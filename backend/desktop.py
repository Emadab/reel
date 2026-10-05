"""Reel as a Windows desktop app: the FastAPI backend serves the built UI inside a native WebView2 window.
Start it from the Start-menu shortcut (`make shortcut`), `make app`, or `uv run pythonw desktop.py`."""
import ctypes
import os
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


if user32:
    from ctypes import wintypes as wt

    user32.SendMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
    user32.LoadImageW.restype = wt.HANDLE
    user32.LoadImageW.argtypes = [wt.HINSTANCE, wt.LPCWSTR, wt.UINT, ctypes.c_int, ctypes.c_int, wt.UINT]
    user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    user32.GetWindowLongPtrW.argtypes = [wt.HWND, ctypes.c_int]
    user32.SetWindowLongPtrW.argtypes = [wt.HWND, ctypes.c_int, ctypes.c_ssize_t]
    user32.IsZoomed.argtypes = [wt.HWND]
    user32.GetDpiForWindow.argtypes = [wt.HWND]


def hwnd_of(window: webview.Window) -> int:
    return window.native.Handle.ToInt64()


def on_ui(window: webview.Window, fn) -> None:
    from System import Action  # type: ignore[import-not-found]  # pythonnet, shipped with pywebview

    window.native.BeginInvoke(Action(fn))


def fit_maximized(window: webview.Window) -> None:
    """A borderless form maximizes over the taskbar; cap it to the work area of its current monitor."""
    from System.Drawing import Rectangle  # type: ignore[import-not-found]
    from System.Windows.Forms import Screen  # type: ignore[import-not-found]

    form = window.native
    scr = Screen.FromHandle(form.Handle)
    wa, b = scr.WorkingArea, scr.Bounds
    form.MaximizedBounds = Rectangle(wa.X - b.X, wa.Y - b.Y, wa.Width, wa.Height)


class Chrome:
    """The custom title bar's window controls (the window is frameless). Called from the page as pywebview.api.*"""

    def __init__(self) -> None:
        self._window: webview.Window | None = None

    def minimize(self) -> None:
        self._window.minimize()

    def toggle_maximize(self) -> bool:
        w = self._window
        if user32.IsZoomed(hwnd_of(w)):
            w.restore()
            return False

        def go() -> None:
            fit_maximized(w)
            w.native.WindowState = w.native.WindowState.Maximized

        on_ui(w, go)
        return True

    def is_maximized(self) -> bool:
        return bool(user32.IsZoomed(hwnd_of(self._window)))

    def close(self) -> None:
        self._window.destroy()

    def drag(self, hit: int = 2) -> None:
        """Hand the mouse to Windows' own move/resize loop: HTCAPTION (2) moves, HTLEFT..HTBOTTOMRIGHT (10-17) resize."""
        if hit not in (2, *range(10, 18)):
            return
        hwnd = hwnd_of(self._window)

        def go() -> None:
            user32.ReleaseCapture()
            user32.SendMessageW(hwnd, 0xA1, hit, 0)  # WM_NCLBUTTONDOWN

        on_ui(self._window, go)


def setup_native(window: webview.Window, maximized: bool) -> None:
    """Runs once the native form exists: crisp DPI-sized icons, Win11 corners, taskbar minimize, saved maximize."""
    for _ in range(100):
        if window.native is not None:
            break
        time.sleep(0.05)
    if not user32 or window.native is None:
        return
    try:
        hwnd = hwnd_of(window)

        def native() -> None:
            # WinForms hands Windows one 32 px icon and lets it scale; load the exact size per DPI from the .ico instead
            dpi = user32.GetDpiForWindow(hwnd) or 96
            for which, metric in ((0, 49), (1, 11)):  # ICON_SMALL/SM_CXSMICON, ICON_BIG/SM_CXICON
                size = user32.GetSystemMetricsForDpi(metric, dpi)
                h = user32.LoadImageW(None, str(ICON), 1, size, size, 0x10)  # IMAGE_ICON, LR_LOADFROMFILE
                if h:
                    user32.SendMessageW(hwnd, 0x80, which, h)  # WM_SETICON
            # rounded corners on Windows 11 (no-op on 10)
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(ctypes.c_int(2)), 4)
            # min/max boxes + system menu: taskbar click minimizes, Win+arrows work; nothing is drawn (no caption)
            style = user32.GetWindowLongPtrW(hwnd, -16)
            user32.SetWindowLongPtrW(hwnd, -16, style | 0x20000 | 0x10000 | 0x80000)
            fit_maximized(window)
            if maximized:
                window.native.WindowState = window.native.WindowState.Maximized

        on_ui(window, native)
        window.events.moved += lambda *_: on_ui(window, lambda: fit_maximized(window))
    except Exception:
        pass  # cosmetic only


def main() -> None:
    if not single_instance():
        return
    if not (FRONTEND / "index.html").exists():
        user32 and user32.MessageBoxW(None, "The interface isn't built yet. Run `make app` once.", "Reel", 0x10)
        sys.exit(1)

    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info" if os.environ.get("REEL_DEBUG") else "warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)

    g = load_geometry()
    start = "/" if settings.tmdb_token else "/settings"  # first run: ask for the TMDB token
    webview.settings["ALLOW_DOWNLOADS"] = True  # backups land in Downloads
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True  # TMDB/IMDb links open in the default browser
    chrome = Chrome()
    window = webview.create_window(
        "Reel", f"http://127.0.0.1:{port}{start}", width=g["width"], height=g["height"], x=g["x"], y=g["y"],
        min_size=(390, 600), background_color="#07080C", text_select=True,
        frameless=True, easy_drag=False, shadow=True, js_api=chrome,  # the UI draws its own title bar
    )
    chrome._window = window

    def remember() -> None:
        try:
            maximized = bool(user32 and user32.IsZoomed(hwnd_of(window)))
        except Exception:
            maximized = False
        geometry = {"width": window.width, "height": window.height, "x": window.x, "y": window.y, "maximized": maximized}
        if not maximized:
            STATE.write_text(json.dumps(geometry))
        else:
            STATE.write_text(json.dumps({**load_geometry(), "maximized": True}))

    window.events.closing += remember
    webview.start(setup_native, (window, g["maximized"]), storage_path=str(settings.data_dir / "webview"), debug=bool(os.environ.get("REEL_DEBUG")))  # REEL_DEBUG=1 opens WebView2 devtools
    server.should_exit = True


if __name__ == "__main__":
    main()
