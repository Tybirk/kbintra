"""
Utility functions for the forum app.
"""

import logging

logger = logging.getLogger(__name__)


def generate_docx_preview(file_field) -> str:
    """
    Generate HTML preview for a DOCX file.

    Args:
        file_field: Django FileField containing the uploaded file

    Returns:
        HTML string preview of the document, or empty string if not a DOCX
        or conversion fails.
    """
    if not file_field or not file_field.name:
        return ""

    # Only process .docx files
    filename = file_field.name.lower()
    if not filename.endswith(".docx"):
        return ""

    try:
        import mammoth

        # Read the file and convert to HTML
        file_field.seek(0)
        result = mammoth.convert_to_html(file_field)
        return result.value
    except Exception as e:
        logger.warning(f"Failed to generate DOCX preview for {file_field.name}: {e}")
        return ""
