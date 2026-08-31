"""Merge an expense's attachments into a single PDF.

The community's accounting program accepts only one attachment per udlæg, so
the treasurer needs every receipt and approval for one expense in one file.
``build_combined_pdf`` does that merge: PDFs are appended page by page, images
(incl. iPhone HEIC) become one A4 page each, and anything that cannot be
rendered becomes a short notice page naming the file — so a bilag never
disappears silently from the merged document.
"""

from __future__ import annotations

import logging
import textwrap
from collections.abc import Sequence
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont, ImageOps
from pillow_heif import register_heif_opener
from pypdf import PdfReader, PdfWriter

logger = logging.getLogger(__name__)

# Register the HEIF/HEIC opener with Pillow exactly once (iPhone photos).
register_heif_opener()

# A4 at 150 dpi — readable for a crumpled kassebon, small enough to email.
PAGE_SIZE = (1240, 1754)
_MARGIN = 60
_RESOLUTION = 150.0


def combined_pdf_name(expense_id: int | None) -> str:
    """Filename for the merged bilag of one expense (mail + download share it)."""
    return f"udlaeg-{expense_id}-bilag.pdf"


def build_combined_pdf(parts: Sequence[tuple[str, bytes | None]]) -> bytes:
    """Merge ``(filename, content)`` attachments into one PDF's bytes.

    A ``None`` content means the file could not be read from storage; it still
    gets a notice page so the treasurer sees that a bilag is missing.
    """
    writer = PdfWriter()
    for name, content in parts:
        try:
            for page_bytes in _pdf_parts_for(name, content):
                writer.append(BytesIO(page_bytes))
        except Exception:
            # One odd bilag must not cost the whole merge — the original file is
            # still attached to the mail and downloadable in the app.
            logger.warning("Leaving bilag '%s' out of the merged PDF", name, exc_info=True)
    out = BytesIO()
    writer.write(out)
    writer.close()
    return out.getvalue()


def _pdf_parts_for(name: str, content: bytes | None) -> list[bytes]:
    """Turn one attachment into PDF bytes, falling back to a notice page."""
    if not content:
        return [_notice_page(f"Bilaget '{name}' kunne ikke hentes. Se det i KB Intra.")]

    pdf = _as_pdf(content) if content[:5] == b"%PDF-" else _image_page(content)
    if pdf is not None:
        return [pdf]

    logger.warning("Could not convert expense attachment '%s' to PDF", name)
    return [
        _notice_page(
            f"Bilaget '{name}' kan ikke vises som PDF. Hent den oprindelige fil i KB Intra."
        )
    ]


def _as_pdf(content: bytes) -> bytes | None:
    """Validate PDF bytes (and unlock empty-password encryption) before merging.

    Broken or password-protected files are rejected here rather than blowing up
    halfway through ``PdfWriter.append``, which would leave partial pages behind.
    """
    try:
        reader = PdfReader(BytesIO(content))
        if reader.is_encrypted:
            # Scanners often "encrypt" with an empty owner password; that we can
            # open. A real password is not something we can work around.
            reader.decrypt("")
        if not reader.pages:
            return None
    except Exception:
        logger.warning("Unreadable PDF attachment on expense", exc_info=True)
        return None

    writer = PdfWriter()
    writer.append(reader)
    out = BytesIO()
    writer.write(out)
    writer.close()
    return out.getvalue()


def _image_page(content: bytes) -> bytes | None:
    """Render image bytes as one A4 page, centred and scaled to fit."""
    try:
        with Image.open(BytesIO(content)) as opened:
            # Phone photos carry their rotation in EXIF only.
            image = ImageOps.exif_transpose(opened) or opened
            image = image.convert("RGB")
            image.thumbnail(
                (PAGE_SIZE[0] - 2 * _MARGIN, PAGE_SIZE[1] - 2 * _MARGIN),
                Image.LANCZOS,
            )
            page = _blank_page()
            page.paste(
                image,
                ((PAGE_SIZE[0] - image.width) // 2, (PAGE_SIZE[1] - image.height) // 2),
            )
            return _page_to_pdf(page)
    except Exception:
        return None


def _notice_page(message: str) -> bytes:
    """A plain text page standing in for an attachment we could not render."""
    page = _blank_page()
    draw = ImageDraw.Draw(page)
    font = ImageFont.load_default(size=34)
    y = 2 * _MARGIN
    for line in textwrap.wrap(message, width=54):
        draw.text((2 * _MARGIN, y), line, fill="black", font=font)
        y += 52
    return _page_to_pdf(page)


def _blank_page() -> Image.Image:
    return Image.new("RGB", PAGE_SIZE, "white")


def _page_to_pdf(page: Image.Image) -> bytes:
    buf = BytesIO()
    page.save(buf, format="PDF", resolution=_RESOLUTION)
    return buf.getvalue()
