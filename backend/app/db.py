from collections.abc import Iterator

from sqlalchemy import event, inspect
from sqlmodel import Session, SQLModel, create_engine, select

from .config import settings
from .models import Setting


def make_engine():
    eng = create_engine(f"sqlite:///{settings.db_path}", connect_args={"check_same_thread": False})

    @event.listens_for(eng, "connect")
    def _pragmas(conn, _):
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")

    return eng


engine = make_engine()


def migrate() -> None:
    """Create missing tables, then add any column a model has that its table lacks. Idempotent, never drops."""
    SQLModel.metadata.create_all(engine)
    have = inspect(engine)
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            existing = {c["name"] for c in have.get_columns(table.name)}
            for col in table.columns:
                if col.name not in existing:
                    ddl = col.type.compile(engine.dialect)
                    conn.exec_driver_sql(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl}')


def reconnect() -> None:
    """After a restore swaps the database file."""
    global engine
    engine.dispose()
    engine = make_engine()
    migrate()


def get_session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


def get_setting(s: Session, key: str, default: str | None = None) -> str | None:
    row = s.get(Setting, key)
    return row.value if row else default


def put_setting(s: Session, key: str, value: str) -> None:
    row = s.get(Setting, key) or Setting(key=key, value=value)
    row.value = value
    s.add(row)
    s.commit()


def all_settings(s: Session) -> dict[str, str]:
    return {r.key: r.value for r in s.exec(select(Setting))}
