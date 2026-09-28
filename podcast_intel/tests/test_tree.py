from podcast_intel.tree import call_label, group_calls, group_interviews, interview_folder, interview_label


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
