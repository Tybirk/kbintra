"""Request-level observability middleware.

Adds two things that were missing in production diagnostics:

1. A `Server-Timing: app;dur=<ms>` response header so request latency is visible
   in browser DevTools (Network tab → Timing) without needing access logs.
2. A `slow_request` log line for requests that exceed `SLOW_REQUEST_THRESHOLD_MS`,
   so the next time someone reports "the app feels sluggish" we can grep logs
   for actual server-side slowness instead of guessing whether it was the
   network, the client, or the backend.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from django.http import HttpRequest, HttpResponse

logger = logging.getLogger(__name__)

SLOW_REQUEST_THRESHOLD_MS = 500


class RequestTimingMiddleware:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        start = time.monotonic()
        response = self.get_response(request)
        duration_ms = (time.monotonic() - start) * 1000.0

        response["Server-Timing"] = f"app;dur={duration_ms:.0f}"

        if duration_ms >= SLOW_REQUEST_THRESHOLD_MS and not request.path.startswith("/api/health"):
            logger.warning(
                "slow_request method=%s path=%s status=%d duration_ms=%.0f",
                request.method,
                request.get_full_path(),
                response.status_code,
                duration_ms,
            )

        return response
