"""
Media file serving with S3 fallback.

Serves files from local disk. If a file is missing locally, attempts to restore
it from S3 before returning a 404.
"""

import posixpath
from pathlib import Path

from django.conf import settings
from django.http import Http404, HttpRequest, HttpResponse
from django.views.static import serve


def _is_safe_path(path: str) -> bool:
    """Reject path traversal attempts (e.g. '../../etc/passwd')."""
    cleaned = posixpath.normpath(path)
    return not cleaned.startswith("/") and not cleaned.startswith("..")


def serve_media(request: HttpRequest, path: str) -> HttpResponse:
    if not _is_safe_path(path):
        raise Http404

    local_path = Path(settings.MEDIA_ROOT) / path
    if not local_path.is_file():
        from apps.backup.s3 import download_file, is_enabled

        if is_enabled():
            restored = download_file(path)
            if not restored:
                raise Http404
        else:
            raise Http404

    return serve(request, path, document_root=settings.MEDIA_ROOT)
