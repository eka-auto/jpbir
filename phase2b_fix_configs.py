#!/usr/bin/env python3
"""
Phase 2b: Fix Firebase Config Files
Updates or deletes stale firebase config files across all 4 trees.

Strategy:
1. Delete config/firebase/firebase.<stale-db>.json files (these databases don't exist)
2. Update root firebase.json files to use "eka-agent" consistently
3. Update DEPLOYMENT_CONFIG.json, isolated_config.json
"""
import json
import os
from pathlib import Path

TREES = {
    "eka-agent": r"C:\Users\abcom\github-repos\eka-agent",
    "eka-agent-clean": r"C:\Users\abcom\Go4Garage\eka-agent-clean",
    "eka-agent-main": r"C:\Users\abcom\Downloads\eka_agent_extract\eka-agent-main",
    "Eka Runner": r"C:\Users\abcom\Go4Garage\Eka Runner",
}

STALE_DBS = ["eka-validation", "eka-llm", "eka-runner", "swarn", "jarvis"]
CANONICAL_DB = "eka-agent"

def delete_file(file_path, reason):
    """Delete a file and return result."""
    try:
        if file_path.exists():
            file_path.unlink()
            print(f"  ✓ Deleted: {file_path} ({reason})")
            return True
    except Exception as e:
        print(f"  ✗ Failed to delete {file_path}: {e}")
    return False

def update_json_file(file_path, replacements):
    """Update JSON file with replacements. Returns True if changed."""
    try:
        content = file_path.read_text(encoding='utf-8')
        data = json.loads(content)
        changed = False
        
        # Apply replacements
        for old_val, new_val in replacements.items():
            # Recursive search and replace
            def replace_in_obj(obj):
                nonlocal changed
                if isinstance(obj, dict):
                    for k, v in obj.items():
                        if isinstance(v, str) and v == old_val:
                            obj[k] = new_val
                            changed = True
                        elif isinstance(v, (dict, list)):
                            replace_in_obj(v)
                elif isinstance(obj, list):
                    for i, item in enumerate(obj):
                        if isinstance(item, str) and item == old_val:
                            obj[i] = new_val
                            changed = True
                        elif isinstance(item, (dict, list)):
                            replace_in_obj(item)
            
            replace_in_obj(data)
        
        if changed:
            file_path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
            print(f"  ✓ Updated: {file_path}")
            return True
        else:
            print(f"  = No changes needed: {file_path}")
            return False
    except Exception as e:
        print(f"  ✗ Error updating {file_path}: {e}")
        return False

def process_tree(tree_name, tree_root):
    """Process a single tree."""
    print(f"\n>>> Processing {tree_name}...")
    root = Path(tree_root)
    
    deleted = 0
    updated = 0
    
    # 1. Delete config/firebase/firebase.<stale-db>.json files
    config_dir = root / "config" / "firebase"
    if config_dir.exists():
        for stale_db in STALE_DBS:
            config_file = config_dir / f"firebase.{stale_db}.json"
            if config_file.exists():
                if delete_file(config_file, f"stale DB '{stale_db}'"):
                    deleted += 1
    
    # 2. Update root firebase.json
    firebase_json = root / "firebase.json"
    if firebase_json.exists():
        replacements = {db: CANONICAL_DB for db in STALE_DBS}
        # Also update hosting targets
        for db in STALE_DBS:
            replacements[f"target\": \"{db}"] = f"target\": \"{CANONICAL_DB}"
        if update_json_file(firebase_json, {db: CANONICAL_DB for db in STALE_DBS}):
            updated += 1
    
    # 3. Update DEPLOYMENT_CONFIG.json
    deployment_config = root / "DEPLOYMENT_CONFIG.json"
    if deployment_config.exists():
        if update_json_file(deployment_config, {db: CANONICAL_DB for db in STALE_DBS}):
            updated += 1
    
    # 4. Update isolated_config.json
    isolated_config = root / "isolated_config.json"
    if isolated_config.exists():
        if update_json_file(isolated_config, {db: CANONICAL_DB for db in STALE_DBS}):
            updated += 1
    
    # 5. Update .vscode/settings.json (if it has firestore db refs)
    vscode_settings = root / ".vscode" / "settings.json"
    if vscode_settings.exists():
        if update_json_file(vscode_settings, {db: CANONICAL_DB for db in STALE_DBS}):
            updated += 1
    
    print(f"  Summary: {deleted} deleted, {updated} updated")
    return deleted, updated

def main():
    print("=" * 80)
    print("PHASE 2b: FIX FIREBASE CONFIG FILES")
    print(f"Canonical DB: {CANONICAL_DB}")
    print(f"Stale DBs to remove: {', '.join(STALE_DBS)}")
    print("=" * 80)
    
    total_deleted = 0
    total_updated = 0
    
    for tree_name, tree_root in TREES.items():
        if not Path(tree_root).exists():
            print(f"  [!] Tree not found: {tree_root}")
            continue
        
        deleted, updated = process_tree(tree_name, tree_root)
        total_deleted += deleted
        total_updated += updated
    
    print("\n" + "=" * 80)
    print("PHASE 2b COMPLETE")
    print(f"Total deleted: {total_deleted} files")
    print(f"Total updated: {total_updated} files")
    print("=" * 80)

if __name__ == "__main__":
    main()
