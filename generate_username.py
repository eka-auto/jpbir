#!/usr/bin/env python3
"""
Generate a new username for Helen Brown's database client.
"""
import uuid
import random
import string
from datetime import datetime

def generate_username(base_name="Helen Brown"):
    """Generate a new unique username."""
    # Extract first and last name
    parts = base_name.split()
    first = parts[0] if len(parts) > 0 else "User"
    last = parts[1] if len(parts) > 1 else ""
    
    # Generate options
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    short_uuid = str(uuid.uuid4())[:8]
    random_suffix = ''.join(random.choices(string.digits, k=6))
    
    options = [
        # Classic formats
        f"{first.lower()}.{last.lower()}{random_suffix}",
        f"{first.lower()}_{last.lower()}_{random_suffix}",
        f"{first[0].lower()}{last.lower()}{random_suffix}",
        
        # UUID-based
        f"{first.lower()}.{last.lower()}.{short_uuid}",
        f"hb_{short_uuid}",
        f"user_{short_uuid}",
        
        # Timestamp-based
        f"{first.lower()}.{last.lower()}.{timestamp}",
        f"helenbrown_{timestamp}",
        
        # Simple
        f"helen_brown_{random_suffix}",
        f"helenbrown{random_suffix}",
        f"hbrown_{random_suffix}",
        
        # Professional
        f"helen.brown{random_suffix}",
        f"h.brown_{random_suffix}",
        f"brown_helen_{random_suffix}",
    ]
    
    return options

if __name__ == "__main__":
    print("=" * 80)
    print("GENERATE NEW USERNAME")
    print("=" * 80)
    print()
    
    usernames = generate_username()
    
    print("Generated usernames for Helen Brown:\n")
    for i, username in enumerate(usernames, 1):
        print(f"  {i:2d}. {username}")
    
    print()
    print("=" * 80)
    print("Recommended: Pick a format and I'll update the database config")
    print("=" * 80)
