#!/usr/bin/env -S uv run
# /// script
# dependencies = ["py-vapid", "cryptography"]
# ///

import base64
from py_vapid import Vapid
from cryptography.hazmat.primitives import serialization

v = Vapid()
v.generate_keys()

public_bytes = v.public_key.public_bytes(
    encoding=serialization.Encoding.X962,
    format=serialization.PublicFormat.UncompressedPoint,
)

private_bytes = v.private_key.private_numbers().private_value.to_bytes(32, "big")

print(
    f"VAPID_PUBLIC_KEY={base64.urlsafe_b64encode(public_bytes).decode()}\n"
    f"VAPID_PRIVATE_KEY={base64.urlsafe_b64encode(private_bytes).decode()}"
)
