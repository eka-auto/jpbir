# DOMAIN LETTER AGENT FOR jaytibirthday.in
# =========================================

"""
AI Agent that builds a knowledge base from domain-related content
and generates personalized letters for jaytibirthday.in
"""

import os
import json
from datetime import datetime

class DomainLetterAgent:
    """AI Agent for generating domain-specific letters"""
    
    def __init__(self, domain="jaytibirthday.in"):
        self.domain = domain
        self.knowledge_base = []
        self.letter_templates = []
        self.sentiment_data = {}
        
    def add_to_knowledge_base(self, content, source_type):
        """Add content to the knowledge base"""
        knowledge_entry = {
            "content": content,
            "source_type": source_type,
            "domain": self.domain,
            "timestamp": datetime.now().isoformat(),
            "processed": False
        }
        self.knowledge_base.append(knowledge_entry)
        print(f"✓ Added {source_type} content to knowledge base")
        return knowledge_entry
    
    def process_media_content(self, media_path):
        """Process media files (audio/video/images) for domain content"""
        print(f"Processing media: {media_path}")
        
        # Simulate media processing
        if media_path.endswith(('.mp3', '.wav', '.m4a')):
            content_type = "audio"
            extracted_text = f"Audio content from {os.path.basename(media_path)} related to {self.domain}"
        elif media_path.endswith(('.mp4', '.mov', '.avi')):
            content_type = "video"
            extracted_text = f"Video content from {os.path.basename(media_path)} related to {self.domain}"
        elif media_path.endswith(('.jpg', '.jpeg', '.png')):
            content_type = "image"
            extracted_text = f"Image content from {os.path.basename(media_path)} related to {self.domain}"
        else:
            content_type = "document"
            extracted_text = f"Document content from {os.path.basename(media_path)} related to {self.domain}"
        
        return self.add_to_knowledge_base(extracted_text, content_type)
    
    def process_text_content(self, text, source_name):
        """Process text content for the knowledge base"""
        print(f"Processing text: {source_name}")
        
        # Add domain context
        domain_context = f"[{self.domain} Context] {text}"
        return self.add_to_knowledge_base(domain_context, "text")
    
    def analyze_sentiment(self, content):
        """Analyze sentiment of content (simplified)"""
        sentiment_keywords = {
            "positive": ["happy", "joy", "celebration", "love", "birthday", "special"],
            "negative": ["sad", "miss", "regret", "sorry", "apology"],
            "neutral": ["information", "update", "notice", "announcement"]
        }
        
        content_lower = content.lower()
        sentiment_scores = {}
        
        for sentiment, keywords in sentiment_keywords.items():
            score = sum(1 for keyword in keywords if keyword in content_lower)
            sentiment_scores[sentiment] = score
        
        # Determine dominant sentiment
        dominant = max(sentiment_scores, key=sentiment_scores.get)
        
        self.sentiment_data = {
            "scores": sentiment_scores,
            "dominant_sentiment": dominant,
            "analysis_timestamp": datetime.now().isoformat()
        }
        
        print(f"✓ Sentiment analysis: {dominant} sentiment detected")
        return self.sentiment_data
    
    def generate_letter(self, recipient="Jayati", letter_type="birthday"):
        """Generate personalized letter based on knowledge base"""
        print(f"Generating {letter_type} letter for {recipient}...")
        
        # Get relevant knowledge
        relevant_knowledge = [kb for kb in self.knowledge_base if kb["processed"]]
        
        if not relevant_knowledge:
            relevant_knowledge = self.knowledge_base[:3]  # Use first 3 entries
        
        # Analyze overall sentiment
        all_content = " ".join([kb["content"] for kb in relevant_knowledge])
        sentiment = self.analyze_sentiment(all_content)
        
        # Generate letter based on type
        if letter_type == "birthday":
            letter = self._generate_birthday_letter(recipient, relevant_knowledge, sentiment)
        elif letter_type == "apology":
            letter = self._generate_apology_letter(recipient, relevant_knowledge, sentiment)
        elif letter_type == "update":
            letter = self._generate_update_letter(recipient, relevant_knowledge, sentiment)
        else:
            letter = self._generate_general_letter(recipient, relevant_knowledge, sentiment)
        
        # Mark knowledge as processed
        for kb in relevant_knowledge:
            kb["processed"] = True
        
        return letter
    
    def _generate_birthday_letter(self, recipient, knowledge, sentiment):
        """Generate birthday letter"""
        letter = f"""
Dear {recipient},

Happy Birthday! 🎉

On this special day for {self.domain}, I wanted to write you a personalized letter 
based on everything we've shared and experienced together.

{self._compile_memories(knowledge)}

The sentiment analysis shows a {sentiment['dominant_sentiment']} tone in our shared memories, 
which makes this birthday even more meaningful.

Wishing you the most wonderful birthday filled with joy, laughter, 
and beautiful new memories.

With warmest wishes,
Your {self.domain} Connection
"""
        return letter
    
    def _generate_apology_letter(self, recipient, knowledge, sentiment):
        """Generate apology letter"""
        letter = f"""
Dear {recipient},

I'm writing to you regarding {self.domain} with a sincere apology.

{self._compile_memories(knowledge)}

After analyzing our shared content, I detect a {sentiment['dominant_sentiment']} sentiment, 
which helps me understand the context better.

Please accept my heartfelt apologies for any misunderstandings or issues 
related to {self.domain}. I value our connection deeply.

Sincerely,
Your {self.domain} Connection
"""
        return letter
    
    def _compile_memories(self, knowledge):
        """Compile memories from knowledge base"""
        memories = []
        for i, kb in enumerate(knowledge[:3], 1):  # Use top 3 memories
            memories.append(f"Memory {i}: {kb['content'][:100]}...")
        
        return "\n".join(memories) if memories else "No specific memories compiled yet."
    
    def save_knowledge_base(self, filepath="domain_knowledge_base.json"):
        """Save knowledge base to file"""
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump({
                "domain": self.domain,
                "knowledge_base": self.knowledge_base,
                "sentiment_data": self.sentiment_data,
                "saved_at": datetime.now().isoformat()
            }, f, indent=2)
        
        print(f"✓ Knowledge base saved to {filepath}")
        return filepath
    
    def load_knowledge_base(self, filepath="domain_knowledge_base.json"):
        """Load knowledge base from file"""
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                self.knowledge_base = data.get("knowledge_base", [])
                self.sentiment_data = data.get("sentiment_data", {})
                print(f"✓ Knowledge base loaded from {filepath}")
                return True
        print(f"✗ Knowledge base file not found: {filepath}")
        return False

# Example usage
def main():
    """Example usage of the Domain Letter Agent"""
    print("=" * 50)
    print("DOMAIN LETTER AGENT FOR jaytibirthday.in")
    print("=" * 50)
    
    # Create agent
    agent = DomainLetterAgent(domain="jaytibirthday.in")
    
    # Add some sample content to knowledge base
    agent.process_text_content(
        "Remember the birthday celebration we had last year for Jayati's birthday",
        "birthday_memory_1"
    )
    
    agent.process_text_content(
        "The website analytics show increased engagement on special occasions",
        "analytics_data"
    )
    
    agent.process_text_content(
        "User feedback mentions emotional connections through personalized messages",
        "user_feedback"
    )
    
    # Generate a letter
    letter = agent.generate_letter(
        recipient="Jayati",
        letter_type="birthday"
    )
    
    print("\n" + "=" * 50)
    print("GENERATED LETTER:")
    print("=" * 50)
    print(letter)
    
    # Save knowledge base
    agent.save_knowledge_base()
    
    print("\n" + "=" * 50)
    print("AGENT READY FOR DOMAIN LETTER GENERATION!")
    print("=" * 50)

if __name__ == "__main__":
    main()
