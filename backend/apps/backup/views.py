"""
Media file serving with S3 fallback.

Serves files from local disk. If a file is missing locally, attempts to restore
it from S3 before returning a 404.
"""

import posixpath
from pathlib import Path

from django.conf import settings
from django.http import Http404, HttpRequest, HttpResponse
from django.utils.cache import patch_cache_control
from django.views.static import serve


def _is_safe_path(path: str) -> bool:
    """Reject path traversal attempts (e.g. '../../etc/passwd')."""
    cleaned = posixpath.normpath(path)
    return not cleaned.startswith("/") and not cleaned.startswith("..")


# Vulnerability scanners constantly probe these paths. Short-circuit them so
# we don't hit S3, log an error, and create Sentry noise per request.
_SCANNER_PATH_PREFIXES = (
    "wp-",
    "wordpress/",
    ".env",
    ".git/",
    ".aws/",
    ".ssh/",
    "xmlrpc.php",
    "phpmyadmin",
    "phpunit",
    "vendor/phpunit",
    "config.php",
)


def _is_scanner_path(path: str) -> bool:
    lowered = path.lower()
    return any(
        lowered.startswith(prefix) or f"/{prefix}" in lowered for prefix in _SCANNER_PATH_PREFIXES
    )


# Private media that must never be served from the shared /media path. These
# files (e.g. expense receipts with bank details) live under MEDIA_ROOT so the
# S3 backup still covers them, but are only reachable through a dedicated,
# permission-checked download view (apps.expenses.views).
_PRIVATE_PATH_PREFIXES = ("expense_receipts/",)


def _is_private_path(path: str) -> bool:
    return path.startswith(_PRIVATE_PATH_PREFIXES)


def serve_media(request: HttpRequest, path: str) -> HttpResponse:
    if not _is_safe_path(path):
        raise Http404

    # Run the prefix checks (and the actual serve) against the NORMALIZED path.
    # A raw path like "avatars/../expense_receipts/x.pdf" sails past the private/
    # scanner prefix checks if they only see the raw string, yet
    # django.views.static.serve normalizes it back into expense_receipts/ and
    # serves the file — leaking private documents. Normalize once, check once.
    cleaned = posixpath.normpath(path)

    if _is_scanner_path(cleaned):
        raise Http404

    if _is_private_path(cleaned):
        # Private financial files are only served via the permission-checked
        # expense download view, never through the shared /media path.
        response = HttpResponse(status=403)
        response["Cache-Control"] = "private, no-store"
        return response

    # Authorize the request in one of two ways:
    #  1. A short-lived signed token in the URL (cookie-independent). An <img>
    #     tag can carry this in the query string but not the JWT header, so this
    #     is what keeps images working when the session cookie is dropped
    #     (common on iOS). Signed URLs are only ever handed to authenticated API
    #     callers, so a valid signature stands in for an authenticated request.
    #  2. The Django session cookie from the JWT login flow (legacy fallback,
    #     kept so existing clients and any cached HTML keep working).
    from apps.backup.signing import verify_media_signature

    has_valid_signature = verify_media_signature(
        cleaned, request.GET.get("exp"), request.GET.get("sig")
    )
    if not has_valid_signature and not request.user.is_authenticated:
        # `no-store` so Cloudflare (or any shared cache) doesn't memoize the
        # 401 for a URL — otherwise a later authenticated user would still see
        # 401 from cache.
        response = HttpResponse(status=401)
        response["Cache-Control"] = "private, no-store"
        return response

    local_path = Path(settings.MEDIA_ROOT) / cleaned
    if not local_path.is_file():
        from apps.backup.s3 import download_file, is_enabled

        if is_enabled():
            restored = download_file(cleaned)
            if not restored:
                raise Http404
        else:
            raise Http404

    response = serve(request, cleaned, document_root=settings.MEDIA_ROOT)
    # `private` keeps Cloudflare/any shared cache from storing the file (it's
    # per-user, not per-URL). The browser may still cache it for max_age seconds
    # — that's a per-user cache so no leak between users.
    patch_cache_control(response, private=True, max_age=3600)
    return response
