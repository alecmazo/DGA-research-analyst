"""The local brief is the right-hand rail on Ideas, Financials, and the desk."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def test_brief_lists_installed_models_and_defaults_to_gpt_oss():
    src = _read("web/gp-app/src/lib/localOllama.ts")
    brief = _read("web/gp-app/src/components/desk/CompanyBrief.tsx")
    assert "export async function listInstalledModels" in src
    assert "brief: 'dga.local.brief.model'" in src
    assert "listInstalledModels" in brief
    assert "LOCAL_PICK_KEYS.brief" in brief
    assert "'gpt-oss'" in brief
    assert "Do not invent prices" in brief
    assert "The tension" in brief
    assert "think: 'medium'" in brief
    assert "streamThinking: false" in brief
    assert "briefAnswer" in brief
    assert "data-brief-scroll" in brief
    assert "briefProse" in brief
    prose = _read("web/gp-app/src/lib/briefProse.ts")
    assert "export function briefProse" in prose
    css = _read("web/gp-app/src/components/desk/CompanyBrief.module.css")
    assert "overflow-y: auto" in css
    assert "overscroll-behavior: contain" in css
    assert "height: 0" in css


def test_brief_opens_on_ideas_financials_and_desk_lists():
    ideas = _read("web/gp-app/src/pages/IdeasPage.tsx")
    desk = _read("web/gp-app/src/pages/DeskPage.tsx")
    financials = _read("web/gp-app/src/pages/FinancialsPage.tsx")
    assert "CompanyBrief" in ideas
    assert "setSelected(ticker)" in ideas
    assert ideas.count("setBriefTk") == 0
    assert desk.count("setBriefTk(tk)") == 2
    assert 'variant="overlay"' in desk
    assert "TopMovers onPeek={openPeek}" in desk.replace("\n", " ")
    assert "CompanyBrief" in financials
    assert "onClose={() => setBrief(false)}" in financials
    assert "dga.financials.brief" in financials
    assert "data-local-brief" in ideas
    assert "data-local-brief" in financials


def test_brief_prose_keeps_the_take_and_drops_the_monologue():
    script = r"""
import { briefAnswer, briefProse } from './web/gp-app/src/lib/briefProse.ts'
const mono = "The user wants a brief.\n\nI need to look at the packet and decide what to say.\n\nNike is at $36.38, down 4.9% today. The headlines are about the margin target."
const out = briefProse(mono)
if (!out.includes('$36.38')) throw new Error('lost the take: ' + out)
if (/the user|I need to/i.test(out)) throw new Error('kept the monologue: ' + out)
const harmony = '<|channel|>analysis<|message|>thinking hard<|end|><|start|>assistant<|channel|>final<|message|>The price is $36.38 and the day is down.'
const out2 = briefProse(harmony)
if (!out2.startsWith('The price is $36.38')) throw new Error('lost the final channel: ' + out2)
const thin = 'The price is down today.'
const reason = "I need to think this through.\n\nThe day is down 4.9% while the margin headline points the other way. That tension is the read. A pass is a second cut to the margin target."
const picked = briefAnswer(thin, reason)
if (!picked.includes('tension')) throw new Error('dropped the reasoning: ' + picked)
if (/I need to/i.test(picked)) throw new Error('kept the scratchpad: ' + picked)
"""
    subprocess.run(
        ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
        check=True,
        cwd=ROOT,
    )
