"""One TTS entry point for episode turns, the disclaimer, samples, and auditions.

`PODCAST_TTS_PROVIDER` selects openai (default), kokoro, or xai.
`tts_model` still chooses the OpenAI model. gpt-4o-mini-tts is the default;
tts-1-hd stays available.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request

OPENAI_MODEL_DEFAULT = "gpt-4o-mini-tts"

# tts-1 and tts-1-hd reject ballad / coral / verse.
OPENAI_TTS1_VOICES = (
    "alloy", "ash", "echo", "fable",
    "nova", "onyx", "sage", "shimmer",
)
OPENAI_MINI_EXTRA = ("ballad", "coral", "verse")

# https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
XAI_VOICES = (
    "ara", "eve", "leo", "rex", "sal",
    "carina", "zagan", "helix", "orion", "luna", "iris", "altair",
    "zenith", "perseus", "helios", "lux", "kepler", "rigel", "cosmo",
    "celeste", "ursa", "sirius", "lumen", "castor", "naksh", "atlas",
    "aurora", "liora",
)

KOKORO_VOICES = (
    "af_heart", "af_bella", "am_adam", "am_michael", "bf_emma", "bm_george",
)


def voices_for_openai_model(model: str | None) -> list[str]:
    name = (model or OPENAI_MODEL_DEFAULT).strip()
    if name in ("tts-1", "tts-1-hd"):
        return list(OPENAI_TTS1_VOICES)
    return list(OPENAI_TTS1_VOICES + OPENAI_MINI_EXTRA)


class TTSProvider:
    def synthesize(self, text: str, voice: str, speed: float) -> bytes:
        raise NotImplementedError

    def voices(self) -> list[str]:
        raise NotImplementedError

    def ensure_ready(self) -> None:
        return None


class OpenAITTS(TTSProvider):
    def __init__(self, model: str | None = None):
        self.model = (model or OPENAI_MODEL_DEFAULT).strip() or OPENAI_MODEL_DEFAULT

    def voices(self) -> list[str]:
        return voices_for_openai_model(self.model)

    def ensure_ready(self) -> None:
        if not os.environ.get("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY not set")
        try:
            import openai  # noqa: F401
        except ImportError as e:
            raise RuntimeError("openai package missing") from e

    def synthesize(self, text: str, voice: str, speed: float) -> bytes:
        self.ensure_ready()
        from openai import OpenAI
        voice_l = (voice or "alloy").lower()
        allowed = self.voices()
        if voice_l not in allowed:
            raise ValueError(f"voice {voice_l!r} is not available on {self.model}")
        speed_f = max(0.25, min(4.0, float(speed)))
        client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
        resp = client.audio.speech.create(
            model=self.model,
            voice=voice_l,
            input=text,
            response_format="mp3",
            speed=speed_f,
        )
        if hasattr(resp, "read"):
            return resp.read()
        if hasattr(resp, "content"):
            return bytes(resp.content)
        return bytes(resp)


class KokoroLocalTTS(TTSProvider):
    """Optional local Kokoro. Import is deferred so a missing package is a clear error."""

    def voices(self) -> list[str]:
        return list(KOKORO_VOICES)

    def ensure_ready(self) -> None:
        try:
            import kokoro  # noqa: F401
        except ImportError as e:
            raise RuntimeError(
                "Kokoro is not installed. Install the kokoro package before "
                "setting PODCAST_TTS_PROVIDER=kokoro."
            ) from e

    def synthesize(self, text: str, voice: str, speed: float) -> bytes:
        self.ensure_ready()
        import io
        import wave

        import numpy as np
        from kokoro import KPipeline

        voice_l = (voice or "af_heart").lower()
        if voice_l not in self.voices():
            raise ValueError(f"voice {voice_l!r} is not a Kokoro voice")
        lang = "b" if voice_l.startswith("b") else "a"
        pipeline = KPipeline(lang_code=lang)
        chunks = []
        for _gs, _ps, audio in pipeline(text, voice=voice_l, speed=float(speed)):
            if audio is not None:
                chunks.append(np.asarray(audio, dtype=np.float32))
        if not chunks:
            raise RuntimeError("Kokoro returned no audio")
        samples = np.concatenate(chunks)
        pcm = (samples.clip(-1.0, 1.0) * 32767.0).astype("<i2")
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(24000)
            wf.writeframes(pcm.tobytes())
        wav = buf.getvalue()
        try:
            from pydub import AudioSegment
            seg = AudioSegment.from_file(io.BytesIO(wav), format="wav")
            out = io.BytesIO()
            seg.export(out, format="mp3", bitrate="128k")
            return out.getvalue()
        except Exception as e:
            raise RuntimeError(f"Kokoro MP3 encode failed: {e}") from e


def xai_max_chars() -> int:
    raw = (os.environ.get("XAI_TTS_MAX_CHARS") or "3000").strip()
    try:
        return max(200, int(raw))
    except ValueError:
        return 3000


def chunk_text(text: str, max_chars: int | None = None) -> list[str]:
    """Split on sentence boundaries. A single long sentence is hard-cut."""
    limit = max_chars or xai_max_chars()
    raw = (text or "").strip()
    if not raw:
        return []
    if len(raw) <= limit:
        return [raw]
    parts: list[str] = []
    buf = ""
    for piece in re.split(r"(?<=[.!?])\s+|\n+", raw):
        piece = piece.strip()
        if not piece:
            continue
        if len(piece) > limit:
            if buf:
                parts.append(buf)
                buf = ""
            for i in range(0, len(piece), limit):
                parts.append(piece[i:i + limit])
            continue
        if buf and len(buf) + 1 + len(piece) > limit:
            parts.append(buf)
            buf = piece
        else:
            buf = f"{buf} {piece}".strip()
    if buf:
        parts.append(buf)
    return parts


def apply_pronunciation(text: str, mapping: dict | None) -> str:
    """Replace phrases before synthesis. Longer keys win."""
    if not text or not mapping:
        return text or ""
    out = text
    for key in sorted(mapping, key=lambda k: len(str(k)), reverse=True):
        val = mapping.get(key)
        if key and val is not None:
            out = out.replace(str(key), str(val))
    return out


def xai_request_body(
    text: str,
    voice: str,
    speed: float,
    replacements: dict | None = None,
) -> dict:
    """REST body. xAI's unary API takes voice_id, not the websocket `voice` param."""
    spoken = apply_pronunciation(text, replacements)
    speed_f = max(0.7, min(1.5, float(speed)))
    return {
        "text": spoken,
        "voice_id": (voice or "eve").lower(),
        "language": "en",
        "text_normalization": True,
        "speed": speed_f,
        "output_format": {
            "codec": "mp3",
            "sample_rate": 44100,
            "bit_rate": 128000,
        },
    }


def cached_xai_voices(
    fetch,
    read_store,
    write_store,
    *,
    now: float,
    state: dict,
    ttl: float = 86400,
) -> list[str]:
    """24h memory cache, then the settings row, then a live GET."""
    cached = state.get("voices")
    at = float(state.get("at") or 0)
    if cached and (now - at) < ttl:
        return list(cached)
    stored = read_store() or {}
    stored_at = float(stored.get("at") or 0)
    if stored.get("voices") and (now - stored_at) < ttl:
        state["voices"] = list(stored["voices"])
        state["at"] = stored_at
        return list(state["voices"])
    voices = list(fetch() or [])
    state["voices"] = voices
    state["at"] = now
    write_store({"voices": voices, "at": now})
    return voices


def _redact(text: str) -> str:
    key = os.environ.get("XAI_API_KEY") or ""
    if key and key in (text or ""):
        return text.replace(key, "[redacted]")
    return text or ""


class XaiTTS(TTSProvider):
    """POST https://api.x.ai/v1/tts. Raw audio bytes, or JSON with base64 audio."""

    endpoint = "https://api.x.ai/v1/tts"
    voices_endpoint = "https://api.x.ai/v1/tts/voices"

    def __init__(self):
        self.chars_used = 0
        self._opener = urllib.request.urlopen
        self._sleep = None
        self._concat = None

    def voices(self) -> list[str]:
        return list(XAI_VOICES)

    def ensure_ready(self) -> None:
        if not os.environ.get("XAI_API_KEY"):
            raise RuntimeError("XAI_API_KEY not set")

    def fetch_voices(self) -> list[str]:
        """GET /v1/tts/voices. The key is sent as a header and never logged."""
        self.ensure_ready()
        req = urllib.request.Request(
            self.voices_endpoint,
            headers={"Authorization": f"Bearer {os.environ['XAI_API_KEY']}"},
            method="GET",
        )
        with self._opener(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        out = []
        for row in payload.get("voices") or []:
            vid = (row.get("voice_id") or row.get("id") or "").lower()
            if vid:
                out.append(vid)
        return out

    def synthesize(
        self,
        text: str,
        voice: str,
        speed: float,
        replacements: dict | None = None,
    ) -> bytes:
        self.ensure_ready()
        voice_l = (voice or "eve").lower()
        allowed = {v.lower() for v in self.voices()}
        if voice_l not in allowed:
            raise ValueError(f"voice {voice_l!r} is not an xAI voice")
        parts = chunk_text(text, xai_max_chars())
        if not parts:
            raise ValueError("empty text")
        spoken = [apply_pronunciation(part, replacements) for part in parts]
        audio = [
            self._post_chunk(part, voice_l, speed, None)
            for part in spoken
        ]
        self.chars_used += sum(len(p) for p in spoken)
        if len(audio) == 1:
            return audio[0]
        concat = self._concat or _concat_mp3
        return concat(audio)

    def _post_chunk(self, text: str, voice: str, speed: float, replacements) -> bytes:
        body = xai_request_body(text, voice, speed, replacements)
        data = json.dumps(body).encode("utf-8")
        delay = 0.4
        last_error = "xAI TTS failed"
        for attempt in range(4):
            req = urllib.request.Request(
                self.endpoint,
                data=data,
                headers={
                    "Authorization": f"Bearer {os.environ['XAI_API_KEY']}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            try:
                with self._opener(req, timeout=120) as resp:
                    raw = resp.read()
                    ctype = (resp.headers.get("Content-Type") or "").lower()
                return _decode_tts_audio(raw, ctype)
            except urllib.error.HTTPError as e:
                detail = _redact(e.read().decode("utf-8", "replace")[:240])
                last_error = f"xAI TTS HTTP {e.code}: {detail}"
                if e.code not in (429, 500, 502, 503, 504) or attempt == 3:
                    raise RuntimeError(last_error) from e
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                last_error = f"xAI TTS network error: {_redact(str(e)[:200])}"
                if attempt == 3:
                    raise RuntimeError(last_error) from e
            sleeper = self._sleep or (lambda _s: None)
            sleeper(delay)
            delay *= 2
        raise RuntimeError(last_error)


def _decode_tts_audio(raw: bytes, ctype: str) -> bytes:
    if "json" in ctype or (raw[:1] in (b"{", b"[")):
        payload = json.loads(raw.decode("utf-8"))
        import base64
        audio_b64 = payload.get("audio") or ""
        if not audio_b64:
            raise RuntimeError("xAI TTS response had no audio")
        return base64.b64decode(audio_b64)
    if not raw:
        raise RuntimeError("xAI TTS returned an empty body")
    return raw


def _concat_mp3(parts: list[bytes]) -> bytes:
    import io
    from pydub import AudioSegment
    segs = [AudioSegment.from_file(io.BytesIO(p), format="mp3") for p in parts]
    full = segs[0]
    for seg in segs[1:]:
        full += seg
    out = io.BytesIO()
    full.export(out, format="mp3", bitrate="128k")
    return out.getvalue()


def provider_name() -> str:
    return (os.environ.get("PODCAST_TTS_PROVIDER") or "openai").strip().lower()


def get_provider(model: str | None = None, name: str | None = None) -> TTSProvider:
    picked = (name or provider_name()).strip().lower()
    if picked in ("", "openai", "openaitts"):
        return OpenAITTS(model=model or OPENAI_MODEL_DEFAULT)
    if picked in ("kokoro", "kokorolocal", "kokoro-local"):
        return KokoroLocalTTS()
    if picked in ("xai", "grok", "xaitts"):
        return XaiTTS()
    raise ValueError(
        f"Unknown PODCAST_TTS_PROVIDER {picked!r}. Use openai, kokoro, or xai."
    )
