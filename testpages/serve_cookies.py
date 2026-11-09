"""Like `python -m http.server 8001`, but also sets one cookie in the response header.

Used to check that a cookie seen both in a Set-Cookie header and written by a script
(same host, same name) is counted once. Run from this folder:  python serve_cookies.py
"""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Set-Cookie", "itv_a=from-header; Path=/")
        super().end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8001), Handler).serve_forever()
