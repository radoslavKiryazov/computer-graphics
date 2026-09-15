from http.server import test, SimpleHTTPRequestHandler

class Handler(SimpleHTTPRequestHandler):
    extensions_map = SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map[".wgsl"] = "text/plain"

test(HandlerClass=Handler)