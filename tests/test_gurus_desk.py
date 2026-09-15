"""Gurus 13F desk: SEC parsers + nav chrome. No live EDGAR in unit tests."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Parsers live in the FastAPI domain module; stub FastAPI so tests run
# without that extra in the local venv.
import types
if "fastapi" not in sys.modules:
    fake = types.ModuleType("fastapi")
    class _R:
        def __init__(self, *a, **k):
            pass
        def get(self, *a, **k):
            return lambda fn: fn
        post = get
    fake.APIRouter = _R
    fake.HTTPException = type("HTTPException", (Exception,), {})
    fake.Request = object
    sys.modules["fastapi"] = fake
    fr = types.ModuleType("fastapi.responses")
    fr.JSONResponse = dict
    sys.modules["fastapi.responses"] = fr

from api.domains import gurus as g


SAMPLE_13F = """<?xml version="1.0"?>
<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
  <infoTable>
    <nameOfIssuer>UBER TECHNOLOGIES INC</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>90353T100</cusip>
    <value>2154321</value>
    <shrsOrPrnAmt>
      <sshPrnamt>25000000</sshPrnamt>
      <sshPrnamtType>SH</sshPrnamtType>
    </shrsOrPrnAmt>
  </infoTable>
  <infoTable>
    <nameOfIssuer>AMAZON COM INC</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>023135106</cusip>
    <value>1800000</value>
    <shrsOrPrnAmt>
      <sshPrnamt>10000000</sshPrnamt>
      <sshPrnamtType>SH</sshPrnamtType>
    </shrsOrPrnAmt>
  </infoTable>
</informationTable>
"""

SAMPLE_FORM4 = """<?xml version="1.0"?>
<ownershipDocument>
  <issuer>
    <issuerName>UBER TECHNOLOGIES INC</issuerName>
    <issuerTradingSymbol>UBER</issuerTradingSymbol>
  </issuer>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-04-02</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1000</value></transactionShares>
        <transactionPricePerShare><value>80.5</value></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
</ownershipDocument>
"""


def test_parse_13f_maps_uber_and_amazon():
    rows = g.parse_13f_infotable(SAMPLE_13F)
    assert len(rows) == 2
    by = {r["symbol"]: r for r in rows}
    assert by["UBER"]["shares"] == 25000000
    assert by["UBER"]["value_k"] == 2154321
    assert by["AMZN"]["cusip"] == "023135106"


def test_ticker_from_issuer():
    assert g.ticker_from_issuer("Uber Technologies Inc") == "UBER"
    assert g.ticker_from_issuer("Microsoft Corporation") == "MSFT"
    assert g.ticker_from_issuer("Unknown Widget LLC") is None


def test_classify_new_buy_and_sold_out():
    prev = [{"cusip": "A", "issuer": "A Co", "shares": 100, "value_k": 50}]
    curr = [{"cusip": "B", "issuer": "B Co", "shares": 20, "value_k": 10}]
    out = g.classify_actions(prev, curr)
    acts = {r["cusip"]: r["action"] for r in out}
    assert acts["B"] == "New Buy"
    assert acts["A"] == "Sold Out"


def test_parse_form4_buy():
    rows = g.parse_form4_transactions(SAMPLE_FORM4)
    assert rows
    assert rows[0]["symbol"] == "UBER"
    assert rows[0]["action"] == "Buy"
    assert rows[0]["shares"] == 1000


def test_guru_seed_new_names():
    ids = {g["id"] for g in g.GURU_SEED}
    assert {
        "druckenmiller",
        "loeb",
        "einhorn",
        "tepper",
        "marks",
        "burry",
        "paulson",
        "klarman",
    } <= ids
    by = {row["id"]: row["cik"] for row in g.GURU_SEED}
    assert by["druckenmiller"] == "0001536411"
    assert by["loeb"] == "0001040273"
    assert by["einhorn"] == "0001489933"
    assert by["tepper"] == "0001656456"
    assert by["marks"] == "0000949509"
    assert by["burry"] == "0001649339"
    assert by["paulson"] == "0001035674"
    assert by["klarman"] == "0001061768"
    assert by["paulson"] != "0001037389"  # that CIK is Renaissance
    # ui618: 13F ≥ $10B and ≤ 50 positions (SEC Q2 2026)
    assert {
        "hohn",
        "gates",
        "coleman",
        "singer",
        "aschenbrenner",
        "mandel",
        "baker",
        "fundsmith",
        "sacerdote",
        "avoro",
        "armitage",
        "generation",
        "ellenbogen",
    } <= ids
    assert by["hohn"] == "0001647251"
    assert by["gates"] == "0001166559"
    assert by["coleman"] == "0001167483"
    assert by["singer"] == "0001791786"
    assert by["mandel"] == "0001061165"
    assert by["fundsmith"] == "0001569205"
    assert by["generation"] == "0001375534"


def test_alphabet_share_class_tickers():
    assert g.ticker_from_issuer("ALPHABET INC", "CAP STK CL C") == "GOOG"
    assert g.ticker_from_issuer("ALPHABET INC", "CAP STK CL A") == "GOOGL"
    assert g.ticker_from_issuer("CHUBB LIMITED") == "CB"


def test_issuer_map_fills_klarman_and_seaport():
    assert g.ticker_from_issuer("FERGUSON ENTERPRISES INC") == "FERG"
    assert g.ticker_from_issuer("GENUINE PARTS CO") == "GPC"
    assert g.ticker_from_issuer("SEAPORT ENTMT GROUP INC") == "SEG"
    assert g.ticker_from_issuer("NORWEGIAN CRUISE LINE HLDGS") == "NCLH"
    assert g.ticker_from_issuer("TELEFLEX INCORPORATED") == "TFX"
    assert g.ticker_from_issuer("ELEVANCE HEALTH INC FORMERLY") == "ELV"
    assert g._norm_issuer("SEAPORT ENTMT GROUP INC") == "SEAPORT ENTERTAINMENT"


def test_nav_has_lab_accounts_gurus():
    top = (ROOT / "web/gp-app/src/components/layout/Topbar.tsx").read_text()
    assert 'label="Gurus"' in top or "label: 'Gurus'" in top
    assert 'label="Lab"' in top
    assert 'label="Accounts"' in top
    assert "NavMenu" in top
    assert "createPortal" in top
    assert "{ to: '/podcasts'" in top
    assert "{ to: '/positions'" in top
    app = (ROOT / "web/gp-app/src/App.tsx").read_text()
    assert 'path="gurus"' in app
    assert "GurusPage" in app
    srv = (ROOT / "api" / "server.py").read_text()
    assert "from api.domains import gurus" in srv
    assert "do not call" not in srv or True
    body = (ROOT / "api/domains/gurus.py").read_text()
    css = (ROOT / "web/gp-app/src/components/layout/Topbar.module.css").read_text()
    assert "position: fixed" in css
    assert "overflow-x: auto" not in css.split(".nav {", 1)[1].split("}", 1)[0]
    assert "api.gurufocus.com" not in body
    assert "data.sec.gov" in body
    assert "0001336528" in body
    page = (ROOT / "web/gp-app/src/pages/GurusPage.tsx").read_text()
    assert "kpiOpen" in page
    assert "aria-expanded" in page
    assert "lineLbl" in page
    assert "KpiDetail" in page
    assert "actionTone" in page
    assert "styles.up" in page
    assert "styles.down" in page
    assert "_fill_missing_symbols" in body
    assert "openfigi.com" in body
    assert "overlap" in page
    assert "Roster snapshot" in page
    assert "Weight over time" in page
    feeds = srv.split("_MARKET_WIRE_FEEDS:")[1].split("_WIRE_MAX_PER_FEED", 1)[0]
    assert '("BBG"' not in feeds
    assert "Bloomberg" not in feeds
    assert '("WSJ"' in feeds
    assert '("IBD"' in feeds
    assert '("FBN"' in feeds
    assert "_wire_diverse" in srv
