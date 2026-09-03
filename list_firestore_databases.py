#!/usr/bin/env python3
"""
List all Firestore databases and search for Helen Brown's UUID.
"""
import requests
import json
from pathlib import Path

# Service account key
key_path = Path(r"C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json")
if not key_path.exists():
    print(f"[!] Service account key not found: {key_path}")
    exit(1)

with open(key_path) as f:
    sa_key = json.load(f)

PROJECT_ID = "intrepid-stage-495117-q1"

# Get access token using service account
def get_access_token():
    """Get OAuth2 access token for Firestore API."""
    import jwt
    import time
    
    header = {"alg": "RS256", "typ": "JWT"}
    now = int(time.time())
    
    claim = {
        "iss": sa_key["client_email"],
        "scope": "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform",
        "aud": "https://oauth2.googleapis.com/token",
        "exp": now + 3600,
        "iat": now,
    }
    
    token = jwt.encode(claim, sa_key["private_key"], headers=header, algorithm="RS256")
    
    # Exchange for access token
    resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": token
        }
    )
    resp.raise_for_status()
    return resp.json()["access_token"]

def list_databases(token):
    """List all Firestore databases in the project."""
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases"
    headers = {"Authorization": f"Bearer {token}"}
    
    resp = requests.get(url, headers=headers)
    resp.raise_for_status()
    
    databases = resp.json().get("databases", [])
    print("=" * 80)
    print("FIRESTORE DATABASES")
    print("=" * 80)
    print(f"Project: {PROJECT_ID}")
    print()
    
    for db in databases:
        name = db.get("name", "").split("/")[-1]
        location = db.get("locationId", "N/A")
        state = db.get("state", "N/A")
        print(f"✅ Database: {name}")
        print(f"   Location: {location}")
        print(f"   State: {state}")
        print()
    
    return [db.get("name", "").split("/")[-1] for db in databases]

def search_uuid_in_database(token, db_id):
    """Search for Helen Brown's UUID in a database."""
    print(f"\n🔍 Searching in database: {db_id}...")
    
    # Try to read the document using REST API
    doc_path = f"projects/{PROJECT_ID}/databases/{db_id}/documents/clients/e21b66dd-2c8d-41c0-9aa3-a50ce72ccf92"
    url = f"https://firestore.googleapis.com/v1/{doc_path}"
    headers = {"Authorization": f"Bearer {token}"}
    
    resp = requests.get(url, headers=headers)
    
    if resp.status_code == 200:
        print(f"✅ Found in '{db_id}/clients/e21b66dd-2c8d-41c0-9aa3-a50ce72ccf92'")
        print(f"   Data: {resp.json()}")
        return True
    elif resp.status_code == 404:
        print(f"  Not found in {db_id}/clients/")
    else:
        print(f"  Error: {resp.status_code} - {resp.text}")
    
    return False

if __name__ == "__main__":
    print("=" * 80)
    print("LIST FIRESTORE DATABASES & SEARCH FOR HELEN BROWN")
    print("=" * 80)
    print()
    
    # Get access token
    token = get_access_token()
    
    # List databases
    databases = list_databases(token)
    
    # Search for Helen Brown's UUID in each database
    print("\n" + "=" * 80)
    print("SEARCHING FOR HELEN BROWN'S UUID")
    print("=" * 80)
    
    for db_id in databases:
        search_uuid_in_database(token, db_id)
    
    print()
    print("=" * 80)
    print("✅ SEARCH COMPLETE")
    print("=" * 80)
