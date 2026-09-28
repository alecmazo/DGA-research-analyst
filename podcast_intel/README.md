# Podcast Intel

This folder labels the transcript library the app already stores. It does not
download shows or run Whisper.

Interviews come from the `transcripts` table. Earnings calls come from
`call_chunks`. The Transcripts page shows them as one folder tree. The Local
page opens that same page.

Set `PODCAST_INTEL_ENABLED=false` to hide the tree data. The Local page Ollama
pill talks to `scripts/ollama_desk.py` on `127.0.0.1:8766`, which is separate
from this folder.
