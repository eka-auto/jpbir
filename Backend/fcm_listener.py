#!/usr/bin/env python3
"""
FCM Listener for Termux on Samsung S24
Listens for FCM data messages and executes trigger_s24_full_export.py when received.
"""

import os
import sys
import subprocess
import time
import logging
from pathlib import Path

# Try to import firebase_messaging, if not installed, log it
try:
    from firebase_messaging import FirebaseMessaging
except ImportError:
    FirebaseMessaging = None

# Configure logging
LOG_DIR = Path.home() / ".local/state/eka"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "fcm_listener.log"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(str(LOG_FILE)),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Resolve service account key path relative to this script
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
SERVICE_ACCOUNT_PATH = ROOT_DIR / "serviceAccountKey.json"

# Default FCM Sender ID (can be overridden by environment variable)
FCM_SENDER_ID = os.environ.get("FCM_SENDER_ID", "YOUR_FCM_SENDER_ID")

class FCMListener:
    def __init__(self):
        self.fcm = None
        self.running = True
        
    def initialize(self):
        """Initialize FCM connection"""
        if FirebaseMessaging is None:
            logger.error("❌ The 'firebase-messaging' package is not installed. Please run: pip install firebase-messaging")
            return False
            
        try:
            if SERVICE_ACCOUNT_PATH.exists():
                logger.info(f"Using service account key at {SERVICE_ACCOUNT_PATH}")
                self.fcm = FirebaseMessaging(
                    service_account_file=str(SERVICE_ACCOUNT_PATH),
                    sender_id=FCM_SENDER_ID
                )
            else:
                logger.warning(f"⚠️ Service account key not found at {SERVICE_ACCOUNT_PATH}. Trying default credentials...")
                self.fcm = FirebaseMessaging(sender_id=FCM_SENDER_ID)
            
            logger.info("✅ FCM initialized successfully")
            return True
        except Exception as e:
            logger.error(f"❌ FCM initialization failed: {e}")
            return False
    
    def on_message(self, message):
        """Callback when a message is received"""
        try:
            logger.info(f"📨 Received FCM message: {message}")
            
            # Extract data from the message
            data = message.get('data', {})
            command = data.get('command', '')
            command_id = data.get('commandId', '')
            script = data.get('script', 'trigger_s24_full_export.py')
            
            if command == 'run_sync':
                script_path = ROOT_DIR / script
                if not script_path.exists():
                    # Fallback to current directory or home directory
                    script_path = Path.home() / script
                    if not script_path.exists():
                        script_path = SCRIPT_DIR / script
                        
                logger.info(f"🚀 Executing command {command_id}: {script_path}")
                
                # Execute the script
                result = subprocess.run(
                    ['python3', str(script_path)],
                    capture_output=True,
                    text=True,
                    timeout=300  # 5 minute timeout
                )
                
                logger.info(f"✅ Script output: {result.stdout}")
                if result.stderr:
                    logger.error(f"⚠️ Script stderr: {result.stderr}")
            else:
                logger.warning(f"⚠️ Unknown command: {command}")
                
        except subprocess.TimeoutExpired:
            logger.error("❌ Script execution timed out")
        except Exception as e:
            logger.error(f"❌ Error processing message: {e}")
    
    def listen(self):
        """Start listening for FCM messages"""
        if not self.fcm:
            logger.error("❌ FCM not initialized")
            return
        
        logger.info("👂 Listening for FCM messages...")
        
        try:
            self.fcm.listen(self.on_message)
        except KeyboardInterrupt:
            logger.info("🛑 Stopping listener...")
            self.running = False
        except Exception as e:
            logger.error(f"❌ FCM listen error: {e}")
            # Attempt to reconnect after a delay
            time.sleep(10)
            self.listen()

if __name__ == "__main__":
    listener = FCMListener()
    if listener.initialize():
        listener.listen()
    else:
        logger.error("❌ Failed to start FCM listener")
        sys.exit(1)
