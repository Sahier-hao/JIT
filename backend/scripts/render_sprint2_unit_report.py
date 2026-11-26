"""Render the Chinese Sprint2 unit-test report to PDF and PNG with local Chrome."""
import json
import os
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[2]
GENERATED = ROOT / "docs/test-delivery/sprint2-unit-test/generated"


def _chrome():
    configured = os.environ.get("JIT_CHROME")
    candidates = [
        configured,
        shutil.which("chrome"),
        shutil.which("google-chrome"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    raise SystemExit("未找到 Chrome/Edge；可设置 JIT_CHROME 指向浏览器可执行文件")


def main():
    html = GENERATED / "report-zh.html"
    if not html.is_file():
        raise SystemExit(f"缺少中文 HTML 报告：{html}")
    pdf = GENERATED / "report-zh.pdf"
    png = GENERATED / "report-zh.png"
    chrome = _chrome()
    profile = ROOT / ".cache/sprint2-unit/report-browser"
    if profile.exists():
        shutil.rmtree(profile)
    profile.mkdir(parents=True)
    common = [
        str(chrome),
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        f"--user-data-dir={profile}",
    ]
    for command in (
        [*common, "--no-pdf-header-footer", "--print-to-pdf-no-header", f"--print-to-pdf={pdf}", html.as_uri()],
        [*common, "--hide-scrollbars", "--window-size=1240,2400", f"--screenshot={png}", html.as_uri()],
    ):
        completed = subprocess.run(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if completed.returncode != 0:
            raise SystemExit(f"浏览器渲染失败，退出码 {completed.returncode}：{chrome}")
    print(json.dumps({
        "html": str(html),
        "pdf": str(pdf),
        "png": str(png),
        "bytes": {"pdf": pdf.stat().st_size, "png": png.stat().st_size},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
