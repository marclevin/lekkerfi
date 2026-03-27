import json
from datetime import date, timedelta

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db.database import SessionLocal
from db.models import Insight, Translation
from services.combine import combine_transactions
from services.simplify import simplify
from services.translate import translate

insights_bp = Blueprint("insights", __name__)


@insights_bp.post("/generate")
@jwt_required()
def generate_insight():
    """
    Full pipeline: fetch TrxHistory for selected accounts (last 90 days),
    combine, simplify, translate, persist and return the insight.

    Body: { "selected_accounts": ["4048195297", ...], "language": "xhosa" }
    """
    user_id = int(get_jwt_identity())
    client = current_app.config["ABSA_CLIENT"]
    settings = current_app.config["ABSA_SETTINGS"]
    data = request.get_json() or {}

    selected_accounts = data.get("selected_accounts", [])
    language = data.get("language", "xhosa").strip()

    if not selected_accounts:
        return jsonify({"error": "selected_accounts is required"}), 400

    to_date = date.today().isoformat()
    from_date = (date.today() - timedelta(days=90)).isoformat()

    db = SessionLocal()
    try:
        # Fresh token — one-time consent TrxHistory doesn't need a long-lived session
        token = client.get_oauth_token()

        trx_responses = []
        for account_number in selected_accounts:
            resp = client.fetch_trx_history(
                token=token,
                account_number=account_number,
                org_name=settings.org_name,
                org_id=settings.org_id,
                from_date=from_date,
                to_date=to_date,
            )
            rc = resp.get("resultCode")
            if rc != 200:
                return jsonify({
                    "error": (
                        f"TrxHistory failed for account {account_number} "
                        f"(resultCode={rc}): {resp.get('resultMessage', '')}"
                    )
                }), 502
            trx_responses.append(resp)

        combined = combine_transactions(trx_responses)
        simplified_text = simplify(combined)
        translated_text = translate(simplified_text, language)

        insight = Insight(
            user_id=user_id,
            selected_accounts=json.dumps(selected_accounts),
            raw_transactions=json.dumps(combined),
            simplified_text=simplified_text,
        )
        db.add(insight)
        db.flush()

        translation = Translation(
            insight_id=insight.id,
            language=language,
            translated_text=translated_text,
        )
        db.add(translation)
        db.commit()
        db.refresh(insight)

        return jsonify({
            "insight_id": insight.id,
            "accounts": selected_accounts,
            "period": {"from": from_date, "to": to_date},
            "simplified": simplified_text,
            "translated": translated_text,
            "language": language,
            "created_at": insight.created_at.isoformat(),
        }), 201
    except Exception as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


@insights_bp.get("/")
@jwt_required()
def list_insights():
    """Returns a summary list of all insights for the authenticated user."""
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        insights = (
            db.query(Insight)
            .filter_by(user_id=user_id)
            .order_by(Insight.created_at.desc())
            .all()
        )
        return jsonify({
            "insights": [
                {
                    "id": i.id,
                    "accounts": json.loads(i.selected_accounts),
                    "simplified": i.simplified_text,
                    "translations": [
                        {"id": t.id, "language": t.language}
                        for t in i.translations
                    ],
                    "created_at": i.created_at.isoformat(),
                }
                for i in insights
            ]
        })
    finally:
        db.close()


@insights_bp.get("/<int:insight_id>")
@jwt_required()
def get_insight(insight_id: int):
    """Returns full detail for a single insight including all translations."""
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        insight = db.get(Insight, insight_id)
        if not insight or insight.user_id != user_id:
            return jsonify({"error": "Insight not found"}), 404
        return jsonify({
            "id": insight.id,
            "accounts": json.loads(insight.selected_accounts),
            "simplified": insight.simplified_text,
            "translations": [
                {
                    "id": t.id,
                    "language": t.language,
                    "translated": t.translated_text,
                    "created_at": t.created_at.isoformat(),
                }
                for t in insight.translations
            ],
            "created_at": insight.created_at.isoformat(),
        })
    finally:
        db.close()


@insights_bp.post("/<int:insight_id>/translate")
@jwt_required()
def translate_insight(insight_id: int):
    """
    Translates an existing insight into a new language and persists the result.
    Body: { "language": "zulu" }
    """
    user_id = int(get_jwt_identity())
    data = request.get_json() or {}
    language = data.get("language", "").strip()

    if not language:
        return jsonify({"error": "language is required"}), 400

    db = SessionLocal()
    try:
        insight = db.get(Insight, insight_id)
        if not insight or insight.user_id != user_id:
            return jsonify({"error": "Insight not found"}), 404

        translated_text = translate(insight.simplified_text, language)

        t = Translation(
            insight_id=insight.id,
            language=language,
            translated_text=translated_text,
        )
        db.add(t)
        db.commit()
        db.refresh(t)

        return jsonify({
            "translation_id": t.id,
            "language": language,
            "translated": translated_text,
            "created_at": t.created_at.isoformat(),
        }), 201
    except Exception as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()
