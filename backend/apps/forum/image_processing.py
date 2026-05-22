"""Server-side thumbnail generation for PostAttachment images.

A single small JPEG variant (400 px longest edge) is generated for every
uploaded image attachment. The gallery grid and per-post inline thumbnail
strip use this variant; the carousel and zoom viewer still serve the
original.

HEIC/HEIF (iPhone) support is provided by pillow-heif, registered at module
import so a plain `Image.open` works on `.heic` files.
"""

from __future__ import annotations

import logging
import os
from io import BytesIO
from typing import BinaryIO

from django.core.files.base import ContentFile
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

logger = logging.getLogger(__name__)

# Register the HEIF/HEIC opener with Pillow exactly once.
register_heif_opener()

THUMBNAIL_MAX_EDGE = 400
THUMBNAIL_QUALITY = 85

_IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".heic",
    ".heif",
}


def is_image_attachment(name: str) -> bool:
    """Return True if `name`'s extension is in our image set."""
    _, ext = os.path.splitext(name.lower())
    return ext in _IMAGE_EXTENSIONS


def generate_thumbnail(source: BinaryIO, *, preserve_aspect: bool = False) -> ContentFile | None:
    """Open `source`, return a JPEG ContentFile sized for thumbnail use.

    Two modes:

    - Default (`preserve_aspect=False`): center-crop to a 400×400 square via
      `ImageOps.fit`. Used for avatars (User, House, Child) where faces
      should sit tight in a round/square slot — the surrounding pixels add
      no value.

    - `preserve_aspect=True`: scale-to-fit so the longest edge ≤ 400 while
      keeping aspect ratio (via `Image.thumbnail`, which is in-place and
      won't upscale). Used for post attachments shown in the gallery and
      inline strip. The frontend `BlurredThumbnail` component places the
      contained image over a blurred copy of itself, so panoramic or tall
      photos show their full content with a soft backdrop instead of being
      brutally center-cropped.

    Applies EXIF orientation so photos taken sideways aren't rotated in the
    gallery, drops transparency onto a white background, and resamples with
    LANCZOS. Source is opened lazily; the caller is responsible for closing
    the underlying file.
    """
    try:
        img = Image.open(source)
        # Force the image to load now so we can detect corrupt files early.
        img.load()
    except Exception as exc:  # noqa: BLE001 — Pillow raises many exception types
        logger.warning("Pillow could not open attachment for thumbnailing: %s", exc)
        return None

    img = ImageOps.exif_transpose(img)

    # JPEG can't carry alpha — composite onto white so PNGs with transparency
    # don't end up with a black background.
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    if preserve_aspect:
        # In-place: shrinks until the longest edge ≤ THUMBNAIL_MAX_EDGE,
        # preserves aspect ratio, and never upscales.
        img.thumbnail((THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE), Image.LANCZOS)
    else:
        # Clamp target side to the source's shortest edge to avoid upscaling
        # small images. ImageOps.fit crops to the target aspect ratio (square
        # here), then resizes — combining both steps without upsampling between.
        target = min(min(img.size), THUMBNAIL_MAX_EDGE)
        img = ImageOps.fit(img, (target, target), Image.LANCZOS)

    buf = BytesIO()
    img.save(
        buf,
        format="JPEG",
        quality=THUMBNAIL_QUALITY,
        optimize=True,
        progressive=True,
    )
    buf.seek(0)
    return ContentFile(buf.getvalue())
