import json
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import cast

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db.database import SessionLocal
from db.models import AbsaSession, SupporterNotification, User, UserSupporter
from services.combine import combine_transactions
from services.unified_finance import ingest_combined_transactions

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


@absa_bp.post("/connect")
@jwt_required()
def connect_absa_accounts():
    """
    Fetches and stores transaction history for selected ABSA accounts.
    Does NOT generate insights — just fetches and persists the data.
    
    Body: { "selected_accounts": ["4048195297", ...] }
    """
    DEMO_ACCOUNT_ALLOWLIST = {'4048195297', '4048223317'}
    
    user_id = int(get_jwt_identity())
    client = _client()
    settings = _settings()
    data = request.get_json() or {}

    # Only process selected accounts, filtered to demo allowlist
    selected_accounts = data.get("selected_accounts", [])
    filtered_accounts = [
        str(acc).strip()
        for acc in selected_accounts
        if str(acc).strip() in DEMO_ACCOUNT_ALLOWLIST
    ]

    to_date = date.today().isoformat()
    from_date = (date.today() - timedelta(days=90)).isoformat()

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404

        active_session = (
            db.query(AbsaSession)
            .filter_by(user_id=user_id, status="active")
            .order_by(AbsaSession.created_at.desc())
            .first()
        )

        if not active_session:
            return jsonify({
                "error": "No active ABSA session. Complete the SureCheck first."
            }), 400

        if not filtered_accounts:
            return jsonify({
                "error": "No valid accounts selected."
            }), 400

        # Fetch transaction history for selected accounts only
        token = client.get_oauth_token()
        trx_responses = []
        for account_number in sorted(set(filtered_accounts)):
            resp = client.fetch_trx_history(
                token=token,
                account_number=account_number,
                org_name=settings.org_name,
                org_id=settings.org_id,
                from_date=from_date,
                to_date=to_date,
            )
            trx_rc = resp.get("resultCode")
            if trx_rc != 200:
                return jsonify({
                    "error": (
                        f"TrxHistory failed for account {account_number} "
                        f"(resultCode={trx_rc}): {resp.get('resultMessage', '')}"
                    )
                }), 502
            trx_responses.append(resp)

        # Combine and store the transaction data
        combined = combine_transactions(trx_responses)
        ingest_combined_transactions(
            db,
            user_id=user_id,
            source_type="absa",
            source_ref=f"absa:{active_session.id}:{from_date}:{to_date}",
            combined=combined,
        )
        
        # Store the selected accounts in the session for display purposes
        active_session.selected_accounts = json.dumps(filtered_accounts)  # type: ignore
        db.commit()

        return jsonify({
            "message": "Accounts connected and data stored successfully.",
            "accounts": filtered_accounts,
            "session_id": active_session.id,
        }), 201

    except Exception as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


@absa_bp.delete("/session/<int:session_id>")
@jwt_required()
def delete_absa_session(session_id: int):
    """Revoke and delete an ABSA session for the current user. Notifies linked supporters."""
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        session_rec = db.query(AbsaSession).filter_by(id=session_id, user_id=user_id).first()
        if not session_rec:
            return jsonify({"error": "Session not found"}), 404

        session_ref = session_rec.reference_number or str(session_id)
        db.delete(session_rec)

        # Notify all registered linked supporters
        user = db.query(User).filter_by(id=user_id).first()
        user_name = user.full_name or user.email if user else "Your user"
        supporter_links = db.query(UserSupporter).filter_by(user_id=user_id).all()
        for link in supporter_links:
            if link.linked_supporter_id:
                notif = SupporterNotification(
                    from_user_id=user_id,
                    to_user_id=link.linked_supporter_id,
                    message=f"{user_name} removed their ABSA bank connection (ref: {session_ref}).",
                )
                db.add(notif)

        db.commit()
        return jsonify({"deleted": True})
    finally:
        db.close()


@absa_bp.get("/sessions")
@jwt_required()
def list_absa_sessions():
    """List all ABSA sessions for the current user, newest first."""
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        sessions = (
            db.query(AbsaSession)
            .filter_by(user_id=user_id)
            .order_by(AbsaSession.created_at.desc())
            .all()
        )
        
        session_list = []
        for s in sessions:
            session_dict = {
                "id": s.id,
                "status": s.status,
                "reference_number": s.reference_number,
                "created_at": s.created_at.isoformat(),
            }
            # Include selected accounts if available
            if s.selected_accounts:
                try:
                    selected = json.loads(s.selected_accounts)
                    session_dict["selected_accounts"] = selected
                except Exception:
                    session_dict["selected_accounts"] = []
            else:
                session_dict["selected_accounts"] = []
            session_list.append(session_dict)
        
        return jsonify({"sessions": session_list})
    finally:
        db.close()
