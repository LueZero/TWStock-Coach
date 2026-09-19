"""Resolve project artifacts inside data/, independently of the working directory."""
from pathlib import Path
import re

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = PROJECT_ROOT / "data"


def data_path(path="data", *parts):
    """Resolve repo-relative paths and reject traversal or symlink escapes."""
    target = Path(path).expanduser()
    if not target.is_absolute():
        target = PROJECT_ROOT / target
    target = target.joinpath(*parts).resolve()
    # Keep the boundary lexical: data itself must not point outside the repo.
    if not target.is_relative_to(DATA_ROOT):
        raise ValueError(f"Output/data path must be inside {DATA_ROOT}: {target}")
    return str(target)


def stock_code(value):
    """Stock identifiers must not introduce path components."""
    if not re.fullmatch(r"[A-Za-z0-9]+", value):
        raise ValueError("Stock code must contain only ASCII letters and digits")
    return value
