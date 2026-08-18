#!/usr/bin/env python3
"""
Permanent Domain Letter Agent for jaytibirthday.in
Run with: python simple_agent.py
"""

from flask import Flask, jsonify
from datetime import datetime
import json

app = Flask(__name__)

class JaytiBirthdayAgent:
    def __init__(self):
        self.domain = "jaytibirthday.in"
        self.templates = {
            "birthday": {
                "subject": "🎂 Happy Birthday Wishes from {domain}!",
                "greeting": "Dear {recipient},",
                "body": """Wishing you a day filled with happiness and joy!
                
On this special day, we want to celebrate you and all the wonderful things you bring to our community.

May your birthday be as amazing as you are!""",
                "closing": "Warm birthday wishes,\nThe {domain} Team",
                "tone": "Celebratory, warm"
            },
            "domain_update": {
                "subject": "📢 Important Update from {domain}",
                "greeting": "Hello {recipient},",
                "body": """We have some exciting updates to share about {domain}!

We've been working hard to improve your experience and want to keep you informed about what's new.

Thank you for being a valued part of our community!""",
                "closing": "Best regards,\nThe {domain} Team",
                "tone": "Informative, friendly"
            },
            "apology": {
                "subject": "🙏 Our Apologies from {domain}",
                "greeting": "Dear {recipient},",
                "body": """We sincerely apologize for any inconvenience you may have experienced.

We value you as part of our community and are committed to making things right.

Your satisfaction is important to us.""",
                "closing": "Sincerely,\nThe {domain} Team",
                "tone": "Apologetic, sincere"
            }
        }
    
    def generate(self, letter_type, recipient="Friend", custom_message=""):
        template = self.templates.get(letter_type, self.templates["birthday"])
        
        letter = f"""{template['greeting'].format(recipient=recipient)}

{template['body'].format(domain=self.domain)}

{custom_message if custom_message else ""}

{template['closing'].format(domain=self.domain)}"""
        
        return {
            "domain": self.domain,
            "letter_type": letter_type,
            "recipient": recipient,
            "subject": template['subject'].format(domain=self.domain),
            "content": letter,
            "tone": template['tone'],
            "generated_at": datetime.now().isoformat(),
            "word_count": len(letter.split())
        }

agent = JaytiBirthdayAgent()

@app.route('/')
def index():
    return '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Jayti Birthday Agent</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 40px; }
            .container { max-width: 600px; margin: 0 auto; }
            h1 { color: #e91e63; }
            .status { background: #4caf50; color: white; padding: 10px; border-radius: 5px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎂 Jayti Birthday Agent</h1>
            <div class="status">
                ✅ Permanent Agent is Running<br>
                📡 Ready to generate domain letters
            </div>
            <h2>API Endpoints:</h2>
            <ul>
                <li><a href="/health">/health</a> - Health check</li>
                <li><a href="/generate/birthday">/generate/birthday</a> - Generate birthday letter</li>
                <li><a href="/generate/update">/generate/update</a> - Generate domain update</li>
                <li><a href="/generate/apology">/generate/apology</a> - Generate apology letter</li>
                <li><a href="/stats">/stats</a> - Service statistics</li>
            </ul>
            <p>Test it: <a href="/generate/birthday?recipient=Jayti">Generate birthday letter for Jayti</a></p>
        </div>
    </body>
    </html>
    '''

@app.route('/health')
def health():
    return jsonify({
        "status": "healthy",
        "service": "Jayti Birthday Letter Agent",
        "domain": "jaytibirthday.in",
        "timestamp": datetime.now().isoformat(),
        "letter_templates": list(agent.templates.keys())
    })

@app.route('/generate/<letter_type>')
def generate(letter_type):
    recipient = request.args.get('recipient', 'Friend')
    result = agent.generate(letter_type, recipient)
    return jsonify(result)

@app.route('/stats')
def stats():
    return jsonify({
        "agent": "Jayti Birthday Agent",
        "domain": "jaytibirthday.in",
        "status": "permanent",
        "templates": len(agent.templates),
        "available_types": list(agent.templates.keys()),
        "deployed": True
    })

if __name__ == '__main__':
    print("🎯 JAYTI BIRTHDAY PERMANENT AGENT")
    print("==================================")
    print("Domain: jaytibirthday.in")
    print("Service: Letter Generation")
    print("Port: 5000")
    print("==================================")
    print("Starting server...")
    print("")
    print("🌐 Available at: http://localhost:5000")
    print("🏥 Health: http://localhost:5000/health")
    print("📊 Stats: http://localhost:5000/stats")
    print("")
    print("💡 Try these:")
    print("  http://localhost:5000/generate/birthday?recipient=Jayti")
    print("  http://localhost:5000/generate/update?recipient=Visitor")
    print("")
    app.run(host='0.0.0.0', port=5000, debug=True)
