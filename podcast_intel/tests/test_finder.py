"""Show finder matching. No network and no database."""

import pytest

from podcast_intel.finder import (
    ShowFinderError,
    choose_channel,
    clean_collection_id,
    clean_episode_key,
    episode_key,
    public_https,
    pull_text,
    same_show,
    shape_episodes,
    show_hits,
    stored_hit,
)


def test_search_hits_keep_a_public_feed_and_drop_a_private_one():
    hits = show_hits([
        {
            "collectionId": 123,
            "collectionName": "Odd Lots",
            "artistName": "Bloomberg",
            "feedUrl": "https://feeds.example/odd.xml",
        },
        {
            "collectionId": 999,
            "collectionName": "Local",
            "artistName": "Me",
            "feedUrl": "https://127.0.0.1/feed.xml",
        },
        {
            "collectionId": 123,
            "collectionName": "Odd Lots duplicate",
            "artistName": "Bloomberg",
            "feedUrl": "http://feeds.example/plain.xml",
        },
    ])
    assert hits == [{"collection_id": "123", "name": "Odd Lots", "author": "Bloomberg"}]
    assert public_https("https://feeds.example/odd.xml")
    assert not public_https("http://feeds.example/plain.xml")
    assert not public_https("https://localhost/feed.xml")


def test_a_longer_itunes_name_joins_the_folder_already_in_the_library():
    assert same_show(
        "Invest Like the Best",
        "Invest Like the Best with Patrick O'Shaughnessy",
    )
    assert not same_show("Acquired", "Acquired AI")
    assert choose_channel(
        "Invest Like the Best with Patrick O'Shaughnessy",
        ["Acquired", "Invest Like the Best with Patrick O'Shaughnessy", "Invest Like the Best"],
    ) == "Invest Like the Best"


def test_an_episode_already_stored_under_the_short_show_name_is_the_same_row():
    episode = {
        "title": "Noah Shinn - Building Instinct",
        "link": "https://example.invalid/noah",
        "guid": "noah",
        "published": "2026-09-28",
    }
    hit = stored_hit(
        "Invest Like the Best with Patrick O'Shaughnessy",
        episode,
        [{
            "id": "35877e4d",
            "title": "Noah Shinn - Building Instinct",
            "channel": "Invest Like the Best",
            "video_url": "https://www.youtube.com/watch?v=Am7IWP8IpEc",
        }],
    )
    assert hit["id"] == "35877e4d"
    shaped = shape_episodes(
        "Invest Like the Best with Patrick O'Shaughnessy",
        [episode],
        [hit],
    )
    assert shaped[0]["stored_id"] == "35877e4d"
    assert shaped[0]["key"] == episode_key(episode)
    assert "link" not in shaped[0]


def test_a_matched_video_without_server_captions_returns_the_id(monkeypatch):
    def fake(_episode):
        return "", "", "https://www.youtube.com/watch?v=lr3hNhA0IfQ"

    monkeypatch.setattr("podcast_intel.finder.acquire_episode", fake)
    out = pull_text("The a16z Show", {"title": "Markets", "link": "https://example.invalid/ep"})
    assert out["ok"] is False
    assert out["video_id"] == "lr3hNhA0IfQ"
    assert "YouTube blocks" in out["error"]


def test_a_published_transcript_does_not_ask_the_mac(monkeypatch):
    def fake(_episode):
        return "word " * 200, "T1", "https://example.invalid/t.txt"

    monkeypatch.setattr("podcast_intel.finder.acquire_episode", fake)
    out = pull_text("Odd Lots", {"title": "One", "link": "https://example.invalid/ep"})
    assert out["ok"] is True
    assert out["tier"] == "T1"
    assert "video_id" not in out


def test_episode_keys_and_show_ids_are_tight():
    assert len(episode_key({"guid": "a", "title": "One"})) == 20
    with pytest.raises(ShowFinderError):
        clean_collection_id("https://evil.example/feed.xml")
    with pytest.raises(ShowFinderError):
        clean_episode_key("../etc")
