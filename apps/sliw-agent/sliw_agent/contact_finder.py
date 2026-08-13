"""
Corporate contact discovery for Sliw Agent.

1. Hunter.io Domain Search (HUNTER_API_KEY) — primary
2. Public page scrape (names/titles, rarely emails)
3. Role-inbox fallbacks only if Hunter finds nothing

Always returns diagnostics so the UI can show whether the key was seen.
"""

from __future__ import annotations

import os
import re
from typing import Any
from urllib.parse import quote_plus, urlparse

import requests

TITLE_TARGETS = [
    "Head of People",
    "VP People",
    "Chief People Officer",
    "CHRO",
    "Director of Employee Experience",
    "Head of Employee Experience",
    "Director of Events",
    "Corporate Event Manager",
    "VP Learning and Development",
    "Head of Talent Development",
    "Wellness Program Manager",
    "Chief of Staff",
    "Director of Culture",
]

WEDDING_TITLE_TARGETS = [
    "Owner",
    "Founder",
    "Lead Planner",
    "Senior Wedding Planner",
    "Wedding Planner",
    "Director of Events",
    "Event Director",
    "Wedding Coordinator",
    "Sales Manager",
    "Director of Sales",
    "Catering Sales",
    "Wedding Sales Manager",
]

ROLE_KEYWORDS = [
    "people", "people ops", "people operations", "human resources", " hr",
    "hr ", "chro", "talent", "employee experience", "employee engagement",
    "learning", "l&d", "l and d", "events", "event ", "wellness", "culture",
    "chief of staff", "workplace", "internal communications", "recruiting",
    "people partner", "hrbp", "benefits",
]

WEDDING_ROLE_KEYWORDS = [
    "planner", "wedding", "event", "events", "owner", "founder", "principal",
    "coordinator", "design", "sales", "catering", "hospitality", "venue",
    "bridal", "celebration",
]

# Corporate ICP — High: People / CHRO / EX / Events / L&D / culture / workplace /
# internal comms / chief of staff. Medium: HRBP / recruiting / wellness.
_PEOPLE_EX_CORE = (
    "chro",
    "chief people",
    "chief human resources",
    "head of people",
    "vp people",
    "vp of people",
    "vice president of people",
    "vice president people",
    "people officer",
    "people ops",
    "people operations",
    "people experience",
    "employee experience",
    "employee engagement",
    "head of hr",
    "vp hr",
    "vp of hr",
    "director of people",
    "director of hr",
)
_EVENTS_LD_CULTURE = (
    "head of events",
    "director of events",
    "event manager",
    "events manager",
    "corporate event",
    "corporate events",
    "learning and development",
    "learning & development",
    "l&d",
    "l and d",
    "talent development",
    "director of culture",
    "head of culture",
    "head of workplace",
    "director of workplace",
    "workplace experience",
    "internal communication",
    "internal comms",
    "internal comm",
    "chief of staff",
)
_MEDIUM_ROLE = (
    "hrbp",
    "hr bp",
    "people partner",
    "human resources",
    "recruiting",
    "recruiter",
    "talent acquisition",
    "talent partner",
    "wellness",
    "benefits",
)
_PENALTY_ROLE = (
    "engineer",
    "engineering",
    "software developer",
    "developer",
    "account executive",
    "demand gen",
    "demand-gen",
    "demand generation",
    "sales development",
)
_STRONG_PEOPLE_EX_MIN = 3


def _hunter_api_key() -> str:
    """Read key from several common Railway/env spellings; strip quotes/whitespace."""
    for name in (
        "HUNTER_API_KEY",
        "HUNTERIO_API_KEY",
        "HUNTER_KEY",
        "HUNTER_API",
    ):
        raw = os.environ.get(name)
        if raw is None:
            continue
        key = str(raw).strip().strip('"').strip("'")
        if key:
            return key
    return ""


def _domain_from_website(website: str, company: str = "") -> str:
    if website:
        u = website.strip()
        if not u.startswith("http"):
            u = "https://" + u
        try:
            host = urlparse(u).netloc.lower().removeprefix("www.")
            # careers.x.com → x.com when possible
            parts = host.split(".")
            if len(parts) > 2 and parts[0] in (
                "careers", "jobs", "about", "www", "ir", "investors", "blog",
            ):
                host = ".".join(parts[1:])
            if host and "." in host:
                return host
        except Exception:
            pass
    # Known overrides for library companies with awkward website fields
    overrides = {
        "stripe": "stripe.com",
        "airbnb": "airbnb.com",
        "salesforce": "salesforce.com",
        "google": "google.com",
        "meta": "meta.com",
        "openai": "openai.com",
        "anthropic": "anthropic.com",
        "notion": "notion.so",
        "rippling": "rippling.com",
        "asana": "asana.com",
        "pinterest": "pinterest.com",
        "figma": "figma.com",
        "block (square)": "block.xyz",
        "block": "block.xyz",
    }
    key = (company or "").strip().lower()
    if key in overrides:
        return overrides[key]
    for k, d in overrides.items():
        if k in key:
            return d
    slug = re.sub(r"[^a-z0-9]+", "", key)
    return f"{slug}.com" if slug else ""


def _hunter_title_blob(e: dict) -> str:
    return " ".join(
        str(e.get(k) or "") for k in ("position", "position_raw", "department")
    ).lower()


def _has_people_ex_core(blob: str) -> bool:
    if any(k in blob for k in ("people partner", "hrbp", "hr bp")):
        return False
    if any(k in blob for k in _PEOPLE_EX_CORE):
        return True
    return "people" in blob


def _has_events_ld_culture(blob: str) -> bool:
    if any(k in blob for k in _EVENTS_LD_CULTURE):
        return True
    if "events" in blob or "event " in blob:
        return True
    if "culture" in blob or "workplace" in blob:
        return True
    return False


def _has_high_people_ex_events_ld(blob: str) -> bool:
    return _has_people_ex_core(blob) or _has_events_ld_culture(blob)


def _has_medium_role(blob: str) -> bool:
    if any(k in blob for k in _MEDIUM_ROLE):
        return True
    return bool(re.search(r"\bhr\b", blob))


def _has_penalty_role(blob: str) -> bool:
    if any(k in blob for k in _PENALTY_ROLE):
        return True
    if re.search(r"\bae\b", blob):
        return True
    if "sales" in blob and not _has_high_people_ex_events_ld(blob):
        return True
    return False


def _legacy_role_score(e: dict) -> int:
    """Original Hunter scoring — wedding mode must stay on this path."""
    pos = (e.get("position") or e.get("position_raw") or "").lower()
    dept = (e.get("department") or "").lower()
    score = 0
    if any(k in pos for k in ROLE_KEYWORDS) or dept in (
        "hr", "management", "executive", "operations", "communication",
    ):
        score += 5
    if e.get("confidence", 0) >= 70:
        score += 2
    if (e.get("type") or "") == "personal":
        score += 1
    if e.get("seniority") in ("senior", "executive"):
        score += 1
    if (e.get("type") or "") == "generic":
        score = max(0, score - 3)
    return score


def _corporate_role_score(e: dict) -> tuple[int, bool]:
    """
    Stronger corporate ranking. High = People/CHRO/EX/Events/L&D/culture/
    workplace/internal comms/chief of staff. Medium = HRBP/recruiting/wellness.
    Engineer / sales AE / demand-gen are penalized unless also People/EX.
    """
    blob = _hunter_title_blob(e)
    people_ex_core = _has_people_ex_core(blob)
    high = _has_high_people_ex_events_ld(blob)
    score = 0
    if high:
        score += 10
        if people_ex_core:
            score += 2
    elif _has_medium_role(blob):
        score += 5
    elif (e.get("department") or "").lower() == "hr":
        score += 2
    if e.get("confidence", 0) >= 70:
        score += 2
    if (e.get("type") or "") == "personal":
        score += 1
    if e.get("seniority") in ("senior", "executive"):
        score += 1
    if (e.get("type") or "") == "generic":
        score -= 3
    if _has_penalty_role(blob) and not people_ex_core:
        score -= 8
    return score, high


def _is_generic(c: dict) -> bool:
    return (c.get("type") or "").lower() == "generic"


def _is_personal(c: dict) -> bool:
    t = (c.get("type") or "").lower()
    if t == "generic":
        return False
    if t == "personal":
        return True
    return bool((c.get("name") or "").strip()) and "@" not in (c.get("name") or "")


def _is_strong_people_ex_personal(c: dict) -> bool:
    return bool(c.get("people_ex")) and _is_personal(c) and not _is_generic(c)


def _contact_sort_key(c: dict, *, wedding_mode: bool = False):
    if wedding_mode:
        return (-int(c.get("role_fit_score") or 0), -int(c.get("confidence") or 0))
    generic = 1 if _is_generic(c) else 0
    strong = 1 if _is_strong_people_ex_personal(c) else 0
    personal = 1 if _is_personal(c) else 0
    return (
        generic,
        -strong,
        -personal,
        -int(c.get("role_fit_score") or 0),
        -int(c.get("confidence") or 0),
    )


def _parse_hunter_emails(
    emails: list[dict],
    *,
    wedding_mode: bool = False,
) -> list[dict[str, Any]]:
    out = []
    for e in emails:
        first = (e.get("first_name") or "").strip()
        last = (e.get("last_name") or "").strip()
        name = f"{first} {last}".strip()
        email = (e.get("value") or "").strip()
        if not email:
            continue
        if wedding_mode:
            score = _legacy_role_score(e)
            people_ex = False
        else:
            score, people_ex = _corporate_role_score(e)
        out.append({
            "name": name or email.split("@")[0].replace(".", " ").title(),
            "title": e.get("position") or e.get("position_raw") or e.get("department") or "",
            "email": email,
            "linkedin": e.get("linkedin") or "",
            "source": "hunter.io",
            "confidence": min(95, int(e.get("confidence") or 50) + max(score, 0) * 3),
            "role_fit_score": score,
            "department": e.get("department") or "",
            "type": e.get("type") or "",
            "people_ex": people_ex,
        })
    out.sort(key=lambda c: _contact_sort_key(c, wedding_mode=wedding_mode))
    return out


def _dedupe_contacts(contacts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduped = []
    for c in contacts:
        em = (c.get("email") or "").lower()
        if not em or em in seen:
            continue
        seen.add(em)
        deduped.append(c)
    return deduped


def _count_strong_people_ex_personal(contacts: list[dict[str, Any]]) -> int:
    return sum(1 for c in contacts if _is_strong_people_ex_personal(c))


def _hunter_get(params: dict[str, Any], diag: dict[str, Any]) -> list[dict]:
    """One Domain Search call. Never logs the API key. Returns raw email dicts."""
    label = {k: v for k, v in params.items() if k != "api_key"}
    try:
        r = requests.get(
            "https://api.hunter.io/v2/domain-search",
            params=params,
            timeout=30,
        )
        attempt_info: dict[str, Any] = {
            "params": label,
            "http_status": r.status_code,
        }
        if r.status_code != 200:
            try:
                body = r.json()
                attempt_info["error"] = body.get("errors") or body
            except Exception:
                attempt_info["error"] = (r.text or "")[:180]
            diag["attempts"].append(attempt_info)
            return []
        data = r.json().get("data") or {}
        emails = data.get("emails") or []
        attempt_info["emails_returned"] = len(emails)
        attempt_info["organization"] = (data.get("organization") or "")[:80]
        diag["attempts"].append(attempt_info)
        return emails
    except Exception as exc:
        diag["attempts"].append({"params": label, "error": str(exc)})
        return []


def _hunter_domain_search(
    domain: str,
    company: str = "",
    limit: int = 10,
    *,
    wedding_mode: bool = False,
) -> dict[str, Any]:
    """
    Call Hunter Domain Search. Returns {contacts, diagnostics}.
    Does NOT invent role inboxes here.

    Corporate: do not stop after an open search that returned zero strong
    People/EX/Events/L&D personal emails — continue with department=hr
    (and type=personal). Optional offset page 2 if still empty. Stop once
    we have ≥3 strong role-fit personal emails.

    Wedding: keep the original open-search-first, break-on-first-emails path.
    """
    key = _hunter_api_key()
    diag: dict[str, Any] = {
        "hunter_key_present": bool(key),
        "hunter_key_length": len(key),
        "domain": domain,
        "attempts": [],
        "hunter_emails_fetched": 0,
        "people_ex_hits": 0,
    }
    if not key:
        diag["error"] = "HUNTER_API_KEY not visible to this process"
        return {"contacts": [], "diagnostics": diag}
    if not domain:
        diag["error"] = "No domain resolved for company"
        return {"contacts": [], "diagnostics": diag}

    all_contacts: list[dict[str, Any]] = []

    def ingest(raw_emails: list[dict]) -> list[dict[str, Any]]:
        parsed = _parse_hunter_emails(raw_emails, wedding_mode=wedding_mode)
        if parsed:
            all_contacts.extend(parsed)
        return _dedupe_contacts(all_contacts)

    if wedding_mode:
        attempts = [
            {"domain": domain, "api_key": key, "limit": limit},
            {"domain": domain, "api_key": key, "limit": limit, "department": "hr"},
            {"domain": domain, "api_key": key, "limit": limit, "type": "personal"},
        ]
        if company:
            attempts.append({"company": company, "api_key": key, "limit": limit})
        for params in attempts:
            parsed = _parse_hunter_emails(
                _hunter_get(params, diag),
                wedding_mode=True,
            )
            if parsed:
                all_contacts.extend(parsed)
                break
    else:
        # 1. Open search
        ingest(_hunter_get(
            {"domain": domain, "api_key": key, "limit": limit},
            diag,
        ))
        strong = _count_strong_people_ex_personal(all_contacts)

        # 2. If fewer than 3 strong People/EX/Events/L&D personal emails,
        #    keep fetching — never treat raw top-N as good enough.
        if strong < _STRONG_PEOPLE_EX_MIN:
            ingest(_hunter_get(
                {
                    "domain": domain, "api_key": key, "limit": limit,
                    "department": "hr",
                },
                diag,
            ))
            strong = _count_strong_people_ex_personal(all_contacts)
        if strong < _STRONG_PEOPLE_EX_MIN:
            ingest(_hunter_get(
                {
                    "domain": domain, "api_key": key, "limit": limit,
                    "type": "personal",
                },
                diag,
            ))
            strong = _count_strong_people_ex_personal(all_contacts)
        # 3. Offset page 2 only if still empty of strong role-fit personal emails
        if strong == 0:
            ingest(_hunter_get(
                {
                    "domain": domain, "api_key": key, "limit": limit,
                    "offset": limit,
                },
                diag,
            ))
            strong = _count_strong_people_ex_personal(all_contacts)
        # 4. Company-name search only if Hunter returned nothing at all
        if company and not _dedupe_contacts(all_contacts):
            ingest(_hunter_get(
                {"company": company, "api_key": key, "limit": limit},
                diag,
            ))

    deduped = _dedupe_contacts(all_contacts)
    deduped.sort(key=lambda c: _contact_sort_key(c, wedding_mode=wedding_mode))

    people_ex_hits = _count_strong_people_ex_personal(deduped)
    diag["hunter_emails_fetched"] = len(deduped)
    diag["people_ex_hits"] = people_ex_hits

    if wedding_mode:
        role_fit = [c for c in deduped if c.get("role_fit_score", 0) >= 4]
        contacts = (role_fit or deduped)[:10]
    else:
        contacts = deduped[:10]
    diag["hunter_contacts"] = len(contacts)
    if not contacts:
        diag["error"] = (
            f"Hunter responded but found 0 emails for domain={domain}. "
            "Check domain spelling or Hunter coverage for this company."
        )
    return {"contacts": contacts, "diagnostics": diag}


def _scrape_team_page(website: str) -> list[dict[str, Any]]:
    if not website:
        return []
    base = website.strip().rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base
    paths = ["/about", "/about-us", "/company", "/team", "/leadership", "/people"]
    headers = {
        "User-Agent": "SliwAgent/1.0 (+corporate research; admin@edytasliwinska.com)",
        "Accept": "text/html",
    }
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    name_title = re.compile(
        r"([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){1,3})\s*[,|\-–—|]\s*"
        r"((?:Head|VP|Vice President|Director|Chief|Manager|Lead)[^<\n|]{3,60})",
        re.I,
    )
    for path in paths:
        url = base + path
        try:
            r = requests.get(url, headers=headers, timeout=10, allow_redirects=True)
            if r.status_code != 200:
                continue
            text = re.sub(r"<script[\s\S]*?</script>", " ", r.text, flags=re.I)
            text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
            text = re.sub(r"<[^>]+>", " | ", text)
            text = re.sub(r"\s+", " ", text)
            for m in name_title.finditer(text[:150000]):
                name, title = m.group(1).strip(), m.group(2).strip()
                if len(name) < 5 or name.lower() in seen:
                    continue
                if not any(k in title.lower() for k in ROLE_KEYWORDS):
                    continue
                seen.add(name.lower())
                found.append({
                    "name": name,
                    "title": title[:120],
                    "email": "",
                    "linkedin": "",
                    "source": f"scrape:{url}",
                    "confidence": 50,
                    "role_fit_score": 4,
                })
            if len(found) >= 5:
                break
        except Exception:
            continue
    return found


def _role_inbox_fallbacks(domain: str, *, wedding_mode: bool = False) -> list[dict[str, Any]]:
    if not domain:
        return []
    if wedding_mode:
        boxes = [
            ("Events / Weddings", "events@" + domain, "Events (guess)"),
            ("Weddings team", "weddings@" + domain, "Weddings (guess)"),
            ("Info", "info@" + domain, "General (guess)"),
            ("Hello", "hello@" + domain, "General (guess)"),
        ]
    else:
        boxes = [
            ("People / HR team", "people@" + domain, "People Ops (guess)"),
            ("Events team", "events@" + domain, "Corporate events (guess)"),
            ("HR team", "hr@" + domain, "HR (guess)"),
        ]
    return [
        {
            "name": label,
            "title": title,
            "email": email,
            "linkedin": "",
            "source": "role_inbox_guess",
            "confidence": 20,
            "role_fit_score": 1,
            "note": "Guessed role inbox — not from Hunter",
        }
        for label, email, title in boxes
    ]


def linkedin_search_targets(company: str, *, wedding_mode: bool = False) -> list[dict[str, str]]:
    titles = WEDDING_TITLE_TARGETS[:8] if wedding_mode else TITLE_TARGETS[:8]
    out = []
    for title in titles:
        q = f"{title} {company}"
        out.append({
            "title": title,
            "linkedin_search": f"https://www.linkedin.com/search/results/people/?keywords={quote_plus(q)}",
        })
    return out


def _boost_wedding_contacts(contacts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Re-score Hunter/scrape hits for planner / venue roles."""
    out = []
    for c in contacts:
        c = dict(c)
        pos = (c.get("title") or "").lower()
        name = (c.get("name") or "").lower()
        boost = 0
        if any(k in pos for k in WEDDING_ROLE_KEYWORDS):
            boost += 6
        if any(k in name for k in ("wedding", "event", "planner")):
            boost += 2
        c["role_fit_score"] = int(c.get("role_fit_score") or 0) + boost
        out.append(c)
    out.sort(key=lambda x: (-x.get("role_fit_score", 0), -x.get("confidence", 0)))
    return out


def _why_primary(contact: dict[str, Any] | None, *, wedding_mode: bool) -> str:
    if not contact or not contact.get("email"):
        return "No email found"
    title = (contact.get("title") or "").strip() or "untitled"
    source = contact.get("source") or ""
    if wedding_mode:
        return f"Wedding ranking: {title}"
    if source == "role_inbox_guess":
        return "No Hunter personal email; role-inbox fallback"
    if _is_generic(contact):
        return f"No personal Hunter email; generic inbox ({title})"
    if _is_strong_people_ex_personal(contact):
        blob = f"{contact.get('title') or ''} {contact.get('department') or ''}".lower()
        kind = "People/EX" if _has_people_ex_core(blob) else "Events/L&D"
        return f"Highest ranked personal {kind}: {title}"
    if _is_personal(contact):
        return f"No People/EX/Events/L&D personal email; next personal Hunter contact ({title})"
    return f"Highest ranked remaining Hunter contact ({title})"


def _pick_primary(
    contacts: list[dict[str, Any]],
    *,
    wedding_mode: bool,
) -> dict[str, Any]:
    if wedding_mode:
        return next(
            (c for c in contacts if c.get("source") == "hunter.io" and c.get("email")),
            None,
        ) or next((c for c in contacts if c.get("email")), None) or (
            contacts[0] if contacts else {}
        )

    hunter = [c for c in contacts if c.get("source") == "hunter.io" and c.get("email")]
    strong = next((c for c in hunter if _is_strong_people_ex_personal(c)), None)
    if strong:
        return strong
    personal = next((c for c in hunter if _is_personal(c) and not _is_generic(c)), None)
    if personal:
        return personal
    non_generic = next((c for c in hunter if not _is_generic(c)), None)
    if non_generic:
        return non_generic
    return next((c for c in contacts if c.get("email")), None) or (
        contacts[0] if contacts else {}
    )


def find_contacts(
    *,
    company: str,
    website: str = "",
    industry: str = "",
    package_id: str = "",
    wedding_mode: bool = False,
) -> dict[str, Any]:
    # Auto-detect wedding book industries
    ind = (industry or "").lower()
    if not wedding_mode and any(k in ind for k in ("wedding", "planner", "venue", "bridal")):
        wedding_mode = True

    domain = _domain_from_website(website, company)
    hunter_result = _hunter_domain_search(
        domain, company=company, limit=10, wedding_mode=wedding_mode,
    )
    hunter_contacts = hunter_result.get("contacts") or []
    diagnostics = hunter_result.get("diagnostics") or {}
    diagnostics["wedding_mode"] = wedding_mode

    contacts: list[dict[str, Any]] = list(hunter_contacts)

    # Scrape only if Hunter found nothing useful
    if not hunter_contacts:
        contacts.extend(_scrape_team_page(website or (f"https://{domain}" if domain else "")))

    if wedding_mode:
        contacts = _boost_wedding_contacts(contacts)

    # Dedup
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for c in contacts:
        key = (c.get("email") or c.get("name") or "").lower().strip()
        if not key or key in seen:
            continue
        # drop empty hunter errors
        if c.get("source") == "hunter.io_error":
            continue
        seen.add(key)
        deduped.append(c)

    deduped.sort(key=lambda c: _contact_sort_key(c, wedding_mode=wedding_mode))

    hunter_personal = [c for c in deduped if c.get("source") == "hunter.io" and c.get("email")]
    if not hunter_personal:
        # Only then add role inboxes
        for rb in _role_inbox_fallbacks(domain, wedding_mode=wedding_mode):
            if rb["email"].lower() not in seen:
                deduped.append(rb)

    primary = _pick_primary(deduped, wedding_mode=wedding_mode)
    # Keep the chosen primary first so desk/CRM first-contact pickers match
    if primary and primary.get("email"):
        pem = (primary.get("email") or "").lower()
        rest = [c for c in deduped if (c.get("email") or "").lower() != pem]
        deduped = [primary] + rest

    diagnostics["why_primary"] = _why_primary(primary, wedding_mode=wedding_mode)
    if not wedding_mode:
        diagnostics["people_ex_hits"] = _count_strong_people_ex_personal(deduped)

    summary = _method_summary(deduped, diagnostics, domain)
    if wedding_mode and summary:
        summary = "Wedding/planner mode · " + summary

    return {
        "company": company,
        "domain": domain,
        "contacts": deduped[:12],
        "primary": primary,
        "linkedin_targets": linkedin_search_targets(company, wedding_mode=wedding_mode),
        "hunter_enabled": diagnostics.get("hunter_key_present", False),
        "hunter_diagnostics": diagnostics,
        "method_summary": summary,
        "wedding_mode": wedding_mode,
    }


def _method_summary(
    contacts: list[dict],
    diagnostics: dict[str, Any],
    domain: str,
) -> str:
    key_ok = diagnostics.get("hunter_key_present")
    hunter_n = len([c for c in contacts if c.get("source") == "hunter.io" and c.get("email")])
    if not key_ok:
        return (
            "Hunter key NOT visible to this server process. "
            "On Railway: set HUNTER_API_KEY, then Redeploy (not just save)."
        )
    if hunter_n:
        hits = diagnostics.get("people_ex_hits")
        extra = f" {hits} People/EX/Events/L&D." if hits else ""
        return f"Hunter ✓ — {hunter_n} email(s) for {domain or 'domain'}.{extra}"
    # Key present but no hits
    attempts = diagnostics.get("attempts") or []
    statuses = [a.get("http_status") for a in attempts if a.get("http_status")]
    errs = [a.get("error") for a in attempts if a.get("error")]
    if any(s == 401 for s in statuses):
        return "Hunter key rejected (401). Check the key value on Railway."
    if any(s == 429 for s in statuses):
        return "Hunter rate limit / out of credits (429)."
    if errs and not statuses:
        return f"Hunter request failed: {errs[0]}"
    if statuses and all(s == 200 for s in statuses):
        return (
            f"Hunter key is live, but 0 emails for domain “{domain}”. "
            "Try a company with a public domain, or check Hunter’s coverage."
        )
    if diagnostics.get("error"):
        return str(diagnostics["error"])
    return f"Hunter key present; no usable contacts for {domain}."
