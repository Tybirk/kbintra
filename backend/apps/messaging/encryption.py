"""
Symmetric encryption for message content (at-rest encryption).

Uses Fernet (AES-128-CBC + HMAC-SHA256) from the cryptography library.
The key is stored in the MESSAGES_ENCRYPTION_KEY environment variable.

Behavior:
- Production (DEBUG=False): Key is required, app refuses to start without it.
- Development (DEBUG=True): Key is optional. Without it, messages are stored as plaintext.
  Encrypted messages from a production DB copy show as "[krypteret besked]".
"""

import logging

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import models

logger = logging.getLogger(__name__)

ENCRYPTED_PREFIX = "fernet:"


def _get_fernet() -> Fernet | None:
    key = getattr(settings, "MESSAGES_ENCRYPTION_KEY", "")
    if not key:
        return None
    return Fernet(key.encode())


def encrypt(plaintext: str) -> str:
    f = _get_fernet()
    if not f:
        return plaintext
    return ENCRYPTED_PREFIX + f.encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    if not ciphertext.startswith(ENCRYPTED_PREFIX):
        return ciphertext
    f = _get_fernet()
    if not f:
        return "[krypteret besked]"
    try:
        return f.decrypt(ciphertext[len(ENCRYPTED_PREFIX) :].encode()).decode()
    except InvalidToken:
        logger.warning("Failed to decrypt message - wrong key?")
        return "[krypteret besked]"


class EncryptedTextField(models.TextField):
    """TextField that transparently encrypts/decrypts content at the DB boundary."""

    def get_prep_value(self, value):
        if value is None:
            return value
        return encrypt(str(value))

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        return decrypt(value)
