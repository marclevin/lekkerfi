"""
Finance chat engine that uses user financial context and translation bridge.

Flow:
1. Translate user message to English (if needed)
2. Ask GPT with financial data context + chat history
3. Translate assistant response back to user language (if needed)
"""

import json
import os
from datetime import datetime
from decimal import Decimal, InvalidOperation

from dotenv import load_dotenv
from openai import OpenAI

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


def _to_decimal(value: str | int | float | None) -> Decimal:
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value).replace("R", "").replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _format_money(value: Decimal) -> str:
    return f"R{value:,.2f}"


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
            condensed.append({
                "date": trx.get("date", ""),
                "account": acc_num,
                "description": trx.get("description", ""),
                "amount": _to_decimal(trx.get("amount")),
            })

    condensed.sort(key=lambda row: row.get("date", ""), reverse=True)

    spend_total = sum(abs(row["amount"]) for row in condensed if row["amount"] < 0)
    income_total = sum(row["amount"] for row in condensed if row["amount"] > 0)
    net_flow = income_total - spend_total
    lines.append(f"- Total income in period: {_format_money(income_total)}")
    lines.append(f"- Total spend in period: {_format_money(spend_total)}")
    lines.append(f"- Net flow in period: {_format_money(net_flow)}")

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
        "5) Give actionable next steps when relevant.\n\n"
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
        user_english = _translate_via_openai(user_clean, target_language="English")

    financial_context = _compact_transactions(raw_transactions=raw_transactions)
    if simplified_text:
        financial_context = (
            f"{financial_context}\n\n"
            "Existing simplified insights:\n"
            f"{simplified_text}"
        )

    client, model = _get_client()
    completion = client.chat.completions.create(
        model=model,
        temperature=0.2,
        messages=_build_messages(
            history_english=history_english,
            user_english=user_english,
            financial_context=financial_context,
        ),
    )

    assistant_english = (completion.choices[0].message.content or "").strip()
    if not assistant_english:
        assistant_english = "I could not generate a response. Please try again."

    if _is_english(language):
        assistant_user_language = assistant_english
    else:
        assistant_user_language = _translate_via_openai(assistant_english, target_language=language)

    return {
        "user_english": user_english,
        "assistant_english": assistant_english,
        "assistant_user_language": assistant_user_language,
        "language": language,
        "generated_at": datetime.utcnow().isoformat(),
    }
