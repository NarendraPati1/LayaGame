"""Laya Neural Arena — Main Application Entry Point.
Run `python app.py` to start the arena and launch the browser.
"""

import sys
import time
import webbrowser
import threading
from backend.server import run_server

DEFAULT_PORT = 8080


def open_browser(port: int, delay: float = 1.2):
    time.sleep(delay)
    url = f"http://localhost:{port}"
    print(f"[+] Opening browser: {url}")
    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"[!] Could not open browser automatically: {e}")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else DEFAULT_PORT
    
    # Auto-open browser in background thread
    threading.Thread(target=open_browser, args=(port,), daemon=True).start()
    
    # Run the arena server
    run_server(port)


if __name__ == '__main__':
    main()
