"""在前台同时运行本机前后端，并把两个服务的输出写入固定日志。

默认端口与手动启动一致：后端 8000，前端 4173。脚本不隐藏窗口，也不结束
未被本脚本记录的端口占用进程；按 Ctrl+C 会同时停止前后端。
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
LOG_DIR = ROOT / "temp" / "dev"
STATE_FILE = LOG_DIR / "processes.json"
IS_WINDOWS = os.name == "nt"
PRINT_LOCK = threading.Lock()


def configure_console_encoding() -> None:
    """让中文提示和子进程输出按当前控制台代码页显示。"""
    if not IS_WINDOWS:
        return
    try:
        import ctypes

        code_page = ctypes.windll.kernel32.GetConsoleOutputCP()
    except Exception:
        code_page = 65001
    encoding = "utf-8" if code_page == 65001 else f"cp{code_page}"
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding=encoding, errors="replace")
            except (OSError, ValueError):
                pass


configure_console_encoding()


def say(message: str = "") -> None:
    with PRINT_LOCK:
        print(message, flush=True)


def valid_port(value: str) -> int:
    try:
        port = int(value)
    except (TypeError, ValueError) as exc:
        raise argparse.ArgumentTypeError("端口必须是 1–65535 的整数") from exc
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("端口必须是 1–65535 的整数")
    return port


def port_busy(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def listening_pids(port: int) -> set[int]:
    """返回监听指定端口的 PID；Windows 用 netstat，其它平台交给调用方回退。"""
    if not IS_WINDOWS:
        return set()
    try:
        output = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
            check=False,
        ).stdout
    except (OSError, subprocess.TimeoutExpired):
        return set()
    pids: set[int] = set()
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0].upper() != "TCP" or not parts[1].endswith(f":{port}"):
            continue
        state = parts[3].upper()
        if not (state.startswith("LISTEN") or "侦听" in parts[3]):
            continue
        try:
            pids.add(int(parts[4]))
        except ValueError:
            continue
    return pids


def terminate_process(pid: int) -> bool:
    """直接终止单个进程；作为 taskkill 被拒绝时的回退。"""
    if pid <= 0 or pid == os.getpid():
        return False
    if not IS_WINDOWS:
        try:
            os.kill(pid, signal.SIGKILL)
            return True
        except ProcessLookupError:
            return True
        except OSError:
            return False
    try:
        import ctypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = (ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32)
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.TerminateProcess.argtypes = (ctypes.c_void_p, ctypes.c_uint)
        kernel32.TerminateProcess.restype = ctypes.c_int
        kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
        handle = kernel32.OpenProcess(0x0001, 0, pid)
        if not handle:
            return False
        try:
            return bool(kernel32.TerminateProcess(handle, 1))
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        return False


def kill_tree(pid: int) -> bool:
    if pid <= 0 or pid == os.getpid():
        return False
    if IS_WINDOWS:
        for extra in (["/T", "/F"], ["/F"]):
            result = subprocess.run(
                ["taskkill", "/PID", str(pid), *extra],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
            if result.returncode == 0:
                return True
        return terminate_process(pid)
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
        time.sleep(0.5)
        os.killpg(os.getpgid(pid), signal.SIGKILL)
        return True
    except ProcessLookupError:
        return True
    except OSError:
        return False


def port_clear(port: int, owner: int | None, timeout: float = 6.0) -> bool:
    """等待端口释放；有 owner 时还要求 owner 不再是监听者。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if owner is not None:
            if owner not in listening_pids(port) and not port_busy(port):
                return True
        elif not port_busy(port):
            return True
        time.sleep(0.2)
    return False


def write_state(services: list["Service"]) -> None:
    payload = {}
    for service in services:
        if service.process is None:
            continue
        payload[service.name] = {
            "pid": service.process.pid,
            "ownerPid": service.owner_pid,
            "port": service.port,
        }
    STATE_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def stop_recorded() -> int:
    if not STATE_FILE.is_file():
        say("[dev] 没有找到本脚本的服务记录，不会结束未知进程。")
        for label, port in (("后端", 8000), ("前端", 4173)):
            pids = listening_pids(port)
            if pids:
                say(f"[dev] {label}端口 {port} 当前由 PID {', '.join(map(str, sorted(pids)))} 占用。")
        return 1
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        say(f"[dev] 读取服务记录失败：{exc}")
        return 1
    stopped = 0
    remaining = {}
    for name, info in state.items():
        port = info.get("port")
        owner = info.get("ownerPid")
        wrapper = info.get("pid")
        listeners = listening_pids(port) if isinstance(port, int) else set()
        if isinstance(owner, int) and owner in listeners:
            if isinstance(wrapper, int) and wrapper != owner:
                kill_tree(wrapper)
            kill_tree(owner)
            if port_clear(port, owner):
                say(f"[dev] 已停止 {name}（PID {owner}，端口 {port}）。")
                stopped += 1
            else:
                remaining[name] = info
                say(f"[dev] 未能停止 {name}（PID {owner}，端口 {port}），已保留记录。")
        elif isinstance(wrapper, int) and isinstance(port, int) and port_busy(port):
            kill_tree(wrapper)
            if port_clear(port, None):
                say(f"[dev] 已停止 {name} 的启动进程（PID {wrapper}，端口 {port}）。")
                stopped += 1
            else:
                remaining[name] = info
                say(f"[dev] 未能停止 {name}（PID {wrapper}，端口 {port}），已保留记录。")
        else:
            say(f"[dev] 跳过 {name}：记录的进程已不在监听端口 {port}。")
    if remaining:
        STATE_FILE.write_text(json.dumps(remaining, ensure_ascii=False, indent=2), encoding="utf-8")
        say(f"[dev] 清理未完成：已停止 {stopped} 个，仍有 {len(remaining)} 个服务占用端口。")
        return 1
    STATE_FILE.unlink(missing_ok=True)
    say(f"[dev] 清理完成，共停止 {stopped} 个服务。")
    return 0


class Service:
    def __init__(self, name: str, port: int, command: list[str], cwd: Path, env: dict[str, str]):
        self.name = name
        self.port = port
        self.command = command
        self.cwd = cwd
        self.env = env
        self.process: subprocess.Popen[str] | None = None
        self.owner_pid: int | None = None
        self.log_path = LOG_DIR / f"{name}.log"
        self._log = None
        self._reader: threading.Thread | None = None

    def start(self) -> None:
        command_text = subprocess.list2cmdline(self.command)
        self._log = self.log_path.open("w", encoding="utf-8", buffering=1)
        self._log.write(f"# {self.name}  {dt.datetime.now().isoformat(timespec='seconds')}\n")
        self._log.write(f"# cwd: {self.cwd}\n# command: {command_text}\n\n")
        self._log.flush()
        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if IS_WINDOWS else 0
        try:
            self.process = subprocess.Popen(
                self.command,
                cwd=str(self.cwd),
                env=self.env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=flags,
                start_new_session=not IS_WINDOWS,
            )
        except OSError:
            if self._log:
                self._log.close()
                self._log = None
            raise
        self._reader = threading.Thread(
            target=self._pump,
            name=f"{self.name}-output",
            daemon=True,
        )
        self._reader.start()

    def _pump(self) -> None:
        assert self.process is not None and self.process.stdout is not None and self._log is not None
        for line in self.process.stdout:
            line = line.rstrip("\r\n")
            stamp = dt.datetime.now().strftime("%H:%M:%S")
            with PRINT_LOCK:
                print(f"[{self.name}] {line}", flush=True)
                self._log.write(f"{stamp} {line}\n")
                self._log.flush()
        self.process.stdout.close()

    def wait_listening(self, timeout: float = 90.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.process is None or self.process.poll() is not None:
                return False
            if port_busy(self.port):
                if IS_WINDOWS:
                    pids = listening_pids(self.port)
                    if not pids:
                        time.sleep(0.2)
                        continue
                    self.owner_pid = sorted(pids)[0]
                else:
                    self.owner_pid = self.process.pid
                return True
            time.sleep(0.2)
        return False

    def stop(self) -> bool:
        stopped = True
        if self.process is not None:
            if self.process.poll() is None:
                kill_tree(self.process.pid)
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        self.process.kill()
                        self.process.wait(timeout=5)
                    except (OSError, subprocess.TimeoutExpired):
                        stopped = False
            if self.owner_pid and self.owner_pid != self.process.pid:
                kill_tree(self.owner_pid)
            if self.owner_pid is not None:
                stopped = port_clear(self.port, self.owner_pid) and stopped
            else:
                stopped = self.process.poll() is not None and stopped
        if self._reader is not None:
            self._reader.join(timeout=3)
        if self._log is not None and (self._reader is None or not self._reader.is_alive()):
            self._log.close()
            self._log = None
        return stopped


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="前台启动 JIT 本机前后端，显示合并输出并写入 temp/dev 日志。",
    )
    parser.add_argument("--backend-port", "-BackendPort", type=valid_port, default=8000)
    parser.add_argument("--frontend-port", "-FrontendPort", type=valid_port, default=4173)
    parser.add_argument(
        "--stop",
        "-Stop",
        action="store_true",
        help="停止上次由本脚本启动并记录的服务；不会结束未知进程。",
    )
    return parser.parse_args()


def occupied_message(label: str, port: int) -> str:
    pids = listening_pids(port)
    if pids:
        return f"[dev] {label}端口 {port} 已被 PID {', '.join(map(str, sorted(pids)))} 占用。"
    return f"[dev] {label}端口 {port} 已被占用。"


def main() -> int:
    args = parse_args()
    if args.stop:
        return stop_recorded()

    for label, port in (("后端", args.backend_port), ("前端", args.frontend_port)):
        if port_busy(port):
            say(occupied_message(label, port))
            say("[dev] 脚本不会停止其他服务；请先关闭占用进程，或运行 .\\scripts\\dev.cmd -Stop 清理本脚本上次启动的服务。")
            return 2

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    python = BACKEND / ".venv" / "Scripts" / "python.exe"
    python_command = str(python) if python.is_file() else sys.executable

    backend_env = os.environ.copy()
    backend_env["PYTHONUNBUFFERED"] = "1"
    backend_env["PYTHONIOENCODING"] = "utf-8"
    frontend_env = os.environ.copy()
    frontend_env["JIT_FRONTEND_PORT"] = str(args.frontend_port)
    frontend_env["JIT_API_PROXY_TARGET"] = f"http://127.0.0.1:{args.backend_port}"
    frontend_env["NO_COLOR"] = "1"
    frontend_env["FORCE_COLOR"] = "0"

    backend = Service(
        "backend",
        args.backend_port,
        [python_command, "-m", "jit_baseline.cli", "serve", "--port", str(args.backend_port)],
        BACKEND,
        backend_env,
    )
    if IS_WINDOWS:
        frontend_command = ["cmd.exe", "/d", "/s", "/c", "npm.cmd run dev"]
    else:
        frontend_command = ["npm", "run", "dev"]
    frontend = Service(
        "frontend",
        args.frontend_port,
        frontend_command,
        FRONTEND,
        frontend_env,
    )
    services = [backend, frontend]

    say(f"[dev] 后端  http://127.0.0.1:{args.backend_port}")
    say(f"[dev] 前端  http://127.0.0.1:{args.frontend_port}")
    say(f"[dev] 日志  {LOG_DIR / 'backend.log'}")
    say(f"[dev]       {LOG_DIR / 'frontend.log'}")
    say("[dev] 正在启动；首次导入依赖可能需要几十秒，按 Ctrl+C 同时停止两个服务。")
    try:
        for service in services:
            service.start()
            write_state(services)
        for service in services:
            if not service.wait_listening():
                code = service.process.poll() if service.process is not None else None
                if code is not None:
                    say(f"[dev] {service.name} 已退出（退出码 {code}），日志：{service.log_path}")
                else:
                    say(f"[dev] {service.name} 未能在 90 秒内监听端口 {service.port}，日志：{service.log_path}")
                return 1
            write_state(services)
        say("[dev] 两个服务已就绪。")
        while True:
            for service in services:
                assert service.process is not None
                code = service.process.poll()
                if code is not None:
                    say(f"[dev] {service.name} 已退出（退出码 {code}），正在停止另一个服务。")
                    return code or 1
            time.sleep(0.2)
    except KeyboardInterrupt:
        say("\n[dev] 收到 Ctrl+C，正在停止服务...")
        return 0
    except OSError as exc:
        say(f"[dev] 启动失败：{exc}")
        return 1
    finally:
        stopped = all([service.stop() for service in services])
        if stopped:
            STATE_FILE.unlink(missing_ok=True)
            say("[dev] 服务已停止。")
        else:
            write_state(services)
            say("[dev] 有服务未能停止，已保留记录；可运行 .\\scripts\\dev.cmd -Stop 重试。")


if __name__ == "__main__":
    sys.exit(main())
