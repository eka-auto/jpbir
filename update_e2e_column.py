#!/usr/bin/env python3
"""
Add E2E column to all tables in COMPLETE_FILE_LIST.md
"""
import re
from pathlib import Path

file_path = Path(r"C:\Users\abcom\jpbir\COMPLETE_FILE_LIST.md")
content = file_path.read_text(encoding='utf-8')

# Files that were created/modified in this session
session_files = {
    "helen_brown_db_client.py": "Created",
    "list_firestore_databases.py": "Created",
    "generate_username.py": "Created",
    "check_firestore_client.py": "Created",
    "helen_brown": "DB client work",
}

# Pattern for table header
header_pattern = re.compile(r'^\| # \| File Path \| Category \| Stale DBs \|$')

# Pattern for table rows
row_pattern = re.compile(r'^\| (\d+) \| `([^`]+)` \| ([A-Z_]+) \| ([^|]+) \|$')

lines = content.split('\n')
new_lines = []
in_file_table = False

for line in lines:
    # Check if this is a table header
    if header_pattern.match(line.strip()):
        new_lines.append("| # | File Path | Category | Stale DBs | E2E Changes |")
        in_file_table = True
        continue
    
    # Check if this is a table row
    if in_file_table:
        match = row_pattern.match(line.strip())
        if match:
            num, filepath, category, stale_dbs = match.groups()
            
            # Determine E2E change
            e2e_change = ""
            for key, value in session_files.items():
                if key in filepath:
                    e2e_change = value
                    break
            
            # Android build files were deleted
            if 'android/app/build' in filepath:
                e2e_change = "✅ Deleted (102 files)"
            # .tmp and scratch files
            elif '.tmp/' in filepath or '\\scratch\\' in filepath:
                e2e_change = "Safe to delete"
            # Destructive files
            elif category == 'DESTRUCTIVE':
                e2e_change = "✅ Deleted"
            
            new_lines.append(f"| {num} | `{filepath}` | {category} | {stale_dbs.strip()} | {e2e_change} |")
            continue
        
        # Check if we left the table
        if line.strip() == '' or line.startswith('###'):
            in_file_table = False
    
    new_lines.append(line)

# Write updated content
file_path.write_text('\n'.join(new_lines), encoding='utf-8')
print(f"✅ Added E2E column to {len([l for l in new_lines if '| E2E' in l])} tables")
print(f"   Total lines: {len(new_lines)}")
