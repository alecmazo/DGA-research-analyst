"""One TTS entry point for episode turns, the disclaimer, samples, and auditions.

`PODCAST_TTS_PROVIDER` selects openai (default), kokoro, or xai.
`tts_model` still chooses the OpenAI model. gpt-4o-mini-tts is the default;
tts-1-hd stays available.
"""
from __future__ import annotations

import json
import os
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


class XaiTTS(TTSProvider):
    """POST https://api.x.ai/v1/tts. Raw audio bytes, or JSON with base64 audio."""

    endpoint = "https://api.x.ai/v1/tts"

    def voices(self) -> list[str]:
        return list(XAI_VOICES)

    def ensure_ready(self) -> None:
        if not os.environ.get("XAI_API_KEY"):
            raise RuntimeError("XAI_API_KEY not set")

    def synthesize(self, text: str, voice: str, speed: float) -> bytes:
        self.ensure_ready()
        voice_l = (voice or "eve").lower()
        if voice_l not in self.voices():
            raise ValueError(f"voice {voice_l!r} is not an xAI voice")
        speed_f = max(0.7, min(1.5, float(speed)))
        body = {
            "text": text,
            "voice_id": voice_l,
            "language": "en",
            "speed": speed_f,
            "output_format": {
                "codec": "mp3",
                "sample_rate": 44100,
                "bit_rate": 128000,
            },
        }
        req = urllib.request.Request(
            self.endpoint,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {os.environ['XAI_API_KEY']}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read()
                ctype = (resp.headers.get("Content-Type") or "").lower()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            raise RuntimeError(f"xAI TTS HTTP {e.code}: {detail}") from e
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


def provider_name() -> str:
    return (os.environ.get("PODCAST_TTS_PROVIDER") or "openai").strip().lower()


def get_provider(model: str | None = None) -> TTSProvider:
    name = provider_name()
    if name in ("", "openai", "openaitts"):
        return OpenAITTS(model=model or OPENAI_MODEL_DEFAULT)
    if name in ("kokoro", "kokorolocal", "kokoro-local"):
        return KokoroLocalTTS()
    if name in ("xai", "grok", "xaitts"):
        return XaiTTS()
    raise ValueError(
        f"Unknown PODCAST_TTS_PROVIDER {name!r}. Use openai, kokoro, or xai."
    )
