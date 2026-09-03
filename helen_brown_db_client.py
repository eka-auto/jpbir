#!/usr/bin/env python3
"""
Helen Brown Database Client Connection
Connects to Firestore using Helen Brown's credentials.
"""
import os
import sys
from pathlib import Path
from datetime import datetime

# Firebase Admin SDK
import firebase_admin
from firebase_admin import credentials, firestore

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# HELEN BROWN'S CREDENTIALS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HELEN_BROWN_CONFIG = {
    "username": "Helen Brown",
    "uuid": "e21b66dd-2c8d-41c0-9aa3-a50ce72ccf92",
    "password": "gzJuz8s[1lv",  # TODO: Move to Windows Credential Manager
    "project_id": "intrepid-stage-495117-q1",
    "database_id": "e21b66dd-2c8d-41c0-9aa3-a50ce72ccf92",  # UUID as database ID
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CONNECTION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def connect_helen_brown_db():
    """
    Connect to Helen Brown's Firestore database instance.
    
    Returns:
        firestore.Client: Firestore client connected to Helen Brown's DB
    """
    # Service account key path
    key_path = Path(r"C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json")
    
    if not key_path.exists():
        print(f"[!] Service account key not found: {key_path}")
        return None
    
    try:
        # Initialize Firebase with service account and project
        cred = credentials.Certificate(str(key_path))
        
        # Check if already initialized
        if not firebase_admin._apps:
            firebase_admin.initialize_app(
                credential=cred,
                options={'projectId': HELEN_BROWN_CONFIG["project_id"]}
            )
        
        # Create Firestore client with Helen Brown's database ID
        db = firestore.client(database_id=HELEN_BROWN_CONFIG["database_id"])
        
        print("✅ Connected to Helen Brown's Firestore database")
        print(f"   Project: {HELEN_BROWN_CONFIG['project_id']}")
        print(f"   Database: {HELEN_BROWN_CONFIG['database_id']}")
        print(f"   UUID: {HELEN_BROWN_CONFIG['uuid']}")
        
        return db
        
    except Exception as e:
        print(f"[!] Connection failed: {e}")
        import traceback
        traceback.print_exc()
        return None

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TEST CONNECTION
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def test_connection(db, database_name="eka-agent"):
    """Test the database connection."""
    if not db:
        print("[!] No database connection")
        return False
    
    try:
        # Try Helen Brown's UUID as a document ID in 'clients' collection
        helen_doc = db.collection("clients").document(HELEN_BROWN_CONFIG["uuid"])
        doc = helen_doc.get()
        
        if doc.exists:
            print(f"✅ Found Helen Brown's document in {database_name}")
            data = doc.to_dict()
            print(f"   Data: {data}")
        else:
            print(f"ℹ️ Helen Brown's UUID not found in {database_name}/clients")
        
        # List collections
        collections = db.collections()
        print(f"   Available collections: {[c.id for c in collections]}")
        
        return True
        
    except Exception as e:
        print(f"[!] Connection test failed: {e}")
        return False


def search_helen_brown_in_db(db, database_name="eka-agent"):
    """Search for Helen Brown's data in the given database."""
    print(f"\n🔍 Searching in {database_name}...")
    
    try:
        # Search in common collections
        for collection_name in ["clients", "users", "customers", "accounts"]:
            try:
                docs = db.collection(collection_name).stream()
                for doc in docs:
                    data = doc.to_dict()
                    # Check if this is Helen Brown
                    if data.get("username") == "Helen Brown" or \
                       data.get("name") == "Helen Brown" or \
                       doc.id == HELEN_BROWN_CONFIG["uuid"]:
                        print(f"✅ Found in '{collection_name}/{doc.id}'")
                        print(f"   Data: {data}")
                        return True
            except Exception:
                continue
        
        print(f"  Helen Brown not found in {database_name}")
        return False
        
    except Exception as e:
        print(f"[!] Search failed: {e}")
        return False

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# MAIN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if __name__ == "__main__":
    print("=" * 80)
    print("HELEN BROWN DATABASE CLIENT")
    print("=" * 80)
    print()
    
    # Service account key path
    key_path = Path(r"C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json")
    
    if not key_path.exists():
        print(f"[!] Service account key not found: {key_path}")
        sys.exit(1)
    
    # Initialize Firebase
    cred = credentials.Certificate(str(key_path))
    firebase_admin.initialize_app(credential=cred, options={'projectId': "intrepid-stage-495117-q1"})
    
    # Connect to canonical eka-agent database
    print("Connecting to canonical 'eka-agent' database...")
    db = firestore.client(database_id="eka-agent")
    
    # Search for Helen Brown's data
    search_helen_brown_in_db(db, "eka-agent")
    
    print()
    print("=" * 80)
    print("✅ SEARCH COMPLETE")
    print("=" * 80)
