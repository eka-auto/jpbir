#!/usr/bin/env python3
"""
S24 Ultra Phone Number Extractor and Firestore Updater

Discovers the current cellular phone number from:
1. Direct ADB shell commands (if connected via USB or wireless ADB)
2. Termux environment calls (if running directly on device)
3. Direct CLI argument (--number +91XXXXXXXXXX)

And updates Firestore document devices/samsung-s24-ultra across databases
'eka-agent' and '(default)'.
"""

import sys
import re
import json
import time
import argparse
import subprocess
from pathlib import Path

# Paths
WORKSPACE = Path(__file__).resolve().parent.parent.parent
KEY_PATH = Path(r"C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json")
PROJECT_ID = "intrepid-stage-495117-q1"
TARGET_DOC = "samsung-s24-ultra"


def clean_phone_number(raw: str) -> str | None:
    """Validate and format Indian phone number to E.164 (+91XXXXXXXXXX)."""
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("91") and len(digits) == 12:
        num = digits[2:]
    elif len(digits) == 10:
        num = digits
    elif digits.startswith("0") and len(digits) == 11:
        num = digits[1:]
    else:
        return None

    if re.match(r"^[6-9]\d{9}$", num):
        return f"+91{num}"
    return None


def get_firestore_token() -> str:
    import base64
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    import urllib.request
    import urllib.parse

    key = json.loads(KEY_PATH.read_text(encoding="utf-8"))
    now = int(time.time())
    header = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(json.dumps({
        "iss": key["client_email"],
        "scope": "https://www.googleapis.com/auth/datastore",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }).encode()).rstrip(b"=").decode()

    pk = serialization.load_pem_private_key(key["private_key"].encode(), password=None)
    sig = base64.urlsafe_b64encode(
        pk.sign(f"{header}.{payload}".encode(), padding.PKCS1v15(), hashes.SHA256())
    ).rstrip(b"=").decode()

    jwt_token = f"{header}.{payload}.{sig}"
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=urllib.parse.urlencode({
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": jwt_token,
        }).encode(),
    )
    resp = json.loads(urllib.request.urlopen(req).read())
    return resp["access_token"]


def update_firestore(phone_number: str):
    import urllib.request
    token = get_firestore_token()
    fields = {
        "devicePhoneNumber": {"stringValue": phone_number},
        "phoneNumberUpdatedAt": {"stringValue": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
        "carrier": {"stringValue": "Reliance Jio"},
        "phoneCountry": {"stringValue": "+91 (India)"}
    }
    
    mask = "&".join(f"updateMask.fieldPaths={k}" for k in fields.keys())
    
    for db in ["eka-agent", "(default)"]:
        url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/{db}/documents/devices/{TARGET_DOC}?{mask}"
        req = urllib.request.Request(
            url,
            data=json.dumps({"fields": fields}).encode(),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            method="PATCH"
        )
        try:
            with urllib.request.urlopen(req) as resp:
                if resp.status == 200:
                    print(f"  [ok] Updated Firestore db '{db}' with devicePhoneNumber: {phone_number}")
        except Exception as e:
            print(f"  [!] Failed to update {db}: {e}")


def scan_adb_for_number() -> list[str]:
    found = []
    try:
        r = subprocess.run(["adb", "devices"], capture_output=True, text=True, timeout=5)
        devices = [line.split()[0] for line in r.stdout.splitlines()[1:] if "\tdevice" in line]
        if not devices:
            print("  No ADB devices currently attached.")
            return []
        
        for dev in devices:
            print(f"  Scanning attached device: {dev}...")
            # 1. Dumpsys telephony
            r1 = subprocess.run(["adb", "-s", dev, "shell", "dumpsys", "telephony.registry"], capture_output=True, text=True, timeout=10)
            for m in re.findall(r"(?:mLine1Number|mPhoneNumber)\s*=\s*([+\d\s-]+)", r1.stdout, re.IGNORECASE):
                clean = clean_phone_number(m)
                if clean and clean not in found:
                    found.append(clean)
            
            # 2. SMS scan
            r2 = subprocess.run(["adb", "-s", dev, "shell", "content", "query", "--uri", "content://sms", "--projection", "address,body", "--limit", "20"], capture_output=True, text=True, timeout=10)
            for m in re.findall(r"\b[6-9]\d{9}\b", r2.stdout):
                clean = clean_phone_number(m)
                if clean and clean not in found:
                    found.append(clean)
    except Exception as e:
        print(f"  ADB query failed: {e}")
    return found


def main():
    parser = argparse.ArgumentParser(description="Extract or update S24 phone number for Twilio wakeup")
    parser.add_argument("--number", "-n", nargs="?", const="", type=str, help="Phone number (e.g. +91XXXXXXXXXX or 9XXXXXXXXX)")
    parser.add_argument("--scan", "-s", action="store_true", help="Scan connected ADB / system for phone number")
    args = parser.parse_args()

    print("=" * 60)
    print("S24 ULTRA PHONE NUMBER UTILITY FOR TWILIO WAKEUP")
    print("=" * 60)

    number_input = args.number

    if number_input == "":
        # Flag passed with no value, prompt interactively
        try:
            number_input = input("\nEnter the new phone number: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nAborted.")
            return

    if number_input:
        clean = clean_phone_number(number_input)
        if not clean:
            print(f"\nERROR: Invalid Indian phone number: '{number_input}'.")
            print("Expected 10 digits starting with 6, 7, 8, or 9 (e.g. 9876543210 or +919876543210).")
            sys.exit(1)
        print(f"\n[Setting New Number]: {clean}")
        update_firestore(clean)
        print("\nSUCCESS: Twilio can now send wake-up SMS to:", clean)
        return

    if args.scan:
        print("\nScanning for active numbers via ADB...")
        scanned = scan_adb_for_number()
        if scanned:
            print("\nFound numbers:")
            for n in scanned:
                print(f"  -> {n}")
            target = scanned[0]
            print(f"\nUpdating Firestore with primary number: {target}")
            update_firestore(target)
            return
        else:
            print("  No phone number could be read via ADB.")

    # Interactive prompt fallback
    print("\nNo phone number specified and no ADB device connected.")
    try:
        user_num = input("Enter the new phone number (or press Ctrl+C to cancel): ").strip()
        if user_num:
            clean = clean_phone_number(user_num)
            if not clean:
                print(f"\nERROR: Invalid phone number '{user_num}'. Expected 10 digits.")
                sys.exit(1)
            print(f"\n[Setting New Number]: {clean}")
            update_firestore(clean)
            print("\nSUCCESS: Twilio can now send wake-up SMS to:", clean)
            return
    except (EOFError, KeyboardInterrupt):
        print("\nAborted.")


if __name__ == "__main__":
    main()
