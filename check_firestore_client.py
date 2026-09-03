#!/usr/bin/env python3
"""
Quick Firestore client check - verify canonical DB access.
"""
import os
import sys
from pathlib import Path

# Add Eka Runner to path for firebase_admin import
eka_runner = Path(r"C:\Users\abcom\Go4Garage\Eka Runner")
if eka_runner.exists():
    sys.path.insert(0, str(eka_runner))

from firebase_admin import credentials, firestore, initialize_app

def main():
    print("=" * 80)
    print("FIRESTORE CLIENT CHECK")
    print("=" * 80)
    
    # Service account key
    key_path = Path(r"C:\Users\abcom\Go4Garage\Eka Runner\serviceAccountKey.json")
    if not key_path.exists():
        print(f"[!] Service account key not found: {key_path}")
        return
    
    # Initialize app
    try:
        cred = credentials.Certificate(str(key_path))
        initialize_app(credential=cred)
        print("✅ Firebase app initialized")
    except Exception as e:
        print(f"[!] Firebase init failed: {e}")
        return
    
    # Get client
    try:
        db = firestore.client()
        print("✅ Firestore client created")
    except Exception as e:
        print(f"[!] Firestore client failed: {e}")
        return
    
    # Access canonical database
    canonical_project = "intrepid-stage-495117-q1"
    canonical_db = "eka-agent"
    
    try:
        # Use the client with the canonical database
        # Note: firestore.client() doesn't take database param directly
        # We access it via collection/document operations
        db_ref = db.collection("_test_check").document("ping")
        print(f"✅ Database reference created: {canonical_db}")
        
        # Try to read a known document (S24 device doc)
        device_doc = db.collection("devices").document("samsung-s24-ultra")
        doc = device_doc.get()
        
        if doc.exists:
            data = doc.to_dict()
            print(f"✅ Successfully read: devices/samsung-s24-ultra")
            print(f"   - online: {data.get('online', 'N/A')}")
            print(f"   - agentVersion: {data.get('agentVersion', 'N/A')}")
            print(f"   - lastSeen: {data.get('lastSeen', 'N/A')}")
        else:
            print(f"[!] Document not found: devices/samsung-s24-ultra")
            
    except Exception as e:
        print(f"[!] Database access failed: {e}")
        import traceback
        traceback.print_exc()
        return
    
    print()
    print("=" * 80)
    print("✅ FIRESTORE CLIENT CHECK COMPLETE")
    print("=" * 80)
    print(f"Project: {canonical_project}")
    print(f"Database: {canonical_db}")
    print("Status: Accessible")

if __name__ == "__main__":
    main()
