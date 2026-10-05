"""Reel as a Windows desktop app: the FastAPI backend serves the built UI inside a native WebView2 window.
Start it from the Start-menu shortcut (`make shortcut`), `make app`, or `uv run pythonw desktop.py`."""
import ctypes
import json
import socket
import sys
import threading
import time
from pathlib import Path

import uvicorn
import webview

from app.config import settings
from app.main import FRONTEND, app

APP_ID = "Reel.FilmDiary"
ICON = Path(__file__).parent / "assets" / "reel.ico"
STATE = settings.data_dir / "window.json"
user32 = ctypes.windll.user32 if sys.platform == "win32" else None


def single_instance() -> bool:
    """A named mutex: if Reel is already open, bring its window forward and quit."""
    if not user32:
        return True
    ctypes.windll.kernel32.CreateMutexW(None, False, APP_ID)
    if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        hwnd = user32.FindWindowW(None, "Reel")
        if hwnd:
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            user32.SetForegroundWindow(hwnd)
        return False
    # its own taskbar group and icon instead of Python's
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(APP_ID)
    return True


def on_screen(x: int, y: int) -> bool:
    class POINT(ctypes.Structure):
        _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

    return not user32 or bool(user32.MonitorFromPoint(POINT(x + 40, y + 20), 0))  # 0 = MONITOR_DEFAULTTONULL


def load_geometry() -> dict:
    try:
        g = json.loads(STATE.read_text())
        g = {k: int(g[k]) for k in ("width", "height", "x", "y")} | {"maximized": bool(g.get("maximized"))}
        if not on_screen(g["x"], g["y"]):  # e.g. a monitor was unplugged: centre it instead
            g["x"] = g["y"] = None
        return g
    except (OSError, ValueError, KeyError, TypeError):
        return {"width": 1440, "height": 900, "x": None, "y": None, "maximized": False}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def set_icon(window: webview.Window) -> None:
    """pywebview has no icon option on Windows; set it on the native WinForms form."""
    try:
        from System import Action  # type: ignore[import-not-found]  # pythonnet, shipped with pywebview
        from System.Drawing import Icon  # type: ignore[import-not-found]

        for _ in range(100):  # the native form exists only once the window is up
            if window.native is not None:
                break
            time.sleep(0.05)
        form = window.native
        form.Invoke(Action(lambda: setattr(form, "Icon", Icon(str(ICON)))))
    except Exception:
        pass  # cosmetic only


def main() -> None:
    if not single_instance():
        return
    if not (FRONTEND / "index.html").exists():
        user32 and user32.MessageBoxW(None, "The interface isn't built yet. Run `make app` once.", "Reel", 0x10)
        sys.exit(1)

    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)

    g = load_geometry()
    start = "/" if settings.tmdb_token else "/settings"  # first run: ask for the TMDB token
    webview.settings["ALLOW_DOWNLOADS"] = True  # backups land in Downloads
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True  # TMDB/IMDb links open in the default browser
    window = webview.create_window(
        "Reel", f"http://127.0.0.1:{port}{start}", width=g["width"], height=g["height"], x=g["x"], y=g["y"],
        min_size=(390, 600), background_color="#07080C", maximized=g["maximized"], text_select=True,
    )

    def remember() -> None:
        try:
            maximized = bool(user32 and user32.IsZoomed(window.native.Handle.ToInt64()))
        except Exception:
            maximized = False
        geometry = {"width": window.width, "height": window.height, "x": window.x, "y": window.y, "maximized": maximized}
        if not maximized:
            STATE.write_text(json.dumps(geometry))
        else:
            STATE.write_text(json.dumps({**load_geometry(), "maximized": True}))

    window.events.closing += remember
    webview.start(set_icon, window, storage_path=str(settings.data_dir / "webview"), debug=False)
    server.should_exit = True


if __name__ == "__main__":
    main()
