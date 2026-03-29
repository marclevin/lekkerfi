import json
import logging
from datetime import datetime
from typing import cast

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db.database import SessionLocal
from db.models import FinanceChatMessage, FinanceChatSession, User
from services.finance_chat import generate_finance_chat_reply
from services.supporter_alerts import create_supporter_alerts
from services.simplify import simplify
from services.unified_finance import get_latest_unified_combined, rebuild_unified_snapshot

chat_bp = Blueprint("chat", __name__)
_logger = logging.getLogger(__name__)


def _session_payload(session: FinanceChatSession) -> dict:
    paused_at = cast(datetime | None, session.paused_at)
    return {
        "id": session.id,
        "title": session.title,
        "is_paused": bool(cast(bool | None, session.is_paused)),
        "paused_at": paused_at.isoformat() if paused_at is not None else None,
        "paused_reason": session.paused_reason,
        "created_at": session.created_at.isoformat(),
        "updated_at": session.updated_at.isoformat(),
        "message_count": len(session.messages),
    }


def _message_payload(message: FinanceChatMessage) -> dict:
    return {
        "id": message.id,
        "role": message.role,
        "language": message.language,
        "text": message.original_text,
        "english_text": message.english_text,
        "created_at": message.created_at.isoformat(),
    }


@chat_bp.post("/sessions")
@jwt_required()
def create_chat_session():
    """
    Create a finance chat session.
    Body: { "title": "Budget Chat" (optional) }
    """
    user_id = int(get_jwt_identity())
    data = request.get_json() or {}
    title = (data.get("title") or "").strip() or None

    db = SessionLocal()
    try:
        session = FinanceChatSession(
            user_id=user_id,
            title=title,
        )
        db.add(session)
        db.commit()
        db.refresh(session)

        return jsonify({"session": _session_payload(session)}), 201
    finally:
        db.close()


@chat_bp.get("/sessions")
@jwt_required()
def list_chat_sessions():
    """List chat sessions for the authenticated user."""
    user_id = int(get_jwt_identity())

    db = SessionLocal()
    try:
        sessions = (
            db.query(FinanceChatSession)
            .filter_by(user_id=user_id)
            .order_by(FinanceChatSession.updated_at.desc())
            .all()
        )
        return jsonify({"sessions": [_session_payload(s) for s in sessions]})
    finally:
        db.close()


@chat_bp.get("/sessions/<int:session_id>/messages")
@jwt_required()
def list_chat_messages(session_id: int):
    """List messages in a chat session."""
    user_id = int(get_jwt_identity())

    db = SessionLocal()
    try:
        session = db.get(FinanceChatSession, session_id)
        if session is None or cast(int, session.user_id) != user_id:
            return jsonify({"error": "Chat session not found"}), 404

        messages = (
            db.query(FinanceChatMessage)
            .filter_by(session_id=session.id)
            .order_by(FinanceChatMessage.created_at.asc())
            .all()
        )

        return jsonify({
            "session": _session_payload(session),
            "messages": [_message_payload(m) for m in messages],
        })
    finally:
        db.close()


@chat_bp.post("/sessions/<int:session_id>/messages")
@jwt_required()
def send_chat_message(session_id: int):
    """
    Send a message and get assistant reply.

        Body:
    {
      "message": "How can I save more this month?",
            "language": "zulu",
            "trusted_supporter_name": "Nomsa"
    }
    """
    user_id = int(get_jwt_identity())
    data = request.get_json() or {}

    message = (data.get("message") or "").strip()
    language = (data.get("language") or "english").strip()
    trusted_supporter_name = (data.get("trusted_supporter_name") or "").strip() or None

    if not message:
        return jsonify({"error": "message is required"}), 400

    db = SessionLocal()
    try:
        session = db.get(FinanceChatSession, session_id)
        if session is None or cast(int, session.user_id) != user_id:
            return jsonify({"error": "Chat session not found"}), 404

        if bool(cast(bool | None, session.is_paused)):
            paused_at = cast(datetime | None, session.paused_at)
            paused_context = {}
            context_raw = cast(str | None, session.paused_context_json)
            if context_raw:
                try:
                    paused_context = json.loads(context_raw)
                except json.JSONDecodeError:
                    paused_context = {}
            return jsonify({
                "error": "Chat is paused while your Trusted Supporter reviews your spending request.",
                "chat_paused": True,
                "pause_reason": session.paused_reason,
                "paused_at": paused_at.isoformat() if paused_at is not None else None,
                "safety": paused_context.get("safety") if isinstance(paused_context.get("safety"), dict) else None,
            }), 423

        history = (
            db.query(FinanceChatMessage)
            .filter_by(session_id=session.id)
            .order_by(FinanceChatMessage.created_at.asc())
            .all()
        )

        history_english = [
            {
                "role": h.role,
                "english_text": h.english_text,
            }
            for h in history
        ]

        unified_combined = get_latest_unified_combined(db, user_id=user_id)
        if not (unified_combined and unified_combined.get("accounts")):
            # Self-heal stale/missing snapshot if rows were ingested but snapshot was not refreshed.
            unified_combined = rebuild_unified_snapshot(db, user_id=user_id)

        if unified_combined and unified_combined.get("accounts"):
            raw_transactions = json.dumps(unified_combined)
            simplified_text = simplify(unified_combined)
        else:
            raw_transactions = None
            simplified_text = None

        if not raw_transactions:
            return jsonify({
                "error": "No finance data found yet. Please connect ABSA or upload a statement first.",
                "has_financial_context": False,
            }), 409
        if trusted_supporter_name is None:
            user = db.get(User, user_id)
            trusted_supporter_name = cast(str | None, user.trusted_supporter_name) if user is not None else None

        reply = generate_finance_chat_reply(
            user_text=message,
            user_language=language,
            raw_transactions=raw_transactions,
            simplified_text=simplified_text,
            history_english=history_english,
            trusted_supporter_name=trusted_supporter_name,
        )

        user_message = FinanceChatMessage(
            session_id=session.id,
            role="user",
            language=reply["language"],
            original_text=message,
            english_text=reply["user_english"],
        )
        assistant_message = FinanceChatMessage(
            session_id=session.id,
            role="assistant",
            language=reply["language"],
            original_text=reply["assistant_user_language"],
            english_text=reply["assistant_english"],
        )

        db.add(user_message)
        db.add(assistant_message)
        session.updated_at = datetime.utcnow()  # type: ignore[assignment]
        db.commit()
        db.refresh(user_message)
        db.refresh(assistant_message)
        db.refresh(session)

        coach_signals = {
            "safe_to_spend": reply.get("safe_to_spend"),
            "runout_before_payday": reply.get("runout_before_payday"),
            "days_to_payday": reply.get("days_to_payday"),
            "anomaly_count": reply.get("anomaly_count", 0),
            "pause_prompt": reply.get("pause_prompt"),
            "pause_required": bool(reply.get("pause_required")),
            "pause_reason": reply.get("pause_reason"),
            "purchase_amount": reply.get("purchase_amount"),
            "can_afford": reply.get("can_afford"),
            "suggested_supporter_message": reply.get("suggested_supporter_message"),
            "decision_intent": bool(reply.get("decision_intent")),
            "urgency_level": reply.get("urgency_level"),
            "emotional_distress": bool(reply.get("emotional_distress")),
            "repeated_intent": bool(reply.get("repeated_intent")),
            "supporter_flag_required": bool(reply.get("supporter_flag_required")),
            "supporter_priority": reply.get("supporter_priority"),
            "risk_score": reply.get("risk_score", 0),
            "risk_tags": reply.get("risk_tags") or [],
            "recommended_action": reply.get("recommended_action"),
            "safety_detected": bool(reply.get("safety_detected")),
            "safety_category": reply.get("safety_category"),
            "safety_label": reply.get("safety_label"),
            "safety_confidence": reply.get("safety_confidence"),
            "safety_pause_reason": reply.get("safety_pause_reason"),
            "safety_calming_template_key": reply.get("safety_calming_template_key"),
            "safety_language_variant": reply.get("safety_language_variant"),
            "safety_evidence": reply.get("safety_evidence") or [],
            "trigger_user_message": message,
            "trigger_user_english": reply.get("user_english"),
            "trigger_assistant_english": reply.get("assistant_english"),
            "triggered_session_id": session.id,
            "triggered_user_message_id": user_message.id,
        }

        safety_payload = {
            "detected": bool(coach_signals.get("safety_detected")),
            "category": coach_signals.get("safety_category"),
            "label": coach_signals.get("safety_label"),
            "confidence": coach_signals.get("safety_confidence"),
            "pause_reason": coach_signals.get("safety_pause_reason"),
            "calming_template_key": coach_signals.get("safety_calming_template_key"),
            "language_variant": coach_signals.get("safety_language_variant"),
            "evidence": coach_signals.get("safety_evidence") or [],
        }

        if coach_signals["pause_required"]:
            session.is_paused = True  # type: ignore[assignment]
            session.paused_at = datetime.utcnow()  # type: ignore[assignment]
            session.paused_reason = cast(str | None, coach_signals.get("pause_reason"))  # type: ignore[assignment]
            session.paused_context_json = json.dumps({  # type: ignore[assignment]
                "triggered_by": "chat_safety" if str(coach_signals.get("pause_reason") or "").startswith("safety_") else "chat_affordability",
                "purchase_amount": coach_signals.get("purchase_amount"),
                "safe_to_spend": coach_signals.get("safe_to_spend"),
                "runout_before_payday": coach_signals.get("runout_before_payday"),
                "days_to_payday": coach_signals.get("days_to_payday"),
                "can_afford": coach_signals.get("can_afford"),
                "safety": safety_payload,
            })
            db.commit()
            db.refresh(session)

        created_alert_ids = []
        try:
            created_alert_ids = create_supporter_alerts(db, user_id=user_id, coach_signals=coach_signals)
            db.commit()
        except Exception:
            db.rollback()
            created_alert_ids = []

        return jsonify({
            "session": _session_payload(session),
            "user_message": _message_payload(user_message),
            "assistant_message": _message_payload(assistant_message),
            "has_financial_context": bool(raw_transactions),
            "coach_signals": coach_signals,
            "supporter_alert_ids": created_alert_ids,
            "chat_paused": bool(session.is_paused),
            "pause_reason": session.paused_reason,
            "safety": safety_payload,
        }), 201
    except ValueError as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


@chat_bp.post('/calm-auto-activation')
@jwt_required()
def log_calm_auto_activation():
    """Log calm mode auto-activation events for tuning and audit."""
    user_id = int(get_jwt_identity())
    data = request.get_json() or {}
    source = str(data.get('source') or 'unknown').strip()[:64]
    reason = str(data.get('reason') or 'unspecified').strip()[:128]
    route = str(data.get('route') or '').strip()[:128]
    _logger.info(
        'calm_auto_activation user_id=%s source=%s reason=%s route=%s',
        user_id,
        source,
        reason,
        route,
    )
    return jsonify({'logged': True}), 201
