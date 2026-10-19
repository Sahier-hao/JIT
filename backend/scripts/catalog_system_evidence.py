"""Real localhost catalog lifecycle and two-model timing; with request diagnostics."""
import ctypes
import json
import math
import os
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from jit_baseline.artifacts import environment, identity
from jit_baseline.catalog_storage import CatalogStorage
from jit_baseline.config import BACKEND
from jit_baseline.data import sha256

OUTPUT = BACKEND.parent / 'docs/evidence/_run'


def hashes(directory):
    return {file.name: sha256(file.read_bytes()) for file in directory.iterdir() if file.is_file()}


def physical_ram():
    if os.name != 'nt':
        return None
    class MemoryStatus(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [
            (name, ctypes.c_ulonglong) for name in ('physical', 'available', 'page', 'available_page',
                                                   'virtual', 'available_virtual', 'extended')]
    value = MemoryStatus()
    value.length = ctypes.sizeof(value)
    return value.physical if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)) else None


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    cache = BACKEND / '.cache'
    cache.mkdir(exist_ok=True)
    sources = {'baseline': BACKEND / 'artifacts/baseline',
               'decision-tree': BACKEND / 'artifacts/decision-tree-v1'}
    before = {name: hashes(directory) for name, directory in sources.items()}
    http, timings = [], []
    with tempfile.TemporaryDirectory(prefix='catalog-system-', dir=cache) as temporary:
        root = Path(temporary) / 'artifacts'
        for name, directory in sources.items():
            shutil.copytree(directory, root / name)
        database = Path(temporary) / 'catalog.sqlite3'
        CatalogStorage(database).initialize()
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            port = probe.getsockname()[1]
        env = dict(os.environ,
                   JIT_CATALOG_DATABASE=str(database), JIT_ARTIFACT_ROOT=str(root), PYTHONIOENCODING='utf-8')
        with (OUTPUT / 'catalog-system-service.log').open('w', encoding='utf-8') as log:
            process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'jit_baseline.api:app',
                                        '--host', '127.0.0.1', '--port', str(port), '--workers', '1'],
                                       cwd=BACKEND, env=env, stdout=log, stderr=log,
                                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
            def call(method, path, body=None, *, record=True):
                headers = {'Content-Type':'application/json'}
                request = urllib.request.Request('http://127.0.0.1:' + str(port) + path,
                          data=json.dumps(body).encode('utf-8') if body is not None else None,
                          headers=headers, method=method)
                started = time.perf_counter()
                try:
                    response = urllib.request.urlopen(request, timeout=10)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    value = json.loads(response.read())
                    status, request_id = response.status, response.headers.get('X-Request-Id')
                elapsed = time.perf_counter() - started
                if record:
                    http.append({'method':method,'path':path,'status':status,
                                 'requestId':request_id,'request':body,'response':value})
                return status, value, elapsed
            try:
                deadline = time.monotonic() + 30
                while True:
                    try:
                        status, _, _ = call('GET','/api/v1/models',record=False)
                        if status == 200:
                            break
                    except (OSError, ValueError):
                        pass
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError('Local catalog service did not become ready')
                    time.sleep(.1)
                assert call('GET','/api/v1/models')[0] == 200
                assert call('GET','/api/v1/model-candidates')[0] == 200
                assert call('GET','/api/v1/feature-schemas/openstack-six-v1')[0] == 200
                assert call('GET','/api/v1/feature-schemas/kamei14-v1')[0] == 200
                candidates = call('GET','/api/v1/model-candidates')[1]['candidates']
                assert len(candidates) == 2
                models = []
                registrations = []
                for candidate in candidates:
                    request = {'candidateId':candidate['candidateId'],'expectedManifestSha256':candidate['manifestSha256']}
                    with ThreadPoolExecutor(max_workers=2) as pool:
                        pair = list(pool.map(lambda _: call('POST','/api/v1/models/register',request), range(2)))
                    assert sorted(r[0] for r in pair) == [200,201]
                    assert pair[0][1]['model']['modelId'] == pair[1][1]['model']['modelId']
                    model = pair[0][1]['model']
                    models.append(model)
                    registrations.append({'method':model['method'],'seconds':[r[2] for r in pair]})
                    row = json.loads((root / candidate['displayName'] / 'test-input.json').read_text(encoding='utf-8'))['records'][0]
                    request = {'modelId':model['modelId'],'featureSchemaVersion':'openstack-six-v1',
                               'project':'OpenStack · 单条功能验收',
                               'record':{'recordId':row['id'],'features':row['metrics'],'time':row['time']}}
                    status, saved, _ = call('POST','/api/v1/predictions',request)
                    assert status == 201
                    assert call('GET','/api/v1/prediction-batches/' + saved['batchId'])[1] == saved
                    for _ in range(5):
                        assert call('POST','/api/v1/predictions',request,record=False)[0] == 201
                    samples = []
                    errors = []
                    for _ in range(200):
                        code, _, elapsed = call('POST','/api/v1/predictions',request,record=False)
                        samples.append(elapsed)
                        if code != 201:
                            errors.append(code)
                    timings.append({'method':model['method'],'modelId':model['modelId'],
                        'artifactRunId':model['artifactRunId'],'warmup':5,'requests':200,'concurrency':1,
                        'seconds':samples,'errors':errors,'p95Seconds':sorted(samples)[math.ceil(.95*len(samples))-1]})
                assert len(call('GET','/api/v1/models')[1]['models']) == 2
                model_path = root / candidates[0]['displayName'] / 'model.joblib'
                model_bytes = model_path.read_bytes()
                model_path.unlink()
                first_model = models[0]
                request = {'modelId':first_model['modelId'],'featureSchemaVersion':'openstack-six-v1',
                           'project':'失败路径验收','record':{'recordId':'invalid-check','features':
                            {'ns':1,'nd':1,'nf':1,'ent':.5,'la':1,'ld':0}}}
                assert call('POST','/api/v1/predictions',request)[0] == 503
                assert call('GET','/api/v1/models?state=invalid')[1]['models'][0]['modelId'] == first_model['modelId']
                saved_entry = next(e for e in http if e['path']=='/api/v1/predictions' and e['status']==201)
                saved = saved_entry['response']
                assert call('GET','/api/v1/prediction-batches/'+saved['batchId'])[1] == saved
                model_path.write_bytes(model_bytes)
                candidate = candidates[0]
                assert call('POST','/api/v1/models/register',{'candidateId':candidate['candidateId'],
                            'expectedManifestSha256':candidate['manifestSha256']})[0] == 200
                counts = {}
                with CatalogStorage(database).connection() as db:
                    for table in ('experiment_run','model_version','run_location','registration_event','prediction_batch','prediction'):
                        counts[table] = db.execute('SELECT count(*) FROM '+table).fetchone()[0]
                assert counts['model_version'] == 2 and counts['prediction_batch'] == counts['prediction']
            finally:
                process.terminate()
                process.wait(timeout=15)
        # Reopen the persisted result in a new service process, same DB, no retraining.
        with (OUTPUT / 'catalog-system-restart.log').open('w', encoding='utf-8') as log:
            process = subprocess.Popen([sys.executable,'-m','uvicorn','jit_baseline.api:app','--host','127.0.0.1',
                                        '--port',str(port)],cwd=BACKEND,env=env,stdout=log,stderr=log,
                                        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            try:
                deadline=time.monotonic()+30
                while True:
                    try:
                        status, reopened, _ = call('GET','/api/v1/prediction-batches/'+saved['batchId'])
                        if status==200:
                            assert reopened == saved
                            break
                    except (OSError,ValueError):
                        pass
                    if time.monotonic()>=deadline or process.poll() is not None:
                        raise RuntimeError('Restart recovery timed out')
                    time.sleep(.1)
            finally:
                process.terminate()
                process.wait(timeout=15)
    unchanged = before == {name:hashes(directory) for name,directory in sources.items()}
    assert unchanged and all(not t['errors'] for t in timings)
    report={'kind':'development-system-evidence','passed':True,'http':http,'counts':counts,
            'originalArtifactsUnchanged':unchanged,'sourceHashes':before,'restartRecovered':True,
            'environment':environment(),'cpu':platform.processor(),'logicalCpus':os.cpu_count(),
            'physicalRamBytes':physical_ram(),
            'registrationTimings':registrations,'timings':timings,'percentile':'nearest-rank',
            'p95TargetSeconds':2.0,'p95TargetMet':all(t['p95Seconds']<=2 for t in timings),
            'scope':'单主机本机 HTTP、两种既有模型；不代表 LAN 或在线效果验收'}
    (OUTPUT/'catalog-system.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'passed':True,'requests':sum(t['requests'] for t in timings),
                      'p95Seconds':{t['method']:t['p95Seconds'] for t in timings}},ensure_ascii=False))


if __name__ == '__main__':
    main()
