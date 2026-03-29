import json
import uuid
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import cast

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import or_
from werkzeug.utils import secure_filename

from db.database import SessionLocal
from db.models import (
    FinanceChatMessage,
    FinanceChatSession,
    Insight,
    Statement,
    SupporterAlert,
    SupporterChatMessage,
    SupporterLinkRequest,
    SupporterNote,
    SupporterNotification,
    Translation,
    User,
    UserSpendingLimit,
    UserSupporter,
)
from services.combine import combine_transactions
from services.simplify import simplify as simplify_statement
from services.statement_processor import process_statement
from services.supporter_chat import generate_supporter_chat_reply
from services.translate import translate as translate_statement

supporters_bp = Blueprint("supporters", __name__)


def _supporter_payload(us: UserSupporter) -> dict:
    linked = us.linked_supporter
    name = (linked.full_name or linked.email.split("@")[0]) if linked else us.display_name
    contact = linked.email if linked else us.contact
    return {
        "id": us.id,
        "user_id": us.user_id,
        "linked_supporter_id": us.linked_supporter_id,
        "display_name": name or "Unknown",
        "contact": contact or "",
        "is_registered": us.linked_supporter_id is not None,
        "added_at": us.added_at.isoformat(),
    }


def _notif_payload(n: SupporterNotification, me_id: int) -> dict:
    from_name = ""
    if n.from_user:
        from_name = n.from_user.full_name or n.from_user.email.split("@")[0]
    return {
        "id": n.id,
        "from_user_id": n.from_user_id,
        "to_user_id": n.to_user_id,
        "from_name": from_name,
        "message": n.message,
        "read": n.read,
        "created_at": n.created_at.isoformat(),
        "is_mine": n.from_user_id == me_id,
    }


def _to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value).replace("R", "").replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _safe_float(value) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _is_supporter(db, user_id: int) -> bool:
    me = db.get(User, user_id)
    return bool(me and me.role == "supporter")


def _linked_user_ids_for_supporter(db, supporter_id: int) -> set[int]:
    direct_users = {
        u.id
        for u in db.query(User).filter(User.supporter_id == supporter_id).all()
    }
    linked_users = {
        us.user_id
        for us in db.query(UserSupporter).filter(UserSupporter.linked_supporter_id == supporter_id).all()
    }
    return direct_users.union(linked_users)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value[:19], fmt)
        except ValueError:
            continue
    return None


def _insight_transactions(insight: Insight | None) -> list[dict]:
    if not insight or not insight.raw_transactions:
        return []

    try:
        combined = json.loads(insight.raw_transactions)
    except json.JSONDecodeError:
        return []

    rows: list[dict] = []
    for acc in combined.get("accounts", []):
        account_number = acc.get("account_number") or ""
        for trx in acc.get("transactions", []):
            amount = _to_decimal(trx.get("amount"))
            rows.append({
                "date": trx.get("date"),
                "date_obj": _parse_dt(trx.get("date")),
                "description": trx.get("description") or "",
                "amount": amount,
                "account_number": account_number,
            })

    rows.sort(key=lambda r: r.get("date") or "", reverse=True)
    return rows


def _spending_limit_payload(limit: UserSpendingLimit | None) -> dict | None:
    if not limit:
        return None
    return {
        "id": limit.id,
        "user_id": limit.user_id,
        "supporter_id": limit.supporter_id,
        "daily_spend_limit": _safe_float(limit.daily_spend_limit),
        "weekly_spend_limit": _safe_float(limit.weekly_spend_limit),
        "monthly_spend_limit": _safe_float(limit.monthly_spend_limit),
        "min_balance_threshold": _safe_float(limit.min_balance_threshold),
        "created_at": limit.created_at.isoformat(),
        "updated_at": limit.updated_at.isoformat(),
    }


def _alert_payload(alert: SupporterAlert) -> dict:
    return _alert_payload_with_db(alert, db=None)


def _trim_snippet(text: str | None, limit: int = 220) -> str | None:
    if not text:
        return None
    clean = " ".join(str(text).split())
    if len(clean) <= limit:
        return clean
    return f"{clean[:limit - 1]}..."


def _alert_sla_minutes(alert_type: str, severity: str) -> int:
    if alert_type == "pause_prompt":
        return 20
    if severity == "critical":
        return 30
    if severity == "warning":
        return 90
    return 240


def _alert_overdue_payload(alert: SupporterAlert) -> dict:
    age_minutes = max(0, int((datetime.utcnow() - alert.created_at).total_seconds() // 60))
    sla_minutes = _alert_sla_minutes(alert.alert_type, alert.severity)
    is_overdue = (not bool(alert.read)) and (not bool(alert.dismissed)) and age_minutes > sla_minutes
    return {
        "age_minutes": age_minutes,
        "sla_minutes": sla_minutes,
        "is_overdue": is_overdue,
        "overdue_by_minutes": max(0, age_minutes - sla_minutes),
    }


def _resolve_chat_context_for_alert(alert: SupporterAlert, metadata: dict, db) -> dict:
    context_meta = metadata.get("chat_context") if isinstance(metadata.get("chat_context"), dict) else {}
    coach = metadata.get("coach_signals") if isinstance(metadata.get("coach_signals"), dict) else {}

    user_message = _trim_snippet(context_meta.get("user_message") or coach.get("trigger_user_message"))
    assistant_message = _trim_snippet(
        context_meta.get("assistant_response_english")
        or context_meta.get("assistant_message")
        or coach.get("trigger_assistant_english")
    )

    if db is None:
        return {
            "user_message": user_message,
            "assistant_message": assistant_message,
        }

    session_id = coach.get("triggered_session_id")
    user_message_id = coach.get("triggered_user_message_id")

    if not user_message and user_message_id:
        msg = db.query(FinanceChatMessage).filter_by(id=int(user_message_id), role="user").first()
        if msg:
            user_message = _trim_snippet(msg.original_text or msg.english_text)

    if session_id and (not user_message or not assistant_message):
        if not user_message:
            latest_user = (
                db.query(FinanceChatMessage)
                .filter_by(session_id=int(session_id), role="user")
                .order_by(FinanceChatMessage.created_at.desc())
                .first()
            )
            if latest_user:
                user_message = _trim_snippet(latest_user.original_text or latest_user.english_text)

        if not assistant_message:
            latest_assistant = (
                db.query(FinanceChatMessage)
                .filter_by(session_id=int(session_id), role="assistant")
                .order_by(FinanceChatMessage.created_at.desc())
                .first()
            )
            if latest_assistant:
                assistant_message = _trim_snippet(latest_assistant.english_text or latest_assistant.original_text)

    if not user_message or not assistant_message:
        latest_chat = (
            db.query(FinanceChatSession)
            .filter(FinanceChatSession.user_id == alert.user_id)
            .order_by(FinanceChatSession.updated_at.desc())
            .first()
        )
        if latest_chat:
            if not user_message:
                fallback_user = (
                    db.query(FinanceChatMessage)
                    .filter_by(session_id=latest_chat.id, role="user")
                    .order_by(FinanceChatMessage.created_at.desc())
                    .first()
                )
                if fallback_user:
                    user_message = _trim_snippet(fallback_user.original_text or fallback_user.english_text)
            if not assistant_message:
                fallback_assistant = (
                    db.query(FinanceChatMessage)
                    .filter_by(session_id=latest_chat.id, role="assistant")
                    .order_by(FinanceChatMessage.created_at.desc())
                    .first()
                )
                if fallback_assistant:
                    assistant_message = _trim_snippet(fallback_assistant.english_text or fallback_assistant.original_text)

    return {
        "user_message": user_message,
        "assistant_message": assistant_message,
    }


def _alert_payload_with_db(alert: SupporterAlert, db=None) -> dict:
    metadata = {}
    if alert.metadata_json:
        try:
            metadata = json.loads(alert.metadata_json)
        except json.JSONDecodeError:
            metadata = {}

    user_name = ""
    if alert.user:
        user_name = alert.user.full_name or alert.user.email.split("@")[0]

    overdue = _alert_overdue_payload(alert)
    chat_context = _resolve_chat_context_for_alert(alert, metadata, db)
    coach = metadata.get("coach_signals") if isinstance(metadata.get("coach_signals"), dict) else {}
    safety = {
        "detected": bool(coach.get("safety_detected")),
        "category": coach.get("safety_category"),
        "label": coach.get("safety_label"),
        "confidence": coach.get("safety_confidence"),
        "evidence": coach.get("safety_evidence") or [],
    }

    return {
        "id": alert.id,
        "user_id": alert.user_id,
        "user_name": user_name,
        "alert_type": alert.alert_type,
        "severity": alert.severity,
        "safe_to_spend": _safe_float(alert.safe_to_spend),
        "metadata": metadata,
        "read": alert.read,
        "dismissed": alert.dismissed,
        "created_at": alert.created_at.isoformat(),
        "chat_context": chat_context,
        "safety": safety,
        **overdue,
    }


def _risk_status(active_alerts: list[SupporterAlert], has_data: bool) -> str:
    if not has_data:
        return "no_data"
    if any(a.severity == "critical" for a in active_alerts):
        return "at_risk"
    if any(a.severity == "warning" for a in active_alerts):
        return "watch"
    return "stable"


def _parse_alert_metadata(alert: SupporterAlert) -> dict:
    metadata_text = cast(str | None, alert.metadata_json)
    if not metadata_text:
        return {}
    try:
        return json.loads(metadata_text)
    except json.JSONDecodeError:
        return {}


def _latest_chat_pause_payload(session: FinanceChatSession | None) -> dict:
    if not session:
        return {
            "session_id": None,
            "is_paused": False,
            "paused_reason": None,
            "paused_at": None,
        }
    return {
        "session_id": session.id,
        "is_paused": bool(session.is_paused),
        "paused_reason": session.paused_reason,
        "paused_at": session.paused_at.isoformat() if session.paused_at else None,
    }


@supporters_bp.get("/search")
@jwt_required()
def search_supporters():
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify({"supporters": []})
    db = SessionLocal()
    try:
        results = (
            db.query(User)
            .filter(
                User.role == "supporter",
                or_(
                    User.full_name.ilike(f"%{q}%"),
                    User.email.ilike(f"%{q}%"),
                ),
            )
            .limit(10)
            .all()
        )
        return jsonify({
            "supporters": [
                {
                    "id": u.id,
                    "display_name": u.full_name or u.email.split("@")[0],
                    "email": u.email,
                }
                for u in results
            ]
        })
    finally:
        db.close()


@supporters_bp.get("/mine")
@jwt_required()
def list_my_supporters():
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        records = db.query(UserSupporter).filter_by(user_id=user_id).all()
        result = []
        for r in records:
            payload = _supporter_payload(r)
            if r.linked_supporter_id:
                limit = (
                    db.query(UserSpendingLimit)
                    .filter_by(user_id=user_id, supporter_id=r.linked_supporter_id)
                    .first()
                )
                payload["spending_limit"] = _spending_limit_payload(limit)
            else:
                payload["spending_limit"] = None
            result.append(payload)
        return jsonify({"supporters": result})
    finally:
        db.close()


@supporters_bp.post("/mine")
@jwt_required()
def add_supporter():
    user_id = int(get_jwt_identity())
    data = request.get_json() or {}

    linked_id = data.get("linked_supporter_id")
    display_name = (data.get("display_name") or "").strip()
    contact = (data.get("contact") or "").strip()

    if not linked_id and not display_name:
        return jsonify({"error": "Either linked_supporter_id or display_name is required"}), 400

    db = SessionLocal()
    try:
        if linked_id:
            sup_user = db.get(User, linked_id)
            if not sup_user or sup_user.role != "supporter":
                return jsonify({"error": "User is not a registered supporter"}), 404
            existing = db.query(UserSupporter).filter_by(
                user_id=user_id, linked_supporter_id=linked_id
            ).first()
            if existing:
                return jsonify({"error": "This supporter is already in your Support Circle"}), 409

        record = UserSupporter(
            user_id=user_id,
            linked_supporter_id=linked_id or None,
            display_name=display_name or None,
            contact=contact or None,
        )
        db.add(record)

        # Keep legacy fields in sync (first supporter sets them)
        user = db.get(User, user_id)
        if not user.trusted_supporter_name:
            if linked_id:
                s = db.get(User, linked_id)
                user.trusted_supporter_name = s.full_name or s.email
                user.trusted_supporter_contact = s.email
            else:
                user.trusted_supporter_name = display_name
                user.trusted_supporter_contact = contact

        db.commit()
        db.refresh(record)
        return jsonify({"supporter": _supporter_payload(record)}), 201
    finally:
        db.close()


@supporters_bp.delete("/mine/<int:record_id>")
@jwt_required()
def remove_supporter(record_id):
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        record = db.query(UserSupporter).filter_by(id=record_id, user_id=user_id).first()
        if not record:
            return jsonify({"error": "Not found"}), 404
        db.delete(record)
        db.commit()
        return jsonify({"message": "Removed"})
    finally:
        db.close()


@supporters_bp.get("/notifications")
@jwt_required()
def get_notifications():
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        notifs = (
            db.query(SupporterNotification)
            .filter(
                or_(
                    SupporterNotification.from_user_id == user_id,
                    SupporterNotification.to_user_id == user_id,
                )
            )
            .order_by(SupporterNotification.created_at.desc())
            .limit(50)
            .all()
        )
        unread = sum(1 for n in notifs if n.to_user_id == user_id and not n.read)
        return jsonify({
            "notifications": [_notif_payload(n, user_id) for n in notifs],
            "unread_count": unread,
        })
    finally:
        db.close()


@supporters_bp.post("/notifications")
@jwt_required()
def send_notification():
    user_id = int(get_jwt_identity())
    data = request.get_json() or {}
    to_user_id = data.get("to_user_id")
    message = (data.get("message") or "").strip()

    if not to_user_id or not message:
        return jsonify({"error": "to_user_id and message are required"}), 400

    db = SessionLocal()
    try:
        target = db.get(User, to_user_id)
        if not target:
            return jsonify({"error": "Target user not found"}), 404

        # Verify they are linked (either direction)
        linked = db.query(UserSupporter).filter_by(
            user_id=user_id, linked_supporter_id=to_user_id
        ).first() or db.query(UserSupporter).filter_by(
            user_id=to_user_id, linked_supporter_id=user_id
        ).first()
        if not linked:
            return jsonify({"error": "You are not linked to this user"}), 403

        notif = SupporterNotification(
            from_user_id=user_id,
            to_user_id=to_user_id,
            message=message,
        )
        db.add(notif)
        db.commit()
        db.refresh(notif)
        return jsonify({"notification": _notif_payload(notif, user_id)}), 201
    finally:
        db.close()


@supporters_bp.put("/notifications/<int:notif_id>/read")
@jwt_required()
def mark_read(notif_id):
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        notif = db.query(SupporterNotification).filter_by(
            id=notif_id, to_user_id=user_id
        ).first()
        if not notif:
            return jsonify({"error": "Not found"}), 404
        notif.read = True
        db.commit()
        return jsonify({"message": "Marked as read"})
    finally:
        db.close()


@supporters_bp.get("/dashboard/alerts")
@jwt_required()
def dashboard_alerts():
    supporter_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        if not _is_supporter(db, supporter_id):
            return jsonify({"error": "Supporter access required"}), 403

        linked_user_ids = _linked_user_ids_for_supporter(db, supporter_id)
        if not linked_user_ids:
            return jsonify({"alerts": [], "unread_count": 0})

        limit = min(int(request.args.get("limit", 50)), 200)
        offset = max(int(request.args.get("offset", 0)), 0)
        include_dismissed = (request.args.get("include_dismissed") or "false").lower() == "true"
        user_filter = request.args.get("user_id")

        query = db.query(SupporterAlert).filter(
            SupporterAlert.supporter_id == supporter_id,
            SupporterAlert.user_id.in_(linked_user_ids),
        )
        if not include_dismissed:
            query = query.filter(SupporterAlert.dismissed.is_(False))
        if user_filter:
            try:
                user_filter_id = int(user_filter)
                query = query.filter(SupporterAlert.user_id == user_filter_id)
            except ValueError:
                return jsonify({"error": "user_id must be an integer"}), 400

        alerts = (
            query.order_by(SupporterAlert.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

        unread_count = (
            db.query(SupporterAlert)
            .filter(
                SupporterAlert.supporter_id == supporter_id,
                SupporterAlert.read.is_(False),
                SupporterAlert.dismissed.is_(False),
            )
            .count()
        )
        return jsonify({
            "alerts": [_alert_payload_with_db(a, db) for a in alerts],
            "unread_count": unread_count,
        })
    finally:
        db.close()


@supporters_bp.get("/dashboard/users")
@jwt_required()
def dashboard_users():
    supporter_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        if not _is_supporter(db, supporter_id):
            return jsonify({"error": "Supporter access required"}), 403

        links = db.query(UserSupporter).filter(UserSupporter.linked_supporter_id == supporter_id).all()
        linked_since_map = {link.user_id: link.added_at for link in links}
        linked_user_ids = _linked_user_ids_for_supporter(db, supporter_id)
        if not linked_user_ids:
            return jsonify({"users": []})

        users = db.query(User).filter(User.id.in_(linked_user_ids)).all()
        payload = []
        now = datetime.utcnow()
        for user in users:
            latest_insight = (
                db.query(Insight)
                .filter(Insight.user_id == user.id)
                .order_by(Insight.created_at.desc())
                .first()
            )
            tx_rows = _insight_transactions(latest_insight)

            spend_30d = Decimal("0")
            spend_7d = Decimal("0")
            for row in tx_rows:
                dt = row.get("date_obj")
                amount = row.get("amount", Decimal("0"))
                if dt and amount < 0:
                    age = (now - dt).days
                    if age <= 30:
                        spend_30d += abs(amount)
                    if age <= 7:
                        spend_7d += abs(amount)

            active_alerts = (
                db.query(SupporterAlert)
                .filter(
                    SupporterAlert.supporter_id == supporter_id,
                    SupporterAlert.user_id == user.id,
                    SupporterAlert.dismissed.is_(False),
                )
                .all()
            )

            latest_chat = (
                db.query(FinanceChatSession)
                .filter(FinanceChatSession.user_id == user.id)
                .order_by(FinanceChatSession.updated_at.desc())
                .first()
            )
            last_active = latest_chat.updated_at if latest_chat else user.created_at

            summary = {}
            if latest_insight and latest_insight.raw_transactions:
                try:
                    summary = json.loads(latest_insight.raw_transactions).get("summary", {})
                except json.JSONDecodeError:
                    summary = {}

            current_balance = _to_decimal(summary.get("combined_current_balance"))

            payload.append({
                "id": user.id,
                "full_name": user.full_name or user.email.split("@")[0],
                "email": user.email,
                "current_balance": float(current_balance),
                "avg_30d_spend": float(spend_30d),
                "spending_7d": float(spend_7d),
                "risk_status": _risk_status(active_alerts, has_data=bool(latest_insight)),
                "last_active": last_active.isoformat() if last_active else None,
                "last_chat_at": latest_chat.updated_at.isoformat() if latest_chat else None,
                "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
                "managed_since": linked_since_map.get(user.id, user.created_at).isoformat(),
                "active_alert_count": len(active_alerts),
                "chat_pause": _latest_chat_pause_payload(latest_chat),
            })

        payload.sort(key=lambda u: u["last_active"] or "", reverse=True)
        return jsonify({"users": payload})
    finally:
        db.close()


@supporters_bp.get("/dashboard/users/<int:user_id>/details")
@jwt_required()
def dashboard_user_details(user_id: int):
    supporter_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        if not _is_supporter(db, supporter_id):
            return jsonify({"error": "Supporter access required"}), 403

        linked_user_ids = _linked_user_ids_for_supporter(db, supporter_id)
        if user_id not in linked_user_ids:
            return jsonify({"error": "Not linked to this user"}), 403

        user = db.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404

        link_record = (
            db.query(UserSupporter)
            .filter_by(user_id=user.id, linked_supporter_id=supporter_id)
            .order_by(UserSupporter.added_at.asc())
            .first()
        )

        latest_insight = (
            db.query(Insight)
            .filter(Insight.user_id == user.id)
            .order_by(Insight.created_at.desc())
            .first()
        )
        tx_rows = _insight_transactions(latest_insight)
        transactions = [
            {
                "date": row.get("date"),
                "description": row.get("description"),
                "amount": float(row.get("amount", Decimal("0"))),
                "account_number": row.get("account_number"),
            }
            for row in tx_rows[:30]
        ]

        spend_30d = Decimal("0")
        spend_7d = Decimal("0")
        income_30d = Decimal("0")
        max_single_spend = Decimal("0")
        spend_values_30d: list[Decimal] = []
        today = datetime.utcnow()
        for row in tx_rows:
            amount = row.get("amount", Decimal("0"))
            tx_date = row.get("date_obj")
            if not tx_date:
                continue
            age_days = (today - tx_date).days
            if amount < 0:
                abs_amt = abs(amount)
                if age_days <= 30:
                    spend_30d += abs_amt
                    spend_values_30d.append(abs_amt)
                    if abs_amt > max_single_spend:
                        max_single_spend = abs_amt
                if age_days <= 7:
                    spend_7d += abs_amt
            elif amount > 0 and age_days <= 30:
                income_30d += amount

        avg_daily_spend_30d = (spend_30d / Decimal("30")) if spend_30d > 0 else Decimal("0")
        spike_count_30d = 0
        if avg_daily_spend_30d > 0:
            spike_threshold = avg_daily_spend_30d * Decimal("3")
            spike_count_30d = sum(1 for value in spend_values_30d if value >= spike_threshold)

        active_alerts = (
            db.query(SupporterAlert)
            .filter(
                SupporterAlert.supporter_id == supporter_id,
                SupporterAlert.user_id == user.id,
                SupporterAlert.dismissed.is_(False),
            )
            .order_by(SupporterAlert.created_at.desc())
            .all()
        )
        unread_alerts = [a for a in active_alerts if not a.read]

        spending_limit = (
            db.query(UserSpendingLimit)
            .filter_by(user_id=user.id, supporter_id=supporter_id)
            .first()
        )
        notes = (
            db.query(SupporterNote)
            .filter_by(user_id=user.id, supporter_id=supporter_id)
            .order_by(SupporterNote.updated_at.desc())
            .all()
        )
        statements = (
            db.query(Statement)
            .filter(Statement.user_id == user.id)
            .order_by(Statement.created_at.desc())
            .limit(30)
            .all()
        )

        latest_chat = (
            db.query(FinanceChatSession)
            .filter(FinanceChatSession.user_id == user.id)
            .order_by(FinanceChatSession.updated_at.desc())
            .first()
        )

        recurring_bills = []
        payday_note = None
        if active_alerts:
            meta = {}
            if active_alerts[0].metadata_json:
                try:
                    meta = json.loads(active_alerts[0].metadata_json)
                except json.JSONDecodeError:
                    meta = {}
            recurring_bills = meta.get("recurring_bills", [])
            payday_note = meta.get("payday_note")

        return jsonify({
            "user": {
                "id": user.id,
                "full_name": user.full_name or user.email.split("@")[0],
                "email": user.email,
            },
            "transactions": transactions,
            "alerts": [_alert_payload_with_db(a, db) for a in active_alerts],
            "spending_limit": _spending_limit_payload(spending_limit),
            "notes": [
                {
                    "id": n.id,
                    "note_text": n.note_text,
                    "created_at": n.created_at.isoformat(),
                    "updated_at": n.updated_at.isoformat(),
                }
                for n in notes
            ],
            "insights": {
                "recurring_bills": recurring_bills,
                "payday_note": payday_note,
            },
            "statement_history": [
                {
                    "id": s.id,
                    "original_filename": s.original_filename,
                    "status": s.status,
                    "created_at": s.created_at.isoformat(),
                    "insight_id": s.insight_id,
                }
                for s in statements
            ],
            "management": {
                "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
                "last_chat_at": latest_chat.updated_at.isoformat() if latest_chat else None,
                "managed_since": (link_record.added_at if link_record else user.created_at).isoformat(),
                "active_alert_count": len(active_alerts),
                "unread_alert_count": len(unread_alerts),
                "spending_7d": float(spend_7d),
                "spending_30d": float(spend_30d),
                "income_30d": float(income_30d),
                "avg_daily_spend_30d": float(avg_daily_spend_30d),
                "max_single_spend_30d": float(max_single_spend),
                "spike_transaction_count_30d": int(spike_count_30d),
            },
            "chat_pause": _latest_chat_pause_payload(latest_chat),
        })
    finally:
        db.close()


@supporters_bp.post("/dashboard/users/<int:user_id>/chat-pause")
@jwt_required()
def set_dashboard_user_chat_pause(user_id: int):
    supporter_id = int(get_jwt_identity())
    data = request.get_json() or {}
    action = (data.get("action") or "").strip().lower()
    reason = (data.get("reason") or "").strip()

    if action not in {"pause", "unpause"}:
        return jsonify({"error": "action must be pause or unpause"}), 400

    db = SessionLocal()
    try:
        if not _is_supporter(db, supporter_id):
            return jsonify({"error": "Supporter access required"}), 403

        linked_user_ids = _linked_user_ids_for_supporter(db, supporter_id)
        if user_id not in linked_user_ids:
            return jsonify({"error": "Not linked to this user"}), 403

        latest_chat = (
            db.query(FinanceChatSession)
            .filter(FinanceChatSession.user_id == user_id)
            .order_by(FinanceChatSession.updated_at.desc())
            .first()
        )
        if not latest_chat:
            return jsonify({"error": "No chat session found for this user"}), 404

        if action == "pause":
            pause_reason = reason or "supporter_review_required"
            latest_chat.is_paused = True  # type: ignore[assignment]
            latest_chat.paused_reason = pause_reason  # type: ignore[assignment]
            latest_chat.paused_at = datetime.utcnow()  # type: ignore[assignment]

            message = "Your Trusted Supporter has paused your chat while they review your spending plan."
            if reason:
                message = f"{message} Reason: {reason}"
        else:
            latest_chat.is_paused = False  # type: ignore[assignment]
            latest_chat.paused_reason = None  # type: ignore[assignment]
            latest_chat.paused_at = None  # type: ignore[assignment]
            message = "Your Trusted Supporter has unpaused your chat."
            if reason:
                message = f"{message} Note: {reason}"

        notif = SupporterNotification(
            from_user_id=supporter_id,
            to_user_id=user_id,
            message=message,
        )
        db.add(notif)

        db.commit()
        return jsonify({
            "message": "Chat pause state updated",
            "action": action,
            "chat_pause": _latest_chat_pause_payload(latest_chat),
        })
    finally:
        db.close()


@supporters_bp.post("/dashboard/spending-limit")
@jwt_required()
def upsert_spending_limit():
    supporter_id = int(get_jwt_identity())
    data = request.get_json() or {}
    user_id = data.get("user_id")

    if not user_id:
        return jsonify({"error": "user_id is required"}), 400

    db = SessionLocal()
    try:
        if not _is_supporter(db, supporter_id):
            return jsonify({"error": "Supporter access required"}), 403

        linked_user_ids = _linked_user_ids_for_supporter(db, supporter_id)
        if int(user_id) not in linked_user_ids:
            return jsonify({"error": "Not linked to this user"}), 403

        record = (
            db.query(UserSpendingLimit)
            .filter_by(user_id=int(user_id), supporter_id=supporter_id)
            .first()
        )
        if not record:
            record = UserSpendingLimit(user_id=int(user_id), supporter_id=supporter_id)
            db.add(record)

        record.daily_spend_limit = _to_decimal(data.get("daily_spend_limit")) if data.get("daily_spend_limit") is not None else None
        record.weekly_spend_limit = _to_decimal(data.get("weekly_spend_limit")) if data.get("weekly_spend_limit") is not None else None
        record.monthly_spend_limit = _to_decimal(data.get("monthly_spend_limit")) if data.get("monthly_spend_limit") is not None else None
        record.min_balance_threshold = _to_decimal(data.get("min_balance_threshold")) if data.get("min_balance_threshold") is not None else None
        record.updated_at = datetime.utcnow()

        db.commit()
        db.refresh(record)
        return jsonify({"spending_limit": _spending_limit_payload(record)})
    finally:
        db.close()


@supporters_bp.post("/dashboard/notes")
@jwt_required()
def add_supporter_note():
    supporter_id = int(get_jwt_identity())
    data = request.get_json() or {}
    user_id = data.get("user_id")
    note_text = (data.get("note_text") or "").strip()

    if not user_id or not note_text:
        return jsonify({"error": "user_id and note_text are required"}), 400

    db = SessionLocal()
    try:
        if not _is_supporter(db, supporter_id):
            return jsonify({"error": "Supporter access required"}), 403

        linked_user_ids = _linked_user_ids_for_supporter(db, supporter_id)
        if int(user_id) not in linked_user_ids:
            return jsonify({"error": "Not linked to this user"}), 403

        note = SupporterNote(
            user_id=int(user_id),
            supporter_id=supporter_id,
            note_text=note_text,
            updated_at=datetime.utcnow(),
        )
        db.add(note)

        # Deliver note as a user-visible notice
        supporter_obj = db.get(User, supporter_id)
        supporter_name = (
            (supporter_obj.full_name or supporter_obj.email.split("@")[0])
            if supporter_obj
            else "Your supporter"
        )
        preview = note_text[:200] + ("…" if len(note_text) > 200 else "")
        notif = SupporterNotification(
            from_user_id=supporter_id,
            to_user_id=int(user_id),
            message=f"📝 Note from {supporter_name}: {preview}",
        )
        db.add(notif)

        db.commit()
        db.refresh(note)
        return jsonify({
            "note": {
                "id": note.id,
                "user_id": note.user_id,
                "supporter_id": note.supporter_id,
                "note_text": note.note_text,
                "created_at": note.created_at.isoformat(),
                "updated_at": note.updated_at.isoformat(),
            }
        }), 201
    finally:
        db.close()


@supporters_bp.put("/dashboard/alerts/<int:alert_id>/dismiss")
@jwt_required()
def dismiss_dashboard_alert(alert_id: int):
    supporter_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        alert = db.query(SupporterAlert).filter_by(id=alert_id, supporter_id=supporter_id).first()
        if not alert:
            return jsonify({"error": "Alert not found"}), 404
        alert.dismissed = True
        db.commit()
        return jsonify({"message": "Alert dismissed"})
    finally:
        db.close()


@supporters_bp.put("/dashboard/alerts/<int:alert_id>/read")
@jwt_required()
def mark_dashboard_alert_read(alert_id: int):
    supporter_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        alert = db.query(SupporterAlert).filter_by(id=alert_id, supporter_id=supporter_id).first()
        if not alert:
            return jsonify({"error": "Alert not found"}), 404
        alert.read = True
        db.commit()
        return jsonify({"message": "Alert marked as read"})
    finally:
        db.close()


@supporters_bp.post("/dashboard/alerts/<int:alert_id>/decision")
@jwt_required()
def decide_dashboard_alert(alert_id: int):
    supporter_id = int(get_jwt_identity())
    data = request.get_json() or {}
    decision = (data.get("decision") or "").strip().lower()
    note = (data.get("note") or "").strip()

    if decision not in {"approve", "decline"}:
        return jsonify({"error": "decision must be approve or decline"}), 400

    db = SessionLocal()
    try:
        if not _is_supporter(db, supporter_id):
            return jsonify({"error": "Supporter access required"}), 403

        alert = db.query(SupporterAlert).filter_by(id=alert_id, supporter_id=supporter_id).first()
        if not alert:
            return jsonify({"error": "Alert not found"}), 404

        metadata = _parse_alert_metadata(alert)
        metadata["supporter_decision"] = {
            "decision": decision,
            "note": note or None,
            "decided_at": datetime.utcnow().isoformat(),
            "supporter_id": supporter_id,
        }
        alert.metadata_json = json.dumps(metadata)  # type: ignore[assignment]
        alert.read = True  # type: ignore[assignment]
        alert.dismissed = True  # type: ignore[assignment]

        paused_session = (
            db.query(FinanceChatSession)
            .filter(
                FinanceChatSession.user_id == alert.user_id,
                FinanceChatSession.is_paused.is_(True),
            )
            .order_by(FinanceChatSession.paused_at.desc(), FinanceChatSession.updated_at.desc())
            .first()
        )
        if paused_session:
            paused_session.is_paused = False  # type: ignore[assignment]
            paused_session.paused_reason = None  # type: ignore[assignment]
            paused_session.paused_at = None  # type: ignore[assignment]

        msg_prefix = "approved" if decision == "approve" else "declined"
        purchase_amount = metadata.get("coach_signals", {}).get("purchase_amount")
        amount_text = f" for R{purchase_amount}" if purchase_amount else ""
        review_message = f"Your Trusted Supporter has {msg_prefix} your spending check{amount_text}."
        if note:
            review_message = f"{review_message} Note: {note}"

        notif = SupporterNotification(
            from_user_id=supporter_id,
            to_user_id=alert.user_id,
            message=review_message,
        )
        db.add(notif)

        db.commit()
        return jsonify({
            "message": "Decision recorded",
            "decision": decision,
            "alert": _alert_payload_with_db(alert, db),
            "session_unpaused": bool(paused_session),
            "session_id": paused_session.id if paused_session else None,
        })
    finally:
        db.close()


# ── Supporter chat ──────────────────────────────────────────────────────────────

@supporters_bp.route("/chat/<int:user_id>/messages", methods=["GET"])
@jwt_required()
def get_supporter_chat_messages(user_id: int):
    """Return the supporter's chat history about a specific linked user."""
    supporter_id = get_jwt_identity()
    db = SessionLocal()
    try:
        link = db.query(UserSupporter).filter_by(
            user_id=user_id, linked_supporter_id=supporter_id
        ).first()
        if not link:
            return jsonify({"error": "Not linked to this user"}), 403

        messages = (
            db.query(SupporterChatMessage)
            .filter_by(supporter_id=supporter_id, user_id=user_id)
            .order_by(SupporterChatMessage.created_at.asc())
            .limit(60)
            .all()
        )
        return jsonify({
            "messages": [
                {
                    "id": m.id,
                    "role": m.role,
                    "text": m.text,
                    "created_at": m.created_at.isoformat(),
                }
                for m in messages
            ]
        })
    finally:
        db.close()


@supporters_bp.route("/chat/<int:user_id>/send", methods=["POST"])
@jwt_required()
def send_supporter_chat_message(user_id: int):
    """Send a supporter message and receive an AI response about the linked user."""
    supporter_id = get_jwt_identity()
    data = request.get_json() or {}
    message = (data.get("message") or "").strip()
    language = (data.get("language") or "english").strip().lower()
    if not message:
        return jsonify({"error": "message is required"}), 400

    db = SessionLocal()
    try:
        link = db.query(UserSupporter).filter_by(
            user_id=user_id, linked_supporter_id=supporter_id
        ).first()
        if not link:
            return jsonify({"error": "Not linked to this user"}), 403

        user = db.query(User).filter_by(id=user_id).first()
        if not user:
            return jsonify({"error": "User not found"}), 404

        latest_insight = (
            db.query(Insight)
            .filter_by(user_id=user_id)
            .order_by(Insight.created_at.desc())
            .first()
        )
        raw_transactions = None
        simplified_text = None
        if latest_insight:
            try:
                raw_transactions = (
                    json.loads(latest_insight.raw_transactions)
                    if latest_insight.raw_transactions
                    else None
                )
            except Exception:
                pass
            simplified_text = latest_insight.simplified_text

        history_rows = (
            db.query(SupporterChatMessage)
            .filter_by(supporter_id=supporter_id, user_id=user_id)
            .order_by(SupporterChatMessage.created_at.desc())
            .limit(14)
            .all()
        )
        history = [{"role": m.role, "text": m.text} for m in reversed(history_rows)]

        result = generate_supporter_chat_reply(
            supporter_message=message,
            user_name=user.full_name or user.email,
            raw_transactions=raw_transactions,
            simplified_text=simplified_text,
            history=history,
            language=language,
        )

        supporter_msg = SupporterChatMessage(
            supporter_id=supporter_id,
            user_id=user_id,
            role="supporter",
            text=message,
        )
        db.add(supporter_msg)
        db.flush()

        assistant_msg = SupporterChatMessage(
            supporter_id=supporter_id,
            user_id=user_id,
            role="assistant",
            text=result["assistant_text"],
        )
        db.add(assistant_msg)
        db.commit()

        return jsonify({
            "supporter_message": {
                "id": supporter_msg.id,
                "role": "supporter",
                "text": message,
                "created_at": supporter_msg.created_at.isoformat(),
            },
            "assistant_message": {
                "id": assistant_msg.id,
                "role": "assistant",
                "text": result["assistant_text"],
                "created_at": assistant_msg.created_at.isoformat(),
            },
        })
    finally:
        db.close()


@supporters_bp.route("/chat/<int:user_id>/reset", methods=["POST"])
@jwt_required()
def reset_supporter_chat_messages(user_id: int):
    """Delete supporter chat history for a linked user so a new conversation can start clean."""
    supporter_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        link = db.query(UserSupporter).filter_by(
            user_id=user_id, linked_supporter_id=supporter_id
        ).first()
        if not link:
            return jsonify({"error": "Not linked to this user"}), 403

        deleted_count = (
            db.query(SupporterChatMessage)
            .filter_by(supporter_id=supporter_id, user_id=user_id)
            .delete(synchronize_session=False)
        )
        db.commit()

        return jsonify({
            "message": "Supporter chat history cleared",
            "deleted_count": int(deleted_count or 0),
        })
    finally:
        db.close()


# ── Supporter upload on behalf ───────────────────────────────────────────────────

_UPLOAD_ALLOWED = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}
_UPLOAD_FOLDER = Path("uploads")


@supporters_bp.post("/dashboard/users/<int:user_id>/upload")
@jwt_required()
def supporter_upload_for_user(user_id: int):
    """
    Supporter uploads a bank statement on behalf of a linked user.
    Multipart form fields: file, language (optional, default english).
    Stores the statement file only. No analysis is triggered here.
    """
    supporter_id = int(get_jwt_identity())

    db = SessionLocal()
    try:
        if not _is_supporter(db, supporter_id):
            return jsonify({"error": "Supporter access required"}), 403

        linked_user_ids = _linked_user_ids_for_supporter(db, supporter_id)
        if user_id not in linked_user_ids:
            return jsonify({"error": "Not linked to this user"}), 403

        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400

        file = request.files["file"]
        if not file.filename:
            return jsonify({"error": "No file selected"}), 400

        original_name = secure_filename(file.filename)
        suffix = Path(original_name).suffix.lower()
        if suffix not in _UPLOAD_ALLOWED:
            return jsonify({"error": "Unsupported file type. Use PDF, JPG, PNG, or WebP."}), 400

        language = (request.form.get("language") or "english").strip()

        _UPLOAD_FOLDER.mkdir(exist_ok=True)
        saved_name = f"{user_id}_{uuid.uuid4().hex}{suffix}"
        file_path = str(_UPLOAD_FOLDER / saved_name)
        file.save(file_path)

        stmt_record = Statement(
            user_id=user_id,
            original_filename=original_name,
            file_path=file_path,
            status="done",
        )
        db.add(stmt_record)
        db.commit()

        return jsonify({
            "statement_id": stmt_record.id,
            "language": language,
            "status": "uploaded",
            "message": "Statement uploaded successfully. Analysis was not started.",
        }), 201

    finally:
        db.close()


# ── Supporter view of user's finance chat ────────────────────────────────────

@supporters_bp.get("/dashboard/users/<int:user_id>/finance-chat")
@jwt_required()
def get_user_finance_chat(user_id: int):
    """Supporter reads the user's own finance chat messages (read-only system view)."""
    supporter_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        if not _is_supporter(db, supporter_id):
            return jsonify({"error": "Supporter access required"}), 403
        linked_user_ids = _linked_user_ids_for_supporter(db, supporter_id)
        if user_id not in linked_user_ids:
            return jsonify({"error": "Not linked to this user"}), 403

        latest_session = (
            db.query(FinanceChatSession)
            .filter(FinanceChatSession.user_id == user_id)
            .order_by(FinanceChatSession.updated_at.desc())
            .first()
        )
        if not latest_session:
            return jsonify({"messages": [], "session_id": None})

        messages = (
            db.query(FinanceChatMessage)
            .filter_by(session_id=latest_session.id)
            .order_by(FinanceChatMessage.created_at.asc())
            .limit(60)
            .all()
        )
        return jsonify({
            "session_id": latest_session.id,
            "is_paused": bool(latest_session.is_paused),
            "messages": [
                {
                    "id": m.id,
                    "role": m.role,
                    "text": m.original_text,
                    "english_text": m.english_text,
                    "created_at": m.created_at.isoformat(),
                }
                for m in messages
            ],
        })
    finally:
        db.close()


@supporters_bp.post("/dashboard/users/<int:user_id>/finance-chat/inject")
@jwt_required()
def inject_supporter_message(user_id: int):
    """Supporter injects a message directly into the user's finance chat."""
    supporter_id = int(get_jwt_identity())
    data = request.get_json() or {}
    message_text = (data.get("message") or "").strip()

    if not message_text:
        return jsonify({"error": "message is required"}), 400

    db = SessionLocal()
    try:
        if not _is_supporter(db, supporter_id):
            return jsonify({"error": "Supporter access required"}), 403
        linked_user_ids = _linked_user_ids_for_supporter(db, supporter_id)
        if user_id not in linked_user_ids:
            return jsonify({"error": "Not linked to this user"}), 403

        latest_session = (
            db.query(FinanceChatSession)
            .filter(FinanceChatSession.user_id == user_id)
            .order_by(FinanceChatSession.updated_at.desc())
            .first()
        )
        if not latest_session:
            return jsonify({"error": "User has no active chat session"}), 404

        supporter = db.get(User, supporter_id)
        supporter_name = (
            (supporter.full_name or supporter.email.split("@")[0]) if supporter else "Your supporter"
        )
        prefixed = f"[{supporter_name}]: {message_text}"

        msg = FinanceChatMessage(
            session_id=latest_session.id,
            role="supporter",
            language="english",
            original_text=prefixed,
            english_text=prefixed,
        )
        db.add(msg)

        # Also send as notification so user sees it
        notif = SupporterNotification(
            from_user_id=supporter_id,
            to_user_id=user_id,
            message=f"💬 Message in your chat from {supporter_name}: {message_text[:200]}",
        )
        db.add(notif)
        db.commit()
        db.refresh(msg)

        return jsonify({
            "message": {
                "id": msg.id,
                "role": msg.role,
                "text": msg.original_text,
                "created_at": msg.created_at.isoformat(),
            }
        }), 201
    finally:
        db.close()


# ── Supporter-initiated link requests ─────────────────────────────────────────

@supporters_bp.get("/search-users")
@jwt_required()
def search_users_for_supporter():
    """Supporter searches for an existing regular user by email to request a link."""
    supporter_id = int(get_jwt_identity())
    q = (request.args.get("q") or "").strip()
    if len(q) < 3:
        return jsonify({"users": []})
    db = SessionLocal()
    try:
        if not _is_supporter(db, supporter_id):
            return jsonify({"error": "Supporter access required"}), 403

        already_linked = _linked_user_ids_for_supporter(db, supporter_id)
        results = (
            db.query(User)
            .filter(
                User.role == "user",
                or_(
                    User.full_name.ilike(f"%{q}%"),
                    User.email.ilike(f"%{q}%"),
                ),
            )
            .limit(10)
            .all()
        )
        return jsonify({
            "users": [
                {
                    "id": u.id,
                    "display_name": u.full_name or u.email.split("@")[0],
                    "email": u.email,
                    "already_linked": u.id in already_linked,
                }
                for u in results
            ]
        })
    finally:
        db.close()


@supporters_bp.post("/link-requests")
@jwt_required()
def send_link_request():
    """Supporter sends a link request to a specific user."""
    supporter_id = int(get_jwt_identity())
    data = request.get_json() or {}
    user_id = data.get("user_id")

    if not user_id:
        return jsonify({"error": "user_id is required"}), 400

    db = SessionLocal()
    try:
        if not _is_supporter(db, supporter_id):
            return jsonify({"error": "Supporter access required"}), 403

        target = db.get(User, int(user_id))
        if not target or target.role != "user":
            return jsonify({"error": "User not found"}), 404

        already_linked = _linked_user_ids_for_supporter(db, supporter_id)
        if int(user_id) in already_linked:
            return jsonify({"error": "Already linked to this user"}), 409

        existing = (
            db.query(SupporterLinkRequest)
            .filter_by(supporter_id=supporter_id, user_id=int(user_id), status="pending")
            .first()
        )
        if existing:
            return jsonify({"error": "A pending request already exists for this user"}), 409

        link_req = SupporterLinkRequest(
            supporter_id=supporter_id,
            user_id=int(user_id),
            status="pending",
        )
        db.add(link_req)
        db.flush()

        supporter = db.get(User, supporter_id)
        supporter_name = (
            (supporter.full_name or supporter.email.split("@")[0]) if supporter else "A supporter"
        )
        notif = SupporterNotification(
            from_user_id=supporter_id,
            to_user_id=int(user_id),
            message=(
                f"🤝 {supporter_name} has requested to be your trusted supporter. "
                "Go to Profile → Support Circle to approve or decline."
            ),
        )
        db.add(notif)
        db.commit()
        db.refresh(link_req)

        return jsonify({
            "request_id": link_req.id,
            "status": link_req.status,
            "message": f"Request sent to {target.full_name or target.email}.",
        }), 201
    finally:
        db.close()


@supporters_bp.get("/link-requests/incoming")
@jwt_required()
def get_incoming_link_requests():
    """User retrieves pending link requests directed at them."""
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        pending = (
            db.query(SupporterLinkRequest)
            .filter_by(user_id=user_id, status="pending")
            .order_by(SupporterLinkRequest.created_at.desc())
            .all()
        )
        result = []
        for r in pending:
            supporter = db.get(User, r.supporter_id)
            result.append({
                "id": r.id,
                "supporter_id": r.supporter_id,
                "supporter_name": (supporter.full_name or supporter.email.split("@")[0]) if supporter else "Unknown",
                "supporter_email": supporter.email if supporter else "",
                "status": r.status,
                "created_at": r.created_at.isoformat(),
            })
        return jsonify({"requests": result})
    finally:
        db.close()


@supporters_bp.post("/link-requests/<int:request_id>/respond")
@jwt_required()
def respond_link_request(request_id: int):
    """User approves or declines a link request."""
    user_id = int(get_jwt_identity())
    data = request.get_json() or {}
    action = (data.get("action") or "").strip().lower()

    if action not in {"approve", "decline"}:
        return jsonify({"error": "action must be approve or decline"}), 400

    db = SessionLocal()
    try:
        link_req = db.query(SupporterLinkRequest).filter_by(id=request_id, user_id=user_id).first()
        if not link_req:
            return jsonify({"error": "Request not found"}), 404
        if link_req.status != "pending":
            return jsonify({"error": "Request already handled"}), 409

        supporter = db.get(User, link_req.supporter_id)
        user = db.get(User, user_id)
        user_name = (user.full_name or user.email.split("@")[0]) if user else "The user"
        supporter_name = (
            (supporter.full_name or supporter.email.split("@")[0]) if supporter else "The supporter"
        )

        if action == "approve":
            link_req.status = "approved"
            link_req.updated_at = datetime.utcnow()
            us = UserSupporter(
                user_id=user_id,
                linked_supporter_id=link_req.supporter_id,
                display_name=supporter_name,
            )
            db.add(us)
            notif = SupporterNotification(
                from_user_id=user_id,
                to_user_id=link_req.supporter_id,
                message=f"✅ {user_name} approved your request to be their trusted supporter.",
            )
        else:
            link_req.status = "declined"
            link_req.updated_at = datetime.utcnow()
            notif = SupporterNotification(
                from_user_id=user_id,
                to_user_id=link_req.supporter_id,
                message=f"❌ {user_name} declined your supporter request.",
            )
        db.add(notif)
        db.commit()
        return jsonify({"status": link_req.status})
    finally:
        db.close()
