"""Film vectors: a bge-small text embedding (384-d, L2-normalised)."""
import asyncio
import os

import numpy as np
from sqlmodel import Session, select

from ..models import Movie

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
MODEL_NAME = "BAAI/bge-small-en-v1.5"
DIM = 384
_model = None


def text(m: Movie) -> str:
    return f"{m.title}. {', '.join(m.genres)}. {', '.join(m.keywords[:20])}. {m.overview or ''}"


def embed_texts(texts: list[str]) -> np.ndarray:
    """Runs the sentence-transformer on CPU. Tests replace this function."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        try:  # the cached copy first: loading must not wait on the network (offline, or HF Hub blocked)
            _model = SentenceTransformer(MODEL_NAME, device="cpu", local_files_only=True)
        except OSError:  # first run: download it once
            _model = SentenceTransformer(MODEL_NAME, device="cpu")
    return np.asarray(_model.encode(texts, batch_size=32, normalize_embeddings=True), dtype=np.float32)


def vec(m: Movie) -> np.ndarray | None:
    return np.frombuffer(m.embedding, dtype=np.float32) if m.embedding else None


def matrix(movies: list[Movie]) -> np.ndarray:
    return np.stack([vec(m) for m in movies]) if movies else np.zeros((0, DIM), np.float32)  # type: ignore[misc]


async def embed_missing(s: Session, progress=None) -> int:
    todo = list(s.exec(select(Movie).where(Movie.embedding.is_(None))))  # type: ignore[union-attr]
    for start in range(0, len(todo), 32):
        batch = todo[start:start + 32]
        vecs = await asyncio.to_thread(embed_texts, [text(m) for m in batch])
        for m, v in zip(batch, vecs):
            m.embedding = np.asarray(v, dtype=np.float32).tobytes()
            s.add(m)
        s.commit()
        if progress:
            progress(min(start + 32, len(todo)), len(todo))
    return len(todo)


def director_ids(m: Movie) -> set[int]:
    return {d["id"] for d in m.directors}
