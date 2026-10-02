"""CIK, ticker, and acquirer name resolution. Fuzzy match falls back if rapidfuzz is missing."""

from __future__ import annotations

import difflib
import re

_SUFFIXES = (
    "incorporated",
    "corporation",
    "holdings",
    "company",
    "inc",
    "corp",
    "llc",
    "ltd",
    "lp",
    "co",
)
_DISPLAY = re.compile(
    r"^(?P<title>.*?)\s*\((?P<tickers>[A-Z]{1,6}(?:\s*,\s*[A-Z]{1,6})*)\)\s*\(CIK\s+(?P<cik>\d+)\)\s*$",
    re.I,
)
# A one-letter parenthesis is a clause marker, "(A)", not a ticker.
_TICKER_PAREN = re.compile(r"\(([A-Z]{2,5})\)")
_ACQUIRED_BY = re.compile(
    r"([A-Z][\w.&,'\-]+(?:\s+[A-Z][\w.&,'\-]+){0,8})\s+will be acquired by\s+"
    r"([A-Z][\w.&,'\-]+(?:\s+[A-Z][\w.&,'\-]+){0,8})"
)
_MERGE_INTO = re.compile(
    r"merge with and into\s+([A-Z][\w.&,'\-]+(?:\s+[A-Z][\w.&,'\-]+){0,8})",
    re.I,
)
_TO_ACQUIRE = re.compile(
    r"^(.{2,80}?)\s+to acquire\s+([^.(]{2,80})",
    re.I,
)
_EXCHANGE_TICKER = re.compile(r"(?:Nasdaq|NYSE|NYSEAMERICAN)\s*:\s*([A-Z]{1,5})", re.I)


def pad_cik(value) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if not digits:
        return ""
    return digits.zfill(10)[-10:]


def document_url(cik: str, adsh: str, filename: str) -> str:
    accession = (adsh or "").replace("-", "")
    return (
        f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
        f"{accession}/{filename}"
    )


def normalize_acquirer(name: str) -> str:
    text = (name or "").lower().replace("&", " and ")
    text = text.replace("l.p.", " lp ").replace("l.p", " lp ")
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    tokens = [tok for tok in text.split() if tok and tok not in _SUFFIXES]
    return " ".join(tokens).strip()


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", (text or "").lower()))


def _fallback_ratio(left: str, right: str) -> int:
    a = _tokens(left)
    b = _tokens(right)
    if not a and not b:
        return 100
    inter = a & b
    if not inter:
        return 0
    shared = " ".join(sorted(inter))
    score_a = difflib.SequenceMatcher(None, shared, " ".join(sorted(a))).ratio()
    score_b = difflib.SequenceMatcher(None, shared, " ".join(sorted(b))).ratio()
    return int(round(100 * max(score_a, score_b)))


def token_set_ratio(left: str, right: str) -> int:
    try:
        from rapidfuzz.fuzz import token_set_ratio as rapid
        return int(rapid(left or "", right or ""))
    except Exception:
        return _fallback_ratio(left, right)


def names_match(left: str, right: str, threshold: int = 90) -> bool:
    a = normalize_acquirer(left)
    b = normalize_acquirer(right)
    if not a or not b:
        return False
    if a == b:
        return True
    return token_set_ratio(a, b) >= threshold


def parse_display_name(value: str) -> dict:
    text = re.sub(r"\s+", " ", (value or "").strip())
    match = _DISPLAY.match(text)
    if not match:
        return {"title": text, "ticker": "", "cik": ""}
    tickers = [part.strip().upper() for part in match.group("tickers").split(",") if part.strip()]
    return {
        "title": match.group("title").strip(" ,"),
        "ticker": tickers[0] if tickers else "",
        "cik": pad_cik(match.group("cik")),
    }


def tickers_in_text(text: str) -> list[str]:
    found = []
    for match in _EXCHANGE_TICKER.finditer(text or ""):
        found.append(match.group(1).upper())
    for match in _TICKER_PAREN.finditer(text or ""):
        token = match.group(1).upper()
        if token not in {"CIK", "NYSE", "LLC"}:
            found.append(token)
    out = []
    for token in found:
        if token not in out:
            out.append(token)
    return out


def parties_from_text(text: str) -> dict:
    """Best-effort target and acquirer names from a sentence."""
    acquired = _ACQUIRED_BY.search(text or "")
    if acquired:
        return {"target_name": acquired.group(1).strip(" ,"), "acquirer_name": acquired.group(2).strip(" ,")}
    into = _MERGE_INTO.search(text or "")
    if into:
        return {"target_name": "", "acquirer_name": into.group(1).strip(" ,")}
    headline = _TO_ACQUIRE.search((text or "").strip())
    if headline:
        return {
            "acquirer_name": headline.group(1).strip(" ,"),
            "target_name": headline.group(2).strip(" ,"),
        }
    return {"target_name": "", "acquirer_name": ""}


def deal_key(target_cik: str, target_ticker: str, acquirer_name: str) -> str:
    ident = pad_cik(target_cik) or (target_ticker or "").upper()
    acquirer = normalize_acquirer(acquirer_name) or "unknown"
    return f"{ident}|{acquirer}"


class TickerMap:
    def __init__(self, rows: dict | None = None):
        self.by_ticker: dict[str, dict] = {}
        self.by_cik: dict[str, dict] = {}
        self.names: list[dict] = []
        for row in (rows or {}).values():
            if not isinstance(row, dict):
                continue
            ticker = str(row.get("ticker") or "").upper()
            cik = pad_cik(row.get("cik_str") or row.get("cik") or "")
            title = str(row.get("title") or "")
            item = {"ticker": ticker, "cik": cik, "title": title}
            if ticker:
                self.by_ticker[ticker] = item
            if cik:
                self.by_cik[cik] = item
            if title:
                self.names.append(item)

    def resolve_name(self, name: str) -> dict | None:
        if not name:
            return None
        best = None
        best_score = 0
        for item in self.names:
            score = token_set_ratio(normalize_acquirer(name), normalize_acquirer(item["title"]))
            if score > best_score:
                best = item
                best_score = score
        if best is not None and best_score >= 90:
            return best
        return None

    def get_ticker(self, ticker: str) -> dict | None:
        return self.by_ticker.get((ticker or "").upper())
