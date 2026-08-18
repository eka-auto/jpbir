#!/usr/bin/env python3
"""
Test script for the permanent agent
"""

import urllib.request
import json
import time

def test_agent():
    base_url = "http://localhost:5000"
    
    print("🔍 Testing Jayti Birthday Permanent Agent")
    print("=" * 50)
    
    # Test 1: Health check
    try:
        print("1. Testing health endpoint...")
        with urllib.request.urlopen(f"{base_url}/health") as response:
            data = json.load(response)
            print(f"   ✅ Status: {data['status']}")
            print(f"   ✅ Domain: {data['domain']}")
    except Exception as e:
        print(f"   ❌ Health check failed: {e}")
        return
    
    # Test 2: Generate birthday letter
    try:
        print("\n2. Generating birthday letter...")
        url = f"{base_url}/generate/birthday?recipient=Jayti"
        with urllib.request.urlopen(url) as response:
            data = json.load(response)
            print(f"   ✅ Letter generated!")
            print(f"   👤 Recipient: {data['recipient']}")
            print(f"   📝 Type: {data['letter_type']}")
            print(f"   📏 Words: {data['word_count']}")
            print(f"   📐 Chars: {data['char_count']}")
            
            # Show first 100 chars of content
            preview = data['content'][:100] + "..." if len(data['content']) > 100 else data['content']
            print(f"   📄 Preview: {preview}")
    except Exception as e:
        print(f"   ❌ Generate failed: {e}")
    
    # Test 3: Check stats
    try:
        print("\n3. Checking agent stats...")
        with urllib.request.urlopen(f"{base_url}/stats") as response:
            data = json.load(response)
            print(f"   📊 Letters generated: {data['letters_generated']}")
            print(f"   🕒 Uptime: {data['uptime_seconds']} seconds")
            print(f"   📋 Templates: {data['templates_available']}")
    except Exception as e:
        print(f"   ❌ Stats failed: {e}")
    
    # Test 4: Check web interface
    try:
        print("\n4. Checking web interface...")
        with urllib.request.urlopen(base_url) as response:
            html = response.read().decode('utf-8')
            if "<title>Jayti Birthday Permanent Agent</title>" in html:
                print("   ✅ Web interface is accessible")
                print(f"   🌐 Open: {base_url}")
            else:
                print("   ⚠️  Web interface returned unexpected content")
    except Exception as e:
        print(f"   ❌ Web interface failed: {e}")
    
    print("\n" + "=" * 50)
    print("🎯 TEST COMPLETE")
    print("=" * 50)
    print("\n💡 To use the agent:")
    print(f"   Web Interface: {base_url}")
    print(f"   Birthday Letter: {base_url}/generate/birthday?recipient=YourName")
    print(f"   Domain Update: {base_url}/generate/domain_update?recipient=Visitor")
    print(f"   Welcome Letter: {base_url}/generate/welcome?recipient=NewUser")

if __name__ == "__main__":
    print("Waiting 2 seconds for agent to be ready...")
    time.sleep(2)
    test_agent()
