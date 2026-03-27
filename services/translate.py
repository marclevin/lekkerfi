"""
Translates bullet-point insights into a target language.
Returns text only — no file I/O.
"""

from gradio_client import Client

_MODEL_REPO = "CohereLabs/tiny-aya"


def _enforce_bullets_only(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    bullet_lines = [
        f"- {line[2:].strip()}"
        for line in lines
        if line.startswith(("- ", "* ", "• "))
    ]
    if bullet_lines:
        return "\n".join(bullet_lines)
    return "\n".join(f"- {line}" for line in lines)


def translate(text: str, language: str, model_repo: str = _MODEL_REPO) -> str:
    """
    Translates bullet-point insight text into the target language.
    Returns translated bullet points as a markdown string.
    """
    client = Client(model_repo)

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

    result = client.predict(
        message=message,
        system_prompt=system_prompt,
        temperature=0.1,
        max_new_tokens=700,
        api_name="/generate",
    )

    translated = result.strip() if isinstance(result, str) else str(result).strip()
    return _enforce_bullets_only(translated)
