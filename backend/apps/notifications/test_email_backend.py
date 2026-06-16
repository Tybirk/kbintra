"""Tests for the Cloudflare Email Service backend."""

from unittest.mock import MagicMock, patch

import pytest
import requests
from django.core.mail import EmailMessage, EmailMultiAlternatives

from apps.notifications.email_backend import (
    CloudflareEmailBackend,
    CloudflareEmailError,
    _format_address,
)

SETTINGS = {
    "EMAIL_BACKEND": "apps.notifications.email_backend.CloudflareEmailBackend",
    "CLOUDFLARE_ACCOUNT_ID": "acct123",
    "CLOUDFLARE_EMAIL_API_TOKEN": "token123",
}


def _response(status_code: int, json_data: dict | None) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    if json_data is None:
        resp.json.side_effect = ValueError("no json")
    else:
        resp.json.return_value = json_data
    resp.text = "raw body"
    return resp


SUCCESS = {
    "success": True,
    "errors": [],
    "result": {"delivered": ["a@b.dk"], "permanent_bounces": [], "queued": []},
}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("KB Intra <noreply@kb.dk>", {"address": "noreply@kb.dk", "name": "KB Intra"}),
        ("noreply@kb.dk", "noreply@kb.dk"),
    ],
)
def test_format_address(raw, expected):
    assert _format_address(raw) == expected


@pytest.mark.django_db
def test_send_success_builds_expected_payload(settings):
    for k, v in SETTINGS.items():
        setattr(settings, k, v)

    msg = EmailMessage(
        subject="Hej",
        body="<p>Hej</p>",
        from_email="KB Intra <noreply@kb.dk>",
        to=["bruger@kb.dk"],
    )
    msg.content_subtype = "html"

    with patch.object(requests.Session, "post", return_value=_response(200, SUCCESS)) as post:
        sent = CloudflareEmailBackend().send_messages([msg])

    assert sent == 1
    url = post.call_args.args[0]
    assert url == "https://api.cloudflare.com/client/v4/accounts/acct123/email/sending/send"
    kwargs = post.call_args.kwargs
    assert kwargs["headers"]["Authorization"] == "Bearer token123"
    assert kwargs["timeout"] == (5, 15)
    payload = kwargs["json"]
    assert payload["to"] == ["bruger@kb.dk"]
    assert payload["from"] == {"address": "noreply@kb.dk", "name": "KB Intra"}
    assert payload["subject"] == "Hej"
    assert payload["html"] == "<p>Hej</p>"
    assert "text" not in payload


@pytest.mark.django_db
def test_plain_text_uses_text_field(settings):
    for k, v in SETTINGS.items():
        setattr(settings, k, v)

    msg = EmailMessage(subject="S", body="plain", from_email="noreply@kb.dk", to=["x@kb.dk"])
    with patch.object(requests.Session, "post", return_value=_response(200, SUCCESS)) as post:
        CloudflareEmailBackend().send_messages([msg])
    payload = post.call_args.kwargs["json"]
    assert payload["text"] == "plain"
    assert "html" not in payload


@pytest.mark.django_db
def test_multipart_sets_both_text_and_html(settings):
    for k, v in SETTINGS.items():
        setattr(settings, k, v)

    msg = EmailMultiAlternatives(
        subject="S", body="plain", from_email="noreply@kb.dk", to=["x@kb.dk"]
    )
    msg.attach_alternative("<p>rich</p>", "text/html")
    with patch.object(requests.Session, "post", return_value=_response(200, SUCCESS)) as post:
        CloudflareEmailBackend().send_messages([msg])
    payload = post.call_args.kwargs["json"]
    assert payload["text"] == "plain"
    assert payload["html"] == "<p>rich</p>"


@pytest.mark.django_db
def test_cc_bcc_reply_to_and_headers(settings):
    for k, v in SETTINGS.items():
        setattr(settings, k, v)

    msg = EmailMessage(
        subject="S",
        body="b",
        from_email="noreply@kb.dk",
        to=["x@kb.dk"],
        cc=["c@kb.dk"],
        bcc=["b@kb.dk"],
        reply_to=["r@kb.dk"],
        headers={"List-Unsubscribe": "<https://kb.dk/unsub>"},
    )
    with patch.object(requests.Session, "post", return_value=_response(200, SUCCESS)) as post:
        CloudflareEmailBackend().send_messages([msg])
    payload = post.call_args.kwargs["json"]
    assert payload["cc"] == ["c@kb.dk"]
    assert payload["bcc"] == ["b@kb.dk"]
    assert payload["reply_to"] == "r@kb.dk"
    assert payload["headers"]["List-Unsubscribe"] == "<https://kb.dk/unsub>"


@pytest.mark.django_db
def test_attachments_are_base64_encoded(settings):
    import base64

    for k, v in SETTINGS.items():
        setattr(settings, k, v)

    msg = EmailMessage(subject="S", body="b", from_email="noreply@kb.dk", to=["x@kb.dk"])
    msg.attach("kvittering.pdf", b"%PDF-1.4 fake", "application/pdf")
    with patch.object(requests.Session, "post", return_value=_response(200, SUCCESS)) as post:
        CloudflareEmailBackend().send_messages([msg])
    payload = post.call_args.kwargs["json"]
    assert len(payload["attachments"]) == 1
    att = payload["attachments"][0]
    assert att["filename"] == "kvittering.pdf"
    assert att["type"] == "application/pdf"
    assert att["disposition"] == "attachment"
    assert base64.b64decode(att["content"]) == b"%PDF-1.4 fake"


@pytest.mark.django_db
def test_no_attachments_field_when_none(settings):
    for k, v in SETTINGS.items():
        setattr(settings, k, v)

    msg = EmailMessage(subject="S", body="b", from_email="noreply@kb.dk", to=["x@kb.dk"])
    with patch.object(requests.Session, "post", return_value=_response(200, SUCCESS)) as post:
        CloudflareEmailBackend().send_messages([msg])
    assert "attachments" not in post.call_args.kwargs["json"]


@pytest.mark.django_db
def test_permanent_bounce_is_soft_failure_no_raise(settings):
    """Permanent bounce: reported as not-sent, but must NOT raise (no Huey retry)."""
    for k, v in SETTINGS.items():
        setattr(settings, k, v)

    bounced = {
        "success": True,
        "errors": [],
        "result": {"delivered": [], "permanent_bounces": ["x@kb.dk"], "queued": []},
    }
    msg = EmailMessage(subject="S", body="b", from_email="noreply@kb.dk", to=["x@kb.dk"])
    with patch.object(requests.Session, "post", return_value=_response(200, bounced)):
        sent = CloudflareEmailBackend().send_messages([msg])
    assert sent == 0


@pytest.mark.django_db
def test_http_error_raises_for_retry(settings):
    for k, v in SETTINGS.items():
        setattr(settings, k, v)

    failure = {"success": False, "errors": [{"code": 10001, "message": "bad"}], "result": None}
    msg = EmailMessage(subject="S", body="b", from_email="noreply@kb.dk", to=["x@kb.dk"])
    with (
        patch.object(requests.Session, "post", return_value=_response(400, failure)),
        pytest.raises(CloudflareEmailError),
    ):
        CloudflareEmailBackend().send_messages([msg])


@pytest.mark.django_db
def test_success_false_raises(settings):
    for k, v in SETTINGS.items():
        setattr(settings, k, v)

    failure = {"success": False, "errors": [], "result": None}
    msg = EmailMessage(subject="S", body="b", from_email="noreply@kb.dk", to=["x@kb.dk"])
    with (
        patch.object(requests.Session, "post", return_value=_response(200, failure)),
        pytest.raises(CloudflareEmailError),
    ):
        CloudflareEmailBackend().send_messages([msg])


@pytest.mark.django_db
def test_network_error_raises(settings):
    for k, v in SETTINGS.items():
        setattr(settings, k, v)

    msg = EmailMessage(subject="S", body="b", from_email="noreply@kb.dk", to=["x@kb.dk"])
    with (
        patch.object(requests.Session, "post", side_effect=requests.Timeout("timed out")),
        pytest.raises(CloudflareEmailError),
    ):
        CloudflareEmailBackend().send_messages([msg])


@pytest.mark.django_db
def test_missing_credentials_raises(settings):
    settings.CLOUDFLARE_ACCOUNT_ID = ""
    settings.CLOUDFLARE_EMAIL_API_TOKEN = ""
    msg = EmailMessage(subject="S", body="b", from_email="noreply@kb.dk", to=["x@kb.dk"])
    with pytest.raises(CloudflareEmailError):
        CloudflareEmailBackend().send_messages([msg])


def test_no_messages_returns_zero():
    assert CloudflareEmailBackend().send_messages([]) == 0
