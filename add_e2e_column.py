#!/usr/bin/env python3
"""
Add E2E column to COMPLETE_FILE_LIST.md tables.
E2E = End-to-End changes made during this session.
"""
import re
from pathlib import Path

def add_e2e_column():
    """Add E2E column to all markdown tables in the file."""
    
    file_path = Path(r"C:\Users\abcom\jpbir\COMPLETE_FILE_LIST.md")
    content = file_path.read_text(encoding='utf-8')
    
    # Track changes made in this session
    e2e_changes = {
        # Files we actually modified
        "helen_brown_db_client.py": "Created DB client script",
        "list_firestore_databases.py": "Created DB listing script",
        "generate_username.py": "Created username generator",
        "check_firestore_client.py": "Created Firestore client check",
        "helen_brown_db_client.py": "Firestore connection tested",
    }
    
    # Pattern to match table headers with 4 columns
    # Looking for: | # | File Path | Category | Stale DBs |
    header_pattern = r'^(\| # \| File Path \| Category \| Stale DBs \|)$'
    
    # Pattern to match table rows with 4 columns
    row_pattern = r'^(\| \d+ \| `[^`]+` \| [A-Z_]+ \| [^|]+ \|)$'
    
    lines = content.split('\n')
    new_lines = []
    in_table = False
    
    for i, line in enumerate(lines):
        # Check if this is a table header
        if re.match(header_pattern, line.strip()):
            # Add E2E column to header
            new_line = "| # | File Path | Category | Stale DBs | E2E Changes |"
            new_lines.append(new_line)
            in_table = True
            continue
        
        # Check if this is a table row (only if we're in a table)
        if in_table and re.match(row_pattern, line.strip()):
            # Parse the row
            parts = line.split('|')
            if len(parts) == 5:  # | num | path | cat | dbs |
                # Add E2E column (empty for most files)
                file_path_match = re.search(r'`([^`]+)`', line)
                if file_path_match:
                    fp = file_path_match.group(1)
                    e2e_value = ""
                    for key, value in e2e_changes.items():
                        if key in fp:
                            e2e_value = value
                            break
                    new_line = f"{parts[0]} | {parts[1]} | {parts[2]} | {parts[3]} | {e2e_value} |"
                    new_lines.append(new_line)
                    continue
        
        # Check if we've left the table (empty line or new section)
        if in_table and (line.strip() == '' or line.startswith('###') or line.startswith('##')):
            in_table = False
        
        new_lines.append(line)
    
    # Write updated content
    new_content = '\n'.join(new_lines)
    file_path.write_text(new_content, encoding='utf-8')
    
    print("✅ Added E2E column to COMPLETE_FILE_LIST.md")
    print("   Column shows changes made during this session")

if __name__ == "__main__":
    add_e2e_column()
