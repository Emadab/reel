import os
import re
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
ENV_FILE = ROOT / ".env"


class Settings:
    def __init__(self) -> None:
        load_dotenv(ENV_FILE)  # never overrides variables already set (tests rely on this)
        self.reload()

    def reload(self) -> None:
        self.tmdb_token = os.getenv("TMDB_TOKEN", "").strip()
        self.omdb_key = os.getenv("OMDB_KEY", "").strip()
        data = Path(os.getenv("DATA_DIR") or "data")
        self.data_dir = data if data.is_absolute() else (ROOT / data).resolve()
        self.media_dir = self.data_dir / "media"
        self.models_dir = self.data_dir / "models"
        for d in (self.data_dir, self.media_dir, self.models_dir):
            d.mkdir(parents=True, exist_ok=True)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "movies.db"


settings = Settings()


def set_env(key: str, value: str) -> None:
    """Write KEY=value into backend/.env (keeping other lines) and apply it to the running process."""
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    pattern = re.compile(rf"^\s*{re.escape(key)}\s*=")
    lines = [ln for ln in lines if not pattern.match(ln)] + [f"{key}={value}"]
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ[key] = value
    settings.reload()
