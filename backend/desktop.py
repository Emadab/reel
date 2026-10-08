"""Reel as a Windows desktop app: the FastAPI backend serves the built UI inside a native WebView2 window.
Start it from the Start-menu shortcut (`make shortcut`), `make app`, or `uv run pythonw desktop.py`."""
import ctypes
import os
import json
import logging
import socket
import subprocess
import sys
import time
from pathlib import Path

import webview

from app.config import settings

FRONTEND = Path(__file__).parent.parent / "frontend" / "dist"

APP_ID = "Reel.FilmDiary"
ICON = Path(__file__).parent / "assets" / "reel.ico"
STATE = settings.data_dir / "window.json"
user32 = ctypes.windll.user32 if sys.platform == "win32" else None


_mutex = None


def single_instance() -> bool:
    """A named mutex: if Reel is already open, bring its window forward and quit. A launch that's still starting has
    no window yet, so wait for it rather than quitting silently; a holder that never shows one is stuck, so start."""
    global _mutex
    if not user32:
        return True
    k32 = ctypes.windll.kernel32
    k32.CreateMutexW.restype = ctypes.c_void_p
    _mutex = k32.CreateMutexW(None, False, APP_ID)
    if k32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        for _ in range(200):  # up to 10 s
            if hwnd := user32.FindWindowW(None, "Reel"):
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                user32.SetForegroundWindow(hwnd)
                return False
            time.sleep(0.05)
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
    user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]


def hwnd_of(window: webview.Window) -> int:
    return window.native.Handle.ToInt64()


def on_ui(window: webview.Window, fn) -> None:
    from System import Action  # type: ignore[import-not-found]  # pythonnet, shipped with pywebview

    window.native.BeginInvoke(Action(fn))


class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long), ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


if user32:
    SUBCLASSPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM, ctypes.c_size_t, ctypes.c_size_t)
    comctl32 = ctypes.windll.comctl32
    comctl32.SetWindowSubclass.argtypes = [wt.HWND, SUBCLASSPROC, ctypes.c_size_t, ctypes.c_size_t]
    comctl32.DefSubclassProc.restype = ctypes.c_ssize_t
    comctl32.DefSubclassProc.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
    user32.GetSystemMetricsForDpi.argtypes = [ctypes.c_int, wt.UINT]


def _frame_proc(hwnd, msg, wp, lp, _id, _ref):
    """The window keeps its native resizable frame styles (so Windows snaps, maximizes and animates it like any other
    window) but no visible frame: the client area takes the whole window. Maximized windows overhang the monitor by
    the frame width, so then the client is inset by exactly that much."""
    if msg == 0x83 and wp:  # WM_NCCALCSIZE
        if user32.IsZoomed(hwnd):
            dpi = user32.GetDpiForWindow(hwnd) or 96
            pad = user32.GetSystemMetricsForDpi(92, dpi)  # SM_CXPADDEDBORDER
            fx = user32.GetSystemMetricsForDpi(32, dpi) + pad  # SM_CXFRAME
            fy = user32.GetSystemMetricsForDpi(33, dpi) + pad  # SM_CYFRAME
            r = ctypes.cast(lp, ctypes.POINTER(RECT)).contents  # NCCALCSIZE_PARAMS.rgrc[0]
            r.left += fx
            r.right -= fx
            r.top += fy
            r.bottom -= fy
        return 0
    return comctl32.DefSubclassProc(hwnd, msg, wp, lp)


_frame_proc_ref = SUBCLASSPROC(_frame_proc) if user32 else None  # kept alive for the window's lifetime


class Chrome:
    """The custom title bar's window controls (the frame is hidden). Called from the page as pywebview.api.*"""

    def __init__(self) -> None:
        self._window: webview.Window | None = None

    def minimize(self) -> None:
        self._window.minimize()

    def toggle_maximize(self) -> bool:
        w = self._window
        if user32.IsZoomed(hwnd_of(w)):
            w.restore()
            return False
        w.maximize()
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
    """Runs once the native form exists: hide the frame, crisp DPI-sized icons, Win11 corners, saved maximize."""
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
            comctl32.SetWindowSubclass(hwnd, _frame_proc_ref, 1, 0)
            user32.SetWindowPos(hwnd, None, 0, 0, 0, 0, 0x27)  # SWP_FRAMECHANGED|NOMOVE|NOSIZE|NOZORDER: drop the frame now
            if maximized:
                window.native.WindowState = window.native.WindowState.Maximized

        on_ui(window, native)

        def no_status_bar() -> None:
            # pywebview shows WebView2's link-URL bubble (bottom corner) in debug mode; an app never does
            core = window.native.browser.webview.CoreWebView2
            if core is not None:
                core.Settings.IsStatusBarEnabled = False

        window.events.loaded += lambda *_: on_ui(window, no_status_bar)
    except Exception:
        pass  # cosmetic only


def main() -> None:
    if user32:
        # Per-monitor DPI awareness (v2), before any window exists. pywebview only declares system awareness, so on a
        # monitor whose scaling differs from the main one Windows stretched the whole window, cursor included.
        user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    if not single_instance():
        return
    if not (FRONTEND / "index.html").exists():
        user32 and user32.MessageBoxW(None, "The interface isn't built yet. Run `make app` once.", "Reel", 0x10)
        sys.exit(1)

    port = free_port()
    # the API runs in its own process (app/serve.py says why); this one only hosts the window
    debug = bool(os.environ.get("REEL_DEBUG"))
    server = subprocess.Popen(
        [sys.executable, "-m", "app.serve", str(port), str(os.getpid())], cwd=Path(__file__).parent,
        stdout=None if debug else subprocess.DEVNULL, stderr=None if debug else subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    while server.poll() is None:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.05)
    if server.poll() is not None:
        user32 and user32.MessageBoxW(None, "Reel's server didn't start. Run `uv run python desktop.py` with REEL_DEBUG=1 to see why.", "Reel", 0x10)
        sys.exit(1)

    g = load_geometry()
    start = "/" if settings.tmdb_token else "/settings"  # first run: ask for the TMDB token
    # Render on the integrated GPU on dual-GPU laptops: it's plenty for the UI and keeps the discrete one asleep (battery).
    # WebView2 reads extra Chromium flags from this variable; pywebview's own flag is repeated in case it takes over.
    os.environ.setdefault("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-features=ElasticOverscroll --force_low_power_gpu")
    webview.settings["ALLOW_DOWNLOADS"] = True  # backups land in Downloads
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True  # TMDB/IMDb links open in the default browser
    chrome = Chrome()
    window = webview.create_window(
        "Reel", f"http://127.0.0.1:{port}{start}", width=g["width"], height=g["height"], x=g["x"], y=g["y"],
        min_size=(390, 600), background_color="#07080C", text_select=True,
        js_api=chrome,  # a normal resizable window whose frame setup_native hides; the UI draws its own title bar
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
    # Closed: free the name at once so the next launch starts, then end the server outright rather than wait on
    # whatever background job is mid-run (embeddings, UMAP, box art). SQLite rolls back anything interrupted.
    if _mutex:
        ctypes.windll.kernel32.CloseHandle(ctypes.c_void_p(_mutex))
    server.terminate()
    logging.shutdown()
    os._exit(0)


if __name__ == "__main__":
    main()
