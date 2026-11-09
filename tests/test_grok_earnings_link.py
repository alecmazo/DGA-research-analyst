"""The report link opens free Grok on grok.com. It does not call the portal."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "web" / "gp-app" / "src" / "lib" / "grokEarnings.ts"


def _href(ticker: str, company: str | None = None) -> str:
    company_js = "null" if company is None else json.dumps(company)
    script = f"""
import {{ grokEarningsHref }} from {json.dumps(str(HELPER))};
const href = grokEarningsHref({json.dumps(ticker)}, {company_js});
process.stdout.write(href);
"""
    out = subprocess.run(
        ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
        check=True,
        capture_output=True,
        text=True,
    )
    return out.stdout


def test_ceg_link_opens_grok_on_the_earnings_release():
    href = _href("ceg", "Constellation Energy Corporation")
    assert href.startswith("https://grok.com/?q=")
    assert "dgacapital" not in href.lower()
    assert "portfolio." not in href.lower()
    q = href.split("?q=", 1)[1]
    from urllib.parse import unquote
    prompt = unquote(q)
    assert "CEG (Constellation Energy Corporation)" in prompt
    assert "latest earnings release" in prompt
    assert "call transcript" in prompt
    assert "beat or a miss" in prompt


def test_ticker_only_when_the_name_is_the_symbol():
    href = _href("IBRX", "ibrx")
    from urllib.parse import unquote
    prompt = unquote(href.split("?q=", 1)[1])
    assert "IBRX." in prompt
    assert "IBRX (" not in prompt


def test_report_and_earnings_card_use_the_helper():
    report = (ROOT / "web/gp-app/src/pages/ReportPage.tsx").read_text()
    card = (ROOT / "web/gp-app/src/components/desk/EarningsCard.tsx").read_text()
    assert "grokEarningsHref(ticker)" in report
    assert 'target="_blank"' in report
    assert "grokEarningsHref(ticker, ev.name)" in card
    assert "https://grok.com" not in report
    assert "https://grok.com" not in card
