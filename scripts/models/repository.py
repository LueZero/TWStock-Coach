"""Project CSV/JSON persistence; all artifacts are constrained to data/."""
import json
from pathlib import Path

import pandas as pd

from ..common.paths import data_path, stock_code


def validate_history_code(df: pd.DataFrame, code: str) -> None:
    if "stock_code" not in df:
        return
    stored = {str(value).strip() for value in df["stock_code"].dropna().unique()}
    if stored and stored != {str(code).strip()}:
        raise ValueError(f"歷史資料代碼不符：要求 {code}，檔案標記為 {', '.join(sorted(stored))}")


def load_history(code, data_dir="data"):
    path = Path(data_path(data_dir, f"{stock_code(code)}_history.csv"))
    if not path.exists():
        return None
    df = pd.read_csv(path, parse_dates=["date"], dtype={"stock_code": str})
    validate_history_code(df, code)
    return df


def save_history(df, code, data_dir="data"):
    validate_history_code(df, code)
    return save_table(df, data_dir, f"{stock_code(code)}_history.csv")


def save_table(df, data_dir, filename):
    path = Path(data_path(data_dir, filename))
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
    return str(path)


def load_market_df(data_dir="data", market_code="0050"):
    if market_code is None:
        return None
    return load_history(market_code, data_dir)


def load_institutional_df(code, data_dir="data"):
    path = Path(data_path(data_dir, f"{stock_code(code)}_institutional.csv"))
    if not path.exists():
        return None
    return pd.read_csv(path, parse_dates=["date"])


def load_params(code, data_dir="data"):
    path = Path(data_path(data_dir, "models", f"{stock_code(code)}_best_params.json"))
    if not path.exists():
        return None, None
    return json.loads(path.read_text(encoding="utf-8")), str(path)


def load_params_file(path):
    if path is None:
        return None
    target = Path(data_path(path))
    return json.loads(target.read_text(encoding="utf-8")) if target.exists() else None


def save_params(params, code, data_dir="data"):
    path = Path(data_path(data_dir, "models", f"{stock_code(code)}_best_params.json"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(params, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path)
