"""IB-style number formatting for research-report markdown tables.

Bare ``1234.5`` in a Revenue ($M) column becomes ``$1,234.5``. Percents get
``%``, multiples ``x``. Idempotent on cells that are already formatted.
"""

from __future__ import annotations

import re
from typing import Optional

_DASH = {"", "—", "–", "-", "n/a", "na", "nm", "n.a.", "."}

_PCT_HDR = re.compile(
    r"%|margin|growth|upside|downside|weight|probability|cagr|yield|"
    r"\byoy\b|return\b|ppt|implied return",
    re.I,
)
_MULT_HDR = re.compile(
    r"\bp/?e\b|ev/ebitda|ev/sales|ev/revenue|ev/rev|\bp/?b\b|\bp/?s\b|"
    r"multiple|\bx\b",
    re.I,
)
_EPS_HDR = re.compile(r"diluted eps|basic eps|\beps\b", re.I)
_SHARES_HDR = re.compile(r"shares|share count", re.I)
_MONEY_HDR = re.compile(
    r"\$|price|value|revenue|income|profit|ebitda|fcf|cash|debt|assets|"
    r"equity|capex|cap\.?\s*ex|target|market cap|enterprise|amount|sales|"
    r"pv of|proceeds|book",
    re.I,
)
_TEXT_HDR = re.compile(
    r"^(metric|line item|item|step|method|scenario|firm|company|ticker|"
    r"symbol|year|fiscal|segment|date|rating|action|notes?|formula|"
    r"assumption|comment|rationale)$",
    re.I,
)
_NUM_TOKEN = re.compile(
    r"^[\(\+]?\s*\$?\s*-?\d[\d,]*\.?\d*\s*\)?\s*(%|x|bn|mm|m|ppt)?\s*$",
    re.I,
)


def col_kind(header: str, col_index: int = 0) -> str:
    h = re.sub(r"\*\*", "", header or "").strip()
    if col_index == 0 and _TEXT_HDR.search(h):
        return "text"
    if _TEXT_HDR.search(h) and not _MONEY_HDR.search(h) and not _PCT_HDR.search(h):
        return "text"
    if re.search(r"discount factor|^t$|^year$|fiscal|date|rating|action|notes?|"
                 r"formula|assumption|ticker|firm|company", h, re.I):
        if not _MONEY_HDR.search(h) and not _PCT_HDR.search(h):
            return "text"
    if _EPS_HDR.search(h):
        return "eps"
    if _PCT_HDR.search(h) and not re.search(r"price target|implied value", h, re.I):
        return "pct"
    if _MULT_HDR.search(h):
        return "multiple"
    if _SHARES_HDR.search(h) and not _MONEY_HDR.search(h):
        return "shares"
    if _MONEY_HDR.search(h):
        if re.search(r"\$\s*m\b|\$m\b|\(\s*\$?m\s*\)|millions", h, re.I):
            return "money_m"
        if re.search(r"\$\s*b|\(\s*\$?b|billions", h, re.I):
            return "money_bn"
        return "money"
    return "text"


def _plain(cell: str) -> str:
    t = (cell or "").strip()
    t = re.sub(r"</?[^>]+>", "", t)
    return t


def _is_numeric_token(plain: str) -> bool:
    t = re.sub(r"\*\*", "", plain).strip()
    if t.lower() in _DASH:
        return False
    if "/" in t and not t.startswith("("):  # 8/10, 2026-01-15 handled below
        if re.match(r"^\d+/\d+$", t):
            return False
    if re.match(r"^\d{4}-\d{2}-\d{2}", t):
        return False
    if re.search(r"[a-zA-Z]{3,}", t.replace("Bn", "").replace("bn", "").replace("ppt", "")):
        return False
    inner = t.replace(",", "").replace(" ", "")
    return bool(_NUM_TOKEN.match(inner) or _NUM_TOKEN.match(inner.strip("()")))


def _parse_num(plain: str) -> Optional[tuple[float, dict]]:
    t = re.sub(r"\*\*", "", plain).strip()
    flags = {
        "paren": t.startswith("(") and t.endswith(")"),
        "plus": t.startswith("+"),
        "had_dollar": "$" in t,
        "had_pct": "%" in t,
        "had_x": bool(re.search(r"x\s*$", t, re.I)),
        "had_comma": "," in t,
    }
    if flags["paren"]:
        t = t[1:-1].strip()
    if t.startswith("+"):
        t = t[1:].strip()
    neg = t.startswith("-") or t.startswith("−")
    t = t.lstrip("-−").replace("$", "").replace(",", "")
    t = re.sub(r"(bn|mm|ppt|%|x)\s*$", "", t, flags=re.I).strip()
    try:
        val = float(t)
    except ValueError:
        return None
    if neg or flags["paren"]:
        val = -abs(val)
    return val, flags


def _commas(n: float, decimals: int) -> str:
    if decimals <= 0:
        return f"{abs(n):,.0f}"
    return f"{abs(n):,.{decimals}f}"


def _money_str(n: float, decimals: int, paren: bool) -> str:
    body = "$" + _commas(n, decimals)
    if n < 0 or paren:
        return f"({body})"
    return body


def format_ib_cell(header: str, cell: str, col_index: int = 0,
                   row_label: str = "") -> str:
    """Format one table cell. Leaves labels / already-pretty cells stable.

    Period columns (TTM, FY2025, …) inherit $ / % / x from the row label
    (e.g. ``Revenue ($M)``).
    """
    raw = cell if cell is not None else ""
    kind = col_kind(header, col_index)
    if kind == "text" and col_index > 0 and (row_label or "").strip():
        inherited = col_kind(row_label, 1)
        if inherited != "text":
            kind = inherited
    if kind == "text":
        return raw
    plain = _plain(raw)
    core = re.sub(r"\*\*", "", plain).strip()
    if core.lower() in _DASH:
        return raw
    if not _is_numeric_token(core):
        return raw
    parsed = _parse_num(core)
    if not parsed:
        return raw
    n, flags = parsed
    if kind == "pct":
        body = f"{abs(n):.1f}"
        if abs(n - round(n)) < 1e-9:
            body = f"{abs(n):.0f}"
        if n < 0:
            out = f"({body}%)" if flags["paren"] else f"-{body}%"
        elif flags["plus"]:
            out = f"+{body}%"
        else:
            out = f"{body}%"
    elif kind == "multiple":
        out = f"{abs(n):.1f}x"
        if n < 0:
            out = f"-{out}"
    elif kind == "eps":
        out = _money_str(n, 2, flags["paren"])
    elif kind == "shares":
        out = _commas(n, 1 if abs(n - round(n)) > 1e-9 else 0)
        if n < 0:
            out = f"-{out}"
    elif kind in ("money_m", "money_bn", "money"):
        if kind == "money_m":
            dec = 1
        elif kind == "money_bn":
            dec = 2
        elif abs(n) < 100:
            dec = 2
        elif abs(n - round(n)) < 1e-9:
            dec = 0
        else:
            dec = 2
        out = _money_str(n, dec, flags["paren"])
    else:
        return raw

    if raw.strip().startswith("**") and raw.strip().endswith("**"):
        return f"**{out}**"
    return out


def format_md_tables_ib(md: str) -> str:
    """Rewrite GFM table numeric cells in-place (idempotent)."""
    if not md or "|" not in md:
        return md
    lines = md.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    i = 0
    n = len(lines)
    sep_re = re.compile(r"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$")

    def split_row(line: str) -> tuple[str, list[str], str]:
        lead = "|" if line.lstrip().startswith("|") else ""
        s = line.strip()
        trail = "|" if s.endswith("|") else ""
        if s.startswith("|"):
            s = s[1:]
        if s.endswith("|"):
            s = s[:-1]
        cells = [c.strip() for c in s.split("|")]
        return lead, cells, trail

    while i < n:
        line = lines[i]
        nxt = lines[i + 1] if i + 1 < n else ""
        if "|" in line and sep_re.match(nxt or ""):
            lead, headers, trail = split_row(line)
            out.append(line)
            out.append(nxt)
            i += 2
            while i < n and "|" in lines[i] and not sep_re.match(lines[i]):
                l2, cells, t2 = split_row(lines[i])
                label = cells[0] if cells else ""
                formatted = [
                    format_ib_cell(
                        headers[c] if c < len(headers) else "",
                        cell,
                        c,
                        row_label=label,
                    )
                    for c, cell in enumerate(cells)
                ]
                rebuilt = (l2 or "|") + " " + " | ".join(formatted) + (" |" if t2 or l2 else "")
                # preserve leading pipe style
                if lines[i].strip().startswith("|"):
                    rebuilt = "| " + " | ".join(formatted) + " |"
                else:
                    rebuilt = " | ".join(formatted)
                out.append(rebuilt)
                i += 1
            continue
        out.append(line)
        i += 1
    return "\n".join(out)
