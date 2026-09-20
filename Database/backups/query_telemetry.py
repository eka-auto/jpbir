import json
from collections import defaultdict

def unmarshal_dynamodb_json(node):
    """Recursively parses DynamoDB-formatted JSON into standard Python dictionaries."""
    if isinstance(node, dict):
        if len(node) == 1:
            key = list(node.keys())[0]
            value = node[key]
            if key == 'S': return value
            if key == 'N': return float(value) if '.' in value else int(value)
            if key == 'BOOL': return value
            if key == 'NULL': return None
            if key == 'M': return unmarshal_dynamodb_json(value)
            if key == 'L': return [unmarshal_dynamodb_json(item) for item in value]
        # If it's a standard dict (not a single-key type descriptor), parse its children
        return {k: unmarshal_dynamodb_json(v) for k, v in node.items()}
    elif isinstance(node, list):
        return [unmarshal_dynamodb_json(item) for item in node]
    return node

def load_telemetry_data(filepath):
    """Loads the JSON backup and flattens the DynamoDB structure."""
    with open(filepath, 'r') as f:
        data = json.load(f)
    
    # DynamoDB exports typically store rows inside an "Items" array
    items = data.get('Items', [])
    return [unmarshal_dynamodb_json(item) for item in items]

def get_user_journey(data, session_id):
    """Returns all events for a specific session, sorted chronologically."""
    session_events = [item for item in data if item.get('sessionId') == session_id]
    return sorted(session_events, key=lambda x: x.get('epoch', 0))

def filter_by_event_type(data, event_type):
    """Filters telemetry items by a specific eventType (e.g., 'click', 'pageview')."""
    return [item for item in data if item.get('eventType') == event_type]

# --- Query Execution ---
if __name__ == "__main__":
    # Ensure this matches the filename in your repository
    filepath = 'dynamodb-telemetry-backup.json' 
    
    try:
        telemetry_data = load_telemetry_data(filepath)
        print(f"Successfully loaded {len(telemetry_data)} events.\n")

        # Query 1: Find all unique event types
        event_types = set(item.get('eventType') for item in telemetry_data if item.get('eventType'))
        print(f"Unique Event Types found: {event_types}\n")

        # Query 2: Reconstruct a user journey for a specific session
        target_session = "v_kubu9rwmj_msuoacjw" 
        print(f"--- User Journey for Session: {target_session} ---")
        journey = get_user_journey(telemetry_data, target_session)
        
        for event in journey:
            time = event.get('timestamp')
            e_type = event.get('eventType')
            url = event.get('pageUrl')
            
            # Print basic details
            output = f"[{time}] {e_type.upper()} -> {url}"
            
            # Append specific event data if it was a click
            if e_type == 'click' and 'eventData' in event:
                clicked_text = event['eventData'].get('text', 'Unknown Element')
                output += f" (Clicked: '{clicked_text}')"
                
            print(output)
            
    except FileNotFoundError:
        print(f"Error: Could not find '{filepath}'. Ensure it is in the same directory as this script.")