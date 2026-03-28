"""
Pytest configuration and shared fixtures.

Sets DATABASE_URL to in-memory SQLite BEFORE any app code is imported,
so db/database.py picks up the test engine.
"""

import os

# Must be set before any app import touches db/database.py
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-pytest-only-32ch")
os.environ.setdefault("OPENAI_API_KEY", "sk-test-fake-key")

import json

import bcrypt
import pytest

from api import create_app
from db.database import Base, SessionLocal, engine
from db.models import FinanceChatSession, Insight, User


# ── App / client fixtures ──────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def app():
    application = create_app()
    application.config["TESTING"] = True
    with application.app_context():
        Base.metadata.create_all(engine)
        yield application
        Base.metadata.drop_all(engine)


@pytest.fixture()
def client(app):
    return app.test_client()


# ── DB helpers ─────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def clean_tables():
    """Wipe all rows before each test to keep tests independent."""
    yield
    db = SessionLocal()
    try:
        for table in reversed(Base.metadata.sorted_tables):
            db.execute(table.delete())
        db.commit()
    finally:
        db.close()


# ── User / auth helpers ────────────────────────────────────────────────────────

def make_user(
    email="test@example.com",
    password="password123",
    access_account="1234567890",
    supporter_name=None,
    supporter_contact=None,
) -> User:
    db = SessionLocal()
    try:
        pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        user = User(
            email=email,
            password_hash=pw_hash,
            access_account=access_account,
            trusted_supporter_name=supporter_name,
            trusted_supporter_contact=supporter_contact,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


def get_token(client, email="test@example.com", password="password123") -> str:
    resp = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return resp.get_json()["access_token"]


@pytest.fixture()
def user(client):
    return make_user()


@pytest.fixture()
def auth_header(client, user):
    token = get_token(client)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def user_with_supporter(client):
    return make_user(
        email="supporter@example.com",
        supporter_name="Nomsa",
        supporter_contact="083 000 0000",
    )


@pytest.fixture()
def auth_header_supporter(client, user_with_supporter):
    token = get_token(client, email="supporter@example.com")
    return {"Authorization": f"Bearer {token}"}


# ── Insight fixture ────────────────────────────────────────────────────────────

MINIMAL_TRANSACTIONS = {
    "accounts": [
        {
            "account_number": "1234567890",
            "account_name": "Cheque",
            "account_type": "Current",
            "current_balance": "5000.00",
            "available_balance": "4800.00",
            "transactions": [
                {"date": "2026-03-01", "description": "Salary", "amount": "15000.00", "fee": "0.00"},
                {"date": "2026-03-05", "description": "Groceries", "amount": "-800.00", "fee": "2.50"},
                {"date": "2026-03-10", "description": "Netflix", "amount": "-199.00", "fee": "0.00"},
            ],
        }
    ],
    "summary": {
        "total_accounts": 1,
        "total_transactions": 3,
        "combined_current_balance": "5000.00",
        "combined_available_balance": "4800.00",
    },
    "export_period": {"from": "2025-12-01", "to": "2026-03-01"},
}


@pytest.fixture()
def insight(user):
    db = SessionLocal()
    try:
        ins = Insight(
            user_id=user.id,
            selected_accounts=json.dumps(["1234567890"]),
            raw_transactions=json.dumps(MINIMAL_TRANSACTIONS),
            simplified_text="- We earned R15,000 in salary.\n- We spent R999 on essentials.",
        )
        db.add(ins)
        db.commit()
        db.refresh(ins)
        return ins
    finally:
        db.close()


@pytest.fixture()
def chat_session(user, insight):
    db = SessionLocal()
    try:
        session = FinanceChatSession(user_id=user.id, insight_id=insight.id)
        db.add(session)
        db.commit()
        db.refresh(session)
        return session
    finally:
        db.close()


@pytest.fixture()
def insight_for_supporter(user_with_supporter):
    """Insight owned by the supporter-profile user."""
    db = SessionLocal()
    try:
        ins = Insight(
            user_id=user_with_supporter.id,
            selected_accounts='["1234567890"]',
            raw_transactions='{"accounts":[],"summary":{},"export_period":{}}',
            simplified_text="- Test insight for supporter user.",
        )
        db.add(ins)
        db.commit()
        db.refresh(ins)
        return ins
    finally:
        db.close()


@pytest.fixture()
def chat_session_for_supporter(user_with_supporter, insight_for_supporter):
    """Chat session owned by the supporter-profile user."""
    db = SessionLocal()
    try:
        session = FinanceChatSession(
            user_id=user_with_supporter.id,
            insight_id=insight_for_supporter.id,
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session
    finally:
        db.close()
