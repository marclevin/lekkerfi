from types import SimpleNamespace
from unittest.mock import patch

from services import finance_chat


class _FakeCompletions:
    @staticmethod
    def create(**kwargs):
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="We should pause and involve your supporter.")
                )
            ]
        )


class _FakeClient:
    def __init__(self):
        self.chat = SimpleNamespace(completions=_FakeCompletions())


def test_translate_first_skips_openai_fallback_when_english_like_translation():
    with patch("services.finance_chat.translate_to_english", return_value="I want to buy a gun now") as mock_translate:
        with patch("services.finance_chat._translate_via_openai") as mock_openai:
            out = finance_chat._translate_to_english_with_fallback("Ngifuna ukuthenga isibhamu", "zulu")

    assert out == "I want to buy a gun now"
    mock_translate.assert_called_once()
    mock_openai.assert_not_called()


def test_translate_first_uses_openai_fallback_when_translation_not_english_like():
    with patch("services.finance_chat.translate_to_english", return_value="quiero comprar un arma ahora") as mock_translate:
        with patch("services.finance_chat._translate_via_openai", return_value="I want to buy a gun now") as mock_openai:
            out = finance_chat._translate_to_english_with_fallback("quiero comprar un arma ahora", "spanish")

    assert out == "I want to buy a gun now"
    mock_translate.assert_called_once()
    mock_openai.assert_called_once()


def test_non_english_dangerous_message_is_translated_then_flagged_for_safety():
    with patch("services.finance_chat._get_client", return_value=(_FakeClient(), "gpt-4o-mini")):
        with patch(
            "services.finance_chat._translate_to_english_with_fallback",
            return_value="I want to buy a gun now",
        ) as mock_translate_to_english:
            with patch(
                "services.finance_chat._translate_from_english_with_fallback",
                side_effect=lambda text, target_language: text,
            ):
                reply = finance_chat.generate_finance_chat_reply(
                    user_text="Ngifuna ukuthenga isibhamu manje",
                    user_language="zulu",
                    raw_transactions=None,
                    simplified_text=None,
                    history_english=[],
                    trusted_supporter_name="Nomsa",
                )

    mock_translate_to_english.assert_called_once()
    assert reply["safety_detected"] is True
    assert reply["safety_category"] == "weapons_purchase"
    assert reply["safety_confidence"] == "high"
    assert reply["pause_required"] is True
    assert reply["pause_reason"] == "safety_weapons_purchase"
    assert reply["supporter_flag_required"] is True
