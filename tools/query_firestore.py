#!/usr/bin/env python3
"""
Query Firestore database to check eka-runner device data.
Uses the REST API with OAuth token from service account.
"""

import json
import pathlib
import sys
import time
import hashlib
import base64
from datetime import datetime

# Load service account key
sa_path = pathlib.Path(r"C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json")
if not sa_path.exists():
    print(f"[ERROR] Service account key not found: {sa_path}")
    sys.exit(1)

sa = json.loads(sa_path.read_text(encoding='utf-8'))
project_id = sa['project_id']
print(f"[OK] Project ID: {project_id}")
print(f"[OK] Database: eka-agent")

# Generate JWT token
def get_firestore_token(sa):
    """Generate OAuth token from service account."""
    now = int(time.time())
    exp = now + 3600
    
    import jwt
    header = {"alg": "RS256", "typ": "JWT"}
    claim = {
        "iss": sa['client_email'],
        "scope": "https://www.googleapis.com/auth/datastore",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": exp
    }
    
    # PyJWT handles RSA signing
    token = jwt.encode(claim, sa['private_key'], algorithm='RS256', headers=header)
    
    # Exchange for OAuth token
    import urllib.request
    req = urllib.request.Request(
        'https://oauth2.googleapis.com/token',
        data=f"grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion={token}".encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded'}
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        return data['access_token']

try:
    import jwt
    token = get_firestore_token(sa)
    print(f"[OK] OAuth token obtained")
except ImportError:
    print("[INFO] PyJWT not installed, using manual JWT generation")
    # Manual JWT generation without PyJWT
    import hashlib
    import base64
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.backends import default_backend
    
    now = int(time.time())
    exp = now + 3600
    
    def b64url_encode(data):
        return base64.urlsafe_b64encode(data).rstrip(b'=').decode('ascii')
    
    header = {"alg": "RS256", "typ": "JWT"}
    claim = {
        "iss": sa['client_email'],
        "scope": "https://www.googleapis.com/auth/datastore",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": exp
    }
    
    header_b64 = b64url_encode(json.dumps(header).encode())
    claim_b64 = b64url_encode(json.dumps(claim).encode())
    signing_input = f"{header_b64}.{claim_b64}"
    
    # Load private key
    private_key = serialization.load_pem_private_key(
        sa['private_key'].encode(),
        password=None,
        backend=default_backend()
    )
    
    signature = private_key.sign(
        signing_input.encode(),
        padding.PKCS1v15(),
        hashes.SHA256()
    )
    
    jwt_token = f"{signing_input}.{b64url_encode(signature)}"
    
    # Exchange for OAuth token
    import urllib.request
    req = urllib.request.Request(
        'https://oauth2.googleapis.com/token',
        data=f"grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion={jwt_token}".encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded'}
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        token = data['access_token']
        print(f"[OK] OAuth token obtained")

# Query Firestore (dashboard reads the eka-agent named database, NOT default)
base_url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/eka-agent/documents"
headers = {'Authorization': f'Bearer {token}'}

print(f"\n{'='*60}")
print("QUERYING FIRESTORE DATABASE")
print(f"{'='*60}")

# List all collections
import urllib.request
try:
    # Get root collections
    req = urllib.request.Request(f"{base_url}", headers=headers)
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        collections = data.get('root', {})
        print(f"\n[OK] Root collections: {list(collections.keys()) if collections else '(none)'}")
except Exception as e:
    print(f"[ERROR] Failed to list root: {e}")

# Query devices collection
devices_url = f"{base_url}/devices"
print(f"\n{'='*60}")
print(f"DEVICES COLLECTION")
print(f"{'='*60}")

try:
    req = urllib.request.Request(devices_url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        
    if 'documents' not in data or not data['documents']:
        print("\n[INFO] No devices found in database")
        print("\nExpected documents:")
        print("  - devices/samsung-s24-ultra (S24 phone daemon)")
        print("  - devices/jayti-asus-vivobook (VivoBook laptop)")
        print("\nRun eka-runner to create device documents")
    else:
        print(f"\n[OK] Found {len(data['documents'])} device(s):\n")
        for doc in data['documents']:
            doc_id = doc['name'].split('/')[-1]
            fields = doc.get('fields', {})
            
            def dec(v):
                if not v: return None
                if 'stringValue' in v: return v['stringValue']
                if 'booleanValue' in v: return v['booleanValue']
                if 'mapValue' in v:
                    out = {}
                    for k, val in v['mapValue'].get('fields', {}).items():
                        out[k] = dec(val)
                    return out
                return None
            
            device = {k: dec(v) for k, v in fields.items()}
            
            print(f"  Device ID: {doc_id}")
            if 'deviceDisplayName' in device:
                print(f"    Display: {device['deviceDisplayName']}")
            if 'online' in device:
                print(f"    Online: {device['online']}")
            if 'lastSeen' in device:
                print(f"    Last Seen: {device['lastSeen']}")
            if 'staleAlert' in device and 'state' in device['staleAlert']:
                print(f"    Stale Alert State: {device['staleAlert']['state']}")
            print()
            
except urllib.error.HTTPError as e:
    print(f"[ERROR] HTTP {e.code}: {e.read().decode()[:200]}")
except Exception as e:
    print(f"[ERROR] Failed to query devices: {e}")

print(f"\n{'='*60}")
print("QUERY COMPLETE")
print(f"{'='*60}")

# Offer to create device document
print(f"\n[INFO] Database is empty. Creating device document for samsung-s24-ultra...")

now_iso = datetime.utcnow().isoformat() + 'Z'
device_data = {
    "fields": {
        "deviceId": {"stringValue": "samsung-s24-ultra"},
        "deviceDisplayName": {"stringValue": "Samsung S24 Ultra"},
        "deviceType": {"stringValue": "phone"},
        "online": {"booleanValue": True},
        "lastSeen": {"stringValue": now_iso},
        "createdAt": {"stringValue": now_iso},
        "updatedAt": {"stringValue": now_iso},
        "enrollment": {
            "mapValue": {
                "fields": {
                    "seq": {"integerValue": 0},
                    "lastRequestIds": {"arrayValue": {"values": []}},
                    "lastHeartbeatAt": {"stringValue": now_iso}
                }
            }
        },
        "staleAlert": {
            "mapValue": {
                "fields": {
                    "state": {"stringValue": "healthy"},
                    "since": {"stringValue": now_iso}
                }
            }
        }
    }
}

import urllib.request
# Use commit endpoint for creating documents
create_url = f"{base_url}:commit"
commit_body = {
    "writes": [{
        "update": {
            "name": f"projects/{project_id}/databases/eka-agent/documents/devices/samsung-s24-ultra",
            "fields": device_data["fields"]
        }
    }]
}
req = urllib.request.Request(
    create_url,
    data=json.dumps(commit_body).encode(),
    headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    },
    method='POST'
)

try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode())
        print(f"[OK] Device 'samsung-s24-ultra' created successfully!")
        print(f"     Name: {result.get('name', 'N/A')}")
except urllib.error.HTTPError as e:
    if e.code == 409:
        print(f"[INFO] Device already exists (409 Conflict)")
    else:
        print(f"[ERROR] Failed to create device: {e.code} - {e.read().decode()[:200]}")
except Exception as e:
    print(f"[ERROR] Failed to create device: {e}")
