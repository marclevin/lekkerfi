from datetime import datetime, timedelta
import secrets

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required

import bcrypt

from db.database import SessionLocal
from db.models import SupporterNotification, User, UserSupporter

auth_bp = Blueprint("auth", __name__)

VALID_ROLES = {"user", "supporter"}
ASSIST_CODE_EXPIRY_MINUTES = 10
ASSIST_CODE_MAX_ATTEMPTS = 5


def _user_payload(user: User) -> dict:
    """Canonical user dict returned by every auth endpoint."""
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role or "user",
        "access_account": user.access_account,
        "user_number": user.user_number,
        "user_email": user.user_email,
        "trusted_supporter_name": user.trusted_supporter_name,
        "trusted_supporter_contact": user.trusted_supporter_contact,
        "preferred_language": user.preferred_language or "english",
        "supporter_id": user.supporter_id,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "created_at": user.created_at.isoformat(),
    }


def _linked_supporter_ids(db, user: User) -> set[int]:
    """Return registered supporter ids linked to this user via legacy and support-circle links."""
    ids: set[int] = set()
    if user.supporter_id:
        ids.add(int(user.supporter_id))

    links = db.query(UserSupporter).filter_by(user_id=user.id).all()
    for link in links:
        if link.linked_supporter_id:
            ids.add(int(link.linked_supporter_id))
    return ids


def _assist_tickets_store() -> dict:
    return current_app.config.setdefault("AUTH_ASSIST_TICKETS", {})


def _generate_assist_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _purge_expired_assist_tickets() -> None:
    store = _assist_tickets_store()
    now = datetime.utcnow()
    expired_keys = [k for k, v in store.items() if v.get("expires_at") and v["expires_at"] < now]
    for key in expired_keys:
        store.pop(key, None)


@auth_bp.post("/register")
def register():
    data = request.get_json() or {}
    for field in ("email", "password"):
        if not data.get(field):
            return jsonify({"error": f"{field} is required"}), 400

    role = (data.get("role") or "user").strip().lower()
    if role not in VALID_ROLES:
        return jsonify({"error": f"role must be one of: {', '.join(VALID_ROLES)}"}), 400

    db = SessionLocal()
    try:
        if db.query(User).filter_by(email=data["email"]).first():
            return jsonify({"error": "Email already registered"}), 409

        pw_hash = bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt()).decode()
        user = User(
            email=data["email"],
            password_hash=pw_hash,
            full_name=(data.get("full_name") or "").strip() or None,
            role=role,
            access_account=data.get("access_account") or "",
            user_number=data.get("user_number", "1"),
            user_email=data.get("user_email") or data["email"],
            trusted_supporter_name=data.get("trusted_supporter_name"),
            trusted_supporter_contact=data.get("trusted_supporter_contact"),
            preferred_language=data.get("preferred_language", "english") or "english",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return jsonify({"message": "User created", "user_id": user.id}), 201
    finally:
        db.close()


@auth_bp.post("/login")
def login():
    data = request.get_json() or {}
    if not data.get("email") or not data.get("password"):
        return jsonify({"error": "email and password are required"}), 400

    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=data["email"]).first()
        if not user or not bcrypt.checkpw(data["password"].encode(), user.password_hash.encode()):
            return jsonify({"error": "Invalid credentials"}), 401

        user.last_login_at = datetime.utcnow()
        db.commit()
        db.refresh(user)

        access_token = create_access_token(identity=str(user.id))
        return jsonify({"access_token": access_token, "user": _user_payload(user)})
    finally:
        db.close()


@auth_bp.post("/login-assist/request")
def request_login_assist():
    """
    Starts a trusted-supporter assisted login.

    Body: { "email": "user@example.com" }
    Generates a short-lived code, sends it to linked registered supporters,
    and returns a temporary ticket id for verification.
    """
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    if not email:
        return jsonify({"error": "email is required"}), 400

    _purge_expired_assist_tickets()

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email.ilike(email)).first()
        if not user:
            # Deliberately generic response to reduce account enumeration.
            return jsonify({
                "message": "If that account exists and has a trusted supporter, they were notified.",
            }), 200

        supporter_ids = _linked_supporter_ids(db, user)
        if not supporter_ids:
            return jsonify({
                "error": (
                    "No registered trusted supporter is linked to this account yet. "
                    "Use your password login, or ask support to link a registered supporter first."
                )
            }), 400

        code = _generate_assist_code()
        ticket_id = secrets.token_urlsafe(20)
        expires_at = datetime.utcnow() + timedelta(minutes=ASSIST_CODE_EXPIRY_MINUTES)

        _assist_tickets_store()[ticket_id] = {
            "user_id": int(user.id),
            "email": user.email,
            "code": code,
            "expires_at": expires_at,
            "attempts": 0,
            "max_attempts": ASSIST_CODE_MAX_ATTEMPTS,
        }

        display_name = (user.full_name or user.email).strip()
        for supporter_id in supporter_ids:
            notif = SupporterNotification(
                from_user_id=user.id,
                to_user_id=supporter_id,
                message=(
                    f"Assisted login request for {display_name}. "
                    f"Code: {code}. Expires in {ASSIST_CODE_EXPIRY_MINUTES} minutes. "
                    "Share this code by phone only."
                ),
            )
            db.add(notif)

        db.commit()

        return jsonify({
            "ticket_id": ticket_id,
            "expires_in_seconds": ASSIST_CODE_EXPIRY_MINUTES * 60,
            "supporter_count": len(supporter_ids),
            "supporter_name": user.trusted_supporter_name,
            "message": (
                "We sent a 6-digit assist code to your trusted supporter. "
                "Call them and ask for the code."
            ),
        }), 200
    finally:
        db.close()


@auth_bp.post("/login-assist/verify")
def verify_login_assist():
    """
    Completes trusted-supporter assisted login.

    Body: { "email": "user@example.com", "ticket_id": "...", "code": "123456" }
    """
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    ticket_id = (data.get("ticket_id") or "").strip()
    code = (data.get("code") or "").strip()

    if not email or not ticket_id or not code:
        return jsonify({"error": "email, ticket_id and code are required"}), 400

    _purge_expired_assist_tickets()
    store = _assist_tickets_store()
    ticket = store.get(ticket_id)
    if not ticket:
        return jsonify({"error": "This assist session expired. Request a new code."}), 400

    if ticket.get("email", "").lower() != email:
        return jsonify({"error": "This code does not match the provided email."}), 400

    now = datetime.utcnow()
    expires_at = ticket.get("expires_at")
    if not expires_at or expires_at < now:
        store.pop(ticket_id, None)
        return jsonify({"error": "Assist code expired. Request a new code."}), 400

    attempts = int(ticket.get("attempts", 0))
    max_attempts = int(ticket.get("max_attempts", ASSIST_CODE_MAX_ATTEMPTS))
    if attempts >= max_attempts:
        store.pop(ticket_id, None)
        return jsonify({"error": "Too many incorrect tries. Request a new code."}), 429

    if code != str(ticket.get("code", "")):
        ticket["attempts"] = attempts + 1
        remaining = max(0, max_attempts - ticket["attempts"])
        if remaining == 0:
            store.pop(ticket_id, None)
            return jsonify({"error": "Too many incorrect tries. Request a new code."}), 429
        return jsonify({"error": f"Incorrect code. {remaining} tries left."}), 401

    user_id = int(ticket["user_id"])
    store.pop(ticket_id, None)

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404

        user.last_login_at = datetime.utcnow()
        db.commit()
        db.refresh(user)

        access_token = create_access_token(identity=str(user.id))
        return jsonify({"access_token": access_token, "user": _user_payload(user)})
    finally:
        db.close()


@auth_bp.get("/me")
@jwt_required()
def me():
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        return jsonify(_user_payload(user))
    finally:
        db.close()


@auth_bp.put("/me")
@jwt_required()
def update_me():
    user_id = int(get_jwt_identity())
    data = request.get_json() or {}

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404

        if "full_name" in data:
            user.full_name = (data.get("full_name") or "").strip() or None
        if "trusted_supporter_name" in data:
            user.trusted_supporter_name = (data.get("trusted_supporter_name") or "").strip() or None
        if "trusted_supporter_contact" in data:
            user.trusted_supporter_contact = (data.get("trusted_supporter_contact") or "").strip() or None
        if "preferred_language" in data:
            user.preferred_language = (data.get("preferred_language") or "").strip() or "english"
        if "access_account" in data:
            user.access_account = (data.get("access_account") or "").strip()
        if "user_number" in data:
            user.user_number = (data.get("user_number") or "").strip() or "1"
        if "user_email" in data:
            user.user_email = (data.get("user_email") or "").strip() or None

        db.commit()
        db.refresh(user)
        return jsonify(_user_payload(user))
    finally:
        db.close()


@auth_bp.post("/register-user")
@jwt_required()
def register_user_for_supporter():
    """
    Allows an authenticated supporter to create a user account on someone's behalf.
    The new user is linked to this supporter via supporter_id.
    """
    supporter_id = int(get_jwt_identity())

    db = SessionLocal()
    try:
        supporter = db.get(User, supporter_id)
        if not supporter or supporter.role != "supporter":
            return jsonify({"error": "Only supporters can create user accounts"}), 403

        data = request.get_json() or {}
        for field in ("email", "password", "access_account"):
            if not data.get(field):
                return jsonify({"error": f"{field} is required"}), 400

        if db.query(User).filter_by(email=data["email"]).first():
            return jsonify({"error": "Email already registered"}), 409

        pw_hash = bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt()).decode()
        new_user = User(
            email=data["email"],
            password_hash=pw_hash,
            full_name=(data.get("full_name") or "").strip() or None,
            role="user",
            access_account=data["access_account"],
            user_number=data.get("user_number", "1"),
            user_email=data.get("user_email") or data["email"],
            preferred_language=data.get("preferred_language", supporter.preferred_language or "english"),
            supporter_id=supporter_id,
            trusted_supporter_name=supporter.full_name or supporter.email,
            trusted_supporter_contact=supporter.email,
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        return jsonify({"message": "User created", "user": _user_payload(new_user)}), 201
    finally:
        db.close()


@auth_bp.get("/my-users")
@jwt_required()
def my_users():
    """Returns all users created by / linked to this supporter."""
    supporter_id = int(get_jwt_identity())

    db = SessionLocal()
    try:
        supporter = db.get(User, supporter_id)
        if not supporter or supporter.role != "supporter":
            return jsonify({"error": "Only supporters can list managed users"}), 403

        users = db.query(User).filter_by(supporter_id=supporter_id).all()
        return jsonify({"users": [_user_payload(u) for u in users]})
    finally:
        db.close()
