"""技術指標與價量結構的純計算 Model。"""
import numpy as np
import pandas as pd


class IndicatorCalculator:
    """以 OHLCV 日 K 資料計算技術指標，不負責交易建議。"""

    def __init__(self, df: pd.DataFrame):
        required_columns = {"open", "high", "low", "close", "volume"}
        missing_columns = required_columns - set(df.columns)
        if missing_columns:
            raise ValueError(f"缺少必要欄位: {', '.join(sorted(missing_columns))}")
        self.df = df.copy().reset_index(drop=True)

    def sma(self, periods=(5, 10, 20, 60)):
        return {
            f"MA{period}": round(self.df["close"].rolling(period).mean().iloc[-1], 2)
            for period in periods if len(self.df) >= period
        }

    def ema(self, periods=(12, 26)):
        return {
            f"EMA{period}": round(self.df["close"].ewm(span=period, adjust=False).mean().iloc[-1], 2)
            for period in periods if len(self.df) >= period
        }

    def _true_range(self):
        previous_close = self.df["close"].shift(1)
        return pd.concat([
            self.df["high"] - self.df["low"],
            (self.df["high"] - previous_close).abs(),
            (self.df["low"] - previous_close).abs(),
        ], axis=1).max(axis=1)

    def atr_series(self, period=14):
        return self._true_range().ewm(alpha=1 / period, adjust=False, min_periods=period).mean()

    def atr(self, period=14):
        if len(self.df) < period + 1:
            return {}
        value = self.atr_series(period).iloc[-1]
        price = self.df["close"].iloc[-1]
        return {"ATR": round(value, 2), "ATR_pct": round(value / price * 100, 2) if price else 0}

    def kd(self, period=9):
        if len(self.df) < period:
            return {}
        lowest = self.df["low"].rolling(period).min()
        highest = self.df["high"].rolling(period).max()
        rsv = ((self.df["close"] - lowest) / (highest - lowest) * 100).replace([np.inf, -np.inf], np.nan)
        k_value = rsv.ewm(com=2, adjust=False).mean().iloc[-1]
        d_value = rsv.ewm(com=2, adjust=False).mean().ewm(com=2, adjust=False).mean().iloc[-1]
        return {"K": round(k_value, 1), "D": round(d_value, 1)}

    def macd(self, fast=12, slow=26, signal=9):
        if len(self.df) < slow:
            return {}
        fast_ema = self.df["close"].ewm(span=fast, adjust=False).mean()
        slow_ema = self.df["close"].ewm(span=slow, adjust=False).mean()
        dif = fast_ema - slow_ema
        signal_line = dif.ewm(span=signal, adjust=False).mean()
        return {
            "DIF": round(dif.iloc[-1], 2),
            "SIGNAL": round(signal_line.iloc[-1], 2),
            "OSC": round((dif.iloc[-1] - signal_line.iloc[-1]) * 2, 2),
        }

    def rsi(self, period=14):
        if len(self.df) < period + 1:
            return {}
        delta = self.df["close"].diff()
        gains = delta.clip(lower=0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
        losses = (-delta.clip(upper=0)).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
        rs = gains / losses.replace(0, np.nan)
        value = 100 - (100 / (1 + rs))
        return {"RSI": round(value.iloc[-1], 1)}

    def cci(self, period=20):
        if len(self.df) < period:
            return {}
        typical_price = (self.df["high"] + self.df["low"] + self.df["close"]) / 3
        average = typical_price.rolling(period).mean()
        mean_deviation = typical_price.rolling(period).apply(
            lambda window: np.mean(np.abs(window - window.mean())), raw=True
        )
        value = ((typical_price - average) / (0.015 * mean_deviation.replace(0, np.nan))).iloc[-1]
        return {"CCI": round(value, 1)}

    def bollinger(self, period=20, std_dev=2):
        if len(self.df) < period:
            return {}
        middle = self.df["close"].rolling(period).mean().iloc[-1]
        deviation = self.df["close"].rolling(period).std().iloc[-1]
        return {
            "upper": round(middle + std_dev * deviation, 2),
            "middle": round(middle, 2),
            "lower": round(middle - std_dev * deviation, 2),
        }

    def keltner(self, period=20, multiplier=2):
        if len(self.df) < max(period, 15):
            return {}
        middle = self.df["close"].ewm(span=period, adjust=False).mean().iloc[-1]
        atr_value = self.atr_series(14).iloc[-1]
        return {
            "upper": round(middle + multiplier * atr_value, 2),
            "middle": round(middle, 2),
            "lower": round(middle - multiplier * atr_value, 2),
        }

    def adx(self, period=14):
        if len(self.df) < period * 2:
            return {}
        high_change = self.df["high"].diff()
        low_change = -self.df["low"].diff()
        plus_dm = high_change.where((high_change > low_change) & (high_change > 0), 0.0)
        minus_dm = low_change.where((low_change > high_change) & (low_change > 0), 0.0)
        smoothed_tr = self.atr_series(period)
        plus_di = 100 * plus_dm.ewm(alpha=1 / period, adjust=False, min_periods=period).mean() / smoothed_tr
        minus_di = 100 * minus_dm.ewm(alpha=1 / period, adjust=False, min_periods=period).mean() / smoothed_tr
        total_di = plus_di + minus_di
        dx = (100 * (plus_di - minus_di).abs() / total_di).where(total_di != 0)
        value = dx.ewm(alpha=1 / period, adjust=False, min_periods=period).mean().iloc[-1]
        return {"ADX": round(value, 1) if pd.notna(value) else None, "plus_DI": round(plus_di.iloc[-1], 1), "minus_DI": round(minus_di.iloc[-1], 1)}

    def obv(self, period=20):
        if len(self.df) < period + 1:
            return {}
        direction = np.sign(self.df["close"].diff()).fillna(0)
        series = (direction * self.df["volume"]).cumsum()
        return {"OBV": int(series.iloc[-1]), "OBV_change": int(series.iloc[-1] - series.iloc[-period]), "period": period}

    def volume(self, period=5):
        if len(self.df) < period:
            return {}
        average = self.df["volume"].rolling(period).mean().iloc[-1]
        today = self.df["volume"].iloc[-1]
        return {"volume_today": int(today), "volume_ma": int(average), "volume_ratio": round(today / average, 2) if average else 0}

    def candlestick_anatomy(self):
        """量化最新 K 線實體與上下影線占整體區間的比例。"""
        row = self.df.iloc[-1]
        candle_range = max(row["high"] - row["low"], 1e-9)
        body = abs(row["close"] - row["open"])
        upper_shadow = row["high"] - max(row["open"], row["close"])
        lower_shadow = min(row["open"], row["close"]) - row["low"]
        return {
            "body_ratio": round(body / candle_range, 3),
            "upper_shadow_ratio": round(upper_shadow / candle_range, 3),
            "lower_shadow_ratio": round(lower_shadow / candle_range, 3),
            "body": round(body, 2),
            "upper_shadow": round(upper_shadow, 2),
            "lower_shadow": round(lower_shadow, 2),
            "bullish": bool(row["close"] > row["open"]),
        }

    def bias(self, period=20, zscore_window=60):
        """收盤相對均線的乖離率及歷史 Z-score。"""
        if len(self.df) < period:
            return {}
        moving_average = self.df["close"].rolling(period).mean()
        bias_series = (self.df["close"] - moving_average) / moving_average * 100
        value = bias_series.iloc[-1]
        history = bias_series.dropna().tail(zscore_window)
        std = history.std(ddof=0)
        zscore = (value - history.mean()) / std if std and pd.notna(std) else 0
        return {"period": period, "bias_pct": round(value, 2), "zscore": round(zscore, 2)}

    def market_regime(self):
        """以 ADX 分類盤整或趨勢市場，供 Controller 調整權重。"""
        adx = self.adx()
        if not adx or adx["ADX"] is None:
            return {"regime": "unknown", "adx": None}
        return {"regime": "trending" if adx["ADX"] >= 25 else "ranging", "adx": adx["ADX"]}

    def higher_timeframe(self, period=60, slope_window=10):
        """用 MA60 與最近斜率近似季線背景。"""
        if len(self.df) < period + slope_window:
            return {}
        ma60 = self.df["close"].rolling(period).mean()
        current = ma60.iloc[-1]
        slope = (current - ma60.iloc[-1 - slope_window]) / slope_window
        price = self.df["close"].iloc[-1]
        return {
            "ma60": round(current, 2),
            "ma60_slope": round(slope, 3),
            "price_above_ma60": bool(price >= current),
            "background": "bullish" if price >= current and slope > 0 else ("bearish" if price < current and slope < 0 else "neutral"),
        }

    def trailing_stop(self, period=20):
        """多頭持股的保護價：20 日低點與布林下軌中較高者。"""
        if len(self.df) < period:
            return {}
        support = self.df["low"].rolling(period).min().iloc[-1]
        bollinger = self.bollinger(period)
        stop = max(support, bollinger["lower"]) if bollinger else support
        price = self.df["close"].iloc[-1]
        return {"period": period, "price": round(stop, 2), "distance_pct": round((price / stop - 1) * 100, 2) if stop else 0, "basis": "20 日低點或布林下軌較高者"}

    def vr(self, period=26):
        if len(self.df) < period + 1:
            return {}
        subset = self.df.iloc[-period:].copy()
        change = subset["close"].diff()
        up = subset.loc[change > 0, "volume"].sum()
        down = subset.loc[change < 0, "volume"].sum()
        flat = subset.loc[change == 0, "volume"].sum()
        denominator = down + flat / 2
        return {"VR": round((up + flat / 2) / denominator * 100, 1) if denominator else None, "period": period}

    def support_resistance(self, period=20):
        if len(self.df) < period:
            return {}
        support = self.df["low"].rolling(period).min().iloc[-1]
        resistance = self.df["high"].rolling(period).max().iloc[-1]
        price = self.df["close"].iloc[-1]
        return {"support": round(support, 2), "resistance": round(resistance, 2), "support_distance_pct": round((price / support - 1) * 100, 2), "resistance_distance_pct": round((resistance / price - 1) * 100, 2)}

    def trendlines(self, period=40):
        if len(self.df) < period:
            return {}
        subset = self.df.iloc[-period:]
        indexes = np.arange(period)
        support_slope, support_intercept = np.polyfit(indexes, subset["low"], 1)
        resistance_slope, resistance_intercept = np.polyfit(indexes, subset["high"], 1)
        return {"period": period, "support_slope": round(float(support_slope), 4), "support_at_price": round(float(support_slope * (period - 1) + support_intercept), 2), "resistance_slope": round(float(resistance_slope), 4), "resistance_at_price": round(float(resistance_slope * (period - 1) + resistance_intercept), 2)}

    def fibonacci(self, period=60):
        if len(self.df) < period:
            return {}
        subset = self.df.iloc[-period:]
        high = subset["high"].max()
        low = subset["low"].min()
        difference = high - low
        return {"period": period, "swing_high": round(high, 2), "swing_low": round(low, 2), "23.6%": round(high - difference * 0.236, 2), "38.2%": round(high - difference * 0.382, 2), "50.0%": round(high - difference * 0.5, 2), "61.8%": round(high - difference * 0.618, 2), "78.6%": round(high - difference * 0.786, 2)}

    def volume_profile(self, bins=12, period=60):
        if len(self.df) < period:
            return {}
        subset = self.df.iloc[-period:]
        edges = np.linspace(subset["low"].min(), subset["high"].max(), bins + 1)
        typical_price = (subset["high"] + subset["low"] + subset["close"]) / 3
        bucket = np.clip(np.digitize(typical_price, edges) - 1, 0, bins - 1)
        profile = pd.Series(subset["volume"].to_numpy()).groupby(bucket).sum()
        point_of_control = int(profile.idxmax())
        return {"period": period, "point_of_control": round(float((edges[point_of_control] + edges[point_of_control + 1]) / 2), 2), "high_volume_nodes": [round(float((edges[index] + edges[index + 1]) / 2), 2) for index in profile.nlargest(min(3, len(profile))).index]}

    def price_volume(self):
        if len(self.df) < 6:
            return {}
        price_change = self.df["close"].pct_change(5).iloc[-1]
        volume_change = self.df["volume"].pct_change(5).iloc[-1]
        if price_change > 0 and volume_change > 0:
            label = "價量齊揚"
        elif price_change > 0 and volume_change < 0:
            label = "價漲量縮"
        elif price_change < 0 and volume_change > 0:
            label = "價跌量增"
        else:
            label = "價跌量縮"
        return {"label": label, "price_change_pct": round(price_change * 100, 2), "volume_change_pct": round(volume_change * 100, 2)}

    def all(self):
        data_as_of = None
        if "date" in self.df:
            data_as_of = pd.to_datetime(self.df["date"].iloc[-1]).date().isoformat()
        return {"price": round(self.df["close"].iloc[-1], 2), "data_as_of": data_as_of, "ma": self.sma(), "ema": self.ema(), "kd": self.kd(), "macd": self.macd(), "rsi": self.rsi(), "cci": self.cci(), "bollinger": self.bollinger(), "keltner": self.keltner(), "atr": self.atr(), "adx": self.adx(), "obv": self.obv(), "volume": self.volume(), "vr": self.vr(), "price_volume": self.price_volume(), "candlestick_anatomy": self.candlestick_anatomy(), "bias": self.bias(), "market_regime": self.market_regime(), "higher_timeframe": self.higher_timeframe(), "trailing_stop": self.trailing_stop(), "support_resistance": self.support_resistance(), "trendlines": self.trendlines(), "fibonacci": self.fibonacci(), "volume_profile": self.volume_profile()}