"""
Simplifies combined transaction data into bullet-point financial insights.
Returns text only — no file I/O.
"""

import json
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()


def _get_client(model: str = "gpt-4o-mini") -> tuple[OpenAI, str]:
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("openai_key")
    if not api_key:
        raise ValueError("OpenAI API key not found. Set OPENAI_API_KEY in your environment.")
    return OpenAI(api_key=api_key), model


def _strip_markdown(text: str) -> str:
    """Remove markdown styling while preserving text content."""
    # Remove bold (**text** or __text__)
    text = text.replace("**", "").replace("__", "")
    # Remove italics (*text* or _text_)
    # Be careful with single underscores (only if surrounded by word boundaries)
    text = text.replace("*", "")
    # Remove strikethrough (~~text~~)
    text = text.replace("~~", "")
    # Remove code formatting (`text`)
    text = text.replace("`", "")
    return text


def _enforce_bullets_only(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    bullet_lines = [
        f"- {_strip_markdown(line[2:].strip())}"
        for line in lines
        if line.startswith(("- ", "* ", "• "))
    ]
    if bullet_lines:
        return "\n".join(bullet_lines)
    return "\n".join(f"- {_strip_markdown(line)}" for line in lines)


def simplify(transactions: dict | str) -> str:
    """
    Takes a combined transactions dict (or JSON string) and returns
    bullet-point financial insights as a markdown string.
    """
    if isinstance(transactions, str):
        transactions_json = json.dumps(json.loads(transactions), ensure_ascii=False)
    else:
        transactions_json = json.dumps(transactions, ensure_ascii=False)

    client, model = _get_client()
    completion = client.chat.completions.create(
        model=model,
        temperature=0.2,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a financial assistant. Return ONLY bullet points. "
                    "Use very simple English. Keep each bullet short and actionable. "
                    "Do not include titles, intros, markdown code blocks, or any non-bullet text. "
                    "Ensure you use Rand currency symbol (R) when mentioning amounts."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Simplify this transaction list JSON into clear financial insights."
                    "Ensure that your insights focus on spending patterns, potential risks, and practical next steps for better financial health. "
                    "You must ensure that you return balance information in your insights, and you should use the Rand currency symbol (R) when mentioning any amounts. "
                    "Focus on spending patterns, risks, and practical next steps.\n\n"
                    f"Transactions JSON:\n{transactions_json}"
                ),
            },
        ],
    )

    content = (completion.choices[0].message.content or "").strip()
    return _enforce_bullets_only(content)
