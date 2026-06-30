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

# Full-size web preview: large enough for the carousel/zoom viewer, where the
# 400px thumbnail would look washed out. Used to make HEIC/HEIF viewable.
WEB_PREVIEW_MAX_EDGE = 2000
WEB_PREVIEW_QUALITY = 85

_IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".heic",
    ".heif",
}

# Formats that browsers (Chrome/Firefox/Android) can't render in an <img> tag,
# so they need a converted JPEG to be viewable.
_HEIC_EXTENSIONS = {".heic", ".heif"}


def is_image_attachment(name: str) -> bool:
    """Return True if `name`'s extension is in our image set."""
    _, ext = os.path.splitext(name.lower())
    return ext in _IMAGE_EXTENSIONS


def is_heic(name: str) -> bool:
    """Return True if `name` is an Apple HEIC/HEIF image (not browser-renderable)."""
    _, ext = os.path.splitext(name.lower())
    return ext in _HEIC_EXTENSIONS


def _flatten_to_rgb(img: Image.Image) -> Image.Image:
    """Apply EXIF orientation and composite any alpha onto white, returning RGB."""
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
        return background
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def generate_web_preview(source: BinaryIO) -> ContentFile | None:
    """Open `source`, return a full-resolution web-viewable JPEG (longest edge
    clamped to WEB_PREVIEW_MAX_EDGE, no crop, never upscaled).

    Used to make HEIC/HEIF uploads viewable in browsers that can't decode them
    natively, at a size suitable for the full-screen carousel/zoom viewer.
    Source is opened lazily; the caller closes the underlying file.
    """
    try:
        img = Image.open(source)
        img.load()
    except Exception as exc:  # noqa: BLE001 — Pillow raises many exception types
        logger.warning("Pillow could not open attachment for web preview: %s", exc)
        return None

    img = _flatten_to_rgb(img)
    # Downscale only (thumbnail never upscales) so the longest edge is bounded.
    img.thumbnail((WEB_PREVIEW_MAX_EDGE, WEB_PREVIEW_MAX_EDGE), Image.LANCZOS)

    buf = BytesIO()
    img.save(
        buf,
        format="JPEG",
        quality=WEB_PREVIEW_QUALITY,
        optimize=True,
        progressive=True,
    )
    buf.seek(0)
    return ContentFile(buf.getvalue())


def generate_attachment_preview(attachment: object) -> bool:
    """Generate and save a web-viewable JPEG `preview` for a HEIC/HEIF attachment.

    Works on any attachment model with `file`, `name`, and `preview` fields
    (forum / messaging / announcements). Returns True if a preview was created;
    no-ops (False) for non-HEIC files or if a preview already exists.
    """
    if not is_heic(attachment.name):
        return False
    if getattr(attachment, "preview", None):
        return False
    try:
        with attachment.file.open("rb") as src:
            preview = generate_web_preview(src)
    except FileNotFoundError:
        logger.warning("Skipping preview for attachment %s: source file missing", attachment.pk)
        return False
    if preview is None:
        return False
    attachment.preview.save(f"{attachment.pk}.jpg", preview, save=True)
    return True


def generate_thumbnail(source: BinaryIO) -> ContentFile | None:
    """Open `source`, return a JPEG ContentFile of a centered square crop.

    Why center-crop to square? Gallery tiles and the inline post strip render
    the thumbnail with object-fit: cover into square-ish slots. If the source
    is panoramic (e.g. 4000×500), constraining only by longest edge yields a
    400×50 thumb that has to be upscaled ~4× on display, looking washed out.
    Cropping to a square at source resolution first gives 400×400 of real
    pixels — crisp at any rendered size up to 400px.

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

    # Clamp target side to the source's shortest edge to avoid upscaling small
    # images. ImageOps.fit crops to the target aspect ratio (square here),
    # then resizes — combining the two without an upsample step in between.
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
