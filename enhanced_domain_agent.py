# ENHANCED DOMAIN LETTER AGENT WITH WEBSITE CONTENT
# =================================================

import os
import json
from datetime import datetime

class EnhancedDomainLetterAgent:
    """Enhanced agent that reads actual website content"""
    
    def __init__(self, domain="jaytibirthday.in", website_path="jaytibirthday-site"):
        self.domain = domain
        self.website_path = website_path
        self.knowledge_base = []
        self.website_content = ""
        
    def extract_website_content(self):
        """Extract content from the actual website files"""
        print(f"📄 Extracting content from {self.website_path}...")
        
        content_parts = []
        
        # Check for website directory
        if os.path.exists(self.website_path):
            # Read index.html
            index_path = os.path.join(self.website_path, "index.html")
            if os.path.exists(index_path):
                with open(index_path, 'r', encoding='utf-8') as f:
                    html_content = f.read()
                    # Extract text content (simplified)
                    text_content = self._extract_text_from_html(html_content)
                    content_parts.append({
                        "source": "index.html",
                        "content": text_content[:500] + "..." if len(text_content) > 500 else text_content,
                        "type": "website_content"
                    })
                    self.website_content = text_content
            
            # Look for other HTML files
            html_files = []
            for root, dirs, files in os.walk(self.website_path):
                for file in files:
                    if file.endswith('.html'):
                        html_files.append(os.path.join(root, file))
            
            print(f"✓ Found {len(html_files)} HTML files")
            
            # Add to knowledge base
            for content in content_parts:
                self.knowledge_base.append({
                    "content": content["content"],
                    "source": content["source"],
                    "type": content["type"],
                    "domain": self.domain,
                    "extracted_at": datetime.now().isoformat()
                })
            
            return content_parts
        else:
            print(f"✗ Website directory not found: {self.website_path}")
            return []
    
    def _extract_text_from_html(self, html_content):
        """Simple HTML text extraction"""
        # Remove script and style tags
        import re
        cleaned = re.sub(r'<script.*?</script>', '', html_content, flags=re.DOTALL)
        cleaned = re.sub(r'<style.*?</style>', '', cleaned, flags=re.DOTALL)
        cleaned = re.sub(r'<[^>]+>', ' ', cleaned)  # Remove all HTML tags
        cleaned = re.sub(r'\s+', ' ', cleaned)  # Normalize whitespace
        return cleaned.strip()
    
    def add_analytics_context(self, analytics_data):
        """Add analytics data context"""
        print("📊 Adding analytics context...")
        
        analytics_context = {
            "domain": self.domain,
            "analytics_active": True,
            "dashboard_url": "http://localhost:3001/dashboard",
            "tracking_script": "jaytibirthday-analytics.js",
            "data_points": analytics_data if analytics_data else ["visitor_count", "engagement_metrics", "time_spent"],
            "added_at": datetime.now().isoformat()
        }
        
        self.knowledge_base.append({
            "content": f"Analytics system tracking {self.domain} visitors",
            "source": "analytics_system",
            "type": "analytics_context",
            "metadata": analytics_context,
            "domain": self.domain,
            "added_at": datetime.now().isoformat()
        })
        
        print("✓ Analytics context added to knowledge base")
        return analytics_context
    
    def generate_domain_letter(self, letter_type="domain_update"):
        """Generate letter specifically about the domain"""
        print(f"✍️  Generating {letter_type} letter for {self.domain}...")
        
        # Compile domain knowledge
        domain_knowledge = []
        for kb in self.knowledge_base:
            if kb["type"] in ["website_content", "analytics_context"]:
                domain_knowledge.append(kb)
        
        if not domain_knowledge:
            print("⚠️  No domain knowledge found. Using template.")
            domain_knowledge = [{
                "content": f"Content related to {self.domain}",
                "source": "template",
                "type": "template_content"
            }]
        
        # Generate letter based on type
        if letter_type == "domain_update":
            letter = self._generate_domain_update_letter(domain_knowledge)
        elif letter_type == "analytics_report":
            letter = self._generate_analytics_report_letter(domain_knowledge)
        elif letter_type == "birthday_anniversary":
            letter = self._generate_birthday_anniversary_letter(domain_knowledge)
        else:
            letter = self._generate_general_domain_letter(domain_knowledge)
        
        return letter
    
    def _generate_domain_update_letter(self, knowledge):
        """Generate domain update letter"""
        letter = f"""
DOMAIN UPDATE: {self.domain}
Date: {datetime.now().strftime('%Y-%m-%d')}

Dear Domain Stakeholder,

I'm writing to provide an update on {self.domain}, the personalized birthday website.

CURRENT STATUS:
• Website: Active and accessible at https://{self.domain}
• Analytics: Tracking system deployed and collecting visitor data
• Content: Personalized letter format with emotional tone
• Technology: Modern web standards with JavaScript analytics integration

RECENT DEVELOPMENTS:
{self._compile_domain_updates(knowledge)}

NEXT STEPS:
1. Continue monitoring analytics for visitor engagement
2. Enhance personalization based on collected data
3. Expand content while maintaining emotional authenticity
4. Integrate additional AI capabilities for dynamic content

The {self.domain} project remains focused on creating meaningful, 
personalized digital experiences centered around birthdays and celebrations.

Best regards,
{self.domain} Management System
"""
        return letter
    
    def _compile_domain_updates(self, knowledge):
        """Compile domain updates from knowledge"""
        updates = []
        for i, kb in enumerate(knowledge[:3], 1):
            source = kb.get("source", "unknown")
            content_preview = kb["content"][:80] + "..." if len(kb["content"]) > 80 else kb["content"]
            updates.append(f"{i}. From {source}: {content_preview}")
        
        return "\n".join(updates) if updates else "No specific updates compiled yet."
    
    def save_domain_report(self, letter, report_type="domain_update"):
        """Save generated letter as domain report"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{self.domain}_{report_type}_{timestamp}.txt"
        
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(letter)
        
        print(f"✅ Domain report saved: {filename}")
        return filename

def main():
    """Test the enhanced domain letter agent"""
    print("=" * 60)
    print(f"ENHANCED DOMAIN LETTER AGENT: jaytibirthday.in")
    print("=" * 60)
    
    # Create agent
    agent = EnhancedDomainLetterAgent(
        domain="jaytibirthday.in",
        website_path="jaytibirthday-site"
    )
    
    # Extract website content
    website_content = agent.extract_website_content()
    
    # Add analytics context
    analytics_data = {
        "visitor_count": "tracking enabled",
        "dashboard": "http://localhost:3001/dashboard",
        "email_reports": "ekaaiurgaa@gmail.com"
    }
    agent.add_analytics_context(analytics_data)
    
    # Generate domain update letter
    print("\n" + "-" * 40)
    print("GENERATING DOMAIN UPDATE LETTER...")
    print("-" * 40)
    
    domain_letter = agent.generate_domain_letter(letter_type="domain_update")
    
    print("\n" + "=" * 60)
    print("DOMAIN UPDATE LETTER:")
    print("=" * 60)
    print(domain_letter)
    
    # Save the report
    saved_file = agent.save_domain_report(domain_letter, "domain_update")
    
    print("\n" + "=" * 60)
    print(f"AGENT COMPLETE! Report saved as: {saved_file}")
    print("=" * 60)
    
    # Show knowledge base summary
    print(f"\nKnowledge Base Summary:")
    print(f"• Total entries: {len(agent.knowledge_base)}")
    for kb in agent.knowledge_base:
        print(f"  - {kb['type']}: {kb['source']}")

if __name__ == "__main__":
    main()
