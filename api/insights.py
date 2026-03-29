import json
import random
from datetime import date, datetime, timedelta
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
from services.translate import translate, translate_text

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


_NO_DATA_WINS = [
    "You showed up for your money today — that is the first step.",
    "Checking in on your money is already a win. Well done.",
    "We are ready to track your spending together. That counts.",
    "Opening this app means you care about your money. Keep going.",
    "You are building a good habit just by being here.",
]

_POSITIVE_FLOW_WINS = [
    "More money came in than went out. That is a good result.",
    "You finished this period with money to spare. Great work.",
    "Your balance grew this period. You are moving in the right direction.",
    "Income was higher than spending. That is exactly what we want.",
]

_NEGATIVE_FLOW_WINS = [
    "You tracked every rand — now we can plan smarter next time.",
    "Knowing where money went is step one. You did that.",
    "Every rand is accounted for. That is progress.",
    "You stayed aware of your spending, and that is a real win.",
]

_SPEND_WINS = [
    "You kept an eye on your spending this period. That takes effort.",
    "Tracking spending is how you stay in control. Well done.",
    "You reviewed your spending and that helps you plan ahead.",
]

_LOW_FEE_WINS = [
    "Most of your transactions had very low fees. That is a great habit.",
    "You kept bank fees low this period. Every rand saved matters.",
    "Low fees mean more money stays with you. Keep it up.",
]

_HIGH_FEE_WINS = [
    "Bank fees added up this period. Worth watching next time.",
    "There is room to lower bank fees. Small changes add up.",
]

_TX_COUNT_WINS = [
    "You made {n} transactions this period — you are actively managing your money.",
    "Tracking {n} transactions takes effort. You did it.",
    "{n} transactions reviewed. You are staying on top of things.",
]

_FALLBACK_WINS = [
    "You stayed engaged with your money. That is always a win.",
    "Checking in regularly is what makes the difference. Keep going.",
    "You are building good money habits, one check-in at a time.",
]


def _weekly_win_payload(raw_transactions: str | None) -> dict:
    if not raw_transactions:
        return {
            "wins": [random.choice(_NO_DATA_WINS)],
        }

    combined = json.loads(raw_transactions)
    accounts = combined.get("accounts", []) if isinstance(combined, dict) else []

    spend = Decimal("0")
    income = Decimal("0")
    fee_total = Decimal("0")
    tx_count = 0
    low_fee_count = 0

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
                low_fee_count += 1

    net = income - spend
    wins: list[str] = []

    # Flow result
    if net >= 0:
        wins.append(random.choice(_POSITIVE_FLOW_WINS))
    else:
        wins.append(random.choice(_NEGATIVE_FLOW_WINS))

    # Spending awareness
    if spend > 0:
        wins.append(random.choice(_SPEND_WINS))

    # Fee habit
    if fee_total > 0 and tx_count > 0:
        low_fee_ratio = low_fee_count / tx_count
        if low_fee_ratio >= 0.7:
            wins.append(random.choice(_LOW_FEE_WINS))
        elif fee_total > Decimal("50"):
            wins.append(random.choice(_HIGH_FEE_WINS))

    # Transaction count milestone
    if tx_count >= 5:
        wins.append(random.choice(_TX_COUNT_WINS).format(n=tx_count))

    if not wins:
        wins.append(random.choice(_FALLBACK_WINS))

    # Shuffle so the displayed first win varies
    random.shuffle(wins)

    return {"wins": wins[:4]}


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
    force_refresh = bool(data.get("force_refresh", False))

    if not selected_accounts:
        return jsonify({"error": "selected_accounts is required"}), 400

    to_date = date.today().isoformat()
    from_date = (date.today() - timedelta(days=90)).isoformat()

    db = SessionLocal()
    try:
        # Return cached insight if one exists for the same accounts within 6 hours
        if not force_refresh:
            cutoff = datetime.utcnow() - timedelta(hours=6)
            accounts_key = json.dumps(sorted(selected_accounts))
            recent = (
                db.query(Insight)
                .filter(
                    Insight.user_id == user_id,
                    Insight.selected_accounts == accounts_key,
                    Insight.created_at >= cutoff,
                )
                .order_by(Insight.created_at.desc())
                .first()
            )
            if recent:
                translation = next(
                    (t for t in recent.translations if t.language == language), None
                )
                return jsonify({
                    "insight_id": recent.id,
                    "accounts": selected_accounts,
                    "period": {"from": from_date, "to": to_date},
                    "simplified": recent.simplified_text,
                    "translated": translation.translated_text if translation else recent.simplified_text,
                    "language": language,
                    "created_at": recent.created_at.isoformat(),
                    "cached": True,
                }), 200
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


def _build_accessible_cards_result(
    *,
    insight_id: int,
    language: str,
    simplified_text: str,
    viz_result: dict,
) -> dict:
    """Build or retrieve accessibility cards from process cache."""
    accessible_cache: dict = current_app.config.get("ACCESSIBLE_INSIGHTS_CACHE", {})
    cache_key = f"{insight_id}:{language}"
    visualizations = viz_result.get("visualizations", [])
    summary = viz_result.get("summary", {})

    payload_fingerprint = json.dumps(
        {
            "simplified_text": simplified_text,
            "visualizations": visualizations,
            "summary": summary,
        },
        ensure_ascii=False,
        sort_keys=True,
    )

    cached_entry = accessible_cache.get(cache_key)
    if (
        isinstance(cached_entry, dict)
        and cached_entry.get("fingerprint") == payload_fingerprint
        and isinstance(cached_entry.get("payload"), dict)
    ):
        return cached_entry["payload"]

    cards = generate_accessible_carousel(
        simplified_text=simplified_text,
        visualizations=visualizations,
        summary=summary,
        language=language,
    )

    accessible_cache[cache_key] = {
        "fingerprint": payload_fingerprint,
        "payload": cards,
    }
    current_app.config["ACCESSIBLE_INSIGHTS_CACHE"] = accessible_cache
    return cards


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
        cards = _build_accessible_cards_result(
            insight_id=insight_id,
            language=str(language),
            simplified_text=cast(str | None, insight.simplified_text) or "",
            viz_result=viz_result,
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


@insights_bp.post("/translate-message")
@jwt_required()
def translate_message():
    """
    Translate a single free-form message into a target language.
    Body: { "text": "...", "target_language": "xhosa" }
    Returns: { "translated": "..." }
    """
    data = request.get_json() or {}
    text = (data.get("text") or "").strip()
    target_language = (data.get("target_language") or "english").strip().lower()

    if not text:
        return jsonify({"error": "text is required"}), 400

    if target_language == "english":
        return jsonify({"translated": text})

    try:
        translated = translate_text(text, target_language)
        return jsonify({"translated": translated})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
