"""CLI View: formatting and terminal output only."""
import json


def show(*values, **kwargs):
    print(*values, **kwargs)


def show_json(value, **kwargs):
    options = {"ensure_ascii": False, "indent": 2, "default": str}
    options.update(kwargs)
    show(json.dumps(value, **options))
