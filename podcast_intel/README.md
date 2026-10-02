# Podcast Intel

This folder labels the transcript library the app already stores.

`python -m podcast_intel ingest --limit 3` stores the newest episodes of
Odd Lots, Invest Like the Best, and Acquired in the `transcripts` table.
The RSS address comes from iTunes, and only a title-and-publisher match is
kept. Transcript text comes from the feed's transcript file, then the
publisher's episode page, then a Simplecast transcript when the
publisher filled one in, then YouTube captions. The YouTube video is
found from the public search page when yt-dlp is not installed. The
channel name may be shorter than the Apple show title. When the server
cannot download those captions, the desk browser reads them from the
helper on this Mac and sends the text back. Show notes are not stored
as the transcript. Spotify does not publish a free transcript. Apple
is the directory used to find the RSS address. Audio is not downloaded
and Whisper is not run. All-In is not ingested.

Earnings-call Refresh on the Transcripts page uses `call_refresh.py` to build
Motley Fool URLs. The publish date is often in the first weeks of the month
after the usual print month, and the slug sometimes omits "call" or, on a
year-end call, the quarter. The company name comes from the SEC ticker list
when a quote feed has none. The same rules apply to every ticker. Mention
extraction is not in this package.

Interviews come from the `transcripts` table. Earnings calls come from
`call_chunks`. The Transcripts page shows them as one folder tree. The Local
page opens that same page.

Set `PODCAST_INTEL_ENABLED=false` to hide the tree data. The Local page Ollama
pill talks to `scripts/ollama_desk.py` on `127.0.0.1:8766`, which is separate
from this folder.
