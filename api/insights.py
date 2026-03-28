import json
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import cast

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from db.database import SessionLocal
from db.models import Insight, Translation, User
from services.accessible_insights import generate_accessible_carousel
from services.combine import combine_transactions
from services.insights_visualizer import FinancialInsightsVisualizer
from services.simplify import simplify
from services.translate import translate

insights_bp = Blueprint("insights", __name__)


def _to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value).replace("R", "").replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _fmt_money(value: Decimal) -> str:
    return f"R{value:,.2f}"


def _weekly_win_payload(raw_transactions: str | None) -> dict:
    if not raw_transactions:
        return {
            "wins": ["We linked your profile and we are ready for the next money check-in."],
            "share_text": "Weekly Win: We are ready to track our spending together this week.",
        }

    combined = json.loads(raw_transactions)
    accounts = combined.get("accounts", []) if isinstance(combined, dict) else []

    spend = Decimal("0")
    income = Decimal("0")
    fee_total = Decimal("0")
    tx_count = 0
    low_fee_days = 0

    for acc in accounts:
        for trx in acc.get("transactions", []):
            tx_count += 1
            amount = _to_decimal(trx.get("amount"))
            fee = _to_decimal(trx.get("fee"))
            if amount < 0:
                spend += abs(amount)
            elif amount > 0:
                income += amount
            fee_total += abs(fee)
            if abs(fee) <= Decimal("5"):
                low_fee_days += 1

    net = income - spend
    wins: list[str] = []
    if net >= 0:
        wins.append(f"We kept a positive money flow of {_fmt_money(net)} in this period.")
    else:
        wins.append("We tracked where money is going, so we can make a stronger plan next week.")

    if spend > 0:
        wins.append(f"We reviewed {_fmt_money(spend)} of spending, which helps us plan with confidence.")

    if fee_total > 0:
        wins.append(f"We kept total bank fees to {_fmt_money(fee_total)} and can aim to lower that next week.")

    if tx_count > 0 and low_fee_days / tx_count >= 0.7:
        wins.append("Most of our transactions had very low fees, which is a great habit.")

    if not wins:
        wins.append("We stayed engaged with our money this week, and that is a real win.")

    share_text = "Weekly Win:\n- " + "\n- ".join(wins[:3])
    return {"wins": wins[:4], "share_text": share_text}


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


@insights_bp.get("/weekly-win")
@jwt_required()
def weekly_win():
    """Returns a positive weekly summary and copy-ready text snippet."""
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        insight = (
            db.query(Insight)
            .filter_by(user_id=user_id)
            .order_by(Insight.created_at.desc())
            .first()
        )
        user = db.get(User, user_id)
        payload = _weekly_win_payload(insight.raw_transactions if insight else None)
        payload["supporter_name"] = (user.trusted_supporter_name if user else None) or "Trusted Supporter"
        payload["insight_id"] = insight.id if insight else None
        payload["generated_at"] = date.today().isoformat()
        return jsonify(payload)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
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


@insights_bp.get("/<int:insight_id>/visualize")
@jwt_required()
def visualize_insight(insight_id: int):
    """
    Generates financial visualizations for an insight from its stored transaction data.
    Results are cached in memory for the lifetime of the server process.
    """
    user_id = int(get_jwt_identity())

    viz_cache: dict = current_app.config.get("VIZ_CACHE", {})
    if insight_id in viz_cache:
        return jsonify(viz_cache[insight_id])

    db = SessionLocal()
    try:
        insight = db.get(Insight, insight_id)
        if not insight or insight.user_id != user_id:
            return jsonify({"error": "Insight not found"}), 404
        if not insight.raw_transactions:
            return jsonify({"error": "No transaction data available for this insight"}), 400

        combined = json.loads(insight.raw_transactions)
        viz_input = _combined_to_viz_format(combined)

        visualizer = FinancialInsightsVisualizer()
        result = visualizer.generate_all_insights(viz_input)

        # Replace absolute file paths with API-relative URLs
        for viz in result.get("visualizations", []):
            viz["url"] = f"/api/visualizations/{viz['filename']}"

        viz_cache[insight_id] = result
        current_app.config["VIZ_CACHE"] = viz_cache

        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


def _combined_to_viz_format(combined: dict) -> dict:
    """Convert the combine_transactions() output to the format expected by FinancialInsightsVisualizer."""
    accounts = combined.get("accounts", [])
    summary = combined.get("summary", {})

    all_lines = []
    line_num = 0
    for acc in accounts:
        for trx in acc.get("transactions", []):
            all_lines.append({
                "transactionDate": trx.get("date", ""),
                "transactionDescription": trx.get("description", ""),
                "transactionAmount": trx.get("amount", "0.00"),
                "balanceAmount": trx.get("balance_after", "0.00"),
                "lineNumber": line_num,
                "transactionFee": trx.get("fee", "0.00"),
                "transactionCategory": trx.get("category", 0),
            })
            line_num += 1

    first_acc = accounts[0] if accounts else {}
    return {
        "transactionHistory": {
            "accountHistoryLines": all_lines,
            "currentBalance": summary.get("combined_current_balance")
                              or first_acc.get("current_balance", "0.00"),
            "availableBalance": summary.get("combined_available_balance")
                                or first_acc.get("available_balance", "0.00"),
        }
    }


def _build_visualization_result(insight_id: int, insight: Insight) -> dict:
    """Build or retrieve visualization payload for an insight from process cache."""
    viz_cache: dict = current_app.config.get("VIZ_CACHE", {})
    if insight_id in viz_cache:
        return viz_cache[insight_id]

    raw = cast(str | None, insight.raw_transactions)
    combined = json.loads(raw or "{}")
    viz_input = _combined_to_viz_format(combined)

    visualizer = FinancialInsightsVisualizer()
    result = visualizer.generate_all_insights(viz_input)

    for viz in result.get("visualizations", []):
        viz["url"] = f"/api/visualizations/{viz['filename']}"

    viz_cache[insight_id] = result
    current_app.config["VIZ_CACHE"] = viz_cache
    return result


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


@insights_bp.get("/<int:insight_id>/accessible")
@jwt_required()
def accessible_insight_cards(insight_id: int):
    """
    Returns accessibility-first guided cards tied to each insight chart.

    Query params:
    - language: optional target language (defaults to user preferred_language or english)
    """
    user_id = int(get_jwt_identity())
    requested_language = (request.args.get("language") or "").strip().lower()

    db = SessionLocal()
    try:
        insight = db.get(Insight, insight_id)
        if not insight or insight.user_id != user_id:
            return jsonify({"error": "Insight not found"}), 404

        user = db.get(User, user_id)
        preferred_language = cast(str | None, user.preferred_language) if user else None
        language = requested_language or (preferred_language or "english")

        viz_result = _build_visualization_result(insight_id=insight_id, insight=insight)
        cards = generate_accessible_carousel(
            simplified_text=cast(str | None, insight.simplified_text) or "",
            visualizations=viz_result.get("visualizations", []),
            summary=viz_result.get("summary", {}),
            language=str(language),
        )

        return jsonify({
            "insight_id": insight.id,
            "language": cards.get("language", language),
            "intro": cards.get("intro", ""),
            "cards": cards.get("cards", []),
            "summary": viz_result.get("summary", {}),
            "created_at": insight.created_at.isoformat(),
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()
