"""GICS sector plus a city archetype. The Portfolio Ship is not called from here.

Sector stays GICS. Only the archetype is overridden, and the note says so.
"""
from __future__ import annotations

GSE_SYMBOLS = frozenset({"FMCC", "FMCCJ", "FMCCS", "FMCCM", "FMCCN", "FNMAP"})
GSE_COMMONS = ("FMCC", "FNMA")
CASH_SYMBOLS = frozenset({"SPAXX", "FZDXX"})

# base, primary, accent
PALETTES: dict[str, tuple[str, str, str]] = {
    "tech_neon": ("#0b1630", "#00e5ff", "#ff2bd6"),
    "comm_spire": ("#141028", "#7c4dff", "#00b0ff"),
    "consumer_flagship": ("#1b1410", "#ff9900", "#ff4d6d"),
    "consumer_staples_market": ("#2a1d14", "#ffcf6e", "#8bd17c"),
    "financial_monolith": ("#1c1f26", "#d4af37", "#f5e6b8"),
    "health_biomorph": ("#e8f1f4", "#5ef2e0", "#ffffff"),
    "energy_reactor": ("#0f1d17", "#39ff88", "#ffd23f"),
    "utility_grid": ("#1d1712", "#ff8a00", "#ffd23f"),
    "industrial_steel": ("#22262b", "#ffb000", "#9fb3c8"),
    "aero_gantry": ("#1a1d22", "#ff7a1a", "#e8eef5"),
    "speculative_beacon": ("#120a1c", "#b6ff00", "#ff3df2"),
    "cash_plaza": ("#0c1a14", "#7dffb2", "#ffffff"),
    "materials_forge": ("#2a241c", "#c4a574", "#ff6a00"),
    "realestate_terrace": ("#1a2420", "#8fd6c1", "#f2e6c8"),
}

SECTOR_ARCHETYPE = {
    "Information Technology": "tech_neon",
    "Communication Services": "comm_spire",
    "Consumer Discretionary": "consumer_flagship",
    "Consumer Staples": "consumer_staples_market",
    "Financials": "financial_monolith",
    "Health Care": "health_biomorph",
    "Energy": "utility_grid",
    "Utilities": "energy_reactor",
    "Industrials": "industrial_steel",
    "Materials": "materials_forge",
    "Real Estate": "realestate_terrace",
    "Cash": "cash_plaza",
}

# ticker -> (name, sector, archetype, note, override)
HAND: dict[str, tuple[str, str, str, str | None, bool]] = {
    "TSLA": (
        "Tesla Inc",
        "Consumer Discretionary",
        "tech_neon",
        "Archetype override: GICS Consumer Discretionary, styled as Tech/EV",
        True,
    ),
    "C": ("Citigroup Inc", "Financials", "financial_monolith", None, False),
    "META": ("Meta Platforms Inc", "Communication Services", "comm_spire", None, False),
    "WFC": ("Wells Fargo & Co", "Financials", "financial_monolith", None, False),
    "CEG": ("Constellation Energy Corp", "Utilities", "energy_reactor", None, False),
    "SPCX": (
        "Space Exploration Technologies Corp",
        "Industrials",
        "aero_gantry",
        "Aerospace & Defense. Private name; market cap stays empty when SEC has no share count.",
        False,
    ),
    "IBRX": (
        "ImmunityBio Inc",
        "Health Care",
        "speculative_beacon",
        "Archetype override: Health Care biotech, styled as a speculative beacon",
        True,
    ),
    "MOH": ("Molina Healthcare Inc", "Health Care", "health_biomorph", None, False),
    "AMZN": ("Amazon.com Inc", "Consumer Discretionary", "consumer_flagship", None, False),
    "UBER": (
        "Uber Technologies Inc",
        "Industrials",
        "industrial_steel",
        "GICS Industrials (Ground Transportation)",
        False,
    ),
    "BSX": ("Boston Scientific Corp", "Health Care", "health_biomorph", None, False),
    "FMCC": ("Freddie Mac", "Financials", "speculative_beacon", None, False),
    "FNMA": ("Fannie Mae", "Financials", "speculative_beacon", None, False),
}

# Open-book names that were missing from the hand map. Sector is GICS.
# An unknown symbol still falls through to Industrials below; these do not.
BOOK_SECTORS: dict[str, tuple[str, str]] = {
    "AMD": ("Advanced Micro Devices Inc", "Information Technology"),
    "ANET": ("Arista Networks Inc", "Information Technology"),
    "ARM": ("Arm Holdings plc", "Information Technology"),
    "ASML": ("ASML Holding NV", "Information Technology"),
    "AVGO": ("Broadcom Inc", "Information Technology"),
    "AYI": ("Acuity Inc", "Industrials"),
    "BRKB": ("Berkshire Hathaway Inc", "Financials"),
    "CARR": ("Carrier Global Corp", "Industrials"),
    "CAT": ("Caterpillar Inc", "Industrials"),
    "CIEN": ("Ciena Corp", "Information Technology"),
    "CMCSA": ("Comcast Corp", "Communication Services"),
    "CMI": ("Cummins Inc", "Industrials"),
    "CRM": ("Salesforce Inc", "Information Technology"),
    "CSCO": ("Cisco Systems Inc", "Information Technology"),
    "DE": ("Deere & Co", "Industrials"),
    "DELL": ("Dell Technologies Inc", "Information Technology"),
    "DLR": ("Digital Realty Trust Inc", "Real Estate"),
    "DUK": ("Duke Energy Corp", "Utilities"),
    "EQIX": ("Equinix Inc", "Real Estate"),
    "FLR": ("Fluor Corp", "Industrials"),
    "GOOG": ("Alphabet Inc", "Communication Services"),
    "GOOGL": ("Alphabet Inc", "Communication Services"),
    "HHH": ("Howard Hughes Holdings Inc", "Real Estate"),
    "HPE": ("Hewlett Packard Enterprise Co", "Information Technology"),
    "INTC": ("Intel Corp", "Information Technology"),
    "IRM": ("Iron Mountain Inc", "Real Estate"),
    "J": ("Jacobs Solutions Inc", "Industrials"),
    "JCI": ("Johnson Controls International plc", "Industrials"),
    "MLM": ("Martin Marietta Materials Inc", "Materials"),
    "MRVL": ("Marvell Technology Inc", "Information Technology"),
    "MSFT": ("Microsoft Corp", "Information Technology"),
    "NEE": ("NextEra Energy Inc", "Utilities"),
    "NFLX": ("Netflix Inc", "Communication Services"),
    "NKE": ("Nike Inc", "Consumer Discretionary"),
    "NLYPRF": ("Annaly Capital Management Inc", "Financials"),
    "NVDA": ("NVIDIA Corp", "Information Technology"),
    "OKLO": ("Oklo Inc", "Utilities"),
    "PYPL": ("PayPal Holdings Inc", "Financials"),
    "SMR": ("NuScale Power Corp", "Utilities"),
    "SPG": ("Simon Property Group Inc", "Real Estate"),
    "TSM": ("Taiwan Semiconductor Manufacturing Co Ltd", "Information Technology"),
    "VMC": ("Vulcan Materials Co", "Materials"),
    "VRT": ("Vertiv Holdings Co", "Industrials"),
}

for _sym, (_name, _sector) in BOOK_SECTORS.items():
    if _sym in HAND:
        continue
    HAND[_sym] = (_name, _sector, SECTOR_ARCHETYPE[_sector], None, False)

DISTRICTS: dict[str, tuple[float, float]] = {
    "Financials": (-1.0, -1.0),
    "Health Care": (1.0, -1.0),
    "Industrials": (1.0, 1.0),
    "Consumer Discretionary": (-1.0, 1.0),
    "Communication Services": (0.0, 1.6),
    "Utilities": (1.6, 0.0),
    "Cash": (0.0, 0.0),
    "Information Technology": (0.0, -1.6),
    "Consumer Staples": (-1.6, 0.0),
    "Energy": (1.6, 1.6),
    "Materials": (-1.6, -1.6),
    "Real Estate": (-1.6, 1.6),
}

SHIP_DOTS = {
    "Information Technology": "#5b8cff",
    "Communication Services": "#5b8cff",
    "Financials": "#2ec4a6",
    "Consumer Discretionary": "#ff7a3d",
    "Industrials": "#f2c14e",
    "Health Care": "#ef5d7a",
    "Utilities": "#8a6cff",
    "Energy": "#8a6cff",
    "Cash": "#9aa7b4",
    "Consumer Staples": "#ff7a3d",
    "Materials": "#f2c14e",
    "Real Estate": "#9aa7b4",
}


def normalize_symbol(symbol: str | None) -> str:
    return (symbol or "").strip().upper()


def classify(symbol: str) -> dict:
    """Return sector, archetype, display name, and whether the archetype is an override."""
    sym = normalize_symbol(symbol)
    if sym in CASH_SYMBOLS:
        return {
            "name": sym,
            "sector": "Cash",
            "archetype": "cash_plaza",
            "industry_note": None,
            "archetype_override": False,
        }
    if (
        sym in GSE_SYMBOLS
        or sym in GSE_COMMONS
        or sym.startswith(("FMCC", "FMCK", "FNMA", "FNMF", "FREG", "FREJ"))
    ):
        return {
            "name": HAND.get(sym, (sym,))[0] if sym in HAND else sym,
            "sector": "Financials",
            "archetype": "speculative_beacon",
            "industry_note": None,
            "archetype_override": False,
        }
    row = HAND.get(sym)
    if row:
        name, sector, archetype, note, override = row
        return {
            "name": name,
            "sector": sector,
            "archetype": archetype,
            "industry_note": note,
            "archetype_override": override,
        }
    return {
        "name": sym,
        "sector": "Industrials",
        "archetype": "industrial_steel",
        "industry_note": "Sector not on the hand map. Plain fallback tower.",
        "archetype_override": False,
    }


def colors(archetype: str) -> dict[str, str]:
    base, primary, accent = PALETTES.get(archetype, PALETTES["industrial_steel"])
    return {"base": base, "primary": primary, "accent": accent}
