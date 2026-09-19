import time
from datetime import datetime, timedelta
from typing import Optional
import numpy as np
import pandas as pd
import requests


class InstitutionalFetcher:
    """法人籌碼資料抓取器（TWSE/TPEX API）"""

    TWSE_T86 = "https://www.twse.com.tw/rwd/zh/fund/T86"
    TWSE_MARGIN = "https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN"
    TWSE_SBL = "https://www.twse.com.tw/rwd/zh/SBL/TWT96U"
    TDCC_OPENDATA = "https://opendata.tdcc.com.tw/getOD.ashx"

    def __init__(self, rate_limit: float = 3.0):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        self.rate_limit = rate_limit
        self.last_request = 0

    def _throttle(self):
        elapsed = time.time() - self.last_request
        if elapsed < self.rate_limit:
            time.sleep(self.rate_limit - elapsed)
        self.last_request = time.time()

    @staticmethod
    def _safe_int(v) -> int:
        """安全轉換為整數（處理逗號和空值）"""
        if v is None or v == "" or v == "--":
            return 0
        try:
            return int(str(v).replace(",", "").strip())
        except (ValueError, TypeError):
            return 0

    @staticmethod
    def _safe_float(v) -> float:
        """安全轉換為浮點數"""
        if v is None or v == "" or v == "--":
            return 0.0
        try:
            return float(str(v).replace(",", "").strip())
        except (ValueError, TypeError):
            return 0.0

    def fetch_institutional(self, code: str, date_str: str) -> Optional[dict]:
        """抓取單日三大法人買賣超（T86 API）

        Args:
            code: 股票代碼
            date_str: 日期 YYYYMMDD 格式

        Returns:
            dict with institutional data or None
        """
        self._throttle()
        params = {"response": "json", "date": date_str, "selectType": "ALL"}
        try:
            resp = self.session.get(self.TWSE_T86, params=params, timeout=10)
            data = resp.json()

            if data.get("stat") != "OK" or not data.get("data"):
                return None

            # 搜尋目標股票
            for row in data["data"]:
                if row[0].strip() == code:
                    return {
                        "date": f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}",
                        "foreign_buy": self._safe_int(row[2]),
                        "foreign_sell": self._safe_int(row[3]),
                        "foreign_net": self._safe_int(row[4]),
                        "foreign_dealer_net": self._safe_int(row[7]),
                        "trust_buy": self._safe_int(row[8]),
                        "trust_sell": self._safe_int(row[9]),
                        "trust_net": self._safe_int(row[10]),
                        "dealer_self_net": self._safe_int(row[14]),
                        "dealer_hedge_net": self._safe_int(row[17]),
                        "dealer_net": self._safe_int(row[11]),
                        "total_institutional_net": self._safe_int(row[18]),
                    }
            return None
        except Exception:
            return None

    def fetch_market_institutional(self, date_str: str) -> Optional[dict]:
        """加總 TWSE T86 當日全市場三大法人買賣超。"""
        self._throttle()
        params = {"response": "json", "date": date_str, "selectType": "ALL"}
        try:
            response = self.session.get(self.TWSE_T86, params=params, timeout=10)
            data = response.json()
            rows = data.get("data", [])
            if data.get("stat") != "OK" or not rows:
                return None
            foreign_net = sum(self._safe_int(row[4]) for row in rows)
            trust_net = sum(self._safe_int(row[10]) for row in rows)
            dealer_net = sum(self._safe_int(row[11]) for row in rows)
            return {
                "date": f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}",
                "foreign_net": foreign_net,
                "trust_net": trust_net,
                "dealer_net": dealer_net,
                "total_institutional_net": sum(self._safe_int(row[18]) for row in rows),
                "stock_count": len(rows),
            }
        except (requests.RequestException, ValueError, KeyError, IndexError):
            return None

    def fetch_market_history(self, days: int = 20) -> pd.DataFrame:
        """抓取 TWSE 大盤三大法人歷史買賣超。"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        records = []
        current = start_date
        while current <= end_date:
            if current.weekday() < 5:
                record = self.fetch_market_institutional(current.strftime("%Y%m%d"))
                if record:
                    records.append(record)
            current += timedelta(days=1)
        if not records:
            return pd.DataFrame()
        df = pd.DataFrame(records)
        df["date"] = pd.to_datetime(df["date"])
        return df.sort_values("date").drop_duplicates("date").reset_index(drop=True)

    def fetch_margin(self, code: str, date_str: str) -> Optional[dict]:
        """抓取單日融資融券餘額（MI_MARGN API）

        Args:
            code: 股票代碼
            date_str: 日期 YYYYMMDD 格式

        Returns:
            dict with margin trading data or None
        """
        self._throttle()
        params = {"response": "json", "date": date_str, "selectType": "ALL"}
        try:
            resp = self.session.get(self.TWSE_MARGIN, params=params, timeout=10)
            data = resp.json()

            if data.get("stat") != "OK":
                return None

            # MI_MARGN tables[1] 含個股資料
            tables = data.get("tables", [])
            if len(tables) < 2:
                return None

            stock_table = tables[1]
            rows = stock_table.get("data", [])

            for row in rows:
                if row[0].strip() == code:
                    # 欄位: 股票代號, 股票名稱,
                    # 融資買進, 融資賣出, 融資現金償還, 融資前日餘額, 融資今日餘額, 融資限額
                    # 融券買進, 融券賣出, 融券現券償還, 融券前日餘額, 融券今日餘額, 融券限額
                    # 資券互抵
                    return {
                        "date": f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}",
                        "margin_buy": self._safe_int(row[2]),
                        "margin_sell": self._safe_int(row[3]),
                        "margin_cash_repay": self._safe_int(row[4]),
                        "margin_balance_prev": self._safe_int(row[5]),
                        "margin_balance": self._safe_int(row[6]),
                        "margin_limit": self._safe_int(row[7]),
                        "short_buy": self._safe_int(row[8]),
                        "short_sell": self._safe_int(row[9]),
                        "short_cash_repay": self._safe_int(row[10]),
                        "short_balance_prev": self._safe_int(row[11]),
                        "short_balance": self._safe_int(row[12]),
                        "short_limit": self._safe_int(row[13]),
                        "offset": self._safe_int(row[14]) if len(row) > 14 else 0,
                    }
            return None
        except Exception:
            return None

    def fetch_sbl(self, code: str, date_str: str) -> Optional[dict]:
        """抓取借券賣出餘額（SBL TWT96U API）

        Args:
            code: 股票代碼
            date_str: 日期 YYYYMMDD 格式

        Returns:
            dict with SBL data or None
        """
        self._throttle()
        params = {"response": "json", "date": date_str, "selectType": "ALL"}
        try:
            resp = self.session.get(self.TWSE_SBL, params=params, timeout=10)
            data = resp.json()

            if data.get("stat") != "OK" or not data.get("data"):
                return None

            for row in data["data"]:
                if row[0].strip() == code:
                    return {
                        "date": f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}",
                        "sbl_sell_balance": self._safe_int(row[12]) if len(row) > 12 else 0,
                        "sbl_buy_balance": self._safe_int(row[13]) if len(row) > 13 else 0,
                    }
            return None
        except Exception:
            return None

    def fetch_tdcc_concentration(self, code: str) -> Optional[dict]:
        """抓取集保分散表（TDCC 開放資料）

        Returns:
            dict with concentration ratios or None
        """
        self._throttle()
        try:
            # TDCC 開放資料 id=1-5 是集保戶股權分散表
            resp = self.session.get(
                self.TDCC_OPENDATA,
                params={"id": "1-5"},
                timeout=15,
            )
            if resp.status_code != 200:
                return None

            lines = resp.text.strip().split("\n")
            if len(lines) < 2:
                return None

            # 解析 CSV（欄位：資料日期,證券代號,持股/單位數分級,人數,股數/單位數,佔集保庫存數比例(%)）
            target_rows = []
            latest_date = None

            for line in lines[1:]:
                parts = line.strip().split(",")
                if len(parts) >= 6 and parts[1].strip().strip('"') == code:
                    target_rows.append(parts)
                    if latest_date is None:
                        latest_date = parts[0].strip().strip('"')

            if not target_rows:
                return None

            # 只取最新日期的資料
            latest_rows = [r for r in target_rows if r[0].strip().strip('"') == latest_date]

            total_shares = 0
            large_holder_shares = 0  # 持股 400 張以上（level >= 12）

            for row in latest_rows:
                level = row[2].strip().strip('"')
                shares = self._safe_int(row[4])
                total_shares += shares

                # 級距 12-17 通常代表 400 張以上的大戶
                try:
                    level_num = int(level)
                    if level_num >= 12:
                        large_holder_shares += shares
                except ValueError:
                    pass

            concentration = (large_holder_shares / total_shares * 100) if total_shares > 0 else 0

            return {
                "date": latest_date,
                "total_holders_shares": total_shares,
                "large_holder_shares": large_holder_shares,
                "concentration_pct": round(concentration, 2),
            }
        except Exception:
            return None

    def fetch_history(self, code: str, days: int = 180) -> pd.DataFrame:
        """批次抓取歷史籌碼資料（三大法人 + 融資融券）

        Args:
            code: 股票代碼
            days: 歷史天數

        Returns:
            DataFrame with all institutional data
        """
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)
        all_data = []

        current = start_date
        while current <= end_date:
            # 跳過週末
            if current.weekday() >= 5:
                current += timedelta(days=1)
                continue

            date_str = current.strftime("%Y%m%d")

            # 抓三大法人
            inst = self.fetch_institutional(code, date_str)
            if inst is None:
                current += timedelta(days=1)
                continue

            # 抓融資融券
            margin = self.fetch_margin(code, date_str)

            # 抓借券
            sbl = self.fetch_sbl(code, date_str)

            # 合併
            row = {
                "date": inst["date"],
                "foreign_buy": inst["foreign_buy"],
                "foreign_sell": inst["foreign_sell"],
                "foreign_net": inst["foreign_net"],
                "trust_buy": inst["trust_buy"],
                "trust_sell": inst["trust_sell"],
                "trust_net": inst["trust_net"],
                "dealer_net": inst["dealer_net"],
                "total_institutional_net": inst["total_institutional_net"],
            }

            if margin:
                row["margin_balance"] = margin["margin_balance"]
                row["short_balance"] = margin["short_balance"]
            else:
                row["margin_balance"] = 0
                row["short_balance"] = 0

            if sbl:
                row["sbl_balance"] = sbl["sbl_sell_balance"]
            else:
                row["sbl_balance"] = 0

            all_data.append(row)
            current += timedelta(days=1)

        if not all_data:
            return pd.DataFrame()

        df = pd.DataFrame(all_data)
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date").reset_index(drop=True)
        return df


class InstitutionalAnalyzer:
    """籌碼面分析"""

    def __init__(self, df: pd.DataFrame):
        """
        Args:
            df: 含籌碼資料的 DataFrame（由 InstitutionalFetcher.fetch_history 產出）
        """
        self.df = df.copy()

    def analyze(self) -> dict:
        """綜合籌碼分析"""
        if self.df.empty or len(self.df) < 5:
            return {"error": "籌碼資料不足（至少需 5 個交易日）"}

        result = {
            "summary": {},
            "foreign": self._analyze_foreign(),
            "trust": self._analyze_trust(),
            "dealer": self._analyze_dealer(),
            "margin": self._analyze_margin(),
            "signals": [],
            "score": 0,
        }

        # 綜合評分（0-100，50=中性）
        score = 50
        signals = []

        # 法人動向加分
        foreign = result["foreign"]
        if foreign["consecutive_buy_days"] >= 5:
            score += 15
            signals.append(("🟢", f"外資連買 {foreign['consecutive_buy_days']} 天，多方力道強"))
        elif foreign["consecutive_buy_days"] >= 3:
            score += 8
            signals.append(("🟢", f"外資連買 {foreign['consecutive_buy_days']} 天"))
        elif foreign["consecutive_sell_days"] >= 5:
            score -= 15
            signals.append(("🔴", f"外資連賣 {foreign['consecutive_sell_days']} 天，空方壓力大"))
        elif foreign["consecutive_sell_days"] >= 3:
            score -= 8
            signals.append(("🔴", f"外資連賣 {foreign['consecutive_sell_days']} 天"))

        trust = result["trust"]
        if trust["consecutive_buy_days"] >= 3:
            score += 10
            signals.append(("🟢", f"投信連買 {trust['consecutive_buy_days']} 天"))
        elif trust["consecutive_sell_days"] >= 3:
            score -= 10
            signals.append(("🔴", f"投信連賣 {trust['consecutive_sell_days']} 天"))

        # 融資融券訊號
        margin = result["margin"]
        if margin.get("margin_short_ratio", 0) > 30:
            score += 5
            signals.append(("🟢", f"券資比 {margin['margin_short_ratio']:.1f}% 偏高，可能有軋空潛力"))
        if margin.get("margin_change_5d_pct", 0) > 10:
            score -= 5
            signals.append(("🔴", f"融資 5 日增 {margin['margin_change_5d_pct']:.1f}%，散戶追高"))
        if margin.get("margin_change_5d_pct", 0) < -10:
            score += 3
            signals.append(("🟢", f"融資 5 日減 {abs(margin['margin_change_5d_pct']):.1f}%，籌碼沉澱"))

        # 外資 + 投信同方向加權
        if foreign["net_5d"] > 0 and trust["net_5d"] > 0:
            score += 5
            signals.append(("🟢", "外資＋投信同步買超"))
        elif foreign["net_5d"] < 0 and trust["net_5d"] < 0:
            score -= 5
            signals.append(("🔴", "外資＋投信同步賣超"))

        result["score"] = max(0, min(100, score))
        result["signals"] = signals

        # 研判
        if result["score"] >= 65:
            result["summary"]["overall"] = "籌碼偏多"
            result["summary"]["description"] = "法人明顯站買方，籌碼面支持做多"
        elif result["score"] >= 55:
            result["summary"]["overall"] = "籌碼中性偏多"
            result["summary"]["description"] = "法人小幅買超，籌碼面略偏正向"
        elif result["score"] <= 35:
            result["summary"]["overall"] = "籌碼偏空"
            result["summary"]["description"] = "法人明顯站賣方，籌碼面壓力沉重"
        elif result["score"] <= 45:
            result["summary"]["overall"] = "籌碼中性偏空"
            result["summary"]["description"] = "法人小幅賣超，籌碼面略偏負向"
        else:
            result["summary"]["overall"] = "籌碼中性"
            result["summary"]["description"] = "法人多空不明確，觀望為主"

        return result

    def _analyze_foreign(self) -> dict:
        """外資動向分析"""
        net = self.df["foreign_net"]
        return {
            "net_today": int(net.iloc[-1]),
            "net_5d": int(net.tail(5).sum()),
            "net_10d": int(net.tail(10).sum()),
            "net_20d": int(net.tail(20).sum()) if len(net) >= 20 else int(net.sum()),
            "consecutive_buy_days": self._consecutive_days(net, positive=True),
            "consecutive_sell_days": self._consecutive_days(net, positive=False),
            "avg_daily_net": int(net.tail(20).mean()) if len(net) >= 20 else int(net.mean()),
        }

    def _analyze_trust(self) -> dict:
        """投信動向分析"""
        net = self.df["trust_net"]
        return {
            "net_today": int(net.iloc[-1]),
            "net_5d": int(net.tail(5).sum()),
            "net_10d": int(net.tail(10).sum()),
            "net_20d": int(net.tail(20).sum()) if len(net) >= 20 else int(net.sum()),
            "consecutive_buy_days": self._consecutive_days(net, positive=True),
            "consecutive_sell_days": self._consecutive_days(net, positive=False),
        }

    def _analyze_dealer(self) -> dict:
        """自營商動向分析"""
        net = self.df["dealer_net"]
        return {
            "net_today": int(net.iloc[-1]),
            "net_5d": int(net.tail(5).sum()),
            "net_10d": int(net.tail(10).sum()),
        }

    def _analyze_margin(self) -> dict:
        """融資融券分析"""
        result = {}
        if "margin_balance" not in self.df.columns:
            return result

        margin = self.df["margin_balance"]
        short = self.df["short_balance"]

        result["margin_balance"] = int(margin.iloc[-1])
        result["short_balance"] = int(short.iloc[-1])

        # 券資比
        if margin.iloc[-1] > 0:
            result["margin_short_ratio"] = round(
                short.iloc[-1] / margin.iloc[-1] * 100, 2
            )
        else:
            result["margin_short_ratio"] = 0.0

        # 5 日融資變化率
        if len(margin) >= 6 and margin.iloc[-6] > 0:
            result["margin_change_5d_pct"] = round(
                (margin.iloc[-1] - margin.iloc[-6]) / margin.iloc[-6] * 100, 2
            )
        else:
            result["margin_change_5d_pct"] = 0.0

        # 5 日融券變化率
        if len(short) >= 6 and short.iloc[-6] > 0:
            result["short_change_5d_pct"] = round(
                (short.iloc[-1] - short.iloc[-6]) / short.iloc[-6] * 100, 2
            )
        else:
            result["short_change_5d_pct"] = 0.0

        return result

    @staticmethod
    def _consecutive_days(series: pd.Series, positive: bool = True) -> int:
        """計算從最近一天往回數的連續天數"""
        count = 0
        for val in series.iloc[::-1]:
            if positive and val > 0:
                count += 1
            elif not positive and val < 0:
                count += 1
            else:
                break
        return count


def create_institutional_features(inst_df: pd.DataFrame) -> pd.DataFrame:
    """從籌碼資料建立 ML 特徵

    Args:
        inst_df: InstitutionalFetcher.fetch_history 產出的 DataFrame

    Returns:
        DataFrame with engineered features (indexed by date)
    """
    df = inst_df.copy()
    if df.empty:
        return df

    df["date"] = pd.to_datetime(df["date"])

    # 法人買賣超累計
    for col in ["foreign_net", "trust_net", "dealer_net", "total_institutional_net"]:
        if col in df.columns:
            df[f"{col}_5d"] = df[col].rolling(5, min_periods=1).sum()
            df[f"{col}_10d"] = df[col].rolling(10, min_periods=1).sum()
            df[f"{col}_20d"] = df[col].rolling(20, min_periods=1).sum()

    # 法人連買/連賣天數（每日計算）
    df["foreign_streak"] = _streak_series(df["foreign_net"])
    df["trust_streak"] = _streak_series(df["trust_net"])

    # 融資融券變化
    if "margin_balance" in df.columns:
        df["margin_change"] = df["margin_balance"].pct_change()
        df["short_change"] = df["short_balance"].pct_change()
        # 券資比
        df["margin_short_ratio"] = np.where(
            df["margin_balance"] > 0,
            df["short_balance"] / df["margin_balance"],
            0,
        )
        # 融資餘額 5 日變化率
        df["margin_change_5d"] = df["margin_balance"].pct_change(5)
        df["short_change_5d"] = df["short_balance"].pct_change(5)

    # 借券餘額變化
    if "sbl_balance" in df.columns:
        df["sbl_change"] = df["sbl_balance"].pct_change()
        df["sbl_change_5d"] = df["sbl_balance"].pct_change(5)

    # 法人買賣超佔成交量比例（需要 volume 欄位，之後在合併時計算）

    return df


def _streak_series(series: pd.Series) -> pd.Series:
    """計算每日的連續正/負天數（正值=連買，負值=連賣）"""
    streak = pd.Series(0, index=series.index, dtype=int)
    for i in range(len(series)):
        if i == 0:
            if series.iloc[i] > 0:
                streak.iloc[i] = 1
            elif series.iloc[i] < 0:
                streak.iloc[i] = -1
        else:
            if series.iloc[i] > 0:
                streak.iloc[i] = max(1, streak.iloc[i - 1] + 1) if streak.iloc[i - 1] > 0 else 1
            elif series.iloc[i] < 0:
                streak.iloc[i] = min(-1, streak.iloc[i - 1] - 1) if streak.iloc[i - 1] < 0 else -1
    return streak


def summarize_market_institutional(df: pd.DataFrame) -> dict:
    """產出大盤法人買賣超摘要，重用既有的法人連買連賣統計。"""
    if df.empty or len(df) < 5:
        return {"error": "大盤法人資料不足（至少需 5 個交易日）"}
    analyzer = InstitutionalAnalyzer(df)
    result = analyzer.analyze()
    result["market"] = {
        "latest_date": str(df["date"].iloc[-1].date()),
        "stock_count": int(df["stock_count"].iloc[-1]) if "stock_count" in df else None,
        "latest_total_net": int(df["total_institutional_net"].iloc[-1]),
        "net_5d": int(df["total_institutional_net"].tail(5).sum()),
        "net_10d": int(df["total_institutional_net"].tail(10).sum()),
        "source": "TWSE T86 全市場加總；不含櫃買市場與券商分點主力資料。",
    }
    return result
