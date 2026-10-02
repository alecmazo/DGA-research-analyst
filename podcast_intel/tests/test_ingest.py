"""Feed matching and transcript cleanup. No network and no database."""

import pytest

from podcast_intel.feed import (
    normalize_transcript,
    parse_feed,
    publisher_is_preview,
    publisher_transcript,
    simplecast_slug,
    simplecast_transcript_text,
)
from podcast_intel.shows import ShowSkipped, pick_show, show_spec
from podcast_intel.youtube_caps import (
    description_from_player,
    pick_video,
    search_query,
    show_on_video,
    videos_from_search,
)


def test_all_in_is_refused_and_the_copycat_is_not_the_show():
    with pytest.raises(ShowSkipped):
        show_spec("All-In Podcast")
    spec = show_spec("Invest Like the Best")
    chosen = pick_show(
        [
            {
                "collectionName": "Invest Like The Best",
                "artistName": "Horror stories and legends",
                "feedUrl": "https://example.invalid/horror.xml",
            },
            {
                "collectionName": "Invest Like the Best with Patrick O'Shaughnessy",
                "artistName": "Colossus | Investing & Business Podcasts",
                "feedUrl": "https://example.invalid/colossus.xml",
            },
        ],
        spec,
    )
    assert chosen["feedUrl"].endswith("colossus.xml")


def test_acquired_exact_title_beats_a_show_that_only_starts_the_same_way():
    spec = show_spec("Acquired")
    chosen = pick_show(
        [
            {
                "collectionName": "Acquired AI",
                "artistName": "Ben Gilbert",
                "feedUrl": "https://example.invalid/ai.xml",
            },
            {
                "collectionName": "Acquired",
                "artistName": "Ben Gilbert and David Rosenthal",
                "feedUrl": "https://example.invalid/acquired.xml",
            },
        ],
        spec,
    )
    assert chosen["collectionName"] == "Acquired"


def test_feed_parser_keeps_the_plain_transcript_first():
    xml = """<?xml version="1.0"?>
    <rss xmlns:podcast="http://podcastindex.org/namespace/1.0">
      <channel>
        <item>
          <title>Why the crosswalk</title>
          <link>https://example.invalid/ep</link>
          <guid>abc</guid>
          <pubDate>Mon, 28 Sep 2026 08:00:00 GMT</pubDate>
          <enclosure url="https://example.invalid/a.mp3" type="audio/mpeg"/>
          <podcast:transcript url="https://example.invalid/a.vtt" type="text/vtt"/>
          <podcast:transcript url="https://example.invalid/a.txt" type="text/plain"/>
        </item>
      </channel>
    </rss>
    """
    items = parse_feed(xml)
    assert items[0]["title"] == "Why the crosswalk"
    assert items[0]["published"] == "2026-09-28"
    assert items[0]["transcripts"][0]["url"].endswith("a.txt")


def test_timed_plain_text_and_srt_keep_the_words():
    plain = normalize_transcript(
        "00:00:09\nSpeaker 2: Welcome to Odd Lots.\n\n00:00:22\nSpeaker 3: I'm Joe.\n"
    )
    assert "[00:00:09] Speaker 2: Welcome to Odd Lots." in plain
    assert "I'm Joe." in plain
    srt = normalize_transcript(
        "1\n00:00:02,750 --> 00:00:07,690\nSpeaker 1: Bloomberg Audio.\n\n"
        "2\n00:00:09,980 --> 00:00:12,000\nSpeaker 2: Welcome.\n"
    )
    assert "[00:00:02] Speaker 1: Bloomberg Audio." in srt
    assert "[00:00:09] Speaker 2: Welcome." in srt


def test_publisher_page_keeps_speakers_and_drops_the_chrome():
    html = """
    <p class="nav">Subscribe</p>
    <p data-transcript-host data-transcript-speaker-changed="">
      <span class="transcript__speaker transcript__speaker--1">Patrick</span>
      My guest today is Noah.
    </p>
    <p data-transcript-guest>
      <span class="transcript__speaker transcript__speaker--2">Noah</span>
      Thanks for having me.
    </p>
    """
    text = publisher_transcript(html)
    assert "Patrick: My guest today is Noah." in text
    assert "Noah: Thanks for having me." in text
    assert "Subscribe" not in text
    assert publisher_is_preview("<p>Access the full transcript</p> Log in to view episode transcripts")


def test_youtube_match_uses_the_show_channel_and_the_guest():
    chosen = pick_video(
        "Invest Like the Best",
        "Noah Shinn - Building Instinct: The Personal Agent - EP.493",
        "2026-09-28",
        [
            {
                "id": "shortclip111",
                "channel": "Invest Like The Best",
                "title": "A 30 second clip about markets",
                "upload_date": "20260928",
            },
            {
                "id": "Am7IWP8IpEc",
                "channel": "Invest Like The Best",
                "title": "What Happens When Everyone Has an AI Agent",
                "upload_date": "20260928",
                "description": "Patrick interviews Noah Shinn of Instinct",
            },
        ],
    )
    assert chosen["id"] == "Am7IWP8IpEc"
    assert "[" not in search_query("Invest Like the Best", "Noah Shinn - Instinct [EP.493]")


def test_a_shorter_channel_name_still_matches_the_show():
    assert show_on_video("The a16z Show", "a16z", "How AI Is Reshaping Markets")
    assert not show_on_video("The a16z Show", "Bloomberg", "Inside the AI Buildout")
    chosen = pick_video(
        "The a16z Show",
        "The $1 Trillion AI Buildout | State of Markets",
        "2026-09-30",
        [
            {
                "id": "bloomberg01",
                "channel": "Bloomberg",
                "title": "Inside the $1 Trillion AI Buildout and State of Markets",
                "description": "State of Markets buildout",
            },
            {
                "id": "lr3hNhA0IfQ",
                "channel": "a16z",
                "title": "How AI Is Reshaping Markets, Industries, and the Economy",
                "description": (
                    "charts from the latest State of Markets presentation "
                    "and the AI infrastructure buildout"
                ),
            },
        ],
    )
    assert chosen["id"] == "lr3hNhA0IfQ"
    rows = videos_from_search({
        "contents": {
            "twoColumnSearchResultsRenderer": {
                "primaryContents": {
                    "sectionListRenderer": {
                        "contents": [{
                            "itemSectionRenderer": {
                                "contents": [{
                                    "videoRenderer": {
                                        "videoId": "lr3hNhA0IfQ",
                                        "title": {"runs": [{"text": "How AI Is Reshaping Markets"}]},
                                        "ownerText": {"runs": [{"text": "a16z"}]},
                                    },
                                }],
                            },
                        }],
                    },
                },
            },
        },
    })
    assert rows == [{
        "id": "lr3hNhA0IfQ",
        "channel": "a16z",
        "title": "How AI Is Reshaping Markets",
        "upload_date": "",
        "description": "",
    }]
    noted = pick_video(
        "The a16z Show",
        "The $1 Trillion AI Buildout | State of Markets",
        "2026-09-30",
        [{
            "id": "lr3hNhA0IfQ",
            "channel": "a16z",
            "title": "How AI Is Reshaping Markets",
            "description": "David George and Sarah Wang on the State of Markets",
        }],
        "David George and Sarah Wang unpack the State of Markets presentation.",
    )
    assert noted["id"] == "lr3hNhA0IfQ"
    assert description_from_player({
        "videoDetails": {"shortDescription": "State of Markets buildout"},
    }) == "State of Markets buildout"
    assert simplecast_slug(
        "https://a16z.simplecast.com/episodes/the-1-trillion-ai-buildout-tkJj_Zp1",
    ) == "the-1-trillion-ai-buildout-tkJj_Zp1"
    assert simplecast_slug("https://www.youtube.com/watch?v=lr3hNhA0IfQ") == ""
    assert simplecast_transcript_text({"transcription": None}) == ""
    long = "Speaker: " + ("word " * 20)
    assert simplecast_transcript_text({"transcription": f"<p>{long}</p>"}).startswith("Speaker:")


def test_a_rewritten_youtube_title_matches_when_the_description_names_the_guest():
    chosen = pick_video(
        "Invest Like the Best",
        "Gabe Stengel - Building Investing Superintelligence",
        "2026-09-22",
        [
            {
                "id": "B0illwrqUG0",
                "channel": "Invest Like The Best",
                "title": "Why OpenAI and Anthropic Won't Win Finance",
                "upload_date": "NA",
                "description": "Patrick talks with Gabe Stengel about investing superintelligence.",
            }
        ],
    )
    assert chosen["id"] == "B0illwrqUG0"
