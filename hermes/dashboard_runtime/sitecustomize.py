"""Dashboard-scoped MIME correction for Windows registry associations.

Loaded only when run.ps1/run.sh adds this directory to PYTHONPATH.
No registry, Hermes installation, or global configuration is changed.
"""
import mimetypes

mimetypes.init()
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/wasm", ".wasm")
