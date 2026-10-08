"""The API in its own process for the desktop window (desktop.py starts it: `python -m app.serve PORT PARENT_PID`).

The window subclasses its frame with a Python window procedure, so every mouse move and cursor query needs the
GIL. With the server in the same process, any CPU work (embeddings, UMAP, model training, big responses) left the
window unable to answer: busy cursor, frozen input, animations held up. Apart, the window's process stays idle.
The server also runs below normal priority and leaves two cores free, so the WebView's rendering always wins,
and it exits the moment the window's process does."""
import ctypes
import os
import sys
import threading


def main() -> None:
    port, parent = int(sys.argv[1]), int(sys.argv[2])
    spare = str(max(1, (os.cpu_count() or 4) - 2))
    for var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMBA_NUM_THREADS"):
        os.environ.setdefault(var, spare)  # before numpy/torch/numba load
    if sys.platform == "win32":
        k32 = ctypes.windll.kernel32
        k32.SetPriorityClass(k32.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL_PRIORITY_CLASS
        k32.OpenProcess.restype = ctypes.c_void_p
        handle = k32.OpenProcess(0x00100000, False, parent)  # SYNCHRONIZE
        if handle:
            def watch() -> None:
                k32.WaitForSingleObject(ctypes.c_void_p(handle), 0xFFFFFFFF)
                os._exit(0)  # the window is gone (closed or crashed): never linger holding the database
            threading.Thread(target=watch, daemon=True).start()

    import uvicorn

    from app.main import app

    uvicorn.run(app, host="127.0.0.1", port=port, timeout_graceful_shutdown=1,
                log_level="info" if os.environ.get("REEL_DEBUG") else "warning")


if __name__ == "__main__":
    main()
