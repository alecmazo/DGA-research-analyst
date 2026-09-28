import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _desk():
    spec = importlib.util.spec_from_file_location(
        "ollama_desk", ROOT / "scripts" / "ollama_desk.py",
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


def test_red_pill_starts_when_nothing_is_running_and_restarts_a_glitch():
    desk = _desk()
    assert desk.decide(True, True) == "up"
    assert desk.decide(False, False) == "start"
    assert desk.decide(False, True) == "restart"
    assert desk.PORT == 8766
    assert desk.HOST == "127.0.0.1"
