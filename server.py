import http.server
import socketserver
import os
import sys

PORT = 8090
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.apk'):
            return 'application/vnd.android.package-archive'
        if path.endswith('.wasm'):
            return 'application/wasm'
        if path.endswith('.tflite'):
            return 'application/octet-stream'
        if path.endswith('.mjs') or path.endswith('.js'):
            return 'application/javascript'
        return super().guess_type(path)

    def log_message(self, format, *args):
        # Clean logging
        print(f"[{self.log_date_time_string()}] {args[0]} {args[1] if len(args)>1 else ''}")
        sys.stdout.flush()

class ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    server = ThreadingServer(("", PORT), Handler)
    print(f"Server running at http://localhost:{PORT}")
    print(f"Network URL: http://192.168.1.21:{PORT}")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except Exception as e:
        print("Server stopped:", e)
