from flask import Flask, request, jsonify
import json
from datetime import datetime

app = Flask(__name__)

class DomainLetterAgent:
    def __init__(self, domain="jaytibirthday.in"):
        self.domain = domain
    
    def generate_letter(self, letter_type, recipient):
        return {
            "domain": self.domain,
            "letter_type": letter_type,
            "recipient": recipient,
            "content": f"Generated letter for {recipient} regarding {self.domain}",
            "generated_at": datetime.now().isoformat()
        }

agent = DomainLetterAgent()

@app.route('/generate', methods=['POST'])
def generate():
    data = request.json
    letter_type = data.get('type', 'general')
    recipient = data.get('recipient', 'User')
    
    letter = agent.generate_letter(letter_type, recipient)
    return jsonify(letter)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "domain": "jaytibirthday.in",
        "timestamp": datetime.now().isoformat()
    })

@app.route('/docs', methods=['GET'])
def docs():
    return jsonify({
        "endpoints": {
            "POST /generate": "Generate a letter",
            "GET /health": "Health check",
            "GET /docs": "This documentation"
        }
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
