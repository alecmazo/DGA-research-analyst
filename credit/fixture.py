"""Paramount Skydance seed. Numbers come from the handoff sources, not from a model."""

from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from credit.calc import money

PULLED = "2026-10-02T00:00:00+00:00"
CIK = "0002041610"
JSON_PATH = Path(__file__).resolve().parent / "fixtures" / "psky.json"

PR = "https://www.prnewswire.com/news-releases/paramount-skydance-corporation-announces-41-4-billion-and-885-million-senior-secured-notes-offerings-and-8-5-billion-and-850-million-term-loan-b-facility-pricing-302895161.html"
EIGHT_K_1002 = "https://www.sec.gov/Archives/edgar/data/2041610/000110465926113076/tm2626659d3_8k.htm"
EIGHT_K_1001 = "https://www.sec.gov/Archives/edgar/data/2041610/000110465926112829/tm2626659d2_8k.htm"
EIGHT_K_0930 = "https://www.sec.gov/Archives/edgar/data/2041610/000110465926112347/tm2626659d1_8k.htm"
EIGHT_K_0928 = "https://www.sec.gov/Archives/edgar/data/2041610/000110465926111174/tm2610616d13_8k.htm"
PROFORMA = "https://www.sec.gov/Archives/edgar/data/2041610/000110465926111174/tm2610616d13_ex99-2.htm"
EXCHANGE = "https://www.sec.gov/Archives/edgar/data/2041610/000110465926090460/tm2610616d9_8ka.htm"
FACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK0002041610.json"
SUBS = "https://data.sec.gov/submissions/CIK0002041610.json"
TREASURY = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv"
FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2"
LIVEMINT = "https://www.livemint.com/companies/news/paramounts-30-billion-bond-sale-draws-109-billion-demand-for-warner-bros-deal-11790735235267.html"


def _src(kind: str, name: str, url: str, locator: str = "") -> dict:
    return {"type": kind, "name": name, "url": url, "locator": locator}


def field(fid: str, value, unit: str, source: dict, confidence: str, *,
          status: str = "ok", freshness: str = "terms", as_of: str = "2026-10-02", notes: str = "") -> dict:
    return {
        "id": fid,
        "value": value,
        "unit": unit,
        "source": source,
        "pulled_at": PULLED,
        "as_of": as_of,
        "freshness_class": freshness,
        "confidence": confidence,
        "status": status,
        "notes": notes,
    }


def _instrument(row: dict) -> dict:
    press = _src("press_release", "Paramount Skydance pricing release", PR, "2026-09-30 18:02 PT")
    figi_src = _src("market_data", "OpenFIGI", "https://api.openfigi.com/v3/search", row.get("figi") or "")
    amount_conf = row.get("amount_confidence", "high")
    return {
        "id": row["id"],
        "issuer_cik": CIK,
        "group": row["group"],
        "name": row["name"],
        "type": row["type"],
        "priority_rank": row["priority_rank"],
        "lien": field(f"{row['id']}.lien", row["lien"], "text", press if row["lien"] != "unknown" else figi_src,
                      row.get("lien_confidence", "high"),
                      status=row.get("lien_status", "ok"),
                      notes=row.get("lien_notes", "")),
        "currency": row["currency"],
        "amount": field(f"{row['id']}.amount", row["amount"], row["currency"], press, amount_conf),
        "coupon": field(f"{row['id']}.coupon", row["coupon"], "percent", press, "high"),
        "coupon_type": row.get("coupon_type", "fixed"),
        "maturity": field(
            f"{row['id']}.maturity", row["maturity"], "date",
            figi_src if row.get("maturity_confidence") == "medium" else press,
            row.get("maturity_confidence", "high"),
            notes=row.get("maturity_notes", "Day and month are UNCONFIRMED until the indenture. Year is from the pricing release."),
        ),
        "figi": row.get("figi") or "",
        "frequency": row.get("frequency", 2),
        "day_count": row.get("day_count", "30/360"),
        "call_schedule": field(f"{row['id']}.call", None, "text", press, "high", status="not_public",
                               notes="Call schedule is not public until the offering memorandum or S-4."),
        "spread_bp": row.get("spread_bp"),
        "index": row.get("index") or "",
        "floor": row.get("floor"),
        "oid": row.get("oid"),
    }


NEW_NOTES = [
    ("psky_1l_2028", "6.30% Sr Sec 1L Notes due 2028", "1", "USD", "3500", "6.30", "2028-10-05", "BBG025HYZYQ2", 1),
    ("psky_1l_2029", "6.55% Sr Sec 1L Notes due 2029", "1", "USD", "3500", "6.55", "2029-10-05", "BBG025HZDGJ0", 1),
    ("psky_1l_2031", "7.05% Sr Sec 1L Notes due 2031", "1", "USD", "6500", "7.05", "2031-10-15", "BBG025HZ2ZW5", 1),
    ("psky_1l_2033", "7.55% Sr Sec 1L Notes due 2033", "1", "USD", "5250", "7.55", "2033-10-15", "BBG025HYZM33", 1),
    ("psky_1l_2036", "7.90% Sr Sec 1L Notes due 2036", "1", "USD", "5250", "7.90", "2036-10-15", "BBG025HZDT75", 1),
    ("psky_1l_2046", "8.65% Sr Sec 1L Notes due 2046", "1", "USD", "1250", "8.65", "2046-10-15", "BBG025HZF156", 1),
    ("psky_1l_2056", "8.75% Sr Sec 1L Notes due 2056", "1", "USD", "3500", "8.75", "2056-10-15", "BBG025HZRJL6", 1),
    ("psky_1l_2066", "8.90% Sr Sec 1L Notes due 2066", "1", "USD", "1250", "8.90", "2066-10-15", "BBG025HZV3R0", 1),
    ("psky_2l_2031_usd", "8.250% Sr Sec 2L Notes due 2031", "2", "USD", "6000", "8.250", "2031-10-15", "BBG025HXGH64", 2),
    ("psky_2l_2031_eur", "7.000% Sr Sec 2L Notes due 2031 (EUR)", "2", "EUR", "885", "7.000", "2031-10-15", "BBG025HYQZR8", 2),
    ("psky_2l_2034", "8.875% Sr Sec 2L Notes due 2034", "2", "USD", "4000", "8.875", "2034-10-15", "BBG025HXJ1Q4", 2),
    ("psky_2l_2036", "9.125% Sr Sec 2L Notes due 2036", "2", "USD", "1400", "9.125", "2036-10-15", "BBG025HXFYN9", 2),
]


def _notes() -> list[dict]:
    rows = []
    for iid, name, lien, currency, amount, coupon, maturity, figi, rank in NEW_NOTES:
        group = "new_1l" if rank == 1 else "new_2l"
        rows.append(_instrument({
            "id": iid, "group": group, "name": name, "type": "secured_note",
            "priority_rank": rank, "lien": f"{lien}L", "currency": currency,
            "amount": amount, "coupon": coupon, "maturity": maturity, "figi": figi,
            "maturity_confidence": "medium",
            "frequency": 1 if currency == "EUR" else 2,
            "day_count": "ACT/ACT" if currency == "EUR" else "30/360",
        }))
    rows.append(_instrument({
        "id": "psky_tlb_usd", "group": "tlb", "name": "Incremental Term B, USD",
        "type": "term_loan_b", "priority_rank": 1, "lien": "1L", "currency": "USD",
        "amount": "8500", "coupon": "2.75", "maturity": "2033-10-15",
        "lien_confidence": "unconfirmed", "lien_status": "ok",
        "lien_notes": "Lien versus the 1L notes is NOT PUBLIC. Shown as pari passu 1L until the credit agreement is filed. UNCONFIRMED.",
        "maturity_confidence": "medium",
        "maturity_notes": "Year 2033 is from the pricing release. Day and month are not public.",
    }))
    rows[-1]["coupon_type"] = "floating"
    rows[-1]["spread_bp"] = "275"
    rows[-1]["index"] = "Term SOFR"
    rows[-1]["floor"] = "0"
    rows[-1]["oid"] = "99.75"
    rows[-1]["frequency"] = 4
    rows.append(_instrument({
        "id": "psky_tlb_eur", "group": "tlb", "name": "Incremental Term B, EUR",
        "type": "term_loan_b", "priority_rank": 1, "lien": "1L", "currency": "EUR",
        "amount": "850", "coupon": "2.75", "maturity": "2033-10-15",
        "lien_confidence": "unconfirmed",
        "lien_notes": "Same lien assumption as the dollar term loan. UNCONFIRMED.",
        "maturity_confidence": "medium",
        "frequency": 4, "day_count": "ACT/ACT",
    }))
    rows[-1]["coupon_type"] = "floating"
    rows[-1]["index"] = "EURIBOR"
    rows[-1]["floor"] = "0"
    rows[-1]["oid"] = "100"
    return rows


EXCHANGES = [
    ("wbd_dcl_2029", "4.125% Sr Notes 2029", "DCL", "655.825", "6.250% Sr Sec 2L 2029"),
    ("wbd_dcl_2030", "3.625% Sr Notes 2030", "DCL", "914.183", "4.875% Sr Sec 2L 2030"),
    ("wbd_dcl_2037", "5.000% Sr Notes 2037", "DCL", "453.281", "5.000% Sr Sec 2L 2037"),
    ("wbd_dcl_2040", "6.350% Sr Notes 2040", "DCL", "438.102", "6.350% Sr Sec 2L 2040"),
    ("wbd_dcl_2042", "4.950% Sr Notes 2042", "DCL", "130.366", "4.950% Sr Sec 2L 2042"),
    ("wbd_dcl_2043", "4.875% Sr Notes 2043", "DCL", "141.584", "4.875% Sr Sec 2L 2043"),
    ("wbd_dcl_2047", "5.200% Sr Notes 2047", "DCL", "3.161", "5.200% Sr Sec 2L 2047"),
    ("wbd_dcl_2049", "5.300% Sr Notes 2049", "DCL", "247.860", "5.300% Sr Sec 2L 2049"),
    ("wbd_dgh_2029", "4.054% Sr Notes 2029", "DGH", "1353.828", "6.304% Sr Sec 2L 2029"),
    ("wbd_dgh_2032", "4.279% Sr Notes 2032", "DGH", "2691.764", "4.904% Sr Sec 2L 2032"),
    ("wbd_dgh_2042", "5.050% Sr Notes 2042", "DGH", "4104.687", "5.050% Sr Sec 2L 2042"),
    ("wbd_dgh_2052", "5.141% Sr Notes 2052", "DGH", "949.883", "5.141% Sr Sec 2L 2052"),
    ("wbd_dgh_2030_eur", "4.302% Sr Notes 2030", "DGH", "234.382", "5.802% Sr Sec 2L 2030"),
    ("wbd_dgh_2033_eur", "4.693% Sr Notes 2033", "DGH", "316.641", "5.068% Sr Sec 2L 2033"),
]


def _exchanges() -> list[dict]:
    src = _src("sec_filing", "8-K/A 2026-08-04 exchange table", EXCHANGE, "validly delivered")
    rows = []
    for iid, old, issuer, amount, new_name in EXCHANGES:
        currency = "EUR" if iid.endswith("eur") else "USD"
        year = new_name.split()[-1]
        rows.append({
            "id": iid,
            "issuer_cik": CIK,
            "group": "exchange",
            "name": new_name,
            "obligor": issuer,
            "type": "exchange_note",
            "priority_rank": 2,
            "currency": currency,
            "amount": field(f"{iid}.amount", amount, currency, src, "high", notes=f"Validly delivered of {old}."),
            "coupon": field(f"{iid}.coupon", new_name.split()[0].replace("%", ""), "percent", src, "high"),
            "maturity": field(
                f"{iid}.maturity", year, "year", src, "medium",
                notes="The year is in the exchange note name. The month and day were not in the 8-K/A table, so no maturity day is stored.",
            ),
            "lien": field(f"{iid}.lien", "2L", "text", src, "high",
                          notes="Liens release automatically if two of three agencies rate the notes investment grade."),
            "call_schedule": field(f"{iid}.call", None, "text", src, "high", status="not_public"),
            "frequency": 1 if currency == "EUR" else 2,
            "day_count": "ACT/ACT" if currency == "EUR" else "30/360",
            "coupon_type": "fixed",
        })
    return rows


def covenants() -> list[dict]:
    src_pf = _src("sec_filing", "Pro forma 8-K Ex. 99.2", PROFORMA)
    src_ex = _src("sec_filing", "8-K/A 2026-08-04", EXCHANGE)
    src_con = _src("sec_filing", "8-K 2026-05-19 Ex. 99.1",
                   "https://www.sec.gov/Archives/edgar/data/2041610/000110465926063952/tm2610616d3_ex99-1.htm")
    press = _src("press_release", "Pricing release", PR)

    def row(key, label, status, summary, source):
        return {"key": key, "label": label, "status": status, "summary": summary, "source": source}

    return [
        row("debt_incurrence", "Debt incurrence", "not_public",
            "New-note baskets are in the private 144A offering memorandum.", press),
        row("restricted_payments", "Restricted payments", "not_public",
            "Not in a filed description of notes yet.", press),
        row("liens", "Liens / permitted liens", "not_public",
            "New-note lien covenant is not public.", press),
        row("asset_sale", "Asset-sale sweep", "not_public", "Not public.", press),
        row("change_of_control", "Change of control", "not_public",
            "Whether there is a 101% put is not public.", press),
        row("call_schedule", "Make-whole and call schedule", "not_public",
            "Not public until the indenture or S-4.", press),
        row("lien_release_ig", "Lien release on investment grade", "found",
            "Exchange-note liens release if two of three agencies rate the notes investment grade.", src_pf),
        row("guarantors", "Guarantor coverage", "found",
            "Notes and exchange-note guarantors are the obligors under the Pro Rata Credit Agreement.", src_pf),
        row("priming", "Priming / J.Crew / Chewy / Serta", "not_found",
            "No filed covenant text yet. Moody's said the plan primes existing unsecured holders. That is commentary, not a covenant.",
            _src("news", "Livemint citing Bloomberg", LIVEMINT)),
        row("wbd_amendments", "WBD legacy indenture amendments", "found",
            "If the acquisition closes, junior-lien exchange notes carry no restrictive-liens or restricted-debt-prepayment covenant.",
            src_con),
        row("exchange_table", "WBD notes validly delivered", "found",
            "Delivered principal is in the 8-K/A. Full exchange results are not found.", src_ex),
    ]


def build_fixture() -> dict:
    press = _src("press_release", "Pricing release 2026-09-30", PR)
    ident = _src("sec_filing", "8-K 2026-10-02", EIGHT_K_1002)
    proforma = _src("sec_filing", "8-K 2026-09-28 Ex. 99.2", PROFORMA)
    facts = _src("sec_filing", "PSKY companyfacts", FACTS)
    curve = _src("market_data", "Treasury par yield curve", TREASURY, "2026-10-01")
    fred = _src("market_data", "FRED ICE BofA OAS", FRED, "2026-10-01")
    ir = _src("company_ir", "Paramount IR deck, March 2026",
              "https://ir.paramount.com/static-files/fbfeaf79-6c14-46b8-aa63-de846c6c75e1")
    return {
        "packet_meta": {
            "issuer_cik": CIK,
            "version": 1,
            "stage": "fixture",
            "model": "",
            "created_at": PULLED,
            "parent_version": None,
        },
        "issuer": {
            "cik": CIK,
            "legal_name": "Paramount Skydance Corporation",
            "status": "watch",
            "fiscal_year_end": "12-31",
            "tickers": [
                {"ticker": "PSKY", "exchange": "Nasdaq", "from": "2025-08-07", "to": "2026-10-06"},
                {"ticker": "SKYD", "exchange": "NYSE", "from": "2026-10-06", "to": ""},
            ],
            "related_ciks": ["0001437107"],
            "figi_equity": "BBG01VS5NK99",
        },
        "fields": [
            field("identity.legal_name", "Paramount Skydance Corporation", "text", ident, "high", freshness="static"),
            field("identity.name_change", "Skydance Corporation", "text", ident, "high", freshness="event",
                  notes="Expected effective 2026-10-06."),
            field("identity.ticker_now", "PSKY", "text", ident, "high", freshness="event", as_of="2026-10-02",
                  notes="Nasdaq until on or about 2026-10-06, then SKYD on the NYSE."),
            field("identity.ticker_next", "SKYD", "text", ident, "high", freshness="event"),
            field("deal.expected_close", "2026-10-06", "date",
                  _src("sec_filing", "8-K filed 2026-10-01", EIGHT_K_1001), "high", freshness="event"),
            field("deal.cash_per_wbd_share", "31.00", "USD",
                  _src("sec_filing", "8-K filed 2026-10-01", EIGHT_K_1001, "Item 8.01"), "high", freshness="event",
                  notes="Plus $0.00277778 per calendar day after 2026-09-30."),
            field("notes.settlement", "2026-10-05", "date", press, "high", freshness="event",
                  notes="Expected closing date of the new-issue sale in the September 30, 2026 pricing release. A typed secondary price settles on the next business day, not this date."),
            field("pf.cash", "7803", "USD millions", proforma, "high", freshness="event", as_of="2026-06-30"),
            field("pf.current_debt", "2158", "USD millions", proforma, "high", freshness="event", as_of="2026-06-30"),
            field("pf.long_term_debt", "80277", "USD millions", proforma, "high", freshness="event", as_of="2026-06-30"),
            field("pf.interest_fy2025", "6413", "USD millions", proforma, "high", freshness="terms",
                  notes="Interest expense, net. Shown as a positive cost."),
            field("pf.interest_6m", "3088", "USD millions", proforma, "high", freshness="terms"),
            field("pf.revenue_fy2025", "66132", "USD millions", proforma, "high"),
            field("pf.oi_fy2025", "-2592", "USD millions", proforma, "high"),
            field("pf.da_fy2025", "8454", "USD millions", proforma, "high",
                  notes="Operating income plus D&A is an illustration. Do not call it Adjusted EBITDA."),
            field("standalone.debt_face", "16430", "USD millions", facts, "high", as_of="2026-06-30"),
            field("standalone.cash", "1627", "USD millions", facts, "high", as_of="2026-06-30"),
            field("standalone.revolver_drawn", "1800", "USD millions", facts, "high", as_of="2026-06-30"),
            field("standalone.interest_q2", "255", "USD millions", facts, "high", as_of="2026-06-30"),
            field("standalone.ocf_h1", "504", "USD millions", facts, "high", as_of="2026-06-30"),
            field("standalone.capex_h1", "150", "USD millions", facts, "high", as_of="2026-06-30"),
            field("target.ebitda_with_synergies", "18000", "USD millions", ir, "high", freshness="event",
                  notes="Company says 2026E Adjusted EBITDA including $6B synergies. A promise, not a fact."),
            field("target.synergies", "6000", "USD millions", ir, "high",
                  notes="Run-rate synergies the company says it will reach. Implied EBITDA without synergies is derived."),
            field("target.net_debt", "79000", "USD millions", ir, "high",
                  notes="Company says about $79B net debt at close."),
            # Historical close kept on the packet. Pricing uses credit.market.current_benchmarks.
            field("curve.1M", "4.06", "percent", curve, "high", freshness="market", as_of="2026-10-01",
                  notes="Historical pull. The desk does not price off this row."),
            field("curve.3M", "4.17", "percent", curve, "high", freshness="market", as_of="2026-10-01"),
            field("curve.6M", "4.27", "percent", curve, "high", freshness="market", as_of="2026-10-01"),
            field("curve.1Y", "4.44", "percent", curve, "high", freshness="market", as_of="2026-10-01"),
            field("curve.2Y", "4.78", "percent", curve, "high", freshness="market", as_of="2026-10-01"),
            field("curve.3Y", "4.91", "percent", curve, "high", freshness="market", as_of="2026-10-01"),
            field("curve.5Y", "5.01", "percent", curve, "high", freshness="market", as_of="2026-10-01"),
            field("curve.7Y", "5.12", "percent", curve, "high", freshness="market", as_of="2026-10-01"),
            field("curve.10Y", "5.24", "percent", curve, "high", freshness="market", as_of="2026-10-01"),
            field("curve.20Y", "5.64", "percent", curve, "high", freshness="market", as_of="2026-10-01"),
            field("curve.30Y", "5.61", "percent", curve, "high", freshness="market", as_of="2026-10-01"),
            field("oas.hy", "3.24", "percent", fred, "high", freshness="market", as_of="2026-10-01"),
            field("oas.ig", "0.86", "percent", _src("market_data", "FRED BAMLC0A0CM", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLC0A0CM"), "high", freshness="market", as_of="2026-10-01"),
            field("oas.bbb", "1.06", "percent", _src("market_data", "FRED BAMLC0A4CBBB", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLC0A4CBBB"), "high", freshness="market", as_of="2026-10-01"),
            field("oas.bb", "2.04", "percent", _src("market_data", "FRED BAMLH0A1HYBB", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A1HYBB"), "high", freshness="market", as_of="2026-10-01"),
            field("oas.b", "3.29", "percent", _src("market_data", "FRED BAMLH0A2HYB", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A2HYB"), "high", freshness="market", as_of="2026-10-01"),
            field("oas.ccc", "12.15", "percent", _src("market_data", "FRED BAMLH0A3HYC", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A3HYC"), "high", freshness="market", as_of="2026-10-01"),
            field("rating.1l_sp", "BBB-", "text", _src("news", "Livemint citing Bloomberg", LIVEMINT), "medium", freshness="event"),
            field("rating.1l_fitch", "BBB-", "text", _src("news", "Livemint citing Bloomberg", LIVEMINT), "medium", freshness="event"),
            field("rating.1l_moodys", "Ba1", "text", _src("news", "Livemint citing Bloomberg", LIVEMINT), "medium", freshness="event"),
            field("rating.2l_fitch", "BB-", "text", _src("news", "Search summary only", ""), "low", freshness="event",
                  notes="Kept out of the math."),
            field("rating.issuer_sp", "BB", "text",
                  _src("news", "Arabian Post", "https://thearabianpost.com/paramount-outlines-6-billion-savings-for-warner-financing/"),
                  "unconfirmed", freshness="event", notes="Kept out of the math."),
            field("spread.2066_talk", "330", "bp",
                  _src("news", "Bloomberg Law 2026-09-30", "https://news.bloomberglaw.com/daily-labor-report/paramount-cuts-pricing-on-30-billion-high-grade-bond-sale"),
                  "medium", freshness="market", notes="About T+330 at pricing. Not a live secondary price."),
            field("bond.prices", None, "price", press, "high", status="not_found", freshness="market",
                  notes="No free per-bond price. Enter a clean price from FINRA."),
            field("xbrl.maturities", {"2026": "433", "2027": "584", "2028": "1000", "2029": "500", "2030": "827", "after_2030": "11632"},
                  "USD millions", facts, "high", as_of="2025-12-31",
                  notes="PSKY standalone 10-K schedule. This is before the Warner financing."),
        ],
        "instruments": _notes() + _exchanges(),
        "covenants": covenants(),
        "flags": [
            {"flag_type": "unconfirmed_openfigi",
             "details": "PSKY 0 09/30/34 RegS (BBG025HZQKJ7) does not match a priced tranche. It is stored and left out of the capital structure."},
        ],
        "prices": [],
        "confirmed_ids": [],
    }


def structure_totals(packet: dict | None = None) -> dict:
    packet = packet or build_fixture()
    totals = {"new_1l_usd": Decimal("0"), "new_2l_usd": Decimal("0"), "new_2l_eur": Decimal("0"),
              "tlb_usd": Decimal("0"), "tlb_eur": Decimal("0")}
    for row in packet["instruments"]:
        amount = money((row.get("amount") or {}).get("value"))
        conf = (row.get("amount") or {}).get("confidence")
        if amount is None or conf in {"low", "unconfirmed"}:
            continue
        group = row.get("group")
        currency = row.get("currency")
        if group == "new_1l" and currency == "USD":
            totals["new_1l_usd"] += amount
        elif group == "new_2l" and currency == "USD":
            totals["new_2l_usd"] += amount
        elif group == "new_2l" and currency == "EUR":
            totals["new_2l_eur"] += amount
        elif group == "tlb" and currency == "USD":
            totals["tlb_usd"] += amount
        elif group == "tlb" and currency == "EUR":
            totals["tlb_eur"] += amount
    return {key: str(value) for key, value in totals.items()}


def write_json(path: Path | None = None) -> Path:
    path = path or JSON_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(build_fixture(), indent=2) + "\n", encoding="utf-8")
    return path


def load_json() -> dict:
    return json.loads(JSON_PATH.read_text(encoding="utf-8"))
