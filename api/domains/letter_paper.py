"""The letter an LP reads.

Preview, the LP portal, and the email all use this paper. The date is the
first line. A preview for one account never includes another account.
"""

from __future__ import annotations

import html
import re
from datetime import datetime

_LINK = (
    "color:#5BB8D4;text-decoration:underline;font-weight:600;"
)


def format_letter_date(value) -> str:
    """YYYY-MM-DD, or a datetime, as 'October 23, 2026'. Blank when missing."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%B ") + str(value.day) + value.strftime(", %Y")
    text = str(value).strip()
    if not text:
        return ""
    day = text[:10]
    try:
        parsed = datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        return ""
    return parsed.strftime("%B ") + str(parsed.day) + parsed.strftime(", %Y")


def md_to_html(text: str) -> str:
    """The same markdown the LP portal used, escaped first."""
    safe = html.escape(str(text or ""))
    safe = re.sub(
        r"^### (.+)$",
        r'<div style="font-size:12px;font-weight:800;color:#5BB8D4;letter-spacing:.6px;margin:14px 0 4px;text-transform:uppercase;">\1</div>',
        safe,
        flags=re.M,
    )
    safe = re.sub(
        r"^## (.+)$",
        r'<div style="font-size:15px;font-weight:800;color:#1e293b;margin:16px 0 6px;">\1</div>',
        safe,
        flags=re.M,
    )
    safe = re.sub(
        r"^# (.+)$",
        r'<div style="font-size:16px;font-weight:800;color:#1e293b;margin:16px 0 6px;">\1</div>',
        safe,
        flags=re.M,
    )
    safe = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", safe)
    safe = re.sub(r"\*(.+?)\*", r"<em>\1</em>", safe)
    safe = re.sub(
        r"\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)",
        r'<a href="\2" target="_blank" rel="noopener noreferrer" style="' + _LINK + r'">\1</a>',
        safe,
    )
    safe = re.sub(
        r"^- (.+)$",
        r'<div style="padding:2px 0 2px 12px;border-left:2px solid #5BB8D4;margin:3px 0;">\1</div>',
        safe,
        flags=re.M,
    )
    safe = re.sub(r"\n{2,}", '<div style="height:9px;"></div>', safe)
    safe = safe.replace("\n", " ")
    return safe


def one_account_sections(sections, fund_id: str) -> list[dict]:
    """The section for fund_id only. No id means no account section."""
    fid = str(fund_id or "").strip()
    if not fid or not isinstance(sections, dict):
        return []
    raw = sections.get(fid)
    if raw is None:
        return []
    if isinstance(raw, str):
        md = raw.strip()
        name = fid
    elif isinstance(raw, dict):
        md = str(raw.get("md") or "").strip()
        name = str(raw.get("name") or fid).strip() or fid
    else:
        return []
    if not md:
        return []
    return [{"name": name, "md": md}]


def published_accounts(published_ids, sections) -> list[dict]:
    """Names of accounts that were actually published, in that order."""
    if isinstance(published_ids, str):
        return []
    if not isinstance(sections, dict):
        sections = {}
    out = []
    for raw in published_ids or []:
        fid = str(raw)
        sec = sections.get(fid)
        name = ""
        if isinstance(sec, dict):
            name = str(sec.get("name") or "").strip()
        elif isinstance(sec, str):
            name = ""
        out.append({"fund_id": fid, "name": name or fid})
    return out


def paper_html(
    *,
    date_label: str,
    period: str,
    title: str,
    note: str,
    intro: str,
    sections: list[dict],
) -> str:
    """White letter card. Date, then the kicker, then the title, then the copy."""
    parts = [
        '<div style="background:#fff;border-radius:14px;padding:28px 32px;'
        'box-shadow:0 2px 14px rgba(0,0,0,0.12);">'
    ]
    if (date_label or "").strip():
        parts.append(
            '<div style="font-size:15px;font-weight:700;color:#0A1628;margin:0 0 10px;">'
            + html.escape(date_label.strip())
            + "</div>"
        )
    kicker = period or "Letter"
    parts.append(
        '<div style="font-size:11px;font-weight:800;letter-spacing:1.4px;'
        'text-transform:uppercase;color:#5BB8D4;">DGA Capital · '
        + html.escape(kicker)
        + "</div>"
    )
    parts.append(
        '<div style="font-size:24px;font-weight:800;color:#0A1628;margin:4px 0 16px;">'
        + html.escape(title or "Quarterly Letter")
        + "</div>"
    )
    if (note or "").strip():
        parts.append(
            '<div style="background:#f8fafc;border-left:3px solid #5BB8D4;border-radius:6px;'
            'padding:14px 16px;margin:14px 0;font-size:14px;line-height:1.65;color:#1e293b;'
            'font-style:italic;">'
            + md_to_html(note)
            + "</div>"
        )
    if (intro or "").strip():
        parts.append(
            '<div style="font-size:14px;line-height:1.7;color:#1e293b;">'
            + md_to_html(intro)
            + "</div>"
        )
    for section in sections or []:
        if not isinstance(section, dict):
            continue
        md = str(section.get("md") or "").strip()
        if not md:
            continue
        name = str(section.get("name") or "").strip()
        parts.append(
            '<div style="margin-top:22px;padding-top:16px;border-top:1px solid #e2e8f0;">'
            '<div style="font-size:12px;font-weight:800;letter-spacing:1px;'
            'text-transform:uppercase;color:#5BB8D4;margin-bottom:8px;">'
            + html.escape(name)
            + "</div>"
            '<div style="font-size:14px;line-height:1.7;color:#1e293b;">'
            + md_to_html(md)
            + "</div></div>"
        )
    parts.append("</div>")
    return "".join(parts)
