#!/usr/bin/env python3
"""
Simple HTTP server to browse extracted Chrome data.
Run: python browse_data.py
Then open: http://localhost:8000/viewer.html
"""

import http.server
import socketserver
import json
import sqlite3
import pathlib
from urllib.parse import urlparse, parse_qs

PORT = 8080
DB_DIR = pathlib.Path(__file__).parent / 'output'

class ChromeDataHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        
        if parsed.path == '/api/chrome-data':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            # Load all data from databases
            all_history = []
            all_local_storage = []
            
            for db_file in DB_DIR.glob('chrome_data_*.db'):
                try:
                    conn = sqlite3.connect(db_file)
                    conn.row_factory = sqlite3.Row
                    cursor = conn.cursor()
                    
                    # Get history
                    cursor.execute('SELECT url, title, visit_time, source_device FROM history ORDER BY visit_time DESC')
                    for row in cursor.fetchall():
                        all_history.append({
                            'url': row['url'],
                            'title': row['title'],
                            'visit_time': row['visit_time'],
                            'source_device': row['source_device']
                        })
                    
                    # Get local storage
                    cursor.execute('SELECT origin, key, value, source_device FROM local_storage')
                    for row in cursor.fetchall():
                        all_local_storage.append({
                            'origin': row['origin'],
                            'key': row['key'],
                            'value': row['value'],
                            'source_device': row['source_device']
                        })
                    
                    conn.close()
                except Exception as e:
                    print(f"Error reading {db_file}: {e}")
            
            response = {
                'history': all_history,
                'localStorage': all_local_storage
            }
            
            self.wfile.write(json.dumps(response).encode())
            return
        
        elif parsed.path == '/' or parsed.path == '/viewer.html':
            self.path = '/viewer.html'
            return http.server.SimpleHTTPRequestHandler.do_GET(self)
        
        return http.server.SimpleHTTPRequestHandler.do_GET(self)
    
    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {args[0]}")

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), ChromeDataHandler) as httpd:
        print(f"[+] Chrome Data Browser running at http://localhost:{PORT}")
        print(f"[+] View your data at: http://localhost:{PORT}/viewer.html")
        print(f"[+] Data directory: {DB_DIR.absolute()}")
        print(f"\nPress Ctrl+C to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[-] Server stopped")
