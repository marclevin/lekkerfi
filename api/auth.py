from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required

import bcrypt

from db.database import SessionLocal
from db.models import User

auth_bp = Blueprint("auth", __name__)


@auth_bp.post("/register")
def register():
    data = request.get_json() or {}
    for field in ("email", "password", "access_account"):
        if not data.get(field):
            return jsonify({"error": f"{field} is required"}), 400

    db = SessionLocal()
    try:
        if db.query(User).filter_by(email=data["email"]).first():
            return jsonify({"error": "Email already registered"}), 409

        pw_hash = bcrypt.hashpw(data["password"].encode(), bcrypt.gensalt()).decode()
        user = User(
            email=data["email"],
            password_hash=pw_hash,
            access_account=data["access_account"],
            user_number=data.get("user_number", "1"),
            user_email=data.get("user_email", data["email"]),
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

        access_token = create_access_token(identity=str(user.id))
        return jsonify({
            "access_token": access_token,
            "user": {
                "id": user.id,
                "email": user.email,
                "access_account": user.access_account,
            },
        })
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
        return jsonify({
            "id": user.id,
            "email": user.email,
            "access_account": user.access_account,
            "user_number": user.user_number,
            "user_email": user.user_email,
            "created_at": user.created_at.isoformat(),
        })
    finally:
        db.close()
