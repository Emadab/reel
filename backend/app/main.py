from contextlib import asynccontextmanager
from datetime import date

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, SQLModel, create_engine, func, select

from . import tmdb
from .models import Movie, Watch, WatchIn, Watchlist, WatchUpdate

engine = create_engine(f"sqlite:///{tmdb.DATA / 'movies.db'}", connect_args={"check_same_thread": False})


@asynccontextmanager
async def lifespan(_):
    SQLModel.metadata.create_all(engine)
    yield


app = FastAPI(title="Reel", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_methods=["*"], allow_headers=["*"])
app.mount("/images", StaticFiles(directory=tmdb.IMAGES), name="images")


def db():
    with Session(engine) as s:
        yield s


def _normalize(d: date, precision: str) -> date:
    """'sometime in 2019' is stored as 2019-01-01, 'March 2019' as 2019-03-01."""
    if precision == "year":
        return d.replace(month=1, day=1)
    if precision == "month":
        return d.replace(day=1)
    return d


def _fix_rewatches(s: Session, tmdb_id: int):
    """The earliest watch is the first viewing, every later one is a rewatch."""
    ws = s.exec(select(Watch).where(Watch.tmdb_id == tmdb_id).order_by(Watch.watched_on, Watch.id)).all()
    for i, w in enumerate(ws):
        w.is_rewatch = i > 0
        s.add(w)
    s.commit()


@app.get("/search")
async def search(q: str):
    return await tmdb.search(q)


@app.get("/movies")
def library(s: Session = Depends(db)):
    """Watched movies, most recently watched first."""
    last = func.max(Watch.watched_on)
    rows = s.exec(
        select(Movie, last, func.count(Watch.id)).join(Watch).group_by(Movie.tmdb_id).order_by(last.desc())
    ).all()
    return [{**m.model_dump(), "last_watched": lw, "watch_count": n} for m, lw, n in rows]


@app.get("/movies/{tmdb_id}")
async def movie(tmdb_id: int, s: Session = Depends(db)):
    """Detail page. Fetches and caches the movie if it isn't stored yet."""
    m = await tmdb.get_movie(s, tmdb_id)
    watches = s.exec(select(Watch).where(Watch.tmdb_id == tmdb_id).order_by(Watch.watched_on.desc())).all()
    return {**m.model_dump(), "watches": watches, "in_watchlist": s.get(Watchlist, tmdb_id) is not None}


@app.post("/watches")
async def log_watch(body: WatchIn, s: Session = Depends(db)) -> Watch:
    await tmdb.get_movie(s, body.tmdb_id)
    w = Watch.model_validate(body)
    w.watched_on = _normalize(w.watched_on, w.date_precision)
    s.add(w)
    if wl := s.get(Watchlist, body.tmdb_id):
        s.delete(wl)
    s.commit()
    _fix_rewatches(s, w.tmdb_id)
    s.refresh(w)
    return w


@app.patch("/watches/{watch_id}")
def edit_watch(watch_id: int, body: WatchUpdate, s: Session = Depends(db)) -> Watch:
    w = s.get(Watch, watch_id) or _404()
    w.sqlmodel_update(body.model_dump(exclude_unset=True))
    w.watched_on = _normalize(w.watched_on, w.date_precision)
    s.add(w)
    s.commit()
    _fix_rewatches(s, w.tmdb_id)
    s.refresh(w)
    return w


@app.delete("/watches/{watch_id}", status_code=204)
def delete_watch(watch_id: int, s: Session = Depends(db)):
    w = s.get(Watch, watch_id) or _404()
    s.delete(w)
    s.commit()
    _fix_rewatches(s, w.tmdb_id)


@app.get("/watchlist")
def watchlist(s: Session = Depends(db)):
    rows = s.exec(select(Watchlist, Movie).join(Movie).order_by(Watchlist.priority.desc(), Watchlist.added_at)).all()
    return [{**m.model_dump(), "added_at": wl.added_at, "priority": wl.priority} for wl, m in rows]


@app.post("/watchlist/{tmdb_id}")
async def add_to_watchlist(tmdb_id: int, priority: int = 0, s: Session = Depends(db)) -> Watchlist:
    await tmdb.get_movie(s, tmdb_id)
    wl = s.get(Watchlist, tmdb_id) or Watchlist(tmdb_id=tmdb_id)
    wl.priority = priority
    s.add(wl)
    s.commit()
    s.refresh(wl)
    return wl


@app.delete("/watchlist/{tmdb_id}", status_code=204)
def remove_from_watchlist(tmdb_id: int, s: Session = Depends(db)):
    s.delete(s.get(Watchlist, tmdb_id) or _404())
    s.commit()


def _404():
    raise HTTPException(404, "Not found")
