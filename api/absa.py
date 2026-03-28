import uuid
from datetime import datetime, timedelta, timezone
from typing import cast

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db.database import SessionLocal
from db.models import AbsaSession, User

absa_bp = Blueprint("absa", __name__)
_RECENT_SURECHECK_HOURS = 48


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


def _parse_surecheck_time(item: dict) -> datetime | None:
    candidates = [
        item.get("createdAt"),
        item.get("createdDate"),
        item.get("timestamp"),
        item.get("date"),
        item.get("timeStamp"),
    ]
    for raw in candidates:
        if not raw:
            continue
        text = str(raw).strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(text)
        except ValueError:
            pass
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d %H:%M:%S"):
            try:
                return datetime.strptime(text[:19], fmt)
            except ValueError:
                continue
    return None


def _normalize_surecheck_status(raw_status: str | None) -> str:
    status = (raw_status or "").strip().lower()
    if status in {"accepted", "approved"}:
        return "Accepted"
    if status in {"unaccepted", "pending", "initiated", "awaiting"}:
        return "Unaccepted"
    if status in {"rejected", "declined"}:
        return "Rejected"
    return "Unaccepted"


def _is_recent_surecheck(item: dict) -> bool:
    ts = _parse_surecheck_time(item)
    if ts is None:
        return True
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if ts.tzinfo is not None:
        ts = ts.replace(tzinfo=None)
    return ts >= now - timedelta(hours=_RECENT_SURECHECK_HOURS)


def _format_surechecks(items: list[dict], filter_recent: bool = True) -> list[dict]:
    filtered = []
    for item in items:
        status = _normalize_surecheck_status(item.get("status") or item.get("sureCheckStatus"))
        if filter_recent and not _is_recent_surecheck(item):
            continue
        formatted = dict(item)
        formatted["status"] = status
        filtered.append(formatted)

    filtered.sort(
        key=lambda i: _parse_surecheck_time(i) or datetime.min,
        reverse=True,
    )
    return filtered



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

        if not (user.access_account or "").strip():
            return jsonify({
                "error": "ABSA account number not set. Go to Settings → Personal info to add it before connecting."
            }), 400
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

        session_rec = AbsaSession(
                user_id=user_id,
                token=token,
                transaction_id="",
                surecheck_reference="",
                reference_number=reference_number,
                status="surecheck_pending",
            )
        db.add(session_rec)
        db.commit()
        db.refresh(session_rec)
        return jsonify({
            "session_id": session_rec.id,
            "status": session_rec.status,
            "already_active": False,
            "message": "Consent created. Please accept the SureCheck in your email to continue.",
        }), 200

        # Standard flow: resultCode 200 requires SureCheck creation
        transaction_id = consent_resp.get("transactionId", "")
        if not transaction_id:
            return jsonify({
                "error": "ABSA consent did not return a transactionId — cannot proceed."
            }), 502


    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


@absa_bp.get("/surechecks")
@jwt_required()
def list_surechecks():
    """Lists all SureChecks with Accepted/Unaccepted status for the authenticated user."""
    user_id = int(get_jwt_identity())
    client = _client()

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        if not (cast(str | None, user.user_email) or "").strip():
            return jsonify({"error": "user_email not set on this account"}), 400

        session_rec = _latest_session(user_id, db)
        if not session_rec:
            return jsonify({"error": "No ABSA session found. Call POST /api/absa/session/start first."}), 400

        # If we already have an active session, short-circuit
        if cast(str, session_rec.status) == "active":
            return jsonify({
                "ready_to_continue": True,
                "message": "Long-lived consent is already active.",
                "surechecks": [],
            })

        items = client.list_surechecks(token=session_rec.token, user_email=user.user_email)
        surechecks = _format_surechecks(items, filter_recent=False)

        our_ref = (cast(str | None, session_rec.surecheck_reference) or "").strip()

        # Inject our pending surecheck if ABSA hasn't returned it yet
        if our_ref:
            known_refs = {str(sc.get("absaReference", "")).strip() for sc in surechecks}
            if our_ref not in known_refs:
                surechecks.insert(0, {
                    "absaReference": our_ref,
                    "status": "Unaccepted",
                    "type": "Long-term",
                    "source": "ABSA",
                    "sentAt": session_rec.created_at.isoformat(),
                })

        return jsonify({
            "ready_to_continue": False,
            "message": "Accept the SureCheck below to continue.",
            "surechecks": surechecks,
        })
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
            token=cast(str, session_rec.token),
            absa_reference=absa_reference,
            action=action,
        )

        new_status = cast(str, "active" if action == "Accepted" else "rejected")
        session_rec.status = new_status  # type: ignore
        session_rec.updated_at = datetime.now(timezone.utc)  # type: ignore
        db.commit()

        return jsonify({
            "message": f"SureCheck {action.lower()}",
            "session_status": cast(str, session_rec.status),
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
