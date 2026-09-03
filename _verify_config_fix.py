#!/usr/bin/env python3
"""
Verify claude_sdk_unified_config.py fix
Tests that database_id now defaults to 'eka-agent' instead of 'swarn'
"""
import sys
sys.path.insert(0, r'C:\Users\abcom\github-repos\eka-agent')

from claude_sdk_unified_config import ClaudeSDKUnifiedConfig, FirebaseConfig

print("=" * 80)
print("VERIFYING claude_sdk_unified_config.py FIX")
print("=" * 80)

# Test 1: Default FirebaseConfig
print("\n1. Testing FirebaseConfig default values...")
fb_config = FirebaseConfig()
print(f"   project_id: {fb_config.project_id}")
print(f"   database_id: {fb_config.database_id}")

if fb_config.database_id == "eka-agent":
    print("   ✓ PASS: Default database_id is 'eka-agent'")
else:
    print(f"   ✗ FAIL: Default database_id is '{fb_config.database_id}' (expected 'eka-agent')")

# Test 2: Full ClaudeSDKUnifiedConfig
print("\n2. Testing ClaudeSDKUnifiedConfig default values...")
full_config = ClaudeSDKUnifiedConfig()
print(f"   firebase_config.project_id: {full_config.firebase_config.project_id}")
print(f"   firebase_config.database_id: {full_config.firebase_config.database_id}")

if full_config.firebase_config.database_id == "eka-agent":
    print("   ✓ PASS: Full config database_id is 'eka-agent'")
else:
    print(f"   ✗ FAIL: Full config database_id is '{full_config.firebase_config.database_id}'")

# Test 3: Environment variable override still works
print("\n3. Testing FIRESTORE_DB env var override...")
import os
os.environ["FIRESTORE_DB"] = "test-override-db"
override_config = ClaudeSDKUnifiedConfig()
print(f"   With FIRESTORE_DB='test-override-db' → database_id: {override_config.firebase_config.database_id}")

if override_config.firebase_config.database_id == "test-override-db":
    print("   ✓ PASS: Env var override works correctly")
else:
    print(f"   ✗ FAIL: Env var override not working")

# Clean up
del os.environ["FIRESTORE_DB"]

# Test 4: Check all 4 trees
print("\n4. Testing all 4 tree copies...")
trees = [
    (r"C:\Users\abcom\github-repos\eka-agent", "eka-agent"),
    (r"C:\Users\abcom\Go4Garage\eka-agent-clean", "eka-agent-clean"),
    (r"C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main", "eka-agent-main"),
    (r"C:\Users\abcom\Go4Garage\Eka Runner", "Eka Runner"),
]

for tree_path, tree_name in trees:
    try:
        sys.path.insert(0, tree_path)
        # Force reimport by removing from cache
        if 'claude_sdk_unified_config' in sys.modules:
            del sys.modules['claude_sdk_unified_config']
        
        import claude_sdk_unified_config as config_module
        fb = config_module.FirebaseConfig()
        
        if fb.database_id == "eka-agent":
            print(f"   ✓ {tree_name}: database_id = 'eka-agent'")
        else:
            print(f"   ✗ {tree_name}: database_id = '{fb.database_id}' (EXPECTED 'eka-agent')")
    except Exception as e:
        print(f"   ! {tree_name}: Error - {e}")
    finally:
        sys.path.pop(0)

print("\n" + "=" * 80)
print("VERIFICATION COMPLETE")
print("=" * 80)
