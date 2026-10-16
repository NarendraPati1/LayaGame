"""Web Server for Laya Shooting Arena.
Serves frontend static assets and routes neural AI inference requests.
"""

import json
import mimetypes
import sys
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from .engine import LayaShooterEngine

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

_engine_instance = None

def get_engine():
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = LayaShooterEngine()
    return _engine_instance


class LayaArenaHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress routine access logs

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path in ('/', '/index.html'):
            self.serve_file(FRONTEND_DIR / 'index.html', 'text/html')
            return

        file_path = (FRONTEND_DIR / path.lstrip('/')).resolve()
        # Security check: ensure path is within FRONTEND_DIR
        if file_path.is_file() and FRONTEND_DIR.resolve() in file_path.parents:
            mime_type, _ = mimetypes.guess_type(str(file_path))
            self.serve_file(file_path, mime_type or 'application/octet-stream')
            return

        self.send_error(404, "Not found")

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/ai_decision':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8') if length > 0 else '{}'
            try:
                game_state = json.loads(body)
                engine = get_engine()
                result = engine.decide_shooter_move(game_state)
                self.send_json(result)
            except Exception as e:
                print(f"[!] /api/ai_decision error: {e}")
                self.send_json({'error': str(e)}, status=400)
            return

        self.send_error(404, "Endpoint not found")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def serve_file(self, file_path, content_type):
        try:
            with open(file_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Error reading file: {e}")


def run_server(port=8080):
    # Pre-initialize neural engine so CUDA weights load before listening
    get_engine()
    server = HTTPServer(('127.0.0.1', port), LayaArenaHandler)
    print(f"\n[+] Laya Shooting Arena running at: http://localhost:{port}")
    print("[+] Open the link in your browser to fight!\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        server.server_close()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    run_server(port)
