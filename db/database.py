import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///lekkerfi.db")

if DATABASE_URL.startswith("postgres://"):
    # Render may provide postgres://; SQLAlchemy expects postgresql://
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine_kwargs = {"echo": False}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_kwargs)


class Base(DeclarativeBase):
    pass


SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def _ensure_sqlite_user_columns() -> None:
    if not str(engine.url).startswith("sqlite"):
        return

    with engine.begin() as conn:
        rows = conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()
        if not rows:
            return

        existing = {row[1] for row in rows}
        if "trusted_supporter_name" not in existing:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN trusted_supporter_name VARCHAR(255)")
        if "trusted_supporter_contact" not in existing:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN trusted_supporter_contact VARCHAR(255)")
        if "preferred_language" not in existing:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN preferred_language VARCHAR(50) DEFAULT 'english'")
        if "full_name" not in existing:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN full_name VARCHAR(255)")
        if "role" not in existing:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'user'")
        if "supporter_id" not in existing:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN supporter_id INTEGER REFERENCES users(id)")
        if "last_login_at" not in existing:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN last_login_at DATETIME")


def _ensure_sqlite_chat_session_columns() -> None:
    if not str(engine.url).startswith("sqlite"):
        return

    with engine.begin() as conn:
        rows = conn.exec_driver_sql("PRAGMA table_info(finance_chat_sessions)").fetchall()
        if not rows:
            return

        existing = {row[1] for row in rows}
        if "is_paused" not in existing:
            conn.exec_driver_sql("ALTER TABLE finance_chat_sessions ADD COLUMN is_paused BOOLEAN DEFAULT 0")
        if "paused_at" not in existing:
            conn.exec_driver_sql("ALTER TABLE finance_chat_sessions ADD COLUMN paused_at DATETIME")
        if "paused_reason" not in existing:
            conn.exec_driver_sql("ALTER TABLE finance_chat_sessions ADD COLUMN paused_reason VARCHAR(50)")
        if "paused_context_json" not in existing:
            conn.exec_driver_sql("ALTER TABLE finance_chat_sessions ADD COLUMN paused_context_json TEXT")


def init_db() -> None:
    from db import models  # noqa: F401 — ensures models register with Base
    Base.metadata.create_all(engine)
    _ensure_sqlite_user_columns()
    _ensure_sqlite_chat_session_columns()
