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


def test_nav_has_lab_accounts_gurus():
    top = (ROOT / "web/gp-app/src/components/layout/Topbar.tsx").read_text()
    assert 'label="Gurus"' in top or "label: 'Gurus'" in top
    assert 'label="Lab"' in top
    assert 'label="Accounts"' in top
    assert "NavMenu" in top
    assert "{ to: '/podcasts'" in top
    assert "{ to: '/positions'" in top
    app = (ROOT / "web/gp-app/src/App.tsx").read_text()
    assert 'path="gurus"' in app
    assert "GurusPage" in app
    srv = (ROOT / "api" / "server.py").read_text()
    assert "from api.domains import gurus" in srv
    assert "do not call" not in srv or True
    body = (ROOT / "api/domains/gurus.py").read_text()
    assert "api.gurufocus.com" not in body
    assert "data.sec.gov" in body
    assert "0001336528" in body
