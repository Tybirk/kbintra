"""Django email backend that sends through the Cloudflare Email Service REST API.

All outbound mail goes through standard Django ``EmailMessage(...).send()`` calls;
this backend translates each message into a Cloudflare Email Service request:

    POST https://api.cloudflare.com/client/v4/accounts/{account_id}/email/sending/send

Configure in production via env:

    EMAIL_BACKEND=apps.notifications.email_backend.CloudflareEmailBackend
    CLOUDFLARE_ACCOUNT_ID=...
    CLOUDFLARE_EMAIL_API_TOKEN=...   # token scoped to email_sending:write

Cloudflare has no batch endpoint, so we loop single sends. A success is
HTTP 200 + ``success: true`` + an empty ``result.permanent_bounces`` array; we
check all three.
"""

import base64
import logging
from email.utils import parseaddr

import requests
from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

logger = logging.getLogger(__name__)

SEND_URL = "https://api.cloudflare.com/client/v4/accounts/{account_id}/email/sending/send"

# (connect timeout, read timeout) in seconds — a stuck Cloudflare API must never
# hang a web request or a Huey worker.
_TIMEOUTS = (5, 15)


class CloudflareEmailError(Exception):
    """Raised when a Cloudflare email send fails transiently (so Huey can retry)."""


def _format_address(raw: str) -> str | dict[str, str]:
    """Parse a ``"Name <email@x>"`` string into Cloudflare's address form.

    Returns a bare string when there's no display name, else ``{"address", "name"}``.
    """
    name, address = parseaddr(raw)
    if name and address:
        return {"address": address, "name": name}
    return address or raw


class CloudflareEmailBackend(BaseEmailBackend):
    """Send email via the Cloudflare Email Service REST API."""

    def __init__(self, fail_silently: bool = False, **kwargs) -> None:
        super().__init__(fail_silently=fail_silently, **kwargs)
        self.account_id = getattr(settings, "CLOUDFLARE_ACCOUNT_ID", "")
        self.api_token = getattr(settings, "CLOUDFLARE_EMAIL_API_TOKEN", "")
        self.session = requests.Session()

    def send_messages(self, email_messages) -> int:
        if not email_messages:
            return 0
        if not (self.account_id and self.api_token):
            logger.error(
                "Cloudflare email not configured: CLOUDFLARE_ACCOUNT_ID / "
                "CLOUDFLARE_EMAIL_API_TOKEN missing"
            )
            if not self.fail_silently:
                raise CloudflareEmailError("Cloudflare email credentials not configured")
            return 0

        url = SEND_URL.format(account_id=self.account_id)
        sent = 0
        for message in email_messages:
            if self._send_one(message, url):
                sent += 1
        return sent

    def _build_payload(self, message) -> dict:
        payload: dict = {
            "to": list(message.to),
            "from": _format_address(message.from_email),
            "subject": message.subject,
        }

        # Plain EmailMessage with content_subtype="html" carries HTML in .body;
        # EmailMultiAlternatives carries the HTML part in .alternatives.
        if message.content_subtype == "html":
            payload["html"] = message.body
        else:
            payload["text"] = message.body
        for content, mimetype in getattr(message, "alternatives", None) or []:
            if mimetype == "text/html":
                payload["html"] = content

        if message.cc:
            payload["cc"] = list(message.cc)
        if message.bcc:
            payload["bcc"] = list(message.bcc)
        if message.reply_to:
            payload["reply_to"] = message.reply_to[0]
        if message.extra_headers:
            payload["headers"] = dict(message.extra_headers)
        attachments = [self._format_attachment(a) for a in message.attachments]
        if attachments:
            payload["attachments"] = attachments
        return payload

    @staticmethod
    def _format_attachment(attachment) -> dict:
        """Translate a Django attachment into Cloudflare's base64 form.

        Django carries attachments either as ``(filename, content, mimetype)``
        tuples (the common ``EmailMessage.attach()`` case) or as ``MIMEBase``
        objects; handle both. Cloudflare wants base64 content + a disposition.
        """
        if isinstance(attachment, tuple):
            filename, content, mimetype = attachment
        else:
            filename = attachment.get_filename() or "vedhaeftning"
            content = attachment.get_payload(decode=True) or b""
            mimetype = attachment.get_content_type()
        if isinstance(content, str):
            content = content.encode("utf-8")
        return {
            "content": base64.b64encode(content).decode("ascii"),
            "filename": filename or "vedhaeftning",
            "type": mimetype or "application/octet-stream",
            "disposition": "attachment",
        }

    def _send_one(self, message, url: str) -> bool:
        if not message.recipients():
            return False

        payload = self._build_payload(message)
        try:
            response = self.session.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {self.api_token}"},
                timeout=_TIMEOUTS,
            )
        except requests.RequestException as exc:
            logger.exception("Cloudflare email request failed (network) to %s", message.to)
            if not self.fail_silently:
                raise CloudflareEmailError(str(exc)) from exc
            return False

        try:
            data = response.json()
        except ValueError:
            data = None

        # Permanent bounce: the address will never accept mail. Retrying is
        # pointless, so log and report failure WITHOUT raising (no Huey retry).
        if response.status_code == 200 and isinstance(data, dict) and data.get("success"):
            bounces = (data.get("result") or {}).get("permanent_bounces") or []
            if bounces:
                logger.error("Cloudflare email permanently bounced for %s: %s", message.to, bounces)
                return False
            return True

        # Anything else is treated as transient (HTTP error, success:false, bad
        # body): log and raise so the caller's Huey retry can kick in.
        errors = data.get("errors") if isinstance(data, dict) else response.text
        logger.error(
            "Cloudflare email send failed to %s: HTTP %s errors=%s",
            message.to,
            response.status_code,
            errors,
        )
        if not self.fail_silently:
            raise CloudflareEmailError(
                f"Cloudflare email send failed: HTTP {response.status_code} errors={errors}"
            )
        return False
