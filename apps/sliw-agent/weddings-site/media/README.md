# Wedding storefront media

Drop images / short clips here so the site feels visual, not text-heavy.
The gallery **only appears when assets are listed** in `manifest.json`.

## Front-and-center first-dance video

Drop the customer wedding video in this folder as **`wedding-first-dance.mp4`**
(or `wedding-dance.mp4` / `first-dance.mp4`). It appears on the storefront
immediately under the hero.

Or paste a YouTube / Vimeo URL in `media/site-media.json` → `weddingVideo.src`.

## Quick start

1. Add files to this folder (keep each video under ~15 MB for fast mobile).
2. Edit `manifest.json`:

```json
{
  "hero": {
    "type": "image",
    "src": "media/hero.jpg",
    "alt": "Couple learning their first dance with Edyta"
  },
  "clips": [
    {
      "type": "video",
      "src": "media/clip-first-dance.mp4",
      "poster": "media/clip-first-dance.jpg",
      "caption": "First dance · SF"
    },
    {
      "type": "image",
      "src": "media/studio.webp",
      "caption": "San Rafael studio"
    },
    {
      "type": "embed",
      "src": "https://www.youtube.com/embed/VIDEO_ID",
      "caption": "Rehearsal snippet"
    }
  ]
}
```

## Types

| type | fields |
|------|--------|
| `image` | `src`, `alt?`, `caption?` |
| `video` | `src` (mp4/webm), `poster?`, `caption?` |
| `embed` | `src` (YouTube/Vimeo embed URL), `caption?` |

## Hosted elsewhere

Prefer Instagram Reels / YouTube unlisted + `embed` so Railway doesn’t serve huge MP4s.

## Path notes

- On production host: `https://weddings.edytasliwinska.com/media/...`
- On DGA preview: `https://portfolio.dgacapital.com/weddings-site/media/...`

`src` can be relative (`media/…`) or absolute (`https://…`).
