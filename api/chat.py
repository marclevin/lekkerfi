import json
from datetime import datetime
from typing import cast

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db.database import SessionLocal
from db.models import FinanceChatMessage, FinanceChatSession, Insight, User
from services.finance_chat import generate_finance_chat_reply
from services.supporter_alerts import create_supporter_alerts

chat_bp = Blueprint("chat", __name__)


def _session_payload(session: FinanceChatSession) -> dict:
    paused_at = cast(datetime | None, session.paused_at)
    return {
        "id": session.id,
        "insight_id": session.insight_id,
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


def _latest_user_insight(user_id: int, db) -> Insight | None:
    return (
        db.query(Insight)
        .filter_by(user_id=user_id)
        .order_by(Insight.created_at.desc())
        .first()
    )


@chat_bp.post("/sessions")
@jwt_required()
def create_chat_session():
    """
    Create a finance chat session.
    Body: { "insight_id": 1 (optional), "title": "Budget Chat" (optional) }

    If insight_id is omitted, the latest insight for the user is used.
    """
    user_id = int(get_jwt_identity())
    data = request.get_json() or {}
    title = (data.get("title") or "").strip() or None
    requested_insight_id = data.get("insight_id")

    db = SessionLocal()
    try:
        insight = None
        if requested_insight_id is not None:
            insight = db.get(Insight, int(requested_insight_id))
            if insight is None or cast(int, insight.user_id) != user_id:
                return jsonify({"error": "Insight not found"}), 404
        else:
            insight = _latest_user_insight(user_id=user_id, db=db)

        session = FinanceChatSession(
            user_id=user_id,
            insight_id=insight.id if insight else None,
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
            return jsonify({
                "error": "Chat is paused while your Trusted Supporter reviews your spending request.",
                "chat_paused": True,
                "pause_reason": session.paused_reason,
                "paused_at": paused_at.isoformat() if paused_at is not None else None,
            }), 423

        insight = None
        if session.insight_id is not None:
            insight = db.get(Insight, cast(int, session.insight_id))
            if insight is not None and cast(int, insight.user_id) != user_id:
                return jsonify({"error": "Insight not found for this user"}), 404

        # If the session has no linked insight yet, attach latest user insight if available.
        if not insight:
            insight = _latest_user_insight(user_id=user_id, db=db)
            if insight:
                session.insight_id = insight.id

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

        raw_transactions = cast(str | None, insight.raw_transactions) if insight is not None else None
        simplified_text = cast(str | None, insight.simplified_text) if insight is not None else None
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
            "trigger_user_message": message,
            "trigger_user_english": reply.get("user_english"),
            "trigger_assistant_english": reply.get("assistant_english"),
            "triggered_session_id": session.id,
            "triggered_user_message_id": user_message.id,
        }

        if coach_signals["pause_required"]:
            session.is_paused = True  # type: ignore[assignment]
            session.paused_at = datetime.utcnow()  # type: ignore[assignment]
            session.paused_reason = cast(str | None, coach_signals.get("pause_reason"))  # type: ignore[assignment]
            session.paused_context_json = json.dumps({  # type: ignore[assignment]
                "triggered_by": "chat_affordability",
                "purchase_amount": coach_signals.get("purchase_amount"),
                "safe_to_spend": coach_signals.get("safe_to_spend"),
                "runout_before_payday": coach_signals.get("runout_before_payday"),
                "days_to_payday": coach_signals.get("days_to_payday"),
                "can_afford": coach_signals.get("can_afford"),
            })

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
            "has_financial_context": bool(insight),
            "coach_signals": coach_signals,
            "supporter_alert_ids": created_alert_ids,
            "chat_paused": bool(session.is_paused),
            "pause_reason": session.paused_reason,
        }), 201
    except ValueError as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()
