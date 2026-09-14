"""技術分析領域資料模型。"""
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class Signal:
    """單一技術訊號。"""

    category: str
    description: str
    direction: str
    strength: int = 1

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class AnalysisResult:
    """Controller 回傳的完整技術分析結果。"""

    indicators: dict[str, Any]
    patterns: dict[str, Any] = field(default_factory=dict)
    signals: list[Signal] = field(default_factory=list)
    overall: str = "中性"
    summary: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "indicators": self.indicators,
            "patterns": self.patterns,
            "signals": [signal.to_dict() for signal in self.signals],
            "overall": self.overall,
            "summary": self.summary,
        }