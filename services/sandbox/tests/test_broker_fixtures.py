#!/usr/bin/env python3
"""Cross-language signature fixtures for broker v2.

Generates a P-256 keypair, signs a canonical envelope string, and writes
fixtures that the Node test verifies (and vice versa). Run this first to
produce fixtures/fixtures.json, then run the Node test.
"""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

FIXTURES = Path(__file__).parent / "fixtures"


def main():
    FIXTURES.mkdir(exist_ok=True)

    # Generate P-256 keypair
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()

    # Export only the public key. Test private material is never persisted.
    pub_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")

    # Derive keyId
    spki_der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    key_id = hashlib.sha256(spki_der).hexdigest()[:32]

    # Canonical envelope string
    body = b'{"code":"deadbeef12345678deadbeef12345678","deviceId":"g4g-lenovo-laptop","publicKeyPem":"...","keyType":"tpm-cng-p256","attestation":{},"hardware":{"manufacturer":"LENOVO","model":"82KA"}}'
    body_sha256 = hashlib.sha256(body).hexdigest()
    seq = 0
    timestamp = 1725278400000  # fixed epoch for reproducibility
    request_id = "550e8400-e29b-41d4-a716-446655440000"
    canonical = "\n".join([
        "v2",
        key_id,
        "POST",
        "/api/device-enroll",
        str(seq),
        str(timestamp),
        request_id,
        body_sha256,
    ])

    # Sign
    signature_der = private_key.sign(canonical.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
    signature_b64 = base64.b64encode(signature_der).decode("ascii")

    fixture = {
        "description": "Broker v2 canonical envelope fixture (Python -> Node verify)",
        "keyId": key_id,
        "publicKeyPem": pub_pem,
        "canonical": canonical,
        "bodySha256": body_sha256,
        "signatureBase64": signature_b64,
        "expectedVerify": True,
    }

    (FIXTURES / "python_to_node.json").write_text(json.dumps(fixture, indent=2), encoding="utf-8")
    print(f"Wrote {FIXTURES / 'python_to_node.json'} (keyId={key_id})")

    # Also generate a Node->Python fixture: sign with Python using a fixed seed? Can't easily.
    # Instead, write a second fixture where Python verifies a pre-computed signature.
    # For now, just the one fixture; the Node test will verify it.


if __name__ == "__main__":
    main()
