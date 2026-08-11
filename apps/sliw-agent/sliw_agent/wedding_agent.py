"""Wedding Agent — parallel CAA desk for couples, planners & venues."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from . import crm
from .contact_finder import find_contacts
from .outreach import save_outreach_draft
from .talent_bible import TALENT
from .wedding_bible import (
    WEDDING_PACKAGES,
    package_to_dict,
    recommend_wedding_package,
    score_wedding_lead,
    wedding_brief_markdown,
)

LIBRARY_PATH = Path(__file__).resolve().parent.parent / "data" / "wedding_library.json"
WEDDINGS_URL = f"{TALENT.get('website') or 'https://edytasliwinska.com'}/weddings"


def load_wedding_library() -> list[dict[str, Any]]:
    if not LIBRARY_PATH.exists():
        return []
    return json.loads(LIBRARY_PATH.read_text(encoding="utf-8"))


def import_wedding_library(
    limit: int = 40,
    *,
    draft_email: bool = False,
    rescore_existing: bool = True,
    run_agent: bool = False,
) -> dict[str, Any]:
    """
    Import library seeds into wedding CRM with real scores.
    - New rows: upsert + score (+ optional draft / sales agent)
    - Existing: rescore so old flat 70s get real tiers
    """
    lib = load_wedding_library()
    # Prefer planners, then high priority, then rest
    def sort_key(row: dict[str, Any]) -> tuple:
        ind = (row.get("industry") or "").lower()
        is_planner = 0 if "planner" in ind else 1
        return (is_planner, -(row.get("priority") or 0), row.get("company") or "")

    lib_sorted = sorted(lib, key=sort_key)
    existing = {
        (p.get("company") or "").lower(): p
        for p in crm.list_prospects(book="wedding")
    }
    results: list[dict[str, Any]] = []
    rescored = 0
    imported = 0

    for row in lib_sorted:
        name = (row.get("company") or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in existing:
            if rescore_existing:
                r = rescore_wedding_prospect(existing[key]["id"], row=row)
                rescored += 1
                results.append(r)
            continue
        if imported >= limit:
            continue
        r = run_wedding_pipeline(
            name=name,
            industry=row.get("industry", "Wedding"),
            geo=row.get("geo", ""),
            website=row.get("website", ""),
            notes=row.get("notes", ""),
            signals=row.get("signals") or [],
            package_hint=row.get("package_hint", ""),
            priority=row.get("priority"),
            draft_email=draft_email,
            run_sales_agent=run_agent,
        )
        imported += 1
        existing[key] = {"id": r["prospect_id"], "company": name}
        results.append(r)

    # Also rescore any CRM rows not in this library pass (stale scores)
    if rescore_existing:
        seen_ids = {r.get("prospect_id") for r in results}
        for p in crm.list_prospects(book="wedding"):
            if p["id"] in seen_ids:
                continue
            # Only bump if score looks like old flat import
            if p.get("score") in (None, 50, 70) or not p.get("score_breakdown"):
                r = rescore_wedding_prospect(p["id"])
                rescored += 1
                results.append(r)

    prospects = crm.list_prospects(book="wedding")
    return {
        "imported": imported,
        "rescored": rescored,
        "total": len(prospects),
        "planners": sum(1 for p in prospects if "planner" in (p.get("industry") or "").lower()),
        "venues": sum(1 for p in prospects if "venue" in (p.get("industry") or "").lower()),
        "tier_a": sum(1 for p in prospects if p.get("tier") == "A"),
        "results": results[:50],
    }


def rescore_wedding_prospect(
    prospect_id: str,
    row: dict[str, Any] | None = None,
) -> dict[str, Any]:
    p = crm.get_prospect(prospect_id, book="wedding")
    if not p:
        raise KeyError(prospect_id)
    scored = score_wedding_lead(
        company=p.get("company") or "",
        industry=(row or {}).get("industry") or p.get("industry") or "",
        geo=(row or {}).get("geo") or p.get("geo") or "",
        notes=(row or {}).get("notes") or p.get("notes") or "",
        signals=(row or {}).get("signals") or p.get("signals") or [],
        website=(row or {}).get("website") or p.get("website") or "",
        priority=(row or {}).get("priority") if row else p.get("library_priority"),
        package_hint=(row or {}).get("package_hint") or "",
    )
    fields: dict[str, Any] = {
        "score": scored["score"],
        "tier": scored["tier"],
        "recommended_packages": scored["recommended_packages"],
        "score_breakdown": scored["breakdown"],
        "agent_note": scored["agent_note"],
        "channel_label": scored.get("channel_label"),
    }
    if row:
        if row.get("website"):
            fields["website"] = row["website"]
        if row.get("industry"):
            fields["industry"] = row["industry"]
        if row.get("geo"):
            fields["geo"] = row["geo"]
        if row.get("notes"):
            fields["notes"] = row["notes"]
        if row.get("signals"):
            fields["signals"] = list(dict.fromkeys((p.get("signals") or []) + list(row["signals"])))
        if row.get("priority") is not None:
            fields["library_priority"] = row["priority"]
    # Don't clobber advanced stages
    if (p.get("stage") or "research") in ("research", "scored"):
        fields["stage"] = "scored"
    updated = crm.update_prospect(prospect_id, book="wedding", **fields)
    return {
        "prospect_id": prospect_id,
        "company": updated.get("company"),
        "score": updated.get("score"),
        "tier": updated.get("tier"),
        "rescored": True,
        "book": "wedding",
    }


def run_wedding_pipeline(
    *,
    name: str,
    industry: str = "Wedding couple",
    geo: str = "",
    website: str = "",
    notes: str = "",
    signals: list[str] | None = None,
    contacts: list[dict[str, str]] | None = None,
    package_hint: str = "",
    priority: int | float | None = None,
    custom_hook: str = "",
    draft_email: bool = True,
    generate_gamma: bool = False,
    live_gamma: bool = False,
    run_sales_agent: bool = False,
) -> dict[str, Any]:
    signals = signals or []
    contacts = contacts or []
    scored = score_wedding_lead(
        company=name,
        industry=industry,
        geo=geo,
        notes=notes,
        signals=signals,
        website=website,
        priority=priority,
        package_hint=package_hint,
    )
    pkgs = scored["recommended_packages"]

    p = crm.upsert_prospect(
        company=name,
        industry=industry,
        geo=geo,
        website=website,
        notes=notes,
        signals=signals,
        contacts=contacts,
        book="wedding",
        extra={
            "recommended_packages": pkgs,
            "score": scored["score"],
            "tier": scored["tier"],
            "score_breakdown": scored["breakdown"],
            "agent_note": scored["agent_note"],
            "channel_label": scored.get("channel_label"),
            "library_priority": priority,
            "stage": "scored",
        },
    )
    pid = p["id"]
    crm.update_prospect(
        pid,
        book="wedding",
        recommended_packages=pkgs,
        score=scored["score"],
        tier=scored["tier"],
        score_breakdown=scored["breakdown"],
        agent_note=scored["agent_note"],
        channel_label=scored.get("channel_label"),
        stage="scored",
        website=website or p.get("website") or "",
    )

    result: dict[str, Any] = {
        "prospect_id": pid,
        "company": name,
        "book": "wedding",
        "score": scored["score"],
        "tier": scored["tier"],
        "packages": pkgs,
        "gamma": None,
        "outreach_path": None,
        "sales_agent": None,
    }

    if generate_gamma or live_gamma:
        result["gamma"] = generate_wedding_gamma(
            name=name,
            packages=pkgs[:2],
            custom_hook=custom_hook or notes,
            prospect_id=pid,
            dry_run=not live_gamma,
        )

    is_partner = any(
        k in industry.lower() for k in ("planner", "venue", "winery", "hotel")
    ) or any(k in " ".join(signals).lower() for k in ("planner", "venue", "partnership"))

    if run_sales_agent:
        result["sales_agent"] = run_wedding_sales_agent(pid, live_gamma=live_gamma)
        result["outreach_path"] = result["sales_agent"].get("outreach_path")
    elif draft_email:
        primary = pkgs[0] if pkgs else package_to_dict(WEDDING_PACKAGES["package_10"])
        contact = contacts[0] if contacts else {}
        email = draft_wedding_email(
            name=name,
            contact_name=contact.get("name", ""),
            package=primary,
            custom_hook=custom_hook or notes,
            is_planner=is_partner,
            gamma_url=(result.get("gamma") or {}).get("gamma_url"),
        )
        path = save_outreach_draft(
            prospect_id=pid,
            company=name,
            email=email,
            contact_email=contact.get("email", ""),
            sequence_step="wedding_cold_1",
            book="wedding",
        )
        result["outreach_path"] = str(path)
        crm.update_prospect(pid, book="wedding", stage="drafted", outreach_path=str(path))

    return result


def run_wedding_sales_agent(
    prospect_id: str,
    *,
    live_gamma: bool = False,
    find_people: bool = True,
) -> dict[str, Any]:
    """
    Planner/venue-first sales agent:
    find contacts → pro partnership pitch → draft first-touch (human-approved send).
    """
    p = crm.get_prospect(prospect_id, book="wedding")
    if not p:
        # fall through books
        p = crm.get_prospect(prospect_id)
    if not p:
        raise KeyError(prospect_id)
    book = "wedding"
    company = p.get("company") or ""
    industry = p.get("industry") or ""
    is_planner = "planner" in industry.lower()
    is_venue = any(k in industry.lower() for k in ("venue", "winery", "hotel", "lodge"))
    is_partner = is_planner or is_venue

    # Score if missing / flat
    if p.get("score") is None or not p.get("score_breakdown"):
        rescore_wedding_prospect(prospect_id)
        p = crm.get_prospect(prospect_id, book=book) or p

    pkgs = p.get("recommended_packages") or recommend_wedding_package(
        p.get("signals") or [], p.get("notes") or ""
    )
    primary = pkgs[0] if pkgs else package_to_dict(WEDDING_PACKAGES["package_10"])

    contact_result = None
    if find_people:
        contact_result = find_contacts(
            company=company,
            website=p.get("website", ""),
            industry=industry,
            package_id=primary.get("id") or "",
            wedding_mode=True,
        )
        found = contact_result.get("contacts") or []
        if found:
            existing = [
                c for c in (p.get("contacts") or [])
                if c.get("source") not in ("role_inbox_guess", "hunter.io_error")
            ]
            by_key: dict[str, dict] = {}
            for c in found + existing:
                key = (c.get("email") or c.get("name") or "").lower()
                if key:
                    by_key[key] = {**(by_key.get(key) or {}), **c}
            p = crm.update_prospect(
                prospect_id,
                book=book,
                contacts=list(by_key.values())[:12],
                contact_research=contact_result.get("method_summary"),
                hunter_enabled=contact_result.get("hunter_enabled"),
                hunter_diagnostics=contact_result.get("hunter_diagnostics"),
                linkedin_targets=contact_result.get("linkedin_targets"),
            )
        else:
            crm.update_prospect(
                prospect_id,
                book=book,
                contact_research=contact_result.get("method_summary"),
                hunter_enabled=contact_result.get("hunter_enabled"),
                hunter_diagnostics=contact_result.get("hunter_diagnostics"),
            )
            p = crm.get_prospect(prospect_id, book=book) or p

    contacts = p.get("contacts") or []
    primary_contact = next(
        (c for c in contacts if c.get("email") and c.get("source") != "role_inbox_guess"),
        None,
    ) or next((c for c in contacts if c.get("email")), None) or (contacts[0] if contacts else {})

    pitch_url = WEDDINGS_URL
    crm.update_prospect(
        prospect_id,
        book=book,
        marketing_mode="wedding_portfolio",
        gamma_url=pitch_url,
        master_deck_url=pitch_url,
        marketing_note="Official weddings page — partnership / first-dance pitch.",
    )

    email = draft_wedding_email(
        name=company,
        contact_name=primary_contact.get("name") or "",
        package=primary,
        custom_hook=_wedding_hook(company, p.get("notes") or "", p.get("signals") or [], is_partner=is_partner),
        is_planner=is_partner,
        is_venue=is_venue,
        gamma_url=pitch_url,
        contact_title=primary_contact.get("title") or "",
    )
    email["to_email"] = primary_contact.get("email") or ""
    email["marketing_mode"] = "wedding_portfolio"
    email["pitch_url"] = pitch_url

    path = save_outreach_draft(
        prospect_id=prospect_id,
        company=company,
        email=email,
        sequence_step="wedding_cold_1",
        contact_email=primary_contact.get("email") or "",
        book=book,
    )
    seq_paths = {"cold_1": str(path), "wedding_cold_1": str(path)}

    p = crm.update_prospect(
        prospect_id,
        book=book,
        sequence_paths=seq_paths,
        outreach_path=str(path),
        stage="drafted",
        agent_status="ready_to_send",
        sales_agent_ran_at=datetime.utcnow().isoformat(),
        master_deck_url=pitch_url,
    )

    return {
        "prospect_id": prospect_id,
        "company": company,
        "book": "wedding",
        "tier": p.get("tier"),
        "score": p.get("score"),
        "marketing_mode": "wedding_portfolio",
        "pitch_url": pitch_url,
        "portfolio_url": pitch_url,
        "master_deck_url": pitch_url,
        "contacts": contacts[:5],
        "primary_contact": primary_contact,
        "contact_research": contact_result.get("method_summary") if contact_result else None,
        "hunter_enabled": (contact_result or {}).get("hunter_enabled"),
        "hunter_diagnostics": (contact_result or {}).get("hunter_diagnostics") or p.get("hunter_diagnostics"),
        "linkedin_targets": (contact_result or {}).get("linkedin_targets") or p.get("linkedin_targets"),
        "outreach_path": str(path),
        "sequence_paths": seq_paths,
        "email_preview": email,
        "is_planner_partner": is_partner,
        "next_human_step": (
            "Copy the planner/venue partnership email, send from Gmail, then mark contacted. "
            "Warm replies go to Edyta with a wedding brief."
        ),
        "prospect": p,
    }


def _wedding_hook(
    company: str,
    notes: str,
    signals: list[str],
    *,
    is_partner: bool,
) -> str:
    notes = (notes or "").strip()
    if notes and len(notes) < 200 and "Priority" not in notes:
        return notes
    if is_partner:
        return (
            f"I'm building a short list of Bay Area planners and venues who might want a "
            f"DWTS-level first-dance partner for their couples — {company} was an obvious fit."
        )
    if signals:
        return f"Congratulations on the wedding planning — {signals[0]} stood out as the perfect time to start the first dance."
    return (
        f"I'm reaching out about crafting a first dance with Edyta Śliwińska for {company}."
    )


def draft_wedding_email(
    *,
    name: str,
    contact_name: str = "",
    package: dict[str, Any],
    custom_hook: str = "",
    is_planner: bool = False,
    is_venue: bool = False,
    gamma_url: str | None = None,
    contact_title: str = "",
) -> dict[str, str]:
    first = (contact_name or "there").split()[0]
    greeting = f"Hi {first}," if first.lower() != "there" else "Hi there,"
    site = (gamma_url or WEDDINGS_URL).strip()
    hook = custom_hook.strip() if custom_hook else (
        "Couples remember the planner who gave them a first dance they actually felt proud of."
        if is_planner else
        "Your first dance should feel like the best scene of the night — polished, personal, and joyfully you."
    )

    if is_planner or is_venue:
        channel = "planning team" if is_planner else "venue team"
        subject = f"Preferred vendor idea — Edyta Śliwińska (DWTS) for your couples"
        body = f"""{greeting}

I'm writing on behalf of Edyta Śliwińska — Dancing with the Stars professional, based in San Rafael — about a simple referral partnership for wedding first dances.

{hook}

What we offer your couples (you stay the hero of the planning journey):
• Private lessons starting at {WEDDING_PACKAGES['single_lesson'].price_label}
• Full 10-lesson prep arc — {WEDDING_PACKAGES['package_10'].price_label}
• Dream Wedding Dance — choreography, venue coordination, day-of support (custom)

Edyta works with {channel}s across the Bay Area. Studio is in San Rafael, so Marin / SF / wine-country timelines are easy. Couples can start months out or do a focused polish before the weekend.

Weddings overview:
{site}

If useful, I can send a one-page partner sheet and a sample first-dance timeline you can share with couples. Would 15 minutes this week or next work for a quick intro?

Warmly,
Sliw Wedding Agent (for Edyta Śliwińska)
{TALENT['email_public']} · {TALENT['phone_primary']}
{site}
"""
    else:
        subject = f"Your first dance with Edyta Śliwińska (DWTS)"
        body = f"""{greeting}

Congratulations on your wedding. I'm writing on behalf of Edyta Śliwińska — Dancing with the Stars professional — about crafting a first dance you'll both feel proud of.

{hook}

Recommended starting point: {package.get('name')} ({package.get('price_label')}) — {package.get('one_liner')}

Weddings page:
{site}

Would you like a short consult with Edyta to design the right package for your timeline?

Warmly,
Sliw Wedding Agent (for Edyta Śliwińska)
{TALENT['email_public']} · {TALENT['phone_primary']}
{site}
"""
    return {
        "subject": subject,
        "body": body.strip() + "\n",
        "to_name": contact_name or "",
        "to_title": contact_title or "",
    }


def generate_wedding_gamma(
    *,
    name: str,
    packages: list[dict[str, Any]],
    custom_hook: str = "",
    prospect_id: str | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    from .crm import WEDDING_DECKS_DIR, ensure_dirs, update_prospect
    ensure_dirs()
    WEDDING_DECKS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d")
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)[:40]
    pkg_text = "\n".join(
        f"- {p['name']} ({p.get('price_label')}): {p.get('one_liner')}" for p in packages
    )
    input_text = f"""Create a premium romantic wedding first-dance proposal presentation.

Title: "Edyta Śliwińska × {name} — Wedding Dance Proposal"

Design: elegant, romantic, champagne gold + soft ivory + charcoal. Hollywood talent packaging for weddings — not corporate.

Talent facts:
{wedding_brief_markdown()}

Client: {name}
Hook: {custom_hook or 'A first dance with star power and zero judgment'}

Packages to feature:
{pkg_text}

Slides (~8-10):
1. Cover — Edyta × couple/venue/planner
2. Why a first dance with a DWTS pro
3. Edyta's teaching philosophy (celebrities → couples)
4. Package deep-dives
5. How lessons work / timeline
6. Day-of support (for Dream package)
7. Studio location San Rafael / Bay Area
8. Partnership path (for planners/venues)
9. CTA — book a consult
10. Contact {TALENT['email_public']} · {TALENT['phone_primary']}

Never invent fake couple testimonials or prices not listed.
"""
    prompt_path = WEDDING_DECKS_DIR / f"{safe}_{stamp}_prompt.txt"
    prompt_path.write_text(input_text, encoding="utf-8")
    if dry_run:
        return {"dry_run": True, "prompt_path": str(prompt_path), "gamma_url": None}

    from .gamma_packages import _gamma_generate
    pptx = WEDDING_DECKS_DIR / f"Wedding_{safe}_{stamp}.pptx"
    url, credits = _gamma_generate(input_text, num_cards=9, out_pptx=pptx)
    if prospect_id:
        update_prospect(prospect_id, book="wedding", gamma_url=url, gamma_pptx=str(pptx), stage="packaged")
    return {"dry_run": False, "gamma_url": url, "credits": credits, "pptx_path": str(pptx)}


def seed_default_partnerships() -> dict[str, Any]:
    seed_path = Path(__file__).resolve().parent.parent / "data" / "partnerships_seed.json"
    if not seed_path.exists():
        return {"added": 0}
    rows = json.loads(seed_path.read_text(encoding="utf-8"))
    added = 0
    existing = {p.get("name", "").lower() for p in crm.load_partnerships()}
    for row in rows:
        if (row.get("name") or "").lower() in existing:
            continue
        crm.upsert_partner(row)
        added += 1
    return {"added": added, "total": len(crm.load_partnerships())}


def wedding_ready_list(limit: int = 12, *, channel: str | None = None) -> list[dict[str, Any]]:
    """Ranked wedding leads for the Weddings tab (clickable → Work).

    channel: None = all, "couple" = web form couples, "partner" = planners/venues.
    """
    prospects = crm.list_prospects(book="wedding")
    ranked = []
    for p in prospects:
        stage = p.get("stage") or ""
        if stage == "lost":
            continue
        # Keep paid "won" couples visible until lessons are scheduled
        if stage == "won":
            if p.get("payment_status") == "paid" and not p.get("lessons_scheduled"):
                ranked.append(p)
            continue
        ranked.append(p)
    if channel == "couple":
        ranked = [p for p in ranked if _is_couple_lead(p)]
    elif channel == "partner":
        ranked = [p for p in ranked if not _is_couple_lead(p)]
    # Paid first, then couples, then score
    def _sort_key(p: dict[str, Any]) -> tuple:
        paid = 0 if p.get("payment_status") == "paid" else 1
        is_c = 0 if _is_couple_lead(p) else 1
        updated = p.get("updated_at") or p.get("created_at") or ""
        return (paid, is_c, -(p.get("score") or 0), updated)

    ranked.sort(key=_sort_key)
    out = []
    for p in ranked[:limit]:
        pkg = (p.get("recommended_packages") or [{}])[0]
        out.append({
            "id": p["id"],
            "company": p.get("company"),
            "website": p.get("website") or "",
            "industry": p.get("industry") or "",
            "geo": p.get("geo") or "",
            "score": p.get("score"),
            "tier": p.get("tier"),
            "stage": p.get("stage"),
            "package": pkg.get("name") or (p.get("package_interest") or ""),
            "channel_label": p.get("channel_label") or p.get("industry"),
            "agent_note": p.get("agent_note") or "",
            "book": "wedding",
            "lead_channel": "couple" if _is_couple_lead(p) else "partner",
            "source": p.get("source") or "",
            "utm_source": p.get("utm_source") or "",
            "wedding_date": p.get("wedding_date") or "",
            "email": _best_contact_email(p),
            "phone": _best_contact_phone(p),
            "has_draft": bool(p.get("outreach_path") or p.get("sequence_paths")),
            "has_contact": bool(p.get("contacts")),
            "created_at": p.get("created_at") or "",
            "payment_status": p.get("payment_status") or "",
            "paid_package": p.get("paid_package") or "",
        })
    return out


def _is_couple_lead(p: dict[str, Any]) -> bool:
    ind = (p.get("industry") or "").lower()
    src = (p.get("source") or "").lower()
    ch = (p.get("channel_label") or "").lower()
    return (
        "couple" in ind
        or src in ("web_form", "instagram", "x", "referral_form", "stripe")
        or "couple" in ch
        or (p.get("lead_channel") or "") == "couple"
    )


def _best_contact_email(p: dict[str, Any]) -> str:
    """Prefer real form emails over Hunter-guessed placeholders on couple leads."""
    contacts = p.get("contacts") or []
    emails = []
    for c in contacts:
        e = (c.get("email") or "").strip()
        if e:
            emails.append((e, (c.get("source") or "").lower()))
    if not emails:
        return ""
    # Prefer non-hunter, then common personal providers, then last (often form-submitted)
    personal = ("gmail.com", "yahoo.com", "icloud.com", "me.com", "outlook.com", "hotmail.com", "aol.com")

    def rank(item: tuple[str, str]) -> tuple:
        e, src = item
        el = e.lower()
        domain = el.split("@")[-1] if "@" in el else ""
        is_hunter = src == "hunter.io" or "couple" in domain.replace("-", "").replace(".", "")
        is_personal = domain in personal
        return (0 if is_personal else 1, 1 if is_hunter else 0, 0 if is_personal else 1)

    emails_sorted = sorted(emails, key=rank)
    return emails_sorted[0][0]


def _best_contact_phone(p: dict[str, Any]) -> str:
    for c in p.get("contacts") or []:
        ph = (c.get("phone") or "").strip()
        if ph:
            return ph
    return ""


def capture_couple_lead(
    *,
    partner1_name: str = "",
    partner2_name: str = "",
    email: str = "",
    phone: str = "",
    wedding_date: str = "",
    city: str = "",
    experience: str = "",
    package_interest: str = "",
    message: str = "",
    utm_source: str = "",
    utm_medium: str = "",
    utm_campaign: str = "",
    honeypot: str = "",
) -> dict[str, Any]:
    """Public storefront form → wedding CRM (no auth). Returns prospect id.

    Honeypot: if filled, silently pretend success (bot trap).
    """
    if (honeypot or "").strip():
        return {"ok": True, "prospect_id": "ok", "deduped": False, "bot": True}

    email = (email or "").strip().lower()
    p1 = (partner1_name or "").strip()
    p2 = (partner2_name or "").strip()
    if not email or "@" not in email:
        raise ValueError("A valid email is required.")
    if not p1 and not p2:
        raise ValueError("Please include at least one name.")

    names = " & ".join([n for n in (p1, p2) if n])
    company = f"Couple: {names}" if names else f"Couple: {email}"
    geo = (city or "").strip() or "Bay Area"
    exp = (experience or "").strip().lower() or "none"
    pkg = (package_interest or "").strip().lower() or "unsure"
    notes_parts = [
        f"Wedding date: {wedding_date or '—'}",
        f"Experience: {exp}",
        f"Package interest: {pkg}",
        f"UTM: {utm_source or '—'}/{utm_medium or '—'}/{utm_campaign or '—'}",
    ]
    if (message or "").strip():
        notes_parts.append(f"Message: {message.strip()[:800]}")
    notes = "\n".join(notes_parts)
    signals = ["web_lead", "couple", "first dance", "no experience required"]
    if utm_source:
        signals.append(f"utm:{utm_source}")
    if pkg and pkg != "unsure":
        signals.append(f"pkg:{pkg}")

    # Dedup by email among couples
    existing = crm.list_prospects(book="wedding")
    for p in existing:
        contacts = p.get("contacts") or []
        emails = {(c.get("email") or "").lower() for c in contacts}
        if email in emails and _is_couple_lead(p):
            updated = crm.update_prospect(
                p["id"],
                book="wedding",
                notes=((p.get("notes") or "") + "\n---\n" + notes).strip(),
                wedding_date=wedding_date or p.get("wedding_date"),
                package_interest=pkg,
                geo=geo or p.get("geo"),
            )
            crm.set_stage(p["id"], "scored", note="Repeat web form submit", book="wedding")
            return {
                "ok": True,
                "prospect_id": p["id"],
                "deduped": True,
                "company": updated.get("company"),
                "stage": "scored",
            }

    scored = score_wedding_lead(
        company=company,
        industry="Wedding couple",
        geo=geo,
        notes=notes,
        signals=signals,
        package_hint=pkg if pkg != "unsure" else "package_10",
        priority=9,
    )
    contact = {"name": names or p1 or p2, "email": email}
    if phone:
        contact["phone"] = phone.strip()

    p = crm.upsert_prospect(
        company=company,
        industry="Wedding couple",
        geo=geo,
        notes=notes,
        signals=signals,
        contacts=[contact],
        book="wedding",
        extra={
            "source": "web_form",
            "lead_channel": "couple",
            "channel_label": "Couple (web form)",
            "wedding_date": wedding_date or "",
            "package_interest": pkg,
            "experience": exp,
            "utm_source": utm_source or "",
            "utm_medium": utm_medium or "",
            "utm_campaign": utm_campaign or "",
            "recommended_packages": scored["recommended_packages"],
            "score": scored["score"],
            "tier": scored["tier"],
            "score_breakdown": scored["breakdown"],
            "agent_note": scored.get("agent_note") or "Inbound couple — call or text same day.",
            "stage": "scored",
            "partner1_name": p1,
            "partner2_name": p2,
        },
    )
    return {
        "ok": True,
        "prospect_id": p["id"],
        "deduped": False,
        "company": p.get("company"),
        "stage": p.get("stage"),
        "suggested_package": (scored["recommended_packages"] or [{}])[0].get("name"),
    }


_MEDIA_KV_KEY = "wedding_media"


def _normalize_media_item(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    src = (item.get("src") or "").strip()
    if not src:
        return None
    # Allow https URLs and relative media/ paths only
    if not (
        src.startswith("https://")
        or src.startswith("http://")
        or src.startswith("media/")
        or src.startswith("/media/")
    ):
        return None
    typ = (item.get("type") or "image").strip().lower()
    if typ not in ("image", "video", "embed"):
        typ = "image"
    out: dict[str, Any] = {"type": typ, "src": src}
    if item.get("caption"):
        out["caption"] = str(item.get("caption"))[:120]
    if item.get("alt"):
        out["alt"] = str(item.get("alt"))[:160]
    if item.get("poster"):
        poster = str(item.get("poster")).strip()
        if poster.startswith("https://") or poster.startswith("media/") or poster.startswith("/media/"):
            out["poster"] = poster
    return out


def _normalize_media_payload(raw: dict[str, Any] | None) -> dict[str, Any]:
    raw = raw or {}
    hero = _normalize_media_item(raw.get("hero")) if raw.get("hero") else None
    clips_in = raw.get("clips") if isinstance(raw.get("clips"), list) else []
    clips: list[dict[str, Any]] = []
    for c in clips_in[:6]:
        n = _normalize_media_item(c)
        if n:
            clips.append(n)
    return {"hero": hero, "clips": clips}


def get_wedding_media() -> dict[str, Any]:
    """Storefront media — shared Postgres (desk editor) → env → file fallback."""
    import os

    # 1) Desk-edited shared store
    try:
        stored = crm.load_kv(_MEDIA_KV_KEY)
        if stored and (stored.get("hero") or stored.get("clips")):
            return _normalize_media_payload(stored)
    except Exception:
        pass
    # 2) Env override (ops / emergency)
    raw = (os.environ.get("SLIW_WEDDING_MEDIA_JSON") or "").strip()
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                return _normalize_media_payload(data)
        except Exception:
            pass
    # 3) Repo file (dev only)
    path = Path(__file__).resolve().parent.parent / "weddings-site" / "media" / "manifest.json"
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return _normalize_media_payload(data)
        except Exception:
            pass
    return {"hero": None, "clips": []}


def save_wedding_media(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist storefront media from the Sliw desk (shared across services)."""
    clean = _normalize_media_payload(payload if isinstance(payload, dict) else {})
    saved = crm.save_kv(_MEDIA_KV_KEY, clean)
    return {
        "ok": True,
        "hero": clean.get("hero"),
        "clips": clean.get("clips") or [],
        "updated_at": saved.get("_updated_at"),
        "preview": "https://weddings.edytasliwinska.com/",
    }


def wedding_public_config() -> dict[str, Any]:
    """Public config for the storefront (no secrets)."""
    import os

    media = get_wedding_media()
    return {
        "ok": True,
        "brand": {
            "name": "Edyta Śliwińska",
            "tagline": "DWTS pro · Bay Area wedding dances · no experience required",
            "studio": "San Rafael, CA · Bay Area",
            "phone": "+1 (415) 891-7943",
            "email": "admin@edytasliwinska.com",
            "instagram": "https://www.instagram.com/edytasliwinska",
            "x": "https://www.x.com/Edyta_Sliwinska",
            "site": "https://edytasliwinska.com",
        },
        "packages": [package_to_dict(p) for p in WEDDING_PACKAGES.values()],
        "calendly_url": (os.environ.get("SLIW_WEDDING_CALENDLY_URL") or "").strip(),
        "stripe": {
            "single_lesson": (os.environ.get("SLIW_WEDDING_STRIPE_LINK_SINGLE") or "").strip(),
            "package_10": (os.environ.get("SLIW_WEDDING_STRIPE_LINK_PACKAGE10") or "").strip(),
            "mode": (os.environ.get("SLIW_WEDDING_STRIPE_MODE") or "sandbox").strip(),
        },
        "media": {
            "hero": media.get("hero"),
            "clips": media.get("clips") or [],
        },
        "form_endpoint": "/api/sliw/public/wedding-lead",
    }


# Known live Payment Link IDs (fallback if metadata missing on session).
_PLINK_SINGLE = "plink_1U32GPGfn1u1jQca3ehKC5xp"
_PLINK_PACKAGE10 = "plink_1U32GQGfn1u1jQcaeTrYJpnr"


def _package_from_stripe_session(session: dict[str, Any]) -> str:
    """Map a Checkout Session to package_id: single_lesson | package_10 | dream."""
    meta = session.get("metadata") or {}
    pkg = (meta.get("package_id") or meta.get("package") or "").strip().lower()
    if pkg in ("single_lesson", "package_10", "dream", "single", "package10"):
        if pkg in ("single",):
            return "single_lesson"
        if pkg in ("package10",):
            return "package_10"
        return pkg

    plink = session.get("payment_link") or ""
    if isinstance(plink, dict):
        plink = plink.get("id") or ""
    plink = str(plink)
    if plink == _PLINK_SINGLE or plink.endswith("3ehKC5xp"):
        return "single_lesson"
    if plink == _PLINK_PACKAGE10 or plink.endswith("eTrYJpnr"):
        return "package_10"

    amount = session.get("amount_total")
    try:
        cents = int(amount) if amount is not None else -1
    except (TypeError, ValueError):
        cents = -1
    if cents == 15000:
        return "single_lesson"
    if cents == 125000:
        return "package_10"
    return "package_10" if cents and cents >= 100000 else "single_lesson"


def apply_stripe_checkout_session(session: dict[str, Any]) -> dict[str, Any]:
    """Mark a wedding CRM prospect won from a paid Stripe Checkout Session.

    Matches existing couple by customer email when possible; otherwise creates
    a paid lead. Idempotent on stripe_session_id.
    """
    if not isinstance(session, dict):
        return {"ok": False, "error": "invalid session"}

    session_id = (session.get("id") or "").strip()
    email = (
        (session.get("customer_details") or {}).get("email")
        or session.get("customer_email")
        or ""
    ).strip().lower()
    name = (
        (session.get("customer_details") or {}).get("name")
        or (session.get("customer_details") or {}).get("phone")
        or ""
    )
    phone = ((session.get("customer_details") or {}).get("phone") or "").strip()
    amount_total = session.get("amount_total")
    currency = (session.get("currency") or "usd").upper()
    pkg = _package_from_stripe_session(session)
    pkg_label = {
        "single_lesson": "Private wedding lesson ×1 ($150)",
        "package_10": "Wedding lesson package ×10 ($1,250)",
        "dream": "Dream Wedding Dance",
    }.get(pkg, pkg)

    dollars = ""
    try:
        if amount_total is not None:
            dollars = f"${int(amount_total) / 100:,.2f}"
    except Exception:
        dollars = str(amount_total)

    payment_note = (
        f"STRIPE PAID · {pkg_label} · {dollars} {currency} · session={session_id or '—'}"
    ).strip()

    # Idempotency: already processed this session?
    existing = crm.list_prospects(book="wedding")
    for p in existing:
        if session_id and (p.get("stripe_session_id") or "") == session_id:
            return {
                "ok": True,
                "deduped": True,
                "prospect_id": p["id"],
                "stage": p.get("stage"),
                "package": pkg,
            }

    # Match by email among couples
    matched = None
    if email:
        for p in existing:
            contacts = p.get("contacts") or []
            emails = {(c.get("email") or "").lower() for c in contacts}
            if email in emails and _is_couple_lead(p):
                matched = p
                break

    if matched:
        notes = ((matched.get("notes") or "") + "\n---\n" + payment_note).strip()
        updated = crm.update_prospect(
            matched["id"],
            book="wedding",
            notes=notes,
            package_interest=pkg,
            stripe_session_id=session_id,
            stripe_amount_total=amount_total,
            stripe_currency=currency,
            payment_status="paid",
            paid_package=pkg,
        )
        # Paid = won (money in). Note keeps package detail.
        crm.set_stage(
            matched["id"],
            "won",
            note=payment_note,
            book="wedding",
        )
        return {
            "ok": True,
            "deduped": False,
            "created": False,
            "prospect_id": matched["id"],
            "stage": "won",
            "package": pkg,
            "company": updated.get("company"),
            "email": email,
        }

    # No prior form fill — create paid couple lead
    display = (name or "").strip() or (email.split("@")[0] if email else "Stripe buyer")
    company = f"Couple: {display}" if display else f"Couple: {email or 'paid'}"
    scored = score_wedding_lead(
        company=company,
        industry="Wedding couple",
        geo="Bay Area",
        notes=payment_note,
        signals=["stripe_paid", "couple", f"pkg:{pkg}"],
        package_hint=pkg,
        priority=10,
    )
    contact: dict[str, Any] = {"name": display}
    if email:
        contact["email"] = email
    if phone:
        contact["phone"] = phone

    p = crm.upsert_prospect(
        company=company,
        industry="Wedding couple",
        geo="Bay Area",
        notes=payment_note,
        signals=["stripe_paid", "couple", f"pkg:{pkg}"],
        contacts=[contact],
        book="wedding",
        extra={
            "source": "stripe",
            "lead_channel": "couple",
            "channel_label": "Couple (Stripe payment)",
            "package_interest": pkg,
            "paid_package": pkg,
            "payment_status": "paid",
            "stripe_session_id": session_id,
            "stripe_amount_total": amount_total,
            "stripe_currency": currency,
            "recommended_packages": scored["recommended_packages"],
            "score": scored["score"],
            "tier": scored["tier"],
            "score_breakdown": scored["breakdown"],
            "agent_note": "Paid via Stripe — call/text same day to schedule lessons.",
            "stage": "won",
            "partner1_name": display,
        },
    )
    # Ensure history shows won
    if p.get("stage") != "won":
        crm.set_stage(p["id"], "won", note=payment_note, book="wedding")

    return {
        "ok": True,
        "deduped": False,
        "created": True,
        "prospect_id": p["id"],
        "stage": "won",
        "package": pkg,
        "company": p.get("company"),
        "email": email,
    }


def verify_stripe_webhook_signature(
    payload: bytes,
    sig_header: str,
    secret: str,
    *,
    tolerance_sec: int = 300,
) -> bool:
    """HMAC-SHA256 verify Stripe-Signature without the stripe SDK."""
    import hashlib
    import hmac
    import time

    if not secret or not sig_header or not payload:
        return False
    parts: dict[str, list[str]] = {}
    for item in sig_header.split(","):
        item = item.strip()
        if "=" not in item:
            continue
        k, v = item.split("=", 1)
        parts.setdefault(k.strip(), []).append(v.strip())
    try:
        timestamp = int((parts.get("t") or ["0"])[0])
    except ValueError:
        return False
    if abs(int(time.time()) - timestamp) > tolerance_sec:
        return False
    signed = f"{timestamp}.".encode("utf-8") + payload
    expected = hmac.new(
        secret.encode("utf-8"),
        signed,
        hashlib.sha256,
    ).hexdigest()
    candidates = parts.get("v1") or []
    return any(hmac.compare_digest(expected, c) for c in candidates)
