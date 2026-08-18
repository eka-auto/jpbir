#!/usr/bin/env python3
"""
SIMPLIFIED PERMANENT AGENT - WORKING VERSION
"""

import json
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

class WorkingAgent:
    def __init__(self):
        self.domain = "jaytibirthday.in"
        self.letters_generated = 0
        
    def generate(self, letter_type, recipient):
        letters = {
            "birthday": f"""Dear {recipient},

🎂 Happy Birthday from {self.domain}!

We're thrilled to celebrate your special day with you. 
May this birthday bring you joy, laughter, and wonderful memories.

Warmest wishes from the {self.domain} team!""",
            
            "update": f"""Hello {recipient},

📢 Important Update from {self.domain}

We've been working on exciting improvements to enhance your experience.
Thank you for being part of our journey!

Best regards,
The {self.domain} Team""",
            
            "welcome": f"""Welcome {recipient},

👋 Greetings from {self.domain}!

We're excited to have you join our community. 
Here at {self.domain}, we celebrate special moments and connections.

Looking forward to celebrating with you!

Cheers,
The {self.domain} Team"""
        }
        
        content = letters.get(letter_type, letters["birthday"])
        self.letters_generated += 1
        
        result = {
            "domain": self.domain,
            "letter_type": letter_type,
            "recipient": recipient,
            "content": content,
            "generated_at": datetime.now().isoformat(),
            "letter_number": self.letters_generated
        }
        
        # Save it
        import os
        os.makedirs("generated_letters", exist_ok=True)
        filename = f"{self.domain}_{letter_type}_{recipient}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(f"generated_letters/{filename}", "w") as f:
            json.dump(result, f, indent=2)
        
        return result

class SimpleHandler(BaseHTTPRequestHandler):
    agent = WorkingAgent()
    
    def do_GET(self):
        # Parse the path
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        
        # Set response headers
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        # Handle different endpoints
        if path == "/" or path == "/index":
            response = {"message": "Jayti Birthday Agent", "domain": "jaytibirthday.in", "status": "running"}
        
        elif path == "/health":
            response = {"status": "healthy", "domain": "jaytibirthday.in", "timestamp": datetime.now().isoformat()}
        
        elif path == "/stats":
            response = {
                "domain": "jaytibirthday.in",
                "letters_generated": self.agent.letters_generated,
                "status": "permanent",
                "endpoints": ["/health", "/generate/:type", "/stats"]
            }
        
        elif path.startswith("/generate/"):
            # Extract letter type from path
            letter_type = path.split("/")[-1] if len(path.split("/")) > 2 else "birthday"
            
            # Parse query parameters
            query_params = urllib.parse.parse_qs(parsed.query)
            recipient = query_params.get('recipient', ['Friend'])[0]
            
            # Generate letter
            response = self.agent.generate(letter_type, recipient)
        
        else:
            response = {"error": "Endpoint not found", "available_endpoints": ["/health", "/generate/:type", "/stats"]}
        
        # Send response
        self.wfile.write(json.dumps(response, indent=2).encode('utf-8'))

def run():
    print("=" * 60)
    print("🎂 JAYTI BIRTHDAY AGENT - WORKING VERSION")
    print("Domain: jaytibirthday.in")
    print("=" * 60)
    print("\n🚀 Starting server on port 5001...")
    print("📡 Endpoints:")
    print("  • http://localhost:5001/health")
    print("  • http://localhost:5001/stats")
    print("  • http://localhost:5001/generate/birthday?recipient=Jayti")
    print("  • http://localhost:5001/generate/update?recipient=Visitor")
    print("  • http://localhost:5001/generate/welcome?recipient=NewUser")
    print("\n✅ Agent is permanently deployed!")
    print("💾 Letters saved to: generated_letters/")
    print("=" * 60)
    
    server = HTTPServer(('localhost', 5001), SimpleHandler)
    server.serve_forever()

if __name__ == "__main__":
    run()
