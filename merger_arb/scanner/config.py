"""Environment flags for the scanner. Paid models stay off."""

from __future__ import annotations

import os
from dataclasses import dataclass

_PLACEHOLDER = "CONTACT_EMAIL_PLACEHOLDER"


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    return str(raw).strip().lower() in ("1", "true", "yes", "on")


def _rps(raw: str | None, default: float = 5.0) -> float:
    try:
        value = float(raw) if raw not in (None, "") else default
    except (TypeError, ValueError):
        value = default
    if value <= 0:
        value = default
    return min(value, 10.0)


def sec_user_agent_ok(user_agent: str) -> bool:
    text = (user_agent or "").strip()
    if not text or _PLACEHOLDER in text or "@" not in text:
        return False
    return True


@dataclass
class ScannerConfig:
    sec_user_agent: str = ""
    sec_max_rps: float = 5.0
    lookback_days: int = 120
    cache_path: str = "data/cache/scanner_http.sqlite"
    ftc_api_key: str = ""
    enable_ftc: bool = True
    enable_ftc_html: bool = False
    enable_nasdaq: bool = True
    enable_prn: bool = True
    enable_gnw: bool = True
    enable_yahoo_rss: bool = True
    enable_google_news: bool = False
    businesswire_url: str = ""
    enable_trackers: bool = False
    fmp_api_key: str = ""
    llm_enabled: bool = False
    ollama_base_url: str = ""
    local_llm_base_url: str = ""
    ollama_model: str = "gpt-oss-20b-finance"
    allow_remote_llm: bool = False
    daily_time: str = ""
    price_cache_seconds: int = 300
    enable_form_15: bool = False

    @property
    def sec_ok(self) -> bool:
        return sec_user_agent_ok(self.sec_user_agent)

    @property
    def ftc_key_used(self) -> str:
        return (self.ftc_api_key or "").strip() or "DEMO_KEY"

    @property
    def ftc_is_demo(self) -> bool:
        return not (self.ftc_api_key or "").strip()

    @classmethod
    def from_env(cls) -> "ScannerConfig":
        return cls(
            sec_user_agent=os.environ.get("SEC_USER_AGENT", ""),
            sec_max_rps=_rps(os.environ.get("SEC_MAX_RPS"), 5.0),
            lookback_days=int(os.environ.get("SCANNER_INITIAL_LOOKBACK_DAYS") or 120),
            cache_path=os.environ.get("SCANNER_HTTP_CACHE_PATH") or "data/cache/scanner_http.sqlite",
            ftc_api_key=os.environ.get("FTC_API_KEY", ""),
            enable_ftc=_flag("SCANNER_ENABLE_FTC", True),
            enable_ftc_html=_flag("SCANNER_ENABLE_FTC_HTML", False),
            enable_nasdaq=_flag("SCANNER_ENABLE_NASDAQ_ECA", True),
            enable_prn=_flag("SCANNER_ENABLE_PRNEWSWIRE", True),
            enable_gnw=_flag("SCANNER_ENABLE_GLOBENEWSWIRE", True),
            enable_yahoo_rss=_flag("SCANNER_ENABLE_YAHOO_TICKER_RSS", True),
            enable_google_news=_flag("SCANNER_ENABLE_GOOGLE_NEWS", False),
            businesswire_url=(os.environ.get("BUSINESSWIRE_MA_FEED_URL") or "").strip(),
            enable_trackers=_flag("SCANNER_ENABLE_TRACKERS", False),
            fmp_api_key=(os.environ.get("FMP_API_KEY") or "").strip(),
            llm_enabled=_flag("SCANNER_LLM_ENABLED", False),
            ollama_base_url=(os.environ.get("OLLAMA_BASE_URL") or "").strip(),
            local_llm_base_url=(os.environ.get("LOCAL_LLM_BASE_URL") or "").strip(),
            ollama_model=(os.environ.get("OLLAMA_MODEL") or "gpt-oss-20b-finance").strip(),
            allow_remote_llm=_flag("SCANNER_LLM_ALLOW_REMOTE", False),
            daily_time=(os.environ.get("SCANNER_DAILY_TIME") or "").strip(),
            price_cache_seconds=int(os.environ.get("SCANNER_PRICE_CACHE_SECONDS") or 300),
            enable_form_15=_flag("SCANNER_ENABLE_FORM_15", False),
        )
