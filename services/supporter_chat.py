"""
Supporter chat engine — lets a carer ask questions about a linked user's finances.

The supporter asks in plain English and the AI answers using the user's actual
transaction data, flagging patterns relevant to cognitive care (duplicates,
spending velocity, late-night activity, cash spikes).
"""

import json
import os
from collections import Counter
from datetime import datetime

from openai import OpenAI

from services.finance_chat import (
    _build_behavior_snapshot,
    _compact_transactions,
    _format_money,
    _parse_iso_date,
    _translate_from_english_with_fallback,
    _translate_to_english_with_fallback,
    _to_decimal,
)


def _get_client(model: str = "gpt-4o-mini") -> tuple[OpenAI, str]:
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("openai_key")
    if not api_key:
        raise ValueError("OpenAI API key not configured.")
    return OpenAI(api_key=api_key), model


def _build_supporter_system_prompt(user_name: str, financial_context: str) -> str:
    first_name = (user_name or "the person you support").split()[0]
    return (
        f"You are LekkerFi's care partner assistant. You help trusted supporters, "
        f"caregivers, and family members understand how {first_name} is managing their money.\n\n"
        "Your role:\n"
        f"- Answer questions about {first_name}'s financial activity clearly and directly\n"
        "- Flag anything concerning: spending spikes, missed income, duplicate payments, "
        "unusual cash withdrawals, or after-hours transactions\n"
        f"- Suggest practical ways the supporter can help {first_name} without removing their independence\n"
        f"- Always maintain {first_name}'s dignity — describe patterns and numbers, never judge character\n"
        "- Use plain English. No financial jargon whatsoever\n"
        "- If something looks like a red flag, name it clearly, explain what it might mean, "
        "and end with one suggested action the supporter can take\n"
        "- Be compassionate but direct — the supporter needs accurate information to help\n"
        "- Keep answers focused. Use short paragraphs. One idea per paragraph\n\n"
        f"Financial data for {first_name}:\n"
        f"{financial_context}"
    )


def _normalize_language(language: str | None) -> str:
    if not language:
        return 'english'
    return language.strip().lower()


def _build_care_signals(condensed: list[dict], summary: dict, user_name: str) -> str:
    """
    Derive carer-specific signals from transaction patterns:
    - Duplicate/repeat payments (dementia risk)
    - Spending velocity spike (bipolar/ADHD risk)
    - ATM cash spike (exploitation risk)
    - Late-night transactions (crisis behaviour)
    """
    first_name = (user_name or "user").split()[0]
    lines: list[str] = []
    now = datetime.utcnow()

    # ── Duplicate / repeat payments ──────────────────────────────────────────
    desc_counts: Counter = Counter()
    for row in condensed:
        if row["amount"] < 0:
            key = (row.get("description") or "").strip().lower()[:60]
            if key:
                desc_counts[key] += 1

    duplicates = [(desc, count) for desc, count in desc_counts.items() if count >= 3]
    if duplicates:
        lines.append(f"Possible repeat payments for {first_name}:")
        for desc, count in duplicates[:4]:
            lines.append(f"  - '{desc}' appears {count} times — possible accidental repeat payment")

    # ── Spending velocity: last 7 days vs prior 7 days ───────────────────────
    from decimal import Decimal

    last7 = sum(
        abs(r["amount"]) for r in condensed
        if r["amount"] < 0 and r.get("date_obj") and (now - r["date_obj"]).days <= 7
    )
    prior7 = sum(
        abs(r["amount"]) for r in condensed
        if r["amount"] < 0 and r.get("date_obj") and 7 < (now - r["date_obj"]).days <= 14
    )
    if prior7 > 0 and last7 > 0:
        ratio = float(last7 / prior7)
        if ratio >= 2.0:
            lines.append(
                f"Spending velocity alert: {first_name} spent {_format_money(last7)} in the last 7 days "
                f"vs {_format_money(prior7)} the week before — {ratio:.1f}x higher than usual. "
                "This may indicate an elevated spending period worth a check-in."
            )

    # ── ATM / cash withdrawal spike ──────────────────────────────────────────
    cash_rows = [
        r for r in condensed
        if r["amount"] < 0
        and r.get("date_obj")
        and (now - r["date_obj"]).days <= 14
        and any(
            kw in (r.get("description") or "").lower()
            for kw in ("atm", "cash", "withdrawal", "teller")
        )
    ]
    if len(cash_rows) >= 3:
        total_cash = sum(abs(r["amount"]) for r in cash_rows)
        lines.append(
            f"Cash activity: {len(cash_rows)} ATM or cash transactions in the last 14 days "
            f"totalling {_format_money(total_cash)}. This level of cash activity may be worth discussing."
        )

    # ── Late-night transactions (10pm – 4am) ─────────────────────────────────
    late_night = [
        r for r in condensed
        if r.get("date_obj") and (r["date_obj"].hour >= 22 or r["date_obj"].hour <= 3)
    ]
    if len(late_night) >= 2:
        lines.append(
            f"After-hours activity: {len(late_night)} transactions were made between 10pm and 4am. "
            "Depending on context this may be worth a gentle check-in."
        )

    return "\n".join(lines) if lines else ""


def generate_supporter_chat_reply(
    supporter_message: str,
    user_name: str,
    raw_transactions: dict | str | None,
    simplified_text: str | None,
    history: list[dict],
    language: str = 'english',
) -> dict:
    """
    Generate a reply for a supporter asking about a linked user's finances.

    Args:
        supporter_message: The supporter's question
        user_name: Full name of the user being discussed
        raw_transactions: Raw transaction JSON (dict or string)
        simplified_text: AI-generated simplified insight text
        history: List of prior messages [{"role": "supporter"|"assistant", "text": str}]

    Returns:
        {"assistant_text": str, "generated_at": str}
    """
    financial_context = _compact_transactions(raw_transactions=raw_transactions)

    care_signals = ""
    if raw_transactions:
        try:
            combined = (
                raw_transactions
                if isinstance(raw_transactions, dict)
                else json.loads(raw_transactions)
            )
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
            care_signals = _build_care_signals(
                condensed, combined.get("summary", {}), user_name
            )
        except Exception:
            pass

    if simplified_text:
        financial_context += f"\n\nExisting analysis:\n{simplified_text}"
    if care_signals:
        financial_context += f"\n\nAutomated care signals:\n{care_signals}"

    client, model = _get_client()

    normalized_language = _normalize_language(language)
    supporter_message_english = supporter_message.strip()
    if normalized_language != 'english':
        supporter_message_english = _translate_to_english_with_fallback(
            supporter_message_english,
            source_language=normalized_language,
        )

    messages: list[dict] = [
        {"role": "system", "content": _build_supporter_system_prompt(user_name, financial_context)}
    ]

    for item in history[-14:]:
        role = item.get("role", "supporter")
        openai_role = "user" if role == "supporter" else "assistant"
        text = (item.get("text") or "").strip()
        if text:
            messages.append({"role": openai_role, "content": text})

    messages.append({"role": "user", "content": supporter_message_english})

    completion = client.chat.completions.create(
        model=model,
        temperature=0.2,
        messages=messages,
    )

    assistant_text_english = (completion.choices[0].message.content or "").strip()
    if not assistant_text_english:
        assistant_text_english = "I could not generate a response. Please try again."

    assistant_text = assistant_text_english
    if normalized_language != 'english':
        assistant_text = _translate_from_english_with_fallback(
            assistant_text_english,
            target_language=normalized_language,
        )

    return {
        "assistant_text": assistant_text,
        "assistant_text_english": assistant_text_english,
        "language": normalized_language,
        "generated_at": datetime.utcnow().isoformat(),
    }
