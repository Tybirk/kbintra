"""Tests for the request-timing middleware."""

import logging
import time
from unittest.mock import patch

import pytest
from django.http import HttpResponse
from django.test import RequestFactory

from config.middleware import SLOW_REQUEST_THRESHOLD_MS, RequestTimingMiddleware


@pytest.fixture
def rf():
    return RequestFactory()


def test_adds_server_timing_header(rf):
    middleware = RequestTimingMiddleware(lambda r: HttpResponse("ok"))
    response = middleware(rf.get("/api/anything/"))
    assert "Server-Timing" in response
    assert response["Server-Timing"].startswith("app;dur=")


def test_does_not_log_fast_requests(rf, caplog):
    middleware = RequestTimingMiddleware(lambda r: HttpResponse("ok"))
    with caplog.at_level(logging.WARNING, logger="config.middleware"):
        middleware(rf.get("/api/foo/"))
    assert not any("slow_request" in r.message for r in caplog.records)


def test_logs_slow_requests(rf, caplog):
    def slow_view(_request):
        time.sleep((SLOW_REQUEST_THRESHOLD_MS + 50) / 1000.0)
        return HttpResponse("ok")

    middleware = RequestTimingMiddleware(slow_view)
    with caplog.at_level(logging.WARNING, logger="config.middleware"):
        middleware(rf.get("/api/forum/threads/"))

    slow_records = [r for r in caplog.records if "slow_request" in r.message]
    assert len(slow_records) == 1
    assert "/api/forum/threads/" in slow_records[0].message
    assert "method=GET" in slow_records[0].message


def test_skips_healthcheck_log(rf, caplog):
    """Healthcheck requests are noisy and not user-facing — don't log them slow."""

    def slow_view(_request):
        return HttpResponse("ok")

    # Patch monotonic to simulate a slow healthcheck without sleeping
    middleware = RequestTimingMiddleware(slow_view)
    with (
        patch("config.middleware.time.monotonic", side_effect=[0.0, 1.0]),
        caplog.at_level(logging.WARNING, logger="config.middleware"),
    ):
        response = middleware(rf.get("/api/health/"))

    assert "Server-Timing" in response
    assert not any("slow_request" in r.message for r in caplog.records)
