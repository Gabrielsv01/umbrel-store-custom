"""Database engine and session helpers (SQLite via SQLModel)."""
from sqlmodel import SQLModel, Session, create_engine

from . import config

config.DATA_DIR.mkdir(parents=True, exist_ok=True)

# check_same_thread=False so the engine can be shared across FastAPI's threadpool
# and background scan tasks.
engine = create_engine(
    f"sqlite:///{config.DB_PATH}",
    echo=False,
    connect_args={"check_same_thread": False},
)


def init_db() -> None:
    # Import models so they register on SQLModel.metadata before create_all.
    from . import models  # noqa: F401
    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    return Session(engine)
