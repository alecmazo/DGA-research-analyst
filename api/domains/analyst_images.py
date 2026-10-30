"""Normalize Analyst card images and build the first user turn.

Stdlib only. Imported inside the agentic start and worker so importing
api.server does not pull this in at boot.
"""
from __future__ import annotations

import base64
import binascii
import re

MAX_IMAGES = 4
MAX_DECODED = 1_500_000
MIN_DECODED = 32
ALLOWED = {
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "image/png": "image/png",
    "image/webp": "image/webp",
    "image/gif": "image/gif",
}

_DATA_URL = re.compile(
    r"^data:(image/[a-z0-9.+-]+);base64,(.*)$",
    re.IGNORECASE | re.DOTALL,
)

DEFAULT_IMAGE_QUESTION = (
    "Break down the attached image. Read every number and label, "
    "and say what it implies."
)


def normalize_analyst_images(raw) -> list[dict]:
    """Return [{mime, data}] or raise ValueError. data is raw base64, no prefix."""
    if raw is None:
        return []
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        raise ValueError("images must be a list")
    if len(raw) > MAX_IMAGES:
        raise ValueError(f"Attach at most {MAX_IMAGES} images.")
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("each image must be an object")
        mime = (
            item.get("mime") or item.get("media_type") or item.get("type") or ""
        )
        mime = str(mime).strip().lower()
        data = item.get("data") if item.get("data") is not None else (
            item.get("b64") if item.get("b64") is not None else item.get("base64")
        )
        if not isinstance(data, str):
            raise ValueError("image data must be base64 text")
        data = data.strip()
        match = _DATA_URL.match(data.replace("\n", "").replace("\r", ""))
        if match:
            url_mime = match.group(1).lower()
            data = match.group(2)
            if mime not in ALLOWED:
                mime = url_mime
        data = re.sub(r"\s+", "", data)
        mime = ALLOWED.get(mime) or ""
        if not mime:
            raise ValueError("Images must be JPEG, PNG, WebP, or GIF.")
        if not data:
            raise ValueError("An attached image was empty.")
        pad = (-len(data)) % 4
        if pad:
            data = data + ("=" * pad)
        try:
            raw_bytes = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("An attached image was not valid base64.") from exc
        n = len(raw_bytes)
        if n < MIN_DECODED:
            raise ValueError("An attached image was empty.")
        if n > MAX_DECODED:
            raise ValueError("An attached image is too large. Use a smaller picture.")
        out.append({"mime": mime, "data": data})
    return out


def image_system_note(count: int) -> str:
    n = max(1, int(count or 1))
    word = "image" if n == 1 else "images"
    return (
        f"\n\nThe user attached {n} {word}. Read every chart, table, caption, "
        "and label in the attachment. Quote only numbers you can actually read "
        "in the image or that a tool returns. If a figure is unreadable, say so. "
        "Do not invent prices, dates, or percentages from the picture."
    )


def analyst_image_content(question: str, images: list | None, provider: str):
    """Text when there is no picture. Claude image blocks, else OpenAI image_url."""
    imgs = list(images or [])
    text = (question or "").strip()
    if not imgs:
        return text
    if (provider or "").lower() == "claude":
        blocks: list[dict] = []
        for im in imgs:
            blocks.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": im["mime"],
                    "data": im["data"],
                },
            })
        blocks.append({"type": "text", "text": text})
        return blocks
    parts: list[dict] = [{"type": "text", "text": text}]
    for im in imgs:
        parts.append({
            "type": "image_url",
            "image_url": {"url": f"data:{im['mime']};base64,{im['data']}"},
        })
    return parts
