"""
Utility functions for the forum app.
"""

import logging

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from rest_framework import serializers

logger = logging.getLogger(__name__)


def validate_file_size(file: UploadedFile) -> None:
    """
    Validate that an uploaded file doesn't exceed the maximum allowed size.

    Args:
        file: The uploaded file to validate

    Raises:
        serializers.ValidationError: If the file exceeds MAX_UPLOAD_FILE_SIZE
    """
    max_size = getattr(settings, "MAX_UPLOAD_FILE_SIZE", 50 * 1024 * 1024)
    if file.size > max_size:
        max_size_mb = max_size / (1024 * 1024)
        file_size_mb = file.size / (1024 * 1024)
        raise serializers.ValidationError(
            f"File '{file.name}' is too large ({file_size_mb:.1f}MB). "
            f"Maximum allowed size is {max_size_mb:.0f}MB."
        )


def generate_pdf_preview(file_field) -> str:
    """
    Generate HTML preview for a PDF file using PyMuPDF.

    Args:
        file_field: Django FileField containing the uploaded file

    Returns:
        HTML string preview of the document, or empty string if not a PDF,
        file is too large, or conversion fails.
    """
    if not file_field or not file_field.name:
        return ""

    filename = file_field.name.lower()
    if not filename.endswith(".pdf"):
        return ""

    max_preview_size = getattr(settings, "MAX_PDF_PREVIEW_SIZE", 20 * 1024 * 1024)
    try:
        file_size = file_field.size
        if file_size > max_preview_size:
            logger.info(
                f"Skipping PDF preview for {file_field.name}: "
                f"file size ({file_size / (1024 * 1024):.1f}MB) exceeds limit "
                f"({max_preview_size / (1024 * 1024):.0f}MB)"
            )
            return ""
    except (AttributeError, OSError):
        pass

    try:
        import fitz  # pymupdf

        file_field.seek(0)
        pdf_bytes = file_field.read()
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")

        max_pages = getattr(settings, "MAX_PDF_PREVIEW_PAGES", 20)
        total_pages = len(doc)
        pages_html = []
        for page_num in range(min(total_pages, max_pages)):
            page = doc[page_num]
            pages_html.append(page.get_text("html"))

        doc.close()
        truncated = total_pages > max_pages
        html = "".join(pages_html)
        if truncated:
            html += (
                f'<p style="color: gray; font-style: italic;">'
                f"Kun de første {max_pages} sider vises. Download filen for at se hele dokumentet."
                f"</p>"
            )
        return html
    except Exception as e:
        logger.warning(f"Failed to generate PDF preview for {file_field.name}: {e}")
        return ""


def generate_docx_preview(file_field) -> str:
    """
    Generate HTML preview for a DOCX file.

    Args:
        file_field: Django FileField containing the uploaded file

    Returns:
        HTML string preview of the document, or empty string if not a DOCX,
        file is too large, or conversion fails.
    """
    if not file_field or not file_field.name:
        return ""

    # Only process .docx files
    filename = file_field.name.lower()
    if not filename.endswith(".docx"):
        return ""

    # Skip preview for files larger than MAX_DOCX_PREVIEW_SIZE
    max_preview_size = getattr(settings, "MAX_DOCX_PREVIEW_SIZE", 50 * 1024 * 1024)
    try:
        file_size = file_field.size
        if file_size > max_preview_size:
            logger.info(
                f"Skipping DOCX preview for {file_field.name}: "
                f"file size ({file_size / (1024 * 1024):.1f}MB) exceeds limit "
                f"({max_preview_size / (1024 * 1024):.0f}MB)"
            )
            return ""
    except (AttributeError, OSError):
        # If we can't determine file size, proceed with preview generation
        pass

    try:
        import mammoth

        # Read the file and convert to HTML
        file_field.seek(0)
        result = mammoth.convert_to_html(file_field)
        return result.value
    except Exception as e:
        logger.warning(f"Failed to generate DOCX preview for {file_field.name}: {e}")
        return ""
