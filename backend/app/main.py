from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db, jobs, omdb
from .config import settings
from .recommender import service
from .routers import history, imports, library, movies, recs, search, system, watches

FRONTEND = Path(__file__).parent.parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.migrate()
    worker = jobs.start()
    service.on_startup()
    jobs.enqueue("scores:library", omdb.fill_scores)  # IMDb / RT / Metacritic for films that have none yet
    yield
    worker.cancel()


app = FastAPI(title="Reel", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])
for r in (system, search, movies, watches, library, history, recs, imports):
    app.include_router(r.router, prefix="/api")
app.mount("/media", StaticFiles(directory=settings.media_dir, check_dir=False), name="media")

if FRONTEND.exists():  # packaged builds serve the built UI; in dev Vite does
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = FRONTEND / path
        return FileResponse(f if path and f.is_file() else FRONTEND / "index.html")
