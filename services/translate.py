"""
Translates bullet-point insights into a target language.
Returns text only — no file I/O.
"""

from gradio_client import Client

_MODEL_REPO = "CohereLabs/tiny-aya"


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


def _strip_code_fences(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```") and cleaned.endswith("```"):
        lines = cleaned.splitlines()
        if len(lines) >= 3:
            return "\n".join(lines[1:-1]).strip()
    return cleaned


def _predict_translation(message: str, system_prompt: str, model_repo: str = _MODEL_REPO) -> str:
    client = Client(model_repo)
    result = client.predict(
        message=message,
        system_prompt=system_prompt,
        temperature=0.1,
        max_new_tokens=700,
        api_name="/generate",
    )
    return result.strip() if isinstance(result, str) else str(result).strip()


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


def translate(text: str, language: str, model_repo: str = _MODEL_REPO) -> str:
    """
    Translates bullet-point insight text into the target language.
    Returns translated bullet points as a markdown string.
    """
    system_prompt = (
        "You are a translator. Translate text into the requested language. "
        "Output ONLY bullet points in markdown format. "
        "Do not add titles, intros, explanations, or code blocks."
    )
    message = (
        f"Target language: {language}\n\n"
        "Translate the following bullet points into the target language. "
        "Keep them simple and actionable. Output only bullet points.\n\n"
        f"{text}"
    )

    translated = _predict_translation(
        message=message,
        system_prompt=system_prompt,
        model_repo=model_repo,
    )
    return _enforce_bullets_only(translated)


def translate_text(text: str, target_language: str, model_repo: str = _MODEL_REPO) -> str:
    """Translate free-form text without forcing bullet formatting."""
    system_prompt = (
        "You are a translator. Translate the message into the requested language. "
        "Return only the translated text. Do not add explanations, titles, or markdown formatting."
    )
    message = (
        f"Target language: {target_language}\n\n"
        "Translate the following text exactly with natural phrasing.\n\n"
        f"{text}"
    )
    translated = _predict_translation(
        message=message,
        system_prompt=system_prompt,
        model_repo=model_repo,
    )
    return _strip_markdown(_strip_code_fences(translated)).strip()


def translate_to_english(text: str, source_language: str, model_repo: str = _MODEL_REPO) -> str:
    """Translate free-form text from source language to English."""
    return translate_text(
        text=text,
        target_language="English",
        model_repo=model_repo,
    )
