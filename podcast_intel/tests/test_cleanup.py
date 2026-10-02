from pathlib import Path

from podcast_intel.cleanup import (
    CHANNEL_EXPR,
    CleanupError,
    clean_channels,
    shape_show,
)


def test_clean_channels_keeps_exact_names_and_drops_blanks():
    assert clean_channels(["  Odd Lots  ", "", "Odd Lots", "Acquired"]) == [
        "Odd Lots",
        "Acquired",
    ]


def test_clean_channels_rejects_a_wipe_of_everything():
    try:
        clean_channels([])
    except CleanupError as exc:
        assert "at least one" in str(exc)
    else:
        raise AssertionError("empty selection should fail")
    try:
        clean_channels("Odd Lots")
    except CleanupError:
        pass
    else:
        raise AssertionError("a bare string is not a selection")


def test_clean_channels_caps_the_list():
    try:
        clean_channels([f"Show {i}" for i in range(41)])
    except CleanupError as exc:
        assert "40" in str(exc)
    else:
        raise AssertionError("41 shows should fail")


def test_shape_and_match_stay_on_podcast_rows():
    row = shape_show("Invest Like the Best", 3, 1200)
    assert row == {"channel": "Invest Like the Best", "episodes": 3, "bytes": 1200}
    assert "Unlabeled" in CHANNEL_EXPR


def test_cleanup_controls_are_on_the_transcripts_page():
    root = Path(__file__).resolve().parents[2]
    page = (root / "web/gp-app/src/pages/TranscriptsPage.tsx").read_text()
    panel = (root / "web/gp-app/src/components/transcripts/PodcastCleanup.tsx").read_text()
    server = (root / "api/server.py").read_text()
    assert "Clean up" in page
    assert "PodcastCleanup" in page
    assert "Delete selected" in panel
    assert "/api/transcripts/cleanup" in panel
    assert "Earnings calls are left alone" in panel
    fn = server.split("def transcripts_cleanup_delete")[1].split("\ndef ")[0]
    assert "call_chunks" not in fn
    assert "ANY(%s)" in fn
    assert "CHANNEL_EXPR" in fn
