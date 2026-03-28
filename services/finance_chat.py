"""
Finance chat engine that uses user financial context and translation bridge.

Flow:
1. Translate user message to English (if needed)
2. Ask GPT with financial data context + chat history
3. Translate assistant response back to user language (if needed)
"""

import json
import os
import re
from collections import Counter
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from services.translate import translate_text, translate_to_english

load_dotenv()


def _get_client(model: str = "gpt-4o-mini") -> tuple[OpenAI, str]:
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("openai_key")
    if not api_key:
        raise ValueError("OpenAI API key not found. Set OPENAI_API_KEY in your environment.")
    return OpenAI(api_key=api_key), model


def _translate_via_openai(text: str, target_language: str) -> str:
    """Translate text using OpenAI — avoids external Gradio dependency."""
    client, model = _get_client()
    completion = client.chat.completions.create(
        model=model,
        temperature=0.1,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a translator. Translate the user's message into the requested language. "
                    "Return only the translated text with no explanations or formatting."
                ),
            },
            {
                "role": "user",
                "content": f"Translate to {target_language}:\n\n{text}",
            },
        ],
    )
    return (completion.choices[0].message.content or text).strip()


def _translate_to_english_with_fallback(text: str, source_language: str) -> str:
    """Use shared translation service first, then fallback to OpenAI translation."""
    try:
        translated = translate_to_english(text, source_language=source_language)
        if translated and translated.strip():
            return translated.strip()
    except Exception:
        pass
    return _translate_via_openai(text, target_language="English")


def _translate_from_english_with_fallback(text: str, target_language: str) -> str:
    """Use shared translation service first, then fallback to OpenAI translation."""
    try:
        translated = translate_text(text, target_language=target_language)
        if translated and translated.strip():
            return translated.strip()
    except Exception:
        pass
    return _translate_via_openai(text, target_language=target_language)


def _to_decimal(value: str | int | float | None) -> Decimal:
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value).replace("R", "").replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _format_money(value: Decimal) -> str:
    return f"R{value:,.2f}"


def _parse_iso_date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value[:19], fmt)
        except ValueError:
            continue
    return None


def _extract_amount_from_text(text: str) -> Decimal | None:
    match = re.search(r"(?:r|zar)?\s*(\d{1,3}(?:[ ,]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)", text, flags=re.IGNORECASE)
    if not match:
        return None
    candidate = match.group(1).replace(" ", "").replace(",", "")
    try:
        value = Decimal(candidate)
    except InvalidOperation:
        return None
    return value if value > 0 else None


def _is_affordability_question(text: str) -> bool:
    t = text.lower()
    patterns = (
        "can i afford",
        "afford this",
        "enough money",
        "buy this",
        "should i buy",
        "safe to spend",
    )
    return any(pattern in t for pattern in patterns)


def _find_analogies(amount: Decimal) -> tuple[str, str]:
    if amount < Decimal("100"):
        return (
            "about the price of a few loaves of bread",
            "about the price of a few liters of milk",
        )
    if amount <= Decimal("1000"):
        return (
            "about one grocery trip",
            "close to a bundle of electricity units",
        )
    return (
        "close to a month of rent for many families",
        "close to a monthly car installment",
    )


def _replace_jargon(text: str) -> str:
    replacements = {
        r"\bliquidity\b": "money we can use",
        r"\btransaction history\b": "money we spent",
        r"\bdebit interest\b": "bank fees",
        r"\bdebit order\b": "scheduled payment",
        r"\bavailable balance\b": "money we can use now",
        r"\bcurrent balance\b": "money in the account",
    }
    out = text
    for pattern, replacement in replacements.items():
        out = re.sub(pattern, replacement, out, flags=re.IGNORECASE)
    return out


def _ensure_supportive_style(text: str) -> str:
    cleaned = _replace_jargon(text)
    cleaned = re.sub(r"\bYou\b", "We", cleaned)
    cleaned = re.sub(r"\byou\b", "we", cleaned)
    if len(cleaned) > 320 and "does that make sense" not in cleaned.lower() and "explain that differently" not in cleaned.lower():
        cleaned = f"{cleaned.rstrip()}\n\nDoes that make sense, or should I explain that differently?"
    return cleaned


def _infer_recurring_bills(condensed: list[dict], horizon_days: int = 30) -> dict:
    now = datetime.utcnow()
    negatives = [r for r in condensed if r["amount"] < 0 and r.get("date_obj")]
    grouped: dict[str, list[dict]] = {}
    for row in negatives:
        key = (row.get("description") or "unknown").strip().lower()[:80]
        grouped.setdefault(key, []).append(row)

    upcoming_total = Decimal("0")
    recurring_items = []
    for desc, rows in grouped.items():
        rows.sort(key=lambda r: r["date_obj"])
        if len(rows) < 2:
            continue
        intervals = []
        for idx in range(1, len(rows)):
            intervals.append((rows[idx]["date_obj"] - rows[idx - 1]["date_obj"]).days)
        if not intervals:
            continue
        cadence = round(sum(intervals) / len(intervals))
        if cadence < 5 or cadence > 45:
            continue

        amount_values = [abs(r["amount"]) for r in rows]
        avg_amount = sum(amount_values) / Decimal(len(amount_values))
        last_date = rows[-1]["date_obj"]
        next_date = last_date
        while next_date <= now:
            next_date = next_date + timedelta(days=cadence)
        due_count = 0
        while (next_date - now).days <= horizon_days:
            due_count += 1
            upcoming_total += avg_amount
            next_date = next_date + timedelta(days=cadence)

        if due_count > 0:
            recurring_items.append({
                "description": desc,
                "average_amount": avg_amount,
                "cadence_days": cadence,
                "due_count": due_count,
            })

    return {
        "upcoming_total": upcoming_total,
        "items": recurring_items,
    }


def _estimate_payday(condensed: list[dict]) -> tuple[int | None, str]:
    deposits = []
    for row in condensed:
        amt = row.get("amount", Decimal("0"))
        desc = (row.get("description") or "").lower()
        dt = row.get("date_obj")
        if amt <= 0 or not dt:
            continue
        if "salary" in desc or "payroll" in desc or amt >= Decimal("4000"):
            deposits.append(dt.day)

    if not deposits:
        return None, "No clear payday pattern found yet."

    day_counter = Counter(deposits)
    payday_day = day_counter.most_common(1)[0][0]
    return payday_day, f"Estimated payday is around day {payday_day} each month."


def _days_until_payday(payday_day: int | None, now: datetime) -> int:
    if payday_day is None:
        return 30
    if now.day <= payday_day:
        return payday_day - now.day
    return (30 - now.day) + payday_day


def _anomaly_flags(condensed: list[dict]) -> list[dict]:
    spend = [abs(row["amount"]) for row in condensed if row["amount"] < 0]
    if len(spend) < 4:
        return []
    baseline = sum(spend) / Decimal(len(spend))
    threshold = baseline * Decimal("3")
    flags = []
    for row in condensed:
        amt = abs(row["amount"])
        if row["amount"] < 0 and amt >= threshold:
            flags.append({
                "date": row.get("date", ""),
                "description": row.get("description", ""),
                "amount": amt,
                "baseline": baseline,
                "multiplier": float((amt / baseline).quantize(Decimal("0.01"))) if baseline > 0 else 0.0,
            })
    return flags[:5]


def _build_behavior_snapshot(condensed: list[dict], combined_summary: dict) -> dict:
    now = datetime.utcnow()
    recurring = _infer_recurring_bills(condensed)

    current_balance = _to_decimal(combined_summary.get("combined_current_balance"))
    available_balance = _to_decimal(combined_summary.get("combined_available_balance"))
    safe_to_spend = current_balance - recurring["upcoming_total"]

    spending_30d = [abs(r["amount"]) for r in condensed if r["amount"] < 0 and r.get("date_obj") and (now - r["date_obj"]).days <= 30]
    daily_spend = (sum(spending_30d) / Decimal("30")) if spending_30d else Decimal("0")

    payday_day, payday_note = _estimate_payday(condensed)
    days_to_payday = _days_until_payday(payday_day, now)
    recurring_until_payday = recurring["upcoming_total"] if days_to_payday <= 30 else Decimal("0")
    projected_outflow = (daily_spend * Decimal(days_to_payday)) + recurring_until_payday

    runout_before_payday = available_balance < projected_outflow
    if daily_spend > 0:
        runout_days = int((available_balance / daily_spend).to_integral_value(rounding="ROUND_FLOOR"))
    else:
        runout_days = None

    return {
        "current_balance": current_balance,
        "available_balance": available_balance,
        "upcoming_bills": recurring,
        "safe_to_spend": safe_to_spend,
        "daily_spend_30d": daily_spend,
        "days_to_payday": days_to_payday,
        "payday_note": payday_note,
        "projected_outflow_to_payday": projected_outflow,
        "runout_before_payday": runout_before_payday,
        "estimated_runout_days": runout_days,
        "anomalies": _anomaly_flags(condensed),
    }


def _build_affordability_message(amount: Decimal, snapshot: dict) -> str:
    safe_to_spend = snapshot["safe_to_spend"]
    primary_analogy, fallback_analogy = _find_analogies(amount)
    if safe_to_spend >= amount:
        return (
            f"We can afford {_format_money(amount)} right now after setting aside upcoming bills. "
            f"That amount is {primary_analogy} ({fallback_analogy})."
        )

    gap = amount - safe_to_spend
    return (
        f"We cannot safely afford {_format_money(amount)} right now because after upcoming bills, we are short by {_format_money(gap)}. "
        f"That amount is {primary_analogy} ({fallback_analogy})."
    )


def _build_pause_prompt(amount: Decimal, supporter_name: str | None) -> str | None:
    if amount <= Decimal("500"):
        return None
    name = supporter_name.strip() if supporter_name else "Trusted Supporter"
    return f"Would you like to send a quick summary of this to your Trusted Supporter {name} before we buy?"


def _build_supporter_pause_message(
    amount: Decimal,
    snapshot: dict,
    pause_reason: str,
) -> str:
    safe_to_spend = _to_decimal(snapshot.get("safe_to_spend"))
    days_to_payday = snapshot.get("days_to_payday")

    reason_text = {
        "cannot_afford": "it looks unaffordable right now",
        "runout_risk": "it increases the risk of running out before payday",
        "high_amount_review": "it is a high-value spend that should be reviewed",
    }.get(pause_reason, "it needs supporter review")

    payday_part = ""
    if days_to_payday is not None:
        payday_part = f" Days to payday: {days_to_payday}."

    return (
        f"Purchase check-in: user asked about buying an item for {_format_money(amount)}. "
        f"Safe to spend is {_format_money(safe_to_spend)} and {reason_text}.{payday_part}"
    )


def _decision_risk_signals(
    user_english: str,
    history_english: list[dict],
    snapshot: dict,
    affordability_amount: Decimal | None,
    can_afford: bool | None,
    pause_required: bool,
) -> dict:
    text = user_english.lower()

    decision_keywords = (
        "can i buy",
        "can i afford",
        "should i buy",
        "spend",
        "purchase",
        "pay for",
        "loan",
        "borrow",
        "credit",
    )
    urgency_keywords = (
        "now",
        "today",
        "right now",
        "urgent",
        "asap",
        "immediately",
        "before close",
    )
    distress_keywords = (
        "panic",
        "panicking",
        "anxious",
        "stressed",
        "overwhelmed",
        "confused",
        "cannot think",
        "can't think",
        "manic",
        "impulsive",
        "cant stop",
        "can't stop",
    )

    decision_intent = any(token in text for token in decision_keywords) or affordability_amount is not None
    urgency_hits = sum(1 for token in urgency_keywords if token in text)
    distress_hits = sum(1 for token in distress_keywords if token in text)
    emotional_distress = distress_hits > 0

    if urgency_hits >= 2:
        urgency_level = "high"
    elif urgency_hits == 1:
        urgency_level = "medium"
    else:
        urgency_level = "low"

    recent_user_msgs = [
        str(item.get("english_text") or "").lower()
        for item in history_english[-6:]
        if str(item.get("role") or "") == "user"
    ]
    repeated_intent = sum(1 for msg in recent_user_msgs if any(token in msg for token in decision_keywords)) >= 2

    risk_score = 0
    if decision_intent:
        risk_score += 1
    if affordability_amount is not None:
        risk_score += 1
    if can_afford is False:
        risk_score += 3
    if bool(snapshot.get("runout_before_payday")):
        risk_score += 2

    anomaly_count = len(snapshot.get("anomalies", [])) if snapshot else 0
    if anomaly_count >= 3:
        risk_score += 2
    elif anomaly_count > 0:
        risk_score += 1

    if urgency_level == "high":
        risk_score += 2
    elif urgency_level == "medium":
        risk_score += 1

    if emotional_distress:
        risk_score += 2
    if repeated_intent:
        risk_score += 1
    if pause_required:
        risk_score += 2

    if risk_score >= 7 or pause_required or emotional_distress:
        supporter_priority = "high"
    elif risk_score >= 4:
        supporter_priority = "medium"
    else:
        supporter_priority = "low"

    supporter_flag_required = bool(
        pause_required
        or (
            decision_intent
            and supporter_priority in {"high", "medium"}
            and (urgency_level != "low" or repeated_intent or can_afford is False)
        )
    )

    risk_tags: list[str] = []
    if decision_intent:
        risk_tags.append("decision_intent")
    if can_afford is False:
        risk_tags.append("cannot_afford")
    if bool(snapshot.get("runout_before_payday")):
        risk_tags.append("payday_runout_risk")
    if anomaly_count > 0:
        risk_tags.append("spend_anomaly")
    if urgency_level != "low":
        risk_tags.append(f"urgency_{urgency_level}")
    if repeated_intent:
        risk_tags.append("repeated_decision_loop")
    if emotional_distress:
        risk_tags.append("emotional_distress")

    if pause_required:
        recommended_action = "pause_and_review"
    elif supporter_priority == "high":
        recommended_action = "urgent_supporter_checkin"
    elif supporter_priority == "medium":
        recommended_action = "supporter_review_today"
    else:
        recommended_action = "continue_monitoring"

    return {
        "decision_intent": decision_intent,
        "urgency_level": urgency_level,
        "emotional_distress": emotional_distress,
        "repeated_intent": repeated_intent,
        "supporter_flag_required": supporter_flag_required,
        "supporter_priority": supporter_priority,
        "risk_score": risk_score,
        "risk_tags": risk_tags,
        "recommended_action": recommended_action,
    }


def _compact_transactions(raw_transactions: dict | str | None, max_rows: int = 25) -> str:
    if not raw_transactions:
        return "No transaction data provided."

    combined = raw_transactions
    if isinstance(raw_transactions, str):
        try:
            combined = json.loads(raw_transactions)
        except json.JSONDecodeError:
            return "Transaction payload could not be parsed."

    accounts = combined.get("accounts", []) if isinstance(combined, dict) else []
    summary = combined.get("summary", {}) if isinstance(combined, dict) else {}
    period = combined.get("export_period", {}) if isinstance(combined, dict) else {}

    lines = [
        "Financial context:",
        f"- Period: {period.get('from', 'unknown')} to {period.get('to', 'unknown')}",
        f"- Total accounts: {summary.get('total_accounts', len(accounts))}",
        f"- Total transactions: {summary.get('total_transactions', 'unknown')}",
        f"- Combined current balance: {summary.get('combined_current_balance', 'unknown')}",
        f"- Combined available balance: {summary.get('combined_available_balance', 'unknown')}",
    ]

    condensed = []
    for acc in accounts:
        acc_num = acc.get("account_number", "unknown")
        acc_name = acc.get("account_name", "")
        acc_type = acc.get("account_type", "")
        acc_current = _to_decimal(acc.get("current_balance"))
        acc_available = _to_decimal(acc.get("available_balance"))
        lines.append(
            f"- Account {acc_num} ({acc_name}, {acc_type}): current={_format_money(acc_current)}, available={_format_money(acc_available)}"
        )

        for trx in acc.get("transactions", []):
            date_raw = trx.get("date", "")
            condensed.append({
                "date": trx.get("date", ""),
                "date_obj": _parse_iso_date(date_raw),
                "account": acc_num,
                "description": trx.get("description", ""),
                "amount": _to_decimal(trx.get("amount")),
            })

    condensed.sort(key=lambda row: row.get("date", ""), reverse=True)

    spend_total = sum((abs(row["amount"]) for row in condensed if row["amount"] < 0), Decimal("0"))
    income_total = sum((row["amount"] for row in condensed if row["amount"] > 0), Decimal("0"))
    net_flow = income_total - spend_total
    lines.append(f"- Total income in period: {_format_money(income_total)}")
    lines.append(f"- Total spend in period: {_format_money(spend_total)}")
    lines.append(f"- Net flow in period: {_format_money(net_flow)}")

    behavior = _build_behavior_snapshot(condensed, summary)
    lines.append(f"- Safe to spend now (after upcoming bills): {_format_money(behavior['safe_to_spend'])}")
    lines.append(f"- Upcoming recurring bills (30 days): {_format_money(behavior['upcoming_bills']['upcoming_total'])}")
    lines.append(f"- 30-day average daily spend: {_format_money(behavior['daily_spend_30d'])}")
    lines.append(f"- {behavior['payday_note']}")
    if behavior["runout_before_payday"]:
        lines.append("- Risk: At current pattern, money may run out before payday.")
    else:
        lines.append("- Outlook: At current pattern, money should last until payday.")

    if behavior["anomalies"]:
        lines.append("- Anomaly alerts (3x larger than average spend):")
        for anomaly in behavior["anomalies"]:
            lines.append(
                f"- Alert: {anomaly['date']} | {anomaly['description']} | {_format_money(anomaly['amount'])} "
                f"({anomaly['multiplier']}x average)"
            )

    lines.append(f"Recent transactions (max {max_rows}):")
    for row in condensed[:max_rows]:
        lines.append(
            f"- {row['date']} | {row['account']} | {row['description']} | {_format_money(row['amount'])}"
        )

    return "\n".join(lines)


def _normalize_language(language: str | None) -> str:
    if not language:
        return "english"
    return language.strip().lower()


def _is_english(language: str | None) -> bool:
    normalized = _normalize_language(language)
    return normalized in {"en", "eng", "english"}


def _build_system_prompt(financial_context: str) -> str:
    return (
        "You are LekkerFi, a trusted personal finance coach. "
        "Your job is to answer user questions about their own finances using the provided context. "
        "Rules: "
        "1) Only use the user's provided financial data; if missing, clearly say what is missing. "
        "2) Be practical, specific, and concise. "
        "3) Explain assumptions when data is incomplete. "
        "4) Never fabricate balances or transactions. "
        "5) Give actionable next steps when relevant. "
        "6) Never use jargon like liquidity, transaction history, debit interest. Use plain words like money we can use, money we spent, bank fees. "
        "7) Be encouraging and never judgmental. Prefer we instead of you where natural. "
        "8) When mentioning amounts, include one real-world analogy: <R100 bread/milk, R100-R1000 groceries/electricity, >R1000 rent/car installment. "
        "9) For long answers, end with: Does that make sense, or should I explain that differently?\n\n"
        f"{financial_context}"
    )


def _build_messages(history_english: list[dict], user_english: str, financial_context: str) -> list[dict]:
    messages = [{"role": "system", "content": _build_system_prompt(financial_context)}]

    # Keep context window focused and cheap.
    tail = history_english[-16:]
    for item in tail:
        role = item.get("role", "user")
        text = item.get("english_text", "").strip()
        if not text:
            continue
        messages.append({"role": role, "content": text})

    messages.append({"role": "user", "content": user_english})
    return messages


def generate_finance_chat_reply(
    user_text: str,
    user_language: str,
    raw_transactions: dict | str | None,
    simplified_text: str | None,
    history_english: list[dict],
    trusted_supporter_name: str | None = None,
) -> dict:
    """
    Generate assistant response with translation bridge.

    Returns dict:
    {
      user_english: str,
      assistant_english: str,
      assistant_user_language: str
    }
    """
    if not user_text or not user_text.strip():
        raise ValueError("user_text is required")

    language = _normalize_language(user_language)
    user_clean = user_text.strip()

    if _is_english(language):
        user_english = user_clean
    else:
        user_english = _translate_to_english_with_fallback(user_clean, source_language=language)

    financial_context = _compact_transactions(raw_transactions=raw_transactions)
    if simplified_text:
        financial_context = (
            f"{financial_context}\n\n"
            "Existing simplified insights:\n"
            f"{simplified_text}"
        )

    client, model = _get_client()
    snapshot = {}
    if raw_transactions:
        try:
            combined = raw_transactions if isinstance(raw_transactions, dict) else json.loads(raw_transactions)
            accounts = combined.get("accounts", []) if isinstance(combined, dict) else []
            condensed = []
            for acc in accounts:
                for trx in acc.get("transactions", []):
                    condensed.append({
                        "date": trx.get("date", ""),
                        "date_obj": _parse_iso_date(trx.get("date", "")),
                        "description": trx.get("description", ""),
                        "amount": _to_decimal(trx.get("amount")),
                    })
            snapshot = _build_behavior_snapshot(condensed, combined.get("summary", {}))
        except Exception:
            snapshot = {}

    affordability_amount = _extract_amount_from_text(user_english)
    affordability_override = None
    pause_prompt = None
    pause_required = False
    pause_reason = None
    can_afford = None
    suggested_supporter_message = None
    if _is_affordability_question(user_english) and affordability_amount and snapshot:
        can_afford = snapshot.get("safe_to_spend", Decimal("0")) >= affordability_amount
        affordability_override = _build_affordability_message(affordability_amount, snapshot)
        pause_prompt = _build_pause_prompt(affordability_amount, trusted_supporter_name)

        if not can_afford:
            pause_required = True
            pause_reason = "cannot_afford"
        elif snapshot.get("runout_before_payday"):
            pause_required = True
            pause_reason = "runout_risk"
        elif affordability_amount >= Decimal("2000"):
            pause_required = True
            pause_reason = "high_amount_review"

        if pause_required and pause_reason:
            suggested_supporter_message = _build_supporter_pause_message(
                amount=affordability_amount,
                snapshot=snapshot,
                pause_reason=pause_reason,
            )

    decision_signals = _decision_risk_signals(
        user_english=user_english,
        history_english=history_english,
        snapshot=snapshot,
        affordability_amount=affordability_amount,
        can_afford=can_afford,
        pause_required=pause_required,
    )

    completion = client.chat.completions.create(
        model=model,
        temperature=0.2,
        messages=_build_messages(
            history_english=history_english,
            user_english=user_english,
            financial_context=financial_context,
        ),  # type: ignore[arg-type]
    )

    assistant_english = (completion.choices[0].message.content or "").strip()
    if not assistant_english:
        assistant_english = "I could not generate a response. Please try again."

    if affordability_override:
        assistant_english = affordability_override
    if pause_prompt:
        assistant_english = f"{assistant_english}\n\n{pause_prompt}"

    assistant_english = _ensure_supportive_style(assistant_english)

    if _is_english(language):
        assistant_user_language = assistant_english
    else:
        assistant_user_language = _translate_from_english_with_fallback(assistant_english, target_language=language)

    return {
        "user_english": user_english,
        "assistant_english": assistant_english,
        "assistant_user_language": assistant_user_language,
        "language": language,
        "safe_to_spend": str(snapshot.get("safe_to_spend", "")) if snapshot else None,
        "runout_before_payday": snapshot.get("runout_before_payday") if snapshot else None,
        "days_to_payday": snapshot.get("days_to_payday") if snapshot else None,
        "anomaly_count": len(snapshot.get("anomalies", [])) if snapshot else 0,
        "pause_prompt": pause_prompt,
        "pause_required": pause_required,
        "pause_reason": pause_reason,
        "purchase_amount": str(affordability_amount) if affordability_amount is not None else None,
        "can_afford": can_afford,
        "suggested_supporter_message": suggested_supporter_message,
        "decision_intent": decision_signals["decision_intent"],
        "urgency_level": decision_signals["urgency_level"],
        "emotional_distress": decision_signals["emotional_distress"],
        "repeated_intent": decision_signals["repeated_intent"],
        "supporter_flag_required": decision_signals["supporter_flag_required"],
        "supporter_priority": decision_signals["supporter_priority"],
        "risk_score": decision_signals["risk_score"],
        "risk_tags": decision_signals["risk_tags"],
        "recommended_action": decision_signals["recommended_action"],
        "generated_at": datetime.utcnow().isoformat(),
    }
