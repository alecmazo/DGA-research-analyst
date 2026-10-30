"""Thresholds, universes, and the weights a pass reason is allowed to move."""

from __future__ import annotations

SECTOR_ETFS = ("XLK", "XLF", "XLE", "XLV", "XLI", "XLB", "XLY", "XLP", "XLU", "XLRE", "XLC")
INDUSTRY_ETFS = ("SMH", "XBI", "KRE", "ITB", "XOP", "IGV", "TAN", "URA", "JETS", "XRT")
PRICE_ETFS = SECTOR_ETFS + INDUSTRY_ETFS

ETF_LABELS = {
    "XLK": "Technology",
    "XLF": "Financials",
    "XLE": "Energy",
    "XLV": "Health care",
    "XLI": "Industrials",
    "XLB": "Materials",
    "XLY": "Consumer discretionary",
    "XLP": "Consumer staples",
    "XLU": "Utilities",
    "XLRE": "Real estate",
    "XLC": "Communication services",
    "SMH": "Semiconductors",
    "XBI": "Biotech",
    "KRE": "Regional banks",
    "ITB": "Homebuilders",
    "XOP": "Oil and gas producers",
    "IGV": "Software",
    "TAN": "Solar",
    "URA": "Uranium",
    "JETS": "Airlines",
    "XRT": "Retail",
}

# security_meta sector / industry needles. First match wins in the live reader.
ETF_MATCH = {
    "XLK": ("technology", "information technology"),
    "XLF": ("financial",),
    "XLE": ("energy",),
    "XLV": ("health",),
    "XLI": ("industrial",),
    "XLB": ("material",),
    "XLY": ("consumer discretionary", "consumer cyclical"),
    "XLP": ("consumer staples", "consumer defensive"),
    "XLU": ("utilit",),
    "XLRE": ("real estate",),
    "XLC": ("communication",),
    "SMH": ("semiconductor",),
    "XBI": ("biotech",),
    "KRE": ("regional bank", "bank"),
    "ITB": ("homebuild", "homebuilding"),
    "XOP": ("oil & gas", "oil and gas", "exploration"),
    "IGV": ("software",),
    "TAN": ("solar",),
    "URA": ("uranium",),
    "JETS": ("airline",),
    "XRT": ("retail",),
}

DEFAULT_FUNDS = (
    {"name": "Berkshire Hathaway", "cik": "0001067983"},
    {"name": "Pershing Square", "cik": "0001336528"},
    {"name": "Baupost", "cik": "0001061768"},
    {"name": "Icahn", "cik": "0000921669"},
    {"name": "Third Point", "cik": "0001040273"},
    {"name": "Greenlight", "cik": "0001079114"},
)

DEFAULT_THEMES = (
    "AI infrastructure",
    "grid power",
    "nuclear",
    "GLP-1",
    "defense drones",
    "reshoring",
)

PASS_CHIPS = (
    "already known",
    "too small",
    "structural",
    "cyclical",
    "bad balance sheet",
    "not my universe",
    "weak catalyst",
)

DEFAULT_WEIGHTS = {
    "sector": {"drawdown": 35.0, "relative": 35.0, "valuation": 20.0, "balance_sheet": 10.0},
    "weekly": {"drop": 30.0, "overreaction": 40.0, "idiosyncratic": 20.0, "size": 10.0},
    "insider": {"cluster": 40.0, "dollars": 35.0, "role": 25.0},
    "trend": {"filings": 30.0, "patents": 25.0, "fda": 20.0, "search": 25.0},
}

# Pass reason -> weight deltas before the 5–60 bound and the sum-to-100 step.
PASS_NUDGES = {
    "sector": {
        "structural": {"drawdown": -4, "relative": -2, "valuation": 3},
        "cyclical": {"drawdown": 3, "valuation": 2},
        "bad balance sheet": {"balance_sheet": 4, "drawdown": -2},
        "already known": {"drawdown": -2, "relative": -2},
        "weak catalyst": {"relative": -2, "valuation": 2},
    },
    "weekly": {
        "too small": {"size": 4, "drop": -2},
        "weak catalyst": {"overreaction": 4, "drop": -3},
        "already known": {"drop": -2},
        "structural": {"idiosyncratic": -3, "overreaction": 2},
    },
    "insider": {
        "too small": {"dollars": 4, "cluster": -2},
        "already known": {"cluster": -2},
        "weak catalyst": {"role": 3, "cluster": -2},
    },
    "trend": {
        "already known": {"search": -3, "filings": 2},
        "weak catalyst": {"search": -3, "filings": 2},
        "structural": {"filings": 3, "search": -2},
        "not my universe": {},
    },
}

WEIGHT_FLOOR = 5.0
WEIGHT_CAP = 60.0

STAGES_WEEKDAY = ("sector", "weekly", "insider")
STAGES_SUNDAY = ("trend",)
ALL_STAGES = ("sector", "weekly", "insider", "trend")

DEFAULT_SETTINGS = {
    "auto": True,
    "start_local": "06:00",
    "drawdown_min": 0.15,
    "drop_min": 0.15,
    "min_market_cap": 1_000_000_000,
    "insider_window_days": 30,
    "insider_cluster": 2,
    "ceo_cfo_min_usd": 250_000,
    "add_pct": 0.50,
    "grok_cap_usd": 10.0,
    "grok_model": "grok-4",
    "watch_move_pct": 0.08,
    "themes": list(DEFAULT_THEMES),
    "funds": [dict(row) for row in DEFAULT_FUNDS],
    "extra_tickers": [],
    "discovered_themes": [],
    "weights": {k: dict(v) for k, v in DEFAULT_WEIGHTS.items()},
}
