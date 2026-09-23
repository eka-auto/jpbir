#!/usr/bin/env python3
"""Platform signer adapters for broker v2.

Production signers hold non-exportable hardware-backed ECDSA P-256 keys:
- WindowsCngSigner: TPM-backed key in the Windows CNG Platform Crypto
  Provider. The private key never leaves the TPM; signing is delegated to
  a PowerShell helper because Python's cryptography binds OpenSSL, not CNG.
- SoftwareP256Signer: exportable PEM key. ONLY for emulator/sandbox tests;
  the broker rejects software keys unless the enrollment code explicitly
  permits them.
- TermuxKeystoreSigner: P-256 key generated and used by AndroidKeyStore via
  Termux:API. Enrollment fails if Termux reports that the key is not inside
  secure hardware.

All signers emit DER-encoded ECDSA signatures over SHA-256, matching Node's
crypto.createVerify('SHA256') and Android Keystore output.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature

log = logging.getLogger("channel_sandbox.signer")

_POWERSHELL = shutil.which("powershell") or "powershell"

# CREATE_NO_WINDOW. The Windows kits run the daemon under pythonw.exe, which has no
# console, so every console child it starts gets a new window of its own. This helper
# runs for every signed request (a poll every 15 s, a heartbeat every 45 s), and on
# g4g-lenovo-laptop that put a PowerShell window on the user's screen several times a
# minute. device_agent.py already passes this flag to its own subprocesses (_SW);
# the signer was the one that did not. Decided per call so tests can exercise it.
_CREATE_NO_WINDOW = 0x08000000


def _no_console_kwargs():
    return {"creationflags": _CREATE_NO_WINDOW} if sys.platform == "win32" else {}

_CNG_HELPER = r"""
$ErrorActionPreference = 'Stop'
$op = $env:EKA_CNG_OP
$keyName = $env:EKA_CNG_KEY_NAME
if ([string]::IsNullOrWhiteSpace($op) -or [string]::IsNullOrWhiteSpace($keyName)) {
  throw 'CNG operation and key name are required'
}
$platform = [System.Security.Cryptography.CngProvider]::new('Microsoft Platform Crypto Provider')
switch ($op) {
  'exists' {
    try {
      $k = [System.Security.Cryptography.CngKey]::Open($keyName, $platform)
      Write-Output 'exists'
    } catch { Write-Output 'absent' }
  }
  'create' {
    $params = New-Object System.Security.Cryptography.CngKeyCreationParameters
    $params.Provider = $platform
    $params.KeyUsage = [System.Security.Cryptography.CngKeyUsages]::Signing
    $params.ExportPolicy = [System.Security.Cryptography.CngExportPolicies]::None
    $k = [System.Security.Cryptography.CngKey]::Create([System.Security.Cryptography.CngAlgorithm]::ECDsaP256, $keyName, $params)
    Write-Output 'created'
  }
  'pubkey' {
    $k = [System.Security.Cryptography.CngKey]::Open($keyName, $platform)
    Write-Output ([Convert]::ToBase64String($k.Export([System.Security.Cryptography.CngKeyBlobFormat]::EccPublicBlob)))
  }
  'sign' {
    $b64 = [Console]::In.ReadToEnd().Trim()
    $data = [Convert]::FromBase64String($b64)
    $k = [System.Security.Cryptography.CngKey]::Open($keyName, $platform)
    $e = New-Object System.Security.Cryptography.ECDsaCng($k)
    Write-Output ([Convert]::ToBase64String($e.SignData($data, [System.Security.Cryptography.HashAlgorithmName]::SHA256)))
  }
}
"""


class SignerError(RuntimeError):
    pass


def key_id_from_pem(public_key_pem):
    der = serialization.load_pem_public_key(public_key_pem.encode("ascii")).public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return hashlib.sha256(der).hexdigest()[:32]


class SoftwareP256Signer:
    """Exportable PEM key. Sandbox/emulator tests only."""

    key_type = "software-p256"

    def __init__(self, key_path):
        self.key_path = Path(key_path)
        if self.key_path.exists():
            self._key = serialization.load_pem_private_key(self.key_path.read_bytes(), password=None)
        else:
            self._key = ec.generate_private_key(ec.SECP256R1())
            self.key_path.parent.mkdir(parents=True, exist_ok=True)
            self.key_path.write_bytes(
                self._key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.PKCS8,
                    encryption_algorithm=serialization.NoEncryption(),
                )
            )
            try:
                if sys.platform != "win32":
                    self.key_path.chmod(0o600)
            except OSError:
                pass

    def public_key_pem(self):
        return self._key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")

    def sign(self, data):
        return self._key.sign(data, ec.ECDSA(hashes.SHA256()))

    def attestation(self):
        return {"provider": "openssl-software", "exportable": True}


class WindowsCngSigner:
    """Non-exportable ECDSA P-256 key in the Windows Platform Crypto Provider.

    The Platform Crypto Provider stores keys in the TPM when present. There is
    deliberately no software fallback: production enrollment must be
    hardware-backed.
    """

    key_type = "tpm-cng-p256"

    def __init__(self, key_name="EKA-BROKER-DEVICE-KEY"):
        self.key_name = key_name
        self._pubkey_pem = None
        self._ensure_key()

    def _run(self, op, stdin_b64=None):
        cmd = [_POWERSHELL, "-NoProfile", "-NonInteractive", "-Command", _CNG_HELPER]
        env = os.environ.copy()
        env["EKA_CNG_OP"] = op
        env["EKA_CNG_KEY_NAME"] = self.key_name
        try:
            out = subprocess.run(
                cmd,
                input=stdin_b64.encode("ascii") if stdin_b64 else None,
                capture_output=True,
                timeout=30,
                env=env,
                **_no_console_kwargs(),
            )
        except (OSError, subprocess.SubprocessError) as e:
            raise SignerError(f"CNG helper failed to run: {e}") from e
        if out.returncode != 0:
            detail = out.stderr.decode("utf-8", errors="replace").strip()[:300]
            raise SignerError(f"CNG helper {op} failed: {detail}")
        return out.stdout.decode("utf-8", errors="replace").strip()

    def _ensure_key(self):
        state = self._run("exists")
        if state == "absent":
            created = self._run("create")
            if created != "created":
                raise SignerError("could not create CNG key (is the Platform Crypto Provider available?)")
            log.info("created TPM-backed CNG key %s", self.key_name)

    def public_key_pem(self):
        if self._pubkey_pem is None:
            blob = base64.b64decode(self._run("pubkey"), validate=True)
            if len(blob) < 8:
                raise SignerError("CNG returned an invalid ECC public blob")
            coordinate_size = int.from_bytes(blob[4:8], "little")
            if coordinate_size != 32 or len(blob) != 8 + (coordinate_size * 2):
                raise SignerError("CNG key is not ECDSA P-256")
            key = ec_public_key_from_xy(
                blob[8:8 + coordinate_size].hex(),
                blob[8 + coordinate_size:].hex(),
            )
            self._pubkey_pem = key.public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            ).decode("ascii")
        return self._pubkey_pem

    def sign(self, data):
        p1363_b64 = self._run("sign", base64.b64encode(data).decode("ascii"))
        raw = base64.b64decode(p1363_b64)
        if len(raw) != 64:
            raise SignerError(f"unexpected P-256 signature length: {len(raw)}")
        r = int.from_bytes(raw[:32], "big")
        s = int.from_bytes(raw[32:], "big")
        return encode_dss_signature(r, s)

    def attestation(self):
        return {
            "provider": "Microsoft Platform Crypto Provider",
            "keyName": self.key_name,
            "exportable": False,
        }


def ec_public_key_from_xy(x_hex, y_hex):
    numbers = ec.EllipticCurvePublicNumbers(
        int(x_hex, 16),
        int(y_hex, 16),
        ec.SECP256R1(),
    )
    return numbers.public_key()


class TermuxKeystoreSigner:
    """Hardware-backed AndroidKeyStore signer exposed by Termux:API."""

    key_type = "android-keystore-p256"

    def __init__(self, alias="eka-broker-device-key"):
        self.alias = alias
        self._command = shutil.which("termux-keystore")
        self._details = None
        self._pubkey_pem = None
        if not self._command:
            raise SignerError("termux-keystore is required (install the matching Termux:API app and package)")
        self._ensure_key()

    def _run(self, *args, input_bytes=None):
        try:
            result = subprocess.run(
                [self._command, *args],
                input=input_bytes,
                capture_output=True,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise SignerError(f"termux-keystore failed to run: {exc}") from exc
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", errors="replace").strip()[:300]
            raise SignerError(f"termux-keystore {' '.join(args)} failed: {detail}")
        return result.stdout

    def _list_details(self):
        try:
            items = json.loads(self._run("list", "-d").decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise SignerError("termux-keystore returned invalid key metadata") from exc
        return next((item for item in items if item.get("alias") == self.alias), None)

    def _ensure_key(self):
        details = self._list_details()
        if details is None:
            self._run("generate", self.alias, "-a", "EC", "-s", "256")
            details = self._list_details()
        if details is None:
            raise SignerError("AndroidKeyStore key was not created")
        if details.get("algorithm") != "EC" or int(details.get("size", 0)) != 256:
            raise SignerError("AndroidKeyStore alias exists with the wrong algorithm or curve")
        if details.get("inside_secure_hardware") is not True:
            raise SignerError("AndroidKeyStore key is not reported inside secure hardware")
        if not details.get("x") or not details.get("y"):
            raise SignerError("AndroidKeyStore did not return P-256 public coordinates")
        self._details = details

    def public_key_pem(self):
        if self._pubkey_pem is None:
            key = ec_public_key_from_xy(self._details["x"], self._details["y"])
            self._pubkey_pem = key.public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            ).decode("ascii")
        return self._pubkey_pem

    def sign(self, data):
        signature = self._run("sign", self.alias, "SHA256withECDSA", input_bytes=data)
        if not signature:
            raise SignerError("AndroidKeyStore returned an empty signature")
        return signature

    def attestation(self):
        return {
            "provider": "AndroidKeyStore",
            "alias": self.alias,
            "algorithm": "EC",
            "keySize": 256,
            "insideSecureHardware": True,
        }


def make_signer(cfg):
    kind = cfg.get("signer", "software")
    if kind == "windows-cng":
        if sys.platform != "win32":
            raise SignerError("windows-cng signer requires Windows")
        return WindowsCngSigner(cfg.get("key_name", "EKA-BROKER-DEVICE-KEY"))
    if kind == "software":
        key_path = cfg.get("key_path") or str(Path(__file__).resolve().parent / "keys" / "software-p256.pem")
        return SoftwareP256Signer(key_path)
    if kind == "android-keystore":
        return TermuxKeystoreSigner(cfg.get("key_alias", "eka-broker-device-key"))
    raise SignerError(f"unknown signer kind: {kind}")
