"""Structured report data passed from Controller to View."""
from dataclasses import dataclass, field

from ..technical.models import AnalysisResult


@dataclass
class ReportData:
    code: str
    days_ahead: int
    generated_at: str
    realtime: dict = field(default_factory=dict)
    daytrade: dict | None = None
    history: dict = field(default_factory=dict)
    technical: AnalysisResult | None = None
    technical_error: str | None = None
    institutional: dict | None = None
    etf: dict | None = None
    fundamental: dict | None = None
    sentiment: dict | None = None
    prediction: dict | None = None
    params_path: str | None = None
    market_code: str | None = None
    institutional_rows: int | None = None
    risk: dict | None = None
