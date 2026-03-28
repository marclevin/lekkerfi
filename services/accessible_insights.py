"""
Generate cognitively accessible insight cards for carousel presentation.
"""

import json
import os
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

_DEFAULT_MODEL = "gpt-4o-mini"


def _get_client(model: str = _DEFAULT_MODEL) -> tuple[OpenAI, str]:
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("openai_key")
    if not api_key:
        raise ValueError("OpenAI API key not found. Set OPENAI_API_KEY in your environment.")
    return OpenAI(api_key=api_key), model


def _safe_lines(text: str, fallback: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        return fallback
    return cleaned


def _coerce_card(card: dict[str, Any], idx: int, viz: dict[str, Any]) -> dict[str, Any]:
    title = viz.get("title") or f"Chart {idx + 1}"
    chart_type = viz.get("type") or f"chart_{idx + 1}"
    chart_url = viz.get("url") or ""

    return {
        "id": str(card.get("id") or chart_type or f"card_{idx + 1}"),
        "title": str(card.get("title") or title),
        "chart_type": str(card.get("chart_type") or chart_type),
        "chart_url": str(card.get("chart_url") or chart_url),
        "headline": _safe_lines(
            str(card.get("headline") or ""),
            "This chart shows one key money pattern.",
        ),
        "explanation": _safe_lines(
            str(card.get("explanation") or ""),
            "We can look at this step by step.",
        ),
        "what_to_do_now": _safe_lines(
            str(card.get("what_to_do_now") or ""),
            "Take one small action today.",
        ),
        "chat_prompt": _safe_lines(
            str(card.get("chat_prompt") or ""),
            f"Please explain {title} in simple steps and tell me what to do next.",
        ),
    }


def _fallback_cards(
    simplified_text: str,
    visualizations: list[dict[str, Any]],
    language: str,
) -> dict[str, Any]:
    bullet_lines = [
        line[2:].strip()
        for line in (simplified_text or "").splitlines()
        if line.strip().startswith("- ")
    ]
    if not bullet_lines:
        bullet_lines = ["We have your latest money summary ready."]

    cards: list[dict[str, Any]] = []
    for idx, viz in enumerate(visualizations):
        bullet = bullet_lines[idx % len(bullet_lines)]
        title = viz.get("title") or f"Chart {idx + 1}"
        cards.append({
            "id": str(viz.get("type") or f"chart_{idx + 1}"),
            "title": title,
            "chart_type": str(viz.get("type") or f"chart_{idx + 1}"),
            "chart_url": str(viz.get("url") or ""),
            "headline": bullet,
            "explanation": (
                "This chart and the summary tell the same story. "
                "We can review it slowly, one point at a time."
            ),
            "what_to_do_now": "Choose one simple action, then ask chat if you want help.",
            "chat_prompt": f"Please explain this chart: {title}. Use simple words and one next step.",
        })

    if not cards:
        cards.append({
            "id": "summary_only",
            "title": "Money summary",
            "chart_type": "summary",
            "chart_url": "",
            "headline": bullet_lines[0],
            "explanation": "We can take this summary one short step at a time.",
            "what_to_do_now": "Ask one question in chat about this summary.",
            "chat_prompt": "Please explain my latest money summary using very simple words.",
        })

    return {
        "language": language,
        "intro": "We will go through your money summary one card at a time.",
        "cards": cards,
    }


def generate_accessible_carousel(
    *,
    simplified_text: str,
    visualizations: list[dict[str, Any]],
    summary: dict[str, Any] | None,
    language: str,
) -> dict[str, Any]:
    """
    Build a guided carousel payload with simple, supportive language.
    """
    fallback = _fallback_cards(
        simplified_text=simplified_text,
        visualizations=visualizations,
        language=language,
    )

    client, model = _get_client()

    viz_input = [
        {
            "type": v.get("type"),
            "title": v.get("title"),
            "description": v.get("description"),
        }
        for v in visualizations
    ]

    prompt_payload = {
        "language": language,
        "summary": summary or {},
        "simplified_bullets": simplified_text,
        "visualizations": viz_input,
    }

    completion = client.chat.completions.create(
        model=model,
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an accessibility-first finance explainer. "
                    "Write for users with aphasia, cognitive load challenges, or early dementia. "
                    "Use very short, plain sentences. Keep tone calm, kind, and non-judgmental. "
                    "Avoid jargon and complex grammar. "
                    "Always answer in the requested language. "
                    "Return only JSON with this exact shape: "
                    "{\"intro\": string, \"cards\": [{\"id\": string, \"title\": string, \"chart_type\": string, \"headline\": string, \"explanation\": string, \"what_to_do_now\": string, \"chat_prompt\": string}]}. "
                    "Cards must match the number and order of provided visualizations when visualizations exist. "
                    "Each card must include one clear next step."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Create guided insight cards from this input JSON. "
                    "Keep every field concise and easy to read aloud.\n\n"
                    f"Input:\n{json.dumps(prompt_payload, ensure_ascii=False)}"
                ),
            },
        ],
    )

    raw = (completion.choices[0].message.content or "").strip()
    parsed = json.loads(raw)

    intro = _safe_lines(
        str(parsed.get("intro") or ""),
        fallback["intro"],
    )

    raw_cards = parsed.get("cards")
    if not isinstance(raw_cards, list) or not raw_cards:
        return fallback

    coerced_cards: list[dict[str, Any]] = []
    if visualizations:
        for idx, viz in enumerate(visualizations):
            source = raw_cards[idx] if idx < len(raw_cards) and isinstance(raw_cards[idx], dict) else {}
            coerced_cards.append(_coerce_card(source, idx, viz))
    else:
        first_card = raw_cards[0] if isinstance(raw_cards[0], dict) else {}
        coerced_cards.append(_coerce_card(first_card, 0, {"type": "summary", "title": "Money summary", "url": ""}))

    return {
        "language": language,
        "intro": intro,
        "cards": coerced_cards,
    }
