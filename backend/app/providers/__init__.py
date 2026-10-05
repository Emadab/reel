"""Canonical provider per medium. Each satisfies base.Provider (search, fetch, changed_since)."""
from . import openlibrary, rawg
from .base import Kind, Provider
from .tmdb_tv import provider as tmdb_tv

PRIMARY: dict[Kind, Provider] = {"show": tmdb_tv, "book": openlibrary, "game": rawg}  # type: ignore[dict-item]
