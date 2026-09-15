"""Guru 13F desk — SEC EDGAR only. GuruFocus is the UX template, not the feed.

Stores quarterly 13F-HR information tables + subsequent Form 4 / SC 13D / SC 13G
index rows. Refresh on demand. No GuruFocus API calls.
"""
from __future__ import annotations

import time
import xml.etree.ElementTree as ET
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter(tags=["gurus"])


class _Bag:
    pass


B = _Bag()

# Curated roster. Ids are stable slugs for the UI. CIK is the SEC key.
GURU_SEED = [
    {
        "id": "ackman",
        "name": "Bill Ackman",
        "firm": "Pershing Square Capital Management",
        "cik": "0001336528",
    },
    {
        "id": "buffett",
        "name": "Warren Buffett",
        "firm": "Berkshire Hathaway",
        "cik": "0001067983",
    },
    {
        "id": "icahn",
        "name": "Carl Icahn",
        "firm": "Icahn Capital",
        "cik": "0000921669",
    },
    {
        "id": "druckenmiller",
        "name": "Stanley Druckenmiller",
        "firm": "Duquesne Family Office LLC",
        "cik": "0001536411",
    },
    {
        "id": "loeb",
        "name": "Daniel Loeb",
        "firm": "Third Point LLC",
        "cik": "0001040273",
    },
    {
        "id": "einhorn",
        "name": "David Einhorn",
        "firm": "Greenlight Capital (DME Capital Management)",
        "cik": "0001489933",
    },
    {
        "id": "tepper",
        "name": "David Tepper",
        "firm": "Appaloosa LP",
        "cik": "0001656456",
    },
    {
        "id": "marks",
        "name": "Howard Marks",
        "firm": "Oaktree Capital Management LP",
        "cik": "0000949509",
    },
    {
        "id": "burry",
        "name": "Michael Burry",
        "firm": "Scion Asset Management, LLC",
        "cik": "0001649339",
    },
    {
        "id": "paulson",
        "name": "John Paulson",
        "firm": "Paulson & Co. Inc.",
        "cik": "0001035674",
    },
    {
        "id": "klarman",
        "name": "Seth Klarman",
        "firm": "The Baupost Group",
        "cik": "0001061768",
    },
    # Added ui618: latest 13F-HR ≥ $10B and ≤ 50 positions (SEC EDGAR Q2 2026).
    {
        "id": "hohn",
        "name": "Chris Hohn",
        "firm": "TCI Fund Management Ltd",
        "cik": "0001647251",
    },
    {
        "id": "gates",
        "name": "Bill Gates",
        "firm": "Gates Foundation Trust",
        "cik": "0001166559",
    },
    {
        "id": "coleman",
        "name": "Chase Coleman",
        "firm": "Tiger Global Management LLC",
        "cik": "0001167483",
    },
    {
        "id": "singer",
        "name": "Paul Singer",
        "firm": "Elliott Investment Management L.P.",
        "cik": "0001791786",
    },
    {
        "id": "aschenbrenner",
        "name": "Leopold Aschenbrenner",
        "firm": "Situational Awareness LP",
        "cik": "0002045724",
    },
    {
        "id": "mandel",
        "name": "Stephen Mandel",
        "firm": "Lone Pine Capital LLC",
        "cik": "0001061165",
    },
    {
        "id": "baker",
        "name": "Gavin Baker",
        "firm": "Atreides Management, LP",
        "cik": "0001777813",
    },
    {
        "id": "fundsmith",
        "name": "Terry Smith",
        "firm": "Fundsmith LLP",
        "cik": "0001569205",
    },
    {
        "id": "sacerdote",
        "name": "Alex Sacerdote",
        "firm": "Whale Rock Capital Management LLC",
        "cik": "0001387322",
    },
    {
        "id": "avoro",
        "name": "Behzad Aghazadeh",
        "firm": "Avoro Capital Advisors LLC",
        "cik": "0001633313",
    },
    {
        "id": "armitage",
        "name": "John Armitage",
        "firm": "Egerton Capital (UK) LLP",
        "cik": "0001581811",
    },
    {
        "id": "generation",
        "name": "Al Gore / David Blood",
        "firm": "Generation Investment Management LLP",
        "cik": "0001375534",
    },
    {
        "id": "ellenbogen",
        "name": "Henry Ellenbogen",
        "firm": "Durable Capital Partners LP",
        "cik": "0001798849",
    },
]

_ISSUER_TICKER = {
    "UBER TECHNOLOGIES": "UBER",
    "AMAZON COM": "AMZN",
    "AMAZON.COM": "AMZN",
    "MICROSOFT": "MSFT",
    "META PLATFORMS": "META",
    "FACEBOOK": "META",
    "HERTZ GLOBAL": "HTZ",
    "HILTON": "HLT",
    "BROOKFIELD CORP": "BN",
    "BROOKFIELD ASSET": "BAM",
    "RESTAURANT BRANDS": "QSR",
    "HILTON WORLDWIDE": "HLT",
    "CHIPOTLE": "CMG",
    "CANADIAN PACIFIC": "CP",
    "HOWARD HUGHES": "HHH",
    "NIKE": "NKE",
    "APPLE": "AAPL",
    "BANK OF AMERICA": "BAC",
    "AMERICAN EXPRESS": "AXP",
    "COCA COLA": "KO",
    "COCA-COLA": "KO",
    "CHEVRON": "CVX",
    "OCCIDENTAL": "OXY",
    "MOODYS": "MCO",
    "MOODY": "MCO",
    "KRAFT HEINZ": "KHC",
    "DAVITA": "DVA",
    "CVR ENERGY": "CVI",
    "ICAHN ENTERPRISES": "IEP",
    "CHUBB": "CB",
    "DELTA AIR": "DAL",
    "SIRIUS XM": "SIRI",
    "SIRIUSXM": "SIRI",
    "VERISIGN": "VRSN",
    "KROGER": "KR",
    "NVIDIA": "NVDA",
    "TESLA": "TSLA",
    "NETFLIX": "NFLX",
    "BROADCOM": "AVGO",
    "TAIWAN SEMICONDUCTOR": "TSM",
    "ELI LILLY": "LLY",
    "UNITEDHEALTH": "UNH",
    "JPMORGAN": "JPM",
    "VISA": "V",
    "MASTERCARD": "MA",
    "EXXON": "XOM",
    "WALMART": "WMT",
    "COSTCO": "COST",
    "HOME DEPOT": "HD",
    "ORACLE": "ORCL",
    "SALESFORCE": "CRM",
    "PALANTIR": "PLTR",
    "CONSTELLATION ENERGY": "CEG",
    "GE VERNOVA": "GEV",
    "VISTRA": "VST",
    "SPDR S P 500": "SPY",
    "INVESCO QQQ": "QQQ",
    "BERKSHIRE": "BRK.B",
    "FERGUSON": "FERG",
    "GENUINE PARTS": "GPC",
    "TELEFLEX": "TFX",
    "NORWEGIAN CRUISE": "NCLH",
    "MOLINA": "MOH",
    "CME GROUP": "CME",
    "HERBALIFE": "HLF",
    "EAGLE MAT": "EXP",
    "EAGLE MATERIALS": "EXP",
    "GDS HLDGS": "GDS",
    "GDS HOLDINGS": "GDS",
    "AMERICOLD": "COLD",
    "AXALTA": "AXTA",
    "DNOW INC": "DNOW",
    "PERSHING SQUARE": "PS",
    "ELEVANCE": "ELV",
    "SEAPORT ENT": "SEG",
    "SEAPORT ENTERTAINMENT": "SEG",
    "PFIZER": "PFE",
    "HALLIBURTON": "HAL",
    "LULULEMON": "LULU",
    "SLM CORP": "SLM",
    "BRUKER": "BRKR",
    "MADRIGAL": "MDGL",
    "PERPETUA": "PPTA",
    "ACADIAN ASSET": "AAMI",
    "BAUSCH HEALTH": "BHC",
    "BAUSCH PLUS LOMB": "BLCO",
    "BAUSCH + LOMB": "BLCO",
    "INTERNATIONAL TOWER HILL": "THM",
    "NOVAGOLD": "NG",
    "THRYV": "THRY",
    "CENTURI": "CTRI",
    "INTERNATIONAL FLAVORS": "IFF",
    "ECHOSTAR": "SATS",
    "JETBLUE": "JBLU",
    "MONRO": "MNRO",
    "CAESARS": "CZR",
    "SANDRIDGE": "SD",
    "AMERICAN ELECTRIC POWER": "AEP",
    "CVR PARTNERS": "UAN",
}

_LEGAL_SUFFIX = {
    "INC", "CORP", "LTD", "LLC", "LP", "PLC", "CO", "COMPANY", "INCORPORATED",
    "CORPORATION", "HOLDINGS", "HLDGS", "GROUP", "LIMITED", "PLC", "SA", "NV",
    "AG", "PLC", "THE", "PLC",
}
_ABBR = {
    "MATLS": "MATERIALS",
    "HLDGS": "HOLDINGS",
    "INTL": "INTERNATIONAL",
    "INDS": "INDUSTRIES",
    "SVCS": "SERVICES",
    "MGMT": "MANAGEMENT",
    "ENTMT": "ENTERTAINMENT",
    "INCORPORATED": "INC",
}
_CUSIP_TICKER = {
    "02079K107": "GOOGL",
    "02079K305": "GOOG",
}
_SEC_TITLE_TICKER: dict[str, str] = {}
_SEC_TITLE_LOADED = 0.0
_CUSIP_CACHE: dict[str, str] = {}


def mount(ns: dict) -> None:
    for key in (
        "app", "_fund_conn", "_RealDictCursor", "_PSYCOPG2_OK",
        "_claims_or_401",
    ):
        if key in ns:
            setattr(B, key, ns[key])
    ns["app"].include_router(router)
    print("[boot] gurus domain mounted (SEC 13F)", flush=True)


def _gp(request: Request) -> dict:
    claims = B._claims_or_401(request)
    if claims.get("role") not in ("gp", "admin"):
        raise HTTPException(403, "GP only")
    return claims


def _seed(gid: str) -> dict:
    for g in GURU_SEED:
        if g["id"] == gid:
            return g
    raise HTTPException(404, "Unknown guru")


def _tag(el: ET.Element) -> str:
    return (el.tag or "").split("}", 1)[-1].lower()


def _text(el: Optional[ET.Element]) -> str:
    if el is None:
        return ""
    if el.text and str(el.text).strip():
        return str(el.text).strip()
    for child in list(el):
        t = _text(child)
        if t:
            return t
    return ""


def _find(el: ET.Element, *names: str) -> Optional[ET.Element]:
    want = {n.lower() for n in names}
    for child in list(el):
        if _tag(child) in want:
            return child
        nested = _find(child, *names)
        if nested is not None:
            return nested
    return None


def _f(v: Any) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return None


def _norm_issuer(name: str) -> str:
    n = " ".join(
        (name or "").upper().replace(".", " ").replace(",", " ").replace("/", " ").split()
    )
    parts = [_ABBR.get(p, p) for p in n.split() if p]
    while parts and parts[0] in ("THE",):
        parts.pop(0)
    while parts and parts[-1] in _LEGAL_SUFFIX:
        parts.pop()
    return " ".join(parts)


def ticker_from_issuer(name: str, title: str = "", cusip: str = "") -> Optional[str]:
    n = " ".join((name or "").upper().replace(".", " ").replace(",", " ").split())
    t = " ".join((title or "").upper().replace(".", " ").replace(",", " ").split())
    c = (cusip or "").upper()
    if c and c in _CUSIP_TICKER:
        return _CUSIP_TICKER[c]
    if not n:
        return None
    if "ALPHABET" in n:
        if "CL C" in t or "CLASS C" in t or c == "02079K305":
            return "GOOG"
        return "GOOGL"
    if "BERKSHIRE" in n:
        if "CL A" in t or "CLASS A" in t:
            return "BRK.A"
        return "BRK.B"
    if "LIBERTY GLOBAL" in n:
        if "CL C" in t or "CLASS C" in t:
            return "LBTYK"
        if "CL A" in t or "CLASS A" in t:
            return "LBTYA"
        return "LBTYK"
    for needle, tk in _ISSUER_TICKER.items():
        if needle in n:
            return tk
    return None


def parse_13f_infotable(xml_text: str) -> list[dict]:
    """Parse a 13F information-table XML into holding dicts."""
    out: list[dict] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    rows = [el for el in root.iter() if _tag(el) == "infotable"]
    for row in rows:
        issuer = _text(_find(row, "nameofissuer"))
        title = _text(_find(row, "titleofclass"))
        cusip = _text(_find(row, "cusip")).upper()
        value = _f(_text(_find(row, "value")))
        sh_el = _find(row, "shrsorprnamt", "sshprnamt")
        shares = _f(_text(_find(sh_el, "sshprnamt") if sh_el is not None else _find(row, "sshprnamt")))
        put_call = _text(_find(row, "putcall")) or None
        if not issuer and not cusip:
            continue
        # SEC spec is $ thousands; some filers put dollars. Infer from implied price.
        value_k = value
        if value is not None and shares and shares > 0:
            px = value / shares
            if 0.25 <= px <= 50000:
                value_k = value / 1000.0  # was dollars
        out.append({
            "issuer": issuer,
            "title": title,
            "cusip": cusip,
            "symbol": ticker_from_issuer(issuer, title, cusip),
            "value_k": value_k,
            "shares": shares,
            "put_call": put_call,
        })
    return out


def parse_form4_transactions(xml_text: str) -> list[dict]:
    """Non-derivative Form 4 transactions."""
    out: list[dict] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out
    issuer = ""
    iss = _find(root, "issuername", "issuerName".lower())
    if iss is not None:
        issuer = _text(iss)
    tick = _text(_find(root, "issuertradingsymbol"))
    for tx in [el for el in root.iter() if _tag(el) == "nonderivativetransaction"]:
        code = _text(_find(tx, "transactioncode"))
        ad = _text(_find(tx, "transactionacquireddisposedcode"))
        shares = _f(_text(_find(tx, "transactionshares")))
        px = _f(_text(_find(tx, "transactionpricepershare")))
        dt = _text(_find(tx, "transactiondate"))
        title = _text(_find(tx, "securitytitle"))
        action = "Buy" if (ad or "").upper() == "A" or (code or "").upper() == "P" else (
            "Sell" if (ad or "").upper() == "D" or (code or "").upper() == "S" else (code or "—")
        )
        out.append({
            "date": dt[:10],
            "issuer": issuer,
            "symbol": (tick or ticker_from_issuer(issuer) or "").upper() or None,
            "title": title,
            "action": action,
            "code": code,
            "shares": shares,
            "price": px,
        })
    return out


def classify_actions(prev: list[dict], curr: list[dict]) -> list[dict]:
    """QoQ New Buy / Add / Reduce / Sold Out / Hold by CUSIP (fallback issuer)."""
    def key(h):
        return (h.get("cusip") or "") or (h.get("issuer") or "").upper()

    pmap = {key(h): h for h in prev if key(h)}
    cmap = {key(h): h for h in curr if key(h)}
    total_now = sum((h.get("value_k") or 0) for h in curr) or 1.0
    rows = []
    for k, h in cmap.items():
        old = pmap.get(k)
        sh = h.get("shares") or 0
        old_sh = (old or {}).get("shares") or 0
        w = ((h.get("value_k") or 0) / total_now) * 100.0
        if old is None:
            action, delta = "New Buy", sh
        elif sh > old_sh * 1.001:
            action, delta = "Add", sh - old_sh
        elif sh < old_sh * 0.999:
            action, delta = "Reduce", sh - old_sh
        else:
            action, delta = "Hold", 0
        rec = dict(h)
        rec["weight_pct"] = round(w, 2)
        rec["action"] = action
        rec["share_change"] = delta
        rec["impact"] = round(((h.get("value_k") or 0) - ((old or {}).get("value_k") or 0)) / total_now * 100.0, 2)
        rows.append(rec)
    for k, h in pmap.items():
        if k in cmap:
            continue
        rec = dict(h)
        rec["weight_pct"] = 0
        rec["action"] = "Sold Out"
        rec["share_change"] = -(h.get("shares") or 0)
        rec["impact"] = round(-((h.get("value_k") or 0) / total_now) * 100.0, 2)
        rec["shares"] = 0
        rec["value_k"] = 0
        rows.append(rec)
    rows.sort(key=lambda r: abs(r.get("impact") or 0), reverse=True)
    return rows


def _sec_ua() -> str:
    try:
        import market_data as md
        return md._sec_ua()
    except Exception:
        return "DGA-Capital-Research contact@dgacapital.com"


def _get(url: str, timeout: int = 25):
    import requests
    time.sleep(0.12)
    r = requests.get(
        url,
        headers={
            "User-Agent": _sec_ua(),
            "Accept-Encoding": "gzip, deflate",
            "Accept": "application/json, application/xml, text/xml, */*",
        },
        timeout=timeout,
    )
    return r


def _load_sec_titles() -> None:
    """SEC company_tickers.json → normalized issuer title → ticker."""
    global _SEC_TITLE_LOADED
    if _SEC_TITLE_TICKER and (time.time() - _SEC_TITLE_LOADED) < 6 * 3600:
        return
    try:
        r = _get("https://www.sec.gov/files/company_tickers.json", timeout=30)
        if r.status_code != 200:
            return
        data = r.json() or {}
    except Exception:
        return
    n = 0
    for entry in data.values() if isinstance(data, dict) else []:
        if not isinstance(entry, dict):
            continue
        tk = str(entry.get("ticker") or "").strip().upper()
        title = _norm_issuer(str(entry.get("title") or ""))
        if not tk or not title:
            continue
        _SEC_TITLE_TICKER.setdefault(title, tk)
        n += 1
    _SEC_TITLE_LOADED = time.time()
    print(f"[gurus] SEC title map {n} names", flush=True)


def _load_cusip_cache() -> None:
    if _CUSIP_CACHE or not getattr(B, "_PSYCOPG2_OK", False):
        return
    try:
        with B._fund_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT cusip, symbol FROM guru_cusip_map WHERE symbol IS NOT NULL")
            for c, s in cur.fetchall() or []:
                if c and s:
                    _CUSIP_CACHE[str(c).upper()] = str(s).upper()
    except Exception:
        pass


def _save_cusip_map(pairs: list[tuple[str, str, str]]) -> None:
    if not pairs or not getattr(B, "_PSYCOPG2_OK", False):
        return
    try:
        with B._fund_conn() as conn, conn.cursor() as cur:
            for cusip, symbol, issuer in pairs:
                cur.execute(
                    """INSERT INTO guru_cusip_map (cusip, symbol, issuer)
                       VALUES (%s,%s,%s)
                       ON CONFLICT (cusip) DO UPDATE SET
                         symbol=EXCLUDED.symbol, issuer=EXCLUDED.issuer,
                         updated_at=now()""",
                    (cusip, symbol, issuer),
                )
                _CUSIP_CACHE[cusip] = symbol
            conn.commit()
    except Exception as e:
        print(f"[gurus] cusip map save: {e!s:.160}", flush=True)


def _openfigi_cusips(cusips: list[str]) -> dict[str, str]:
    """CUSIP → listed ticker via OpenFIGI (free, batched)."""
    out: dict[str, str] = {}
    want = [c.upper() for c in cusips if c and len(c) >= 8]
    if not want:
        return out
    import os
    import requests
    key = (os.environ.get("OPENFIGI_API_KEY") or "").strip()
    headers = {"Content-Type": "application/json"}
    if key:
        headers["X-OPENFIGI-APIKEY"] = key
    for i in range(0, len(want), 10):
        chunk = want[i:i + 10]
        body = [{"idType": "ID_CUSIP", "idValue": c} for c in chunk]
        try:
            time.sleep(0.25)
            r = requests.post(
                "https://api.openfigi.com/v3/mapping",
                json=body,
                headers=headers,
                timeout=20,
            )
            if r.status_code != 200:
                continue
            rows = r.json() or []
        except Exception:
            continue
        for cusip, rec in zip(chunk, rows):
            data = (rec or {}).get("data") or []
            pick = None
            for d in data:
                tk = str(d.get("ticker") or "").strip().upper()
                if not tk or " " in tk:
                    continue
                exch = str(d.get("exchCode") or "").upper()
                if exch in ("US", "UN", "UW", "UA", "UN", "NYSE", "NASDAQ", "AMEX", "ARCA", "BATS"):
                    pick = tk
                    break
                if pick is None:
                    pick = tk
            if pick:
                out[cusip] = pick.split("/")[0]
    return out


def _fill_missing_symbols(gid: str, rows: list[dict]) -> list[dict]:
    """Stamp a ticker on 13F rows that only have an issuer/CUSIP."""
    if not rows:
        return rows
    _load_sec_titles()
    _load_cusip_cache()
    found: list[tuple[str, str, str]] = []
    still: list[dict] = []
    for r in rows:
        if r.get("symbol"):
            continue
        tk = ticker_from_issuer(r.get("issuer") or "", r.get("title") or "", r.get("cusip") or "")
        if not tk:
            tk = _CUSIP_CACHE.get((r.get("cusip") or "").upper())
        if not tk:
            tk = _SEC_TITLE_TICKER.get(_norm_issuer(r.get("issuer") or ""))
        if tk:
            r["symbol"] = tk
            if r.get("cusip"):
                found.append((str(r["cusip"]).upper(), tk, r.get("issuer") or ""))
        else:
            still.append(r)
    if still:
        figi = _openfigi_cusips([str(r.get("cusip") or "") for r in still])
        for r in still:
            tk = figi.get((r.get("cusip") or "").upper())
            if tk:
                r["symbol"] = tk
                found.append((str(r["cusip"]).upper(), tk, r.get("issuer") or ""))
    if found:
        _save_cusip_map(found)
        if getattr(B, "_PSYCOPG2_OK", False):
            try:
                with B._fund_conn() as conn, conn.cursor() as cur:
                    for cusip, symbol, _iss in found:
                        cur.execute(
                            """UPDATE guru_13f_holdings
                                  SET symbol=%s
                                WHERE guru_id=%s AND cusip=%s
                                  AND (symbol IS NULL OR symbol='')""",
                            (symbol, gid, cusip),
                        )
                    conn.commit()
            except Exception as e:
                print(f"[gurus] symbol backfill: {e!s:.160}", flush=True)
    return rows


def _ensure_tables() -> None:
    if not getattr(B, "_PSYCOPG2_OK", False):
        return
    with B._fund_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS guru_13f_holdings (
                guru_id TEXT NOT NULL,
                portdate DATE NOT NULL,
                cusip TEXT NOT NULL DEFAULT '',
                symbol TEXT,
                issuer TEXT,
                title TEXT,
                shares DOUBLE PRECISION,
                value_k DOUBLE PRECISION,
                weight_pct DOUBLE PRECISION,
                action TEXT,
                share_change DOUBLE PRECISION,
                impact DOUBLE PRECISION,
                put_call TEXT,
                PRIMARY KEY (guru_id, portdate, cusip, issuer)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS guru_filings (
                guru_id TEXT NOT NULL,
                form TEXT NOT NULL,
                filed DATE,
                portdate DATE,
                accession TEXT NOT NULL,
                primary_doc TEXT,
                url TEXT,
                PRIMARY KEY (guru_id, accession)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS guru_form4 (
                guru_id TEXT NOT NULL,
                filed DATE,
                tx_date DATE,
                symbol TEXT,
                issuer TEXT,
                action TEXT,
                code TEXT,
                shares DOUBLE PRECISION,
                price DOUBLE PRECISION,
                accession TEXT,
                id SERIAL PRIMARY KEY
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS guru_cusip_map (
                cusip TEXT PRIMARY KEY,
                symbol TEXT NOT NULL,
                issuer TEXT,
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        """)
        conn.commit()


def _list_13f(cik: str, limit: int = 12) -> list[dict]:
    cik10 = str(cik).zfill(10)
    r = _get(f"https://data.sec.gov/submissions/CIK{cik10}.json")
    if r.status_code != 200:
        raise RuntimeError(f"SEC submissions HTTP {r.status_code}")
    recent = (r.json().get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    filed = recent.get("filingDate") or []
    report = recent.get("reportDate") or []
    accs = recent.get("accessionNumber") or []
    primaries = recent.get("primaryDocument") or []
    out = []
    for i, form in enumerate(forms):
        f = str(form or "")
        if not (f.startswith("13F-HR") or f in ("4", "SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A")):
            continue
        out.append({
            "form": f,
            "filed": (filed[i] if i < len(filed) else "")[:10],
            "portdate": (report[i] if i < len(report) else "")[:10],
            "accession": accs[i] if i < len(accs) else "",
            "primary": primaries[i] if i < len(primaries) else "",
        })
        if len(out) >= limit * 4:
            break
    return out


def _fetch_infotable(cik: str, accession: str) -> str:
    cik_int = str(int(str(cik).zfill(10)))
    acc = str(accession).replace("-", "")
    base = f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{acc}/"
    idx = _get(base + "index.json")
    names: list[str] = []
    if idx.status_code == 200:
        try:
            items = ((idx.json().get("directory") or {}).get("item")) or []
            for it in items:
                n = str(it.get("name") or "")
                low = n.lower()
                if low.endswith(".xml") or low.endswith(".txt"):
                    names.append(n)
        except Exception:
            pass
    def score(n: str) -> int:
        low = n.lower()
        s = 0
        if "infotable" in low or "form13f" in low or "13f" in low and "info" in low:
            s += 80
        if low.endswith(".xml"):
            s += 20
        if "primary" in low or "xsl" in low:
            s -= 20
        return s
    names = sorted(set(names), key=score, reverse=True)
    for n in names[:8]:
        r = _get(base + n, timeout=30)
        if r.status_code != 200 or len(r.text or "") < 200:
            continue
        if "<infoTable" in r.text or "<infotable" in r.text.lower() or "nameOfIssuer" in r.text:
            return r.text
    return ""


def _refresh_guru(gid: str) -> dict:
    seed = _seed(gid)
    cik = seed["cik"]
    _ensure_tables()
    filings = _list_13f(cik, limit=16)
    f13 = [f for f in filings if str(f.get("form") or "").startswith("13F-HR")]
    extras = [f for f in filings if not str(f.get("form") or "").startswith("13F-HR")]
    stored_q = 0
    prev_holdings: list[dict] = []
    # Oldest first so we can classify vs prior quarter
    f13_sorted = sorted(f13, key=lambda x: x.get("portdate") or x.get("filed") or "")
    with B._fund_conn() as conn, conn.cursor() as cur:
        for f in extras[:40]:
            cur.execute(
                """INSERT INTO guru_filings (guru_id, form, filed, portdate, accession, primary_doc, url)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (guru_id, accession) DO NOTHING""",
                (
                    gid, f.get("form"), f.get("filed") or None, f.get("portdate") or None,
                    f.get("accession"), f.get("primary"),
                    f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{str(f.get('accession') or '').replace('-', '')}/",
                ),
            )
        for f in f13_sorted[-12:]:
            portdate = f.get("portdate") or f.get("filed")
            if not portdate or not f.get("accession"):
                continue
            cur.execute(
                "SELECT count(*) FROM guru_13f_holdings WHERE guru_id=%s AND portdate=%s",
                (gid, portdate),
            )
            n = cur.fetchone()[0]
            if n:
                cur.execute(
                    """SELECT cusip, symbol, issuer, title, shares, value_k, put_call
                         FROM guru_13f_holdings WHERE guru_id=%s AND portdate=%s""",
                    (gid, portdate),
                )
                prev_holdings = [
                    {
                        "cusip": r[0], "symbol": r[1], "issuer": r[2], "title": r[3],
                        "shares": r[4], "value_k": r[5], "put_call": r[6],
                    }
                    for r in cur.fetchall()
                ]
                stored_q += 1
                continue
            xml = _fetch_infotable(cik, f["accession"])
            holdings = parse_13f_infotable(xml) if xml else []
            if not holdings:
                continue
            classified = classify_actions(prev_holdings, holdings)
            total = sum((h.get("value_k") or 0) for h in classified if h.get("action") != "Sold Out") or 1.0
            for h in classified:
                if h.get("action") != "Sold Out":
                    h["weight_pct"] = round(((h.get("value_k") or 0) / total) * 100.0, 2)
                cur.execute(
                    """INSERT INTO guru_13f_holdings
                       (guru_id, portdate, cusip, symbol, issuer, title, shares, value_k,
                        weight_pct, action, share_change, impact, put_call)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (guru_id, portdate, cusip, issuer) DO UPDATE SET
                         symbol=EXCLUDED.symbol, shares=EXCLUDED.shares, value_k=EXCLUDED.value_k,
                         weight_pct=EXCLUDED.weight_pct, action=EXCLUDED.action,
                         share_change=EXCLUDED.share_change, impact=EXCLUDED.impact""",
                    (
                        gid, portdate, h.get("cusip") or "", h.get("symbol"),
                        h.get("issuer"), h.get("title"), h.get("shares"), h.get("value_k"),
                        h.get("weight_pct"), h.get("action"), h.get("share_change"),
                        h.get("impact"), h.get("put_call"),
                    ),
                )
            cur.execute(
                """INSERT INTO guru_filings (guru_id, form, filed, portdate, accession, primary_doc, url)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (guru_id, accession) DO NOTHING""",
                (
                    gid, f.get("form"), f.get("filed") or None, portdate,
                    f.get("accession"), f.get("primary"),
                    f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{str(f.get('accession') or '').replace('-', '')}/",
                ),
            )
            prev_holdings = [h for h in classified if h.get("action") != "Sold Out"]
            stored_q += 1
        conn.commit()
    return {"ok": True, "guru": gid, "quarters": stored_q, "filings": len(filings)}


def _holdings_rows(gid: str, portdate: Optional[str] = None) -> tuple[str | None, list[dict]]:
    _ensure_tables()
    with B._fund_conn() as conn, conn.cursor(cursor_factory=B._RealDictCursor) as cur:
        if not portdate:
            cur.execute(
                "SELECT max(portdate) AS d FROM guru_13f_holdings WHERE guru_id=%s",
                (gid,),
            )
            row = cur.fetchone() or {}
            portdate = str(row.get("d") or "")[:10] or None
        if not portdate:
            return None, []
        cur.execute(
            """SELECT symbol, issuer, title, cusip, shares, value_k, weight_pct,
                      action, share_change, impact, put_call
                 FROM guru_13f_holdings
                WHERE guru_id=%s AND portdate=%s
                ORDER BY value_k DESC NULLS LAST""",
            (gid, portdate),
        )
        rows = [dict(r) for r in (cur.fetchall() or [])]
    rows = _fill_missing_symbols(gid, rows)
    return portdate, rows


def _kpis_from_rows(rows: list[dict]) -> dict:
    live = [r for r in rows if (r.get("action") or "") != "Sold Out"]
    equity_k = sum((r.get("value_k") or 0) for r in live)
    n_new = sum(1 for r in live if r.get("action") == "New Buy")
    n_sold = sum(1 for r in rows if r.get("action") == "Sold Out")
    n_add = sum(1 for r in live if r.get("action") == "Add")
    n_cut = sum(1 for r in live if r.get("action") == "Reduce")
    turned = sum(abs(r.get("impact") or 0) for r in rows if r.get("action") in ("New Buy", "Add", "Reduce", "Sold Out"))
    ranked = sorted(live, key=lambda x: -(x.get("weight_pct") or 0))
    top5 = sum((r.get("weight_pct") or 0) for r in ranked[:5])
    top10 = sum((r.get("weight_pct") or 0) for r in ranked[:10])
    hhi = sum(((r.get("weight_pct") or 0) / 100.0) ** 2 for r in live)
    return {
        "equity_k": equity_k,
        "n": len(live),
        "n_new": n_new,
        "n_sold": n_sold,
        "n_add": n_add,
        "n_cut": n_cut,
        "turnover_proxy": round(turned / 2.0, 1),
        "top5_pct": round(top5, 1),
        "top10_pct": round(top10, 1),
        "hhi": round(hhi, 4),
    }


def _book_hist(gid: str) -> list[dict]:
    _ensure_tables()
    if not getattr(B, "_PSYCOPG2_OK", False):
        return []
    with B._fund_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT portdate, action, value_k
                 FROM guru_13f_holdings WHERE guru_id=%s
                 ORDER BY portdate""",
            (gid,),
        )
        raw = cur.fetchall() or []
    by: dict[str, dict] = {}
    for d, action, vk in raw:
        key = str(d)[:10]
        rec = by.setdefault(key, {"portdate": key, "equity_k": 0.0, "n": 0})
        if (action or "") != "Sold Out":
            rec["equity_k"] += float(vk or 0)
            rec["n"] += 1
    return [by[k] for k in sorted(by)]


def _overlap_for(gid: str, live: list[dict]) -> list[dict]:
    """Other roster books that also hold this guru's top names (latest 13F)."""
    syms = [str(r.get("symbol") or "").upper() for r in live if r.get("symbol")][:12]
    if not syms or not getattr(B, "_PSYCOPG2_OK", False):
        return []
    _ensure_tables()
    with B._fund_conn() as conn, conn.cursor() as cur:
        cur.execute(
            """
            WITH latest AS (
              SELECT guru_id, max(portdate) AS d
                FROM guru_13f_holdings GROUP BY guru_id
            )
            SELECT h.guru_id, upper(h.symbol) AS symbol, h.weight_pct
              FROM guru_13f_holdings h
              JOIN latest l ON l.guru_id=h.guru_id AND l.d=h.portdate
             WHERE h.guru_id <> %s
               AND upper(h.symbol) IN ({ph})
               AND (h.action IS NULL OR h.action <> 'Sold Out')
            """.format(ph=",".join(["%s"] * len(syms))),
            (gid, *syms),
        )
        others = cur.fetchall() or []
    by_sym: dict[str, list] = {}
    name_of = {g["id"]: g["name"] for g in GURU_SEED}
    seen: set[tuple[str, str]] = set()
    for ogid, sym, wt in others:
        key = (str(ogid), str(sym))
        if key in seen:
            continue
        seen.add(key)
        by_sym.setdefault(sym, []).append({
            "id": ogid,
            "name": name_of.get(ogid, ogid),
            "weight_pct": round(float(wt or 0), 1),
        })
    out = []
    for r in live:
        tk = str(r.get("symbol") or "").upper()
        if not tk or tk not in by_sym:
            continue
        also = sorted(by_sym[tk], key=lambda x: -(x.get("weight_pct") or 0))
        out.append({
            "symbol": tk,
            "weight_pct": r.get("weight_pct"),
            "also": also,
        })
        if len(out) >= 10:
            break
    return out


@router.get("/api/gurus")
def gurus_list(request: Request):
    _gp(request)
    _ensure_tables()
    stats: dict[str, dict] = {}
    if getattr(B, "_PSYCOPG2_OK", False):
        with B._fund_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                WITH latest AS (
                  SELECT guru_id, max(portdate) AS d
                    FROM guru_13f_holdings GROUP BY guru_id
                )
                SELECT h.guru_id, h.portdate, h.action, h.weight_pct, h.value_k, h.impact
                  FROM guru_13f_holdings h
                  JOIN latest l ON l.guru_id=h.guru_id AND l.d=h.portdate
                """
            )
            bag: dict[str, list] = {}
            dates: dict[str, str] = {}
            for gid, d, action, wt, vk, impact in cur.fetchall() or []:
                bag.setdefault(gid, []).append({
                    "action": action, "weight_pct": wt, "value_k": vk, "impact": impact,
                })
                dates[gid] = str(d)[:10]
            for gid, rows in bag.items():
                stats[gid] = {**_kpis_from_rows(rows), "last_13f": dates.get(gid)}
    out = []
    for g in GURU_SEED:
        st = stats.get(g["id"]) or {}
        out.append({
            **g,
            "last_13f": st.get("last_13f"),
            "cached_rows": None,
            **{k: st.get(k) for k in (
                "equity_k", "n", "n_new", "n_sold", "turnover_proxy", "top5_pct",
            )},
        })
    return {"ok": True, "gurus": out}


@router.get("/api/gurus/{gid}")
def gurus_summary(gid: str, request: Request):
    _gp(request)
    seed = _seed(gid)
    portdate, rows = _holdings_rows(gid)
    live = [r for r in rows if (r.get("action") or "") != "Sold Out"]
    kpis = _kpis_from_rows(rows)
    return {
        "ok": True,
        "guru": seed,
        "portdate": portdate,
        "holdings": live,
        "kpis": kpis,
        "book_hist": _book_hist(gid),
        "overlap": _overlap_for(gid, live),
        "source": "sec_13f",
        "caveat": "13F is long-only US-listed equities, filed up to 45 days after quarter-end. Shorts and most non-US names are absent.",
    }


@router.get("/api/gurus/{gid}/holdings")
def gurus_holdings(gid: str, request: Request, portdate: str = ""):
    _gp(request)
    _seed(gid)
    d, rows = _holdings_rows(gid, portdate or None)
    return {"ok": True, "portdate": d, "holdings": rows}


@router.get("/api/gurus/{gid}/activity")
def gurus_activity(gid: str, request: Request, kind: str = "all"):
    _gp(request)
    _seed(gid)
    d, rows = _holdings_rows(gid)
    acts = [r for r in rows if (r.get("action") or "Hold") != "Hold"]
    k = (kind or "all").lower()
    if k == "buys":
        acts = [r for r in acts if r.get("action") in ("New Buy", "Add")]
    elif k == "sells":
        acts = [r for r in acts if r.get("action") in ("Reduce", "Sold Out")]
    extras = []
    _ensure_tables()
    with B._fund_conn() as conn, conn.cursor(cursor_factory=B._RealDictCursor) as cur:
        cur.execute(
            """SELECT form, filed, portdate, accession, url
                 FROM guru_filings
                WHERE guru_id=%s AND form NOT LIKE '13F%%'
                ORDER BY filed DESC NULLS LAST LIMIT 40""",
            (gid,),
        )
        extras = [dict(r) for r in (cur.fetchall() or [])]
    return {"ok": True, "portdate": d, "trades": acts, "subsequent_filings": extras}


@router.get("/api/gurus/{gid}/history")
def gurus_history(gid: str, request: Request, freq: str = "q"):
    _gp(request)
    _seed(gid)
    _ensure_tables()
    with B._fund_conn() as conn, conn.cursor(cursor_factory=B._RealDictCursor) as cur:
        cur.execute(
            """SELECT portdate, symbol, issuer, title, cusip, weight_pct, value_k, shares
                 FROM guru_13f_holdings
                WHERE guru_id=%s AND (action IS NULL OR action <> 'Sold Out')
                ORDER BY portdate""",
            (gid,),
        )
        rows = [dict(r) for r in (cur.fetchall() or [])]
    rows = _fill_missing_symbols(gid, rows)

    def _ident(r: dict) -> str:
        return (r.get("cusip") or r.get("symbol") or r.get("issuer") or "?").upper()

    def _label(r: dict) -> str:
        tk = (r.get("symbol") or ticker_from_issuer(
            r.get("issuer") or "", r.get("title") or "", r.get("cusip") or "",
        ) or "").upper()
        if tk:
            return tk
        iss = " ".join((r.get("issuer") or "?").split())
        return iss[:8]

    by_date: dict[str, list] = {}
    for r in rows:
        d = str(r.get("portdate") or "")[:10]
        if freq.startswith("y") and not d.endswith("-12-31"):
            # keep last filing of each year instead
            pass
        by_date.setdefault(d, []).append(r)
    dates = sorted(by_date.keys())
    if freq.startswith("y"):
        year_last = {}
        for d in dates:
            year_last[d[:4]] = d
        dates = [year_last[y] for y in sorted(year_last)]
    latest = by_date.get(dates[-1], []) if dates else []
    top = sorted(latest, key=lambda x: -(x.get("weight_pct") or 0))[:6]
    series = []
    used_labels: set[str] = set()
    for r in top:
        ident = _ident(r)
        lab = _label(r)
        if lab in used_labels:
            lab = f"{lab}·{(r.get('cusip') or '')[-3:]}"
        used_labels.add(lab)
        vals = []
        for d in dates:
            hit = next((x for x in by_date.get(d, []) if _ident(x) == ident), None)
            vals.append(None if not hit else hit.get("weight_pct"))
        series.append({"key": lab, "weights": vals})
    return {"ok": True, "freq": "y" if freq.startswith("y") else "q", "dates": dates, "series": series}


@router.post("/api/gurus/{gid}/refresh")
def gurus_refresh(gid: str, request: Request):
    _gp(request)
    _seed(gid)
    try:
        return _refresh_guru(gid)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[gurus] refresh {gid}: {e!s:.200}", flush=True)
        return JSONResponse({"ok": False, "error": str(e)[:240]}, status_code=502)
