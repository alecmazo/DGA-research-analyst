"""Dig-in note. The facts come from the card. A model paragraph is optional."""

from __future__ import annotations


def write_report(card: dict, financials: dict | None = None, model_text: str | None = None) -> str:
    lines = [
        f"# {card.get('title') or 'Idea'}",
        "",
        str(card.get("thesis") or "").strip(),
        "",
        "## Bull case",
        str(card.get("bull") or "").strip(),
        "",
        "## Bear case",
        str(card.get("bear") or "").strip(),
        "",
        "## What would make this wrong",
        str(card.get("falsify") or "").strip(),
        "",
        "## Key numbers",
    ]
    numbers = card.get("key_numbers") or []
    if not numbers:
        lines.append("No figures on the card.")
    for row in numbers:
        lines.append(f"- {row.get('label')}: {row.get('value')}")
    names = card.get("names") or []
    if names:
        lines.extend(["", "## Names"])
        for row in names:
            ticker = row.get("ticker") or ""
            extra = row.get("name") or ""
            bits = [bit for bit in (ticker, extra if extra != ticker else "") if bit]
            if row.get("revenue_pct") is not None:
                bits.append(f"{row['revenue_pct']}% of revenue")
            if row.get("debt_to_equity") is not None:
                bits.append(f"debt/equity {row['debt_to_equity']}")
            lines.append("- " + ", ".join(bits))
    if financials:
        lines.extend(["", "## Latest annual on file"])
        for key in ("period_end", "revenue", "net_income", "diluted_eps", "total_debt", "stockholders_equity"):
            if financials.get(key) is not None:
                lines.append(f"- {key.replace('_', ' ')}: {financials.get(key)}")
    if model_text and str(model_text).strip():
        lines.extend(["", "## Model note", str(model_text).strip()])
    sources = card.get("sources") or []
    if sources:
        lines.extend(["", "## Sources"])
        for row in sources:
            label = row.get("label") or "Source"
            url = row.get("url") or ""
            lines.append(f"- {label}: {url}" if url else f"- {label}")
    lines.extend(["", f"As of {card.get('as_of') or ''}. Score {card.get('score')}."])
    return "\n".join(lines).strip() + "\n"
