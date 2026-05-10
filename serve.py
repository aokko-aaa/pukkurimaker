#!/usr/bin/env python3
import http.server, socketserver, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()
    def log_message(self, format, *args):
        pass  # ログを静かに

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
with socketserver.TCPServer(('', port), Handler) as httpd:
    print(f'サーバー起動中: http://localhost:{port}')
    httpd.serve_forever()
