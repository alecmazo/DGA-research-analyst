"""Open-transcript packing. No database."""

from pathlib import Path

from podcast_intel.ask_context import (
    analysis_packets,
    analysis_system,
    content_words,
    or_tsquery,
    pack_chosen,
    select_passages,
    stitch_system,
    stitch_transcript,
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


def test_caption_lines_stitch_into_paragraphs_and_keep_the_tail():
    lines = [
        "[00:00:00] The most interesting big new trend is in",
        "[00:00:02] personal agents.",
        "[00:00:04] OpenAI is spending on ads.",
        "[00:09:10] Stripe and Shopify came up with Andreessen Horowitz.",
    ]
    text = stitch_transcript("\n\n".join(lines))
    assert text.startswith("[00:00:00] ")
    assert "personal agents." in text
    assert "OpenAI is spending" in text
    assert "[00:09:10] Stripe and Shopify came up with Andreessen Horowitz." in text
    assert text.count("[00:") == 2
    packets = analysis_packets("\n\n".join(lines), packet_chars=90)
    assert len(packets) > 1
    assert any("Stripe" in packet and "Shopify" in packet for packet in packets)
    assert all(len(packet) <= 90 for packet in packets)


def test_packets_cover_a_late_name_the_keyword_excerpt_would_drop():
    head = "\n\n".join(
        f"[00:00:{i:02d}] intro words about the weather today really" for i in range(0, 40, 2)
    )
    tail = "[00:08:00] Andreessen Horowitz and Stripe were discussed with Shopify."
    packets = analysis_packets(head + "\n\n" + tail, packet_chars=500)
    assert len(packets) > 1
    assert any("Stripe" in packet and "Shopify" in packet for packet in packets)
    blob = ("word " * 3000).strip()
    fitted = analysis_packets(blob, packet_chars=1000)
    assert fitted
    assert all(len(packet) <= 1000 for packet in fitted)
    assert "word" in fitted[0] and "word" in fitted[-1]


def test_speaker_change_starts_a_new_paragraph():
    raw = "[00:00:01] Alice: Hello there.\n\n[00:00:03] Bob: Good to see you."
    text = stitch_transcript(raw)
    assert "[00:00:01] Alice: Hello there." in text
    assert "[00:00:03] Bob: Good to see you." in text
    assert analysis_system("a16z Show").startswith("You read one section")
    assert "Do not invent" in stitch_system()


def test_transcript_page_asks_in_packets_and_shows_work():
    root = Path(__file__).resolve().parents[2]
    ask = (root / "web/gp-app/src/components/transcripts/TranscriptAsk.tsx").read_text()
    page = (root / "web/gp-app/src/pages/TranscriptsPage.tsx").read_text()
    library = (root / "web/gp-app/src/components/transcripts/LibraryTree.tsx").read_text()
    server = (root / "api/server.py").read_text()
    assert "packets: true" in ask
    assert "Reading section" in ask
    assert "Stitching" in ask
    assert "Refreshing the transcript library and the call-coverage table" in page
    assert "Refreshing…" in page
    assert "onKeyDown={onSearchKey}" in library
    assert "Pulling earnings-call transcripts for" in library
    assert "analysis_packets(" in server
    assert "stitch_transcript(" in server
    assert 'packets=bool((body or {}).get("packets"))' in server


def test_no_open_document_still_says_when_the_library_is_empty():
    prompt = system_prompt("")
    assert "library does not have it" in prompt
    message = user_message("guidance?", "", "")
    assert "No stored transcript passages matched" in message
