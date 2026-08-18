#!/usr/bin/env python3
"""
STANDALONE PERMANENT DOMAIN AGENT FOR JAYTIBIRTHDAY.IN
No Flask dependencies needed - uses built-in HTTP server
"""

import json
import time
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading
import os
from pathlib import Path

class DomainLetterAgent:
    """Core agent logic without external dependencies"""
    
    def __init__(self):
        self.domain = "jaytibirthday.in"
        self.start_time = datetime.now()
        
        # Domain knowledge base
        self.knowledge = {
            "domain_type": "birthday_website",
            "mission": "Celebrate birthdays with personalized messages",
            "templates": {
                "birthday": {
                    "subject": "🎂 Happy Birthday from {domain}!",
                    "greeting": "Dear {recipient},",
                    "body": """We're so excited to celebrate your special day with you!

On this wonderful occasion, we want to send our warmest wishes for happiness, health, and success.

May your birthday be filled with joy and wonderful memories.""",
                    "closing": "Happy Birthday!\nThe {domain} Team",
                    "tone": "Celebratory, warm, enthusiastic"
                },
                "domain_update": {
                    "subject": "📢 Update from {domain}",
                    "greeting": "Hello {recipient},",
                    "body": """We have some important updates to share about {domain}.

Our team has been working hard to improve your experience and add new features.

We appreciate your continued support!""",
                    "closing": "Best regards,\nThe {domain} Team",
                    "tone": "Informative, professional, friendly"
                },
                "welcome": {
                    "subject": "👋 Welcome to {domain}!",
                    "greeting": "Welcome {recipient},",
                    "body": """We're thrilled to have you join our community at {domain}!

Here, we celebrate birthdays and special occasions with personalized messages.

We hope you enjoy your experience with us!""",
                    "closing": "Welcome aboard!\nThe {domain} Team",
                    "tone": "Welcoming, friendly, warm"
                }
            }
        }
    
    def generate_letter(self, letter_type="birthday", recipient="Friend", custom_message=""):
        """Generate a domain-specific letter"""
        template = self.knowledge["templates"].get(letter_type, self.knowledge["templates"]["birthday"])
        
        content = f"""{template['greeting'].format(recipient=recipient)}

{template['body'].format(domain=self.domain)}

{custom_message if custom_message else ""}

{template['closing'].format(domain=self.domain)}"""
        
        result = {
            "domain": self.domain,
            "agent_version": "1.0.0",
            "letter_type": letter_type,
            "recipient": recipient,
            "subject": template['subject'].format(domain=self.domain),
            "content": content,
            "tone": template['tone'],
            "generated_at": datetime.now().isoformat(),
            "word_count": len(content.split()),
            "char_count": len(content),
            "status": "generated"
        }
        
        # Save the generated letter
        self._save_letter(result)
        return result
    
    def _save_letter(self, letter):
        """Save generated letter to file"""
        save_dir = Path("generated_letters")
        save_dir.mkdir(exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{self.domain}_{letter['letter_type']}_{timestamp}.json"
        filepath = save_dir / filename
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(letter, f, indent=2)
        
        # Log the generation
        log_entry = {
            "action": "letter_generated",
            "timestamp": datetime.now().isoformat(),
            "file": str(filepath),
            "type": letter['letter_type'],
            "recipient": letter['recipient']
        }
        
        log_file = Path("agent_logs.json")
        logs = []
        if log_file.exists():
            try:
                with open(log_file, 'r', encoding='utf-8') as f:
                    logs = json.load(f)
            except:
                logs = []
        
        logs.append(log_entry)
        with open(log_file, 'w', encoding='utf-8') as f:
            json.dump(logs, f, indent=2)
    
    def get_stats(self):
        """Get agent statistics"""
        generated_dir = Path("generated_letters")
        letters_count = len(list(generated_dir.glob("*.json"))) if generated_dir.exists() else 0
        
        return {
            "domain": self.domain,
            "agent_status": "running",
            "started_at": self.start_time.isoformat(),
            "uptime_seconds": (datetime.now() - self.start_time).seconds,
            "letters_generated": letters_count,
            "templates_available": len(self.knowledge["templates"]),
            "letter_types": list(self.knowledge["templates"].keys())
        }

class AgentHTTPHandler(BaseHTTPRequestHandler):
    """HTTP handler for the agent API"""
    
    def __init__(self, *args, **kwargs):
        self.agent = DomainLetterAgent()
        super().__init__(*args, **kwargs)
    
    def do_GET(self):
        """Handle GET requests"""
        if self.path == "/" or self.path == "/index":
            self._send_html_response(self._get_index_page())
        elif self.path == "/health":
            self._send_json_response({"status": "healthy", "domain": "jaytibirthday.in"})
        elif self.path == "/stats":
            self._send_json_response(self.agent.get_stats())
        elif self.path.startswith("/generate/"):
            parts = self.path.split("/")
            if len(parts) >= 3:
                letter_type = parts[2]
                # Get query parameters
                import urllib.parse
                query = urllib.parse.urlparse(self.path).query
                params = urllib.parse.parse_qs(query)
                recipient = params.get('recipient', ['Friend'])[0]
                
                letter = self.agent.generate_letter(letter_type, recipient)
                self._send_json_response(letter)
            else:
                self._send_error_response("Invalid generate path")
        else:
            self._send_error_response("Endpoint not found")
    
    def _send_json_response(self, data):
        """Send JSON response"""
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode('utf-8'))
    
    def _send_html_response(self, html):
        """Send HTML response"""
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(html.encode('utf-8'))
    
    def _send_error_response(self, message):
        """Send error response"""
        self.send_response(404)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode('utf-8'))
    
    def _get_index_page(self):
        """Generate HTML index page"""
        return f'''<!DOCTYPE html>
<html>
<head>
    <title>Jayti Birthday Permanent Agent</title>
    <style>
        body {{ font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; text-align: center; }}
        .status {{ background: #4CAF50; color: white; padding: 15px; border-radius: 5px; margin: 20px 0; }}
        .endpoints {{ background: #f8f9fa; padding: 20px; border-radius: 5px; }}
        a {{ color: #667eea; text-decoration: none; font-weight: bold; }}
        a:hover {{ text-decoration: underline; }}
        .example {{ background: #e3f2fd; padding: 15px; border-radius: 5px; margin: 15px 0; font-family: monospace; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>🎂 Jayti Birthday Permanent Agent</h1>
        <p>Domain: <strong>jaytibirthday.in</strong></p>
        <p>Status: <span style="color: #4CAF50;">● PERMANENTLY DEPLOYED</span></p>
    </div>
    
    <div class="status">
        ✅ Agent is running and ready to generate letters
    </div>
    
    <div class="endpoints">
        <h2>📡 API Endpoints</h2>
        <ul>
            <li><a href="/health" target="_blank">/health</a> - Health check</li>
            <li><a href="/stats" target="_blank">/stats</a> - Agent statistics</li>
            <li><a href="/generate/birthday" target="_blank">/generate/birthday</a> - Generate birthday letter</li>
            <li><a href="/generate/domain_update" target="_blank">/generate/domain_update</a> - Generate domain update</li>
            <li><a href="/generate/welcome" target="_blank">/generate/welcome</a> - Generate welcome letter</li>
        </ul>
        
        <h3>🎯 Example Usage</h3>
        <div class="example">
            Generate birthday letter: <a href="/generate/birthday?recipient=Jayti" target="_blank">/generate/birthday?recipient=Jayti</a>
        </div>
        
        <div class="example">
            Generate welcome letter: <a href="/generate/welcome?recipient=New+Visitor" target="_blank">/generate/welcome?recipient=New+Visitor</a>
        </div>
    </div>
    
    <div style="margin-top: 30px; padding: 20px; background: #fff3cd; border-radius: 5px;">
        <h3>🔧 Technical Details</h3>
        <p><strong>Agent Type:</strong> Standalone Python HTTP Server</p>
        <p><strong>Port:</strong> 5000</p>
        <p><strong>No Dependencies:</strong> Uses built-in Python modules only</p>
        <p><strong>Persistence:</strong> All letters saved to 'generated_letters/' directory</p>
        <p><strong>Logs:</strong> agent_logs.json</p>
    </div>
</body>
</html>'''

def run_agent_server():
    """Run the agent HTTP server"""
    print("=" * 70)
    print("🎂 JAYTI BIRTHDAY PERMANENT AGENT")
    print("Domain: jaytibirthday.in")
    print("=" * 70)
    print("\n🚀 Starting standalone agent server...")
    print(f"📡 Listening on: http://localhost:5000")
    print(f"📁 Data directory: {os.getcwd()}")
    print("\n🔧 Agent features:")
    print("  • No external dependencies")
    print("  • Built-in HTTP server")
    print("  • Automatic letter saving")
    print("  • JSON API endpoints")
    print("  • HTML web interface")
    print("\n🎯 Test URLs:")
    print("  http://localhost:5000")
    print("  http://localhost:5000/health")
    print("  http://localhost:5000/stats")
    print("  http://localhost:5000/generate/birthday?recipient=Jayti")
    print("\n" + "=" * 70)
    
    # Create necessary directories
    for directory in ["generated_letters", "agent_data"]:
        Path(directory).mkdir(exist_ok=True)
        print(f"✓ Created directory: {directory}")
    
    # Start server
    server = HTTPServer(('localhost', 5000), AgentHTTPHandler)
    print(f"\n✅ Agent server started successfully!")
    print(f"📊 Check stats at: http://localhost:5000/stats")
    print(f"💡 Press Ctrl+C to stop the server")
    print("\n" + "=" * 70)
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Agent server stopping...")
        server.server_close()
        print("✅ Agent stopped gracefully")

if __name__ == "__main__":
    run_agent_server()
