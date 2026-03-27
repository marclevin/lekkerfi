import uuid
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db.database import SessionLocal
from db.models import AbsaSession, User

absa_bp = Blueprint("absa", __name__)


def _client():
    return current_app.config["ABSA_CLIENT"]


def _settings():
    return current_app.config["ABSA_SETTINGS"]


def _latest_session(user_id: int, db):
    return (
        db.query(AbsaSession)
        .filter_by(user_id=user_id)
        .order_by(AbsaSession.created_at.desc())
        .first()
    )


def _active_session(user_id: int, db):
    return (
        db.query(AbsaSession)
        .filter_by(user_id=user_id, status="active")
        .order_by(AbsaSession.created_at.desc())
        .first()
    )


@absa_bp.post("/session/start")
@jwt_required()
def start_session():
    """
    Kicks off the long-lived consent flow:
      1. Fetches an ABSA OAuth token
      2. Creates a long-lived consent (returns transaction_id)
      3. Creates a SureCheck for that consent
      4. Persists an AbsaSession (status=surecheck_pending)
      5. Returns the SureCheck details so the frontend can prompt the user
    """
    user_id = int(get_jwt_identity())
    client = _client()
    settings = _settings()

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404

        token = client.get_oauth_token()

        reference_number = f"LFI{uuid.uuid4().hex[:8].upper()}"
        consent_resp = client.create_consent(
            token=token,
            access_account=user.access_account,
            user_number=user.user_number,
            org_name=settings.org_name,
            org_id=settings.org_id,
            merchant_id=settings.merchant_id,
            reference_number=reference_number,
        )

        rc = consent_resp.get("resultCode")
        if rc not in (200, 126):
            return jsonify({
                "error": f"Consent request failed (resultCode={rc}): {consent_resp.get('resultMessage', '')}"
            }), 502

        transaction_id = consent_resp.get("transactionId", "")

        surecheck_resp = client.create_surecheck(
            token=token,
            transaction_id=transaction_id,
            org_name=settings.org_name,
            access_account=user.access_account,
        )

        session_rec = AbsaSession(
            user_id=user_id,
            token=token,
            transaction_id=transaction_id,
            surecheck_reference=surecheck_resp.get("absaReference", ""),
            reference_number=reference_number,
            status="surecheck_pending",
        )
        db.add(session_rec)
        db.commit()
        db.refresh(session_rec)

        return jsonify({
            "session_id": session_rec.id,
            "status": session_rec.status,
            "surecheck": {
                "sureCheckId": surecheck_resp.get("sureCheckId"),
                "absaReference": surecheck_resp.get("absaReference"),
                "status": surecheck_resp.get("status"),
            },
        }), 201
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


@absa_bp.get("/surechecks")
@jwt_required()
def list_surechecks():
    """Lists pending SureChecks for the authenticated user's email."""
    user_id = int(get_jwt_identity())
    client = _client()

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        if not user.user_email:
            return jsonify({"error": "user_email not set on this account"}), 400

        session_rec = _latest_session(user_id, db)
        if not session_rec:
            return jsonify({"error": "No ABSA session found. Call POST /api/absa/session/start first."}), 400

        items = client.list_surechecks(token=session_rec.token, user_email=user.user_email)
        return jsonify({"surechecks": items})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


@absa_bp.post("/surechecks/respond")
@jwt_required()
def respond_surecheck():
    """
    Accepts or rejects a SureCheck.
    Body: { "absa_reference": "...", "action": "Accepted" | "Rejected" }
    """
    user_id = int(get_jwt_identity())
    client = _client()
    data = request.get_json() or {}

    absa_reference = data.get("absa_reference", "").strip()
    action = data.get("action", "Accepted").strip()

    if not absa_reference:
        return jsonify({"error": "absa_reference is required"}), 400
    if action not in ("Accepted", "Rejected"):
        return jsonify({"error": "action must be 'Accepted' or 'Rejected'"}), 400

    db = SessionLocal()
    try:
        session_rec = _latest_session(user_id, db)
        if not session_rec:
            return jsonify({"error": "No ABSA session found."}), 400

        result = client.respond_surecheck(
            token=session_rec.token,
            absa_reference=absa_reference,
            action=action,
        )

        session_rec.status = "active" if action == "Accepted" else "rejected"
        session_rec.updated_at = datetime.utcnow()
        db.commit()

        return jsonify({
            "message": f"SureCheck {action.lower()}",
            "session_status": session_rec.status,
            "result": result,
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


@absa_bp.get("/accounts")
@jwt_required()
def get_accounts():
    """
    Fetches the account list from ABSA AIS.
    Requires an active session (SureCheck must have been accepted).
    """
    user_id = int(get_jwt_identity())
    client = _client()
    settings = _settings()

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404

        session_rec = _active_session(user_id, db)
        if not session_rec:
            return jsonify({
                "error": "No active session. Accept the SureCheck first via POST /api/absa/surechecks/respond."
            }), 400

        payload = client.fetch_accounts(
            token=session_rec.token,
            access_account=user.access_account,
            user_number=user.user_number,
            org_name=settings.org_name,
            org_id=settings.org_id,
            reference_number=session_rec.reference_number,
        )

        rc = payload.get("resultCode")
        if rc != 200:
            return jsonify({
                "error": f"Account fetch failed (resultCode={rc}): {payload.get('resultMessage', '')}"
            }), 502

        return jsonify({"accounts": payload.get("accounts", [])})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()
