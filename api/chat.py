import json
from datetime import datetime

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db.database import SessionLocal
from db.models import FinanceChatMessage, FinanceChatSession, Insight
from services.finance_chat import generate_finance_chat_reply

chat_bp = Blueprint("chat", __name__)


def _session_payload(session: FinanceChatSession) -> dict:
    return {
        "id": session.id,
        "insight_id": session.insight_id,
        "title": session.title,
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
            if not insight or insight.user_id != user_id:
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
        if not session or session.user_id != user_id:
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
      "language": "zulu"
    }
    """
    user_id = int(get_jwt_identity())
    data = request.get_json() or {}

    message = (data.get("message") or "").strip()
    language = (data.get("language") or "english").strip()

    if not message:
        return jsonify({"error": "message is required"}), 400

    db = SessionLocal()
    try:
        session = db.get(FinanceChatSession, session_id)
        if not session or session.user_id != user_id:
            return jsonify({"error": "Chat session not found"}), 404

        insight = None
        if session.insight_id:
            insight = db.get(Insight, session.insight_id)
            if insight and insight.user_id != user_id:
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

        raw_transactions = insight.raw_transactions if insight else None
        simplified_text = insight.simplified_text if insight else None

        reply = generate_finance_chat_reply(
            user_text=message,
            user_language=language,
            raw_transactions=raw_transactions,
            simplified_text=simplified_text,
            history_english=history_english,
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
        session.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(user_message)
        db.refresh(assistant_message)
        db.refresh(session)

        return jsonify({
            "session": _session_payload(session),
            "user_message": _message_payload(user_message),
            "assistant_message": _message_payload(assistant_message),
            "has_financial_context": bool(insight),
        }), 201
    except ValueError as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()
