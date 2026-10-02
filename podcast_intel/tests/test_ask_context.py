"""Open-transcript packing. No database."""

from podcast_intel.ask_context import (
    content_words,
    or_tsquery,
    pack_chosen,
    select_passages,
    system_prompt,
    user_message,
)


def test_content_words_drop_stopwords_and_keep_the_year():
    words = content_words("What did they say about 2026 guidance?")
    assert words[0] == "2026"
    assert "guidance" in words
    assert "about" not in words
    assert "what" not in words


def test_or_tsquery_does_not_require_every_word():
    query = or_tsquery(["2026", "guidance", "organic"])
    assert query == "2026 | guidance | organic"
    assert "&" not in query


def test_one_long_blob_still_reaches_a_late_answer():
    blob = ("Weather and operations. " * 400) + " We are raising 2026 guidance. " + ("More weather. " * 40)
    text = select_passages([blob], "2026 guidance", limit=2500, head_chars=500)
    assert "raising 2026 guidance" in text
    assert len(text) <= 2500


def test_long_call_keeps_the_opening_and_the_matching_section():
    opening = "Operator: Welcome to the call. " * 80
    middle = "Unrelated discussion of the weather. " * 40
    guidance = "We are raising full year 2026 guidance to a range of 14 to 15 percent."
    tail = "More unrelated color on the weather. " * 40
    text = select_passages([opening, middle, guidance, tail], "2026 guidance", limit=2500, head_chars=600)
    assert "Welcome to the call" in text
    assert "raising full year 2026 guidance" in text
    assert len(text) <= 2500


def test_short_document_is_kept_whole():
    parts = ["First speaker said hello.", "Second speaker answered."]
    assert select_passages(parts, "anything") == "\n\n".join(parts)


def test_open_transcript_prompt_does_not_blame_the_library():
    prompt = system_prompt("BSX · 2026Q2")
    assert "open transcript" in prompt.lower()
    assert "library does not have it" not in prompt
    message = user_message("guidance?", "We raised guidance.", "")
    assert message.startswith("Question: guidance?")
    assert "Open transcript:\nWe raised guidance." in message
    assert "Other library" not in message
    assert "library does not have" not in message


def test_chosen_transcripts_are_the_only_context():
    prompt = system_prompt("", chosen_labels=["Odd Lots", "BSX · 2026Q2"])
    assert "Odd Lots" in prompt
    assert "BSX · 2026Q2" in prompt
    assert "chosen transcripts" in prompt.lower()
    assert "library does not have it" not in prompt
    message = user_message("compare?", "", "", "[Odd Lots]\nSaid it.")
    assert "Chosen transcripts:\n[Odd Lots]\nSaid it." in message
    assert "Open transcript" not in message
    first = "Alpha opening. " * 200 + " Alpha raised 2026 guidance."
    second = "Beta opening. " * 200 + " Beta cut the dividend."
    packed = pack_chosen(
        [("Odd Lots", first), ("BSX · 2026Q2", second)],
        "guidance dividend",
        limit=1800,
    )
    assert "[Odd Lots]" in packed
    assert "[BSX · 2026Q2]" in packed
    assert "2026 guidance" in packed
    assert "cut the dividend" in packed
    assert len(packed) <= 1800


def test_no_open_document_still_says_when_the_library_is_empty():
    prompt = system_prompt("")
    assert "library does not have it" in prompt
    message = user_message("guidance?", "", "")
    assert "No stored transcript passages matched" in message
