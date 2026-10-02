from pathlib import Path

from podcast_intel.tree import (
    call_label,
    group_calls,
    group_interviews,
    interview_folder,
    interview_label,
    split_calls,
)


def test_interview_folders_prefer_channel_then_person():
    rows = [
        {"id": "a", "channel": "Acquired", "person": "Ben", "title": "NVIDIA", "created_at": "2026-03-02T00:00:00"},
        {"id": "b", "channel": "", "person": "Bill Ackman", "title": "CNBC hit", "published_at": "2026-01-15"},
        {"id": "c", "channel": "Acquired", "person": "", "title": "Costco", "created_at": "2026-05-01"},
        {"id": "d", "title": "No names", "source": "youtube"},
    ]
    folders = {f["label"]: f for f in group_interviews(rows)}
    assert set(folders) == {"Acquired", "Bill Ackman", "YouTube"}
    assert folders["Acquired"]["count"] == 2
    assert folders["Acquired"]["items"][0]["label"].startswith("2026-05-01")
    assert interview_folder(rows[1]) == "Bill Ackman"
    assert "Ben" in interview_label(rows[0], "Acquired")


def test_call_labels_name_the_source():
    rows = [
        {"ticker": "aapl", "quarter": "Q3 2026", "call_date": "2026-07-30", "source": "motley_fool", "chunks": 40},
        {"ticker": "AAPL", "quarter": "Q2 2026", "call_date": "2026-05-01", "source": "fmp", "chunks": 12},
        {"ticker": "MSFT", "quarter": "", "call_date": "", "source": "unknown", "chunks": 1},
    ]
    folders = {f["label"]: f for f in group_calls(rows)}
    assert list(folders) == ["AAPL", "MSFT"]
    assert folders["AAPL"]["count"] == 2
    assert folders["AAPL"]["items"][0]["label"] == "Q3 2026 · 2026-07-30 · Motley Fool"
    assert call_label(rows[2]) == "Undated"


def test_watchlist_calls_come_first_and_the_rest_stay_alphabetical():
    rows = [
        {"ticker": "MSFT", "quarter": "Q1 2026", "call_date": "2026-01-01", "chunks": 2},
        {"ticker": "AAPL", "quarter": "Q1 2026", "call_date": "2026-01-02", "chunks": 2},
        {"ticker": "NVDA", "quarter": "Q1 2026", "call_date": "2026-01-03", "chunks": 2},
        {"ticker": "COST", "quarter": "Q1 2026", "call_date": "2026-01-04", "chunks": 2},
    ]
    watch, rest = split_calls(group_calls(rows), ["nvda", "AAPL", "AAPL", "TSLA", ""])
    assert [folder["label"] for folder in watch] == ["NVDA", "AAPL"]
    assert [folder["label"] for folder in rest] == ["COST", "MSFT"]
    page = Path(__file__).resolve().parents[2] / "web/gp-app/src/components/transcripts/LibraryTree.tsx"
    src = page.read_text()
    assert 'title="Earnings calls from watchlist"' in src
    assert 'title="Earnings calls"' in src
