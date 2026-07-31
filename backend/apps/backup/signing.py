"""Short-lived, HMAC-signed `/media` URLs.

`<img src="/media/...">` tags can't send the JWT `Authorization` header, so media
used to be gated solely on the Django `sessionid` cookie. When a browser keeps
the JWT but loses that cookie (common on iOS: ITP, PWA-partitioned cookie jars,
Lockdown Mode, clock skew vs a `Secure` cookie), every image silently 401s.

Instead we embed a signed token in the media URL itself, so the credential travels
in the request the `<img>` already makes — no cookie required. The signature
authorizes a *path* for a time window; only an authenticated API caller ever
receives a signed URL (they're minted in the serializers/properties that return
avatar/attachment URLs), so possessing a valid one stands in for "an
authenticated user requested this". `serve_media` keeps the session-cookie check
as a fallback, so nothing regresses.
"""

import base64
import hashlib
import hmac
import posixpath
import time
from typing import overload
from urllib.parse import unquote

from django.conf import settings

# Validity window. `exp` is rounded to a whole hour so the URL is stable within
# the hour (the browser/cache can reuse it instead of re-fetching every render);
# it changes at most once per hour and stays valid for ~TTL_HOURS.
TTL_HOURS = 2


def _signing_key() -> bytes:
    key = getattr(settings, "MEDIA_URL_SIGNING_KEY", "") or settings.SECRET_KEY
    return key.encode()


def _media_relative_path(url: str) -> str:
    """Normalize a media URL to the path `serve_media` verifies against.

    `serve_media` signs/checks the path captured after ``media/`` and normalized
    with ``posixpath.normpath``. Mirror that here so a URL minted from
    ``FileField.url`` (e.g. ``media/profile_pictures/47.jpg``) signs the same
    string the request will be checked against.

    The percent-decoding matters: ``FileField.url`` quotes the name, so a Danish
    filename arrives here as ``post_attachments/%C3%85rsm%C3%B8de.heic`` while
    the request Django routes to ``serve_media`` carries the decoded
    ``post_attachments/Årsmøde.heic``. Signing the encoded form produced a
    signature that could never verify, so every æ/ø/å file fell back to the
    session cookie — exactly what signed URLs exist to avoid.
    """
    path = unquote(url.split("?", 1)[0]).lstrip("/")
    media_prefix = settings.MEDIA_URL.lstrip("/")
    if media_prefix and path.startswith(media_prefix):
        path = path[len(media_prefix) :]
    return posixpath.normpath(path)


def _sign(path: str, exp: int) -> str:
    msg = f"{path}:{exp}".encode()
    digest = hmac.new(_signing_key(), msg, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def _current_expiry() -> int:
    """Unix timestamp TTL_HOURS hours after the start of the current hour.

    Same for every call within a wall-clock hour → cache-stable URLs.
    """
    now = int(time.time())
    return ((now // 3600) + TTL_HOURS) * 3600


@overload
def signed_media_url(url: str) -> str: ...
@overload
def signed_media_url(url: None) -> None: ...


def signed_media_url(url: str | None) -> str | None:
    """Append a short-lived ``?exp=&sig=`` token to a ``/media/...`` URL.

    Returns the input unchanged for falsy values (no avatar/attachment).
    """
    if not url:
        return url
    rel = _media_relative_path(url)
    exp = _current_expiry()
    sig = _sign(rel, exp)
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}exp={exp}&sig={sig}"


def verify_media_signature(path: str, exp: str | None, sig: str | None) -> bool:
    """True if ``sig`` is a valid, unexpired signature for ``path``.

    ``path`` must be the normalized media-relative path (what ``serve_media``
    computes); ``exp``/``sig`` come straight from the request query string.
    """
    if not exp or not sig:
        return False
    try:
        exp_int = int(exp)
    except (TypeError, ValueError):
        return False
    if exp_int < int(time.time()):
        return False
    expected = _sign(posixpath.normpath(path), exp_int)
    # Compare as bytes: compare_digest() rejects str arguments containing
    # non-ASCII characters with a TypeError, and `sig` is attacker-controlled
    # query-string input, so a str comparison turns "?sig=øabc" into a 500.
    return hmac.compare_digest(expected.encode(), sig.encode())
