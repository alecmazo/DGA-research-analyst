"""The bottom-right desk button calls the local model, not xAI."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_desk_button_calls_local_model_and_is_labeled_gpt_oss():
    page = (ROOT / "web/gp-app/src/components/support/GrokBot.tsx").read_text()
    assert "ollamaChat" in page
    assert "gpt-oss-20b-finance" in (ROOT / "web/gp-app/src/lib/localOllama.ts").read_text()
    assert "/api/grok-bot/chat" not in page
    assert "Open GPT-oss" in page
    assert ">GPT-oss<" in page
    assert "call_llm" not in page
    route = (ROOT / "api/domains/grok_bot.py").read_text()
    fn = route.split("def grok_bot_chat")[1].split("\ndef ")[0]
    assert "call_llm" not in fn
    assert "gpt-oss-20b-finance" in fn
    assert "does not call the paid API" in fn
