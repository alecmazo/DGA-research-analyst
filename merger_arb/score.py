"""Deal attractiveness scorecard. Data confidence stays in scanner.scoring."""

from __future__ import annotations

from copy import deepcopy

DEFAULT_WEIGHTS = {
    "return": 25,
    "regulatory": 20,
    "risk_reward": 15,
    "edge": 10,
    "timeline": 10,
    "financing": 8,
    "quality": 7,
    "optionality": 5,
}

DEFAULT_THRESHOLDS = {
    "r_cap": 0.10,
    "house_anchor": 0.90,
    "second_request": 0.08,
    "agency_suit": 0.30,
    "cfius": 0.03,
    "eu_phase_ii": 0.06,
    "samr": 0.05,
    "financing_condition": 0.10,
    "hostile": 0.25,
    "date_slip": 0.02,
    "hsr_and_vote_bonus": 0.04,
}

COMPONENTS = tuple(DEFAULT_WEIGHTS.keys())


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def validate_weights(weights: dict) -> list[str]:
    errors = []
    if not isinstance(weights, dict):
        return ["weights must be an object"]
    missing = [name for name in COMPONENTS if name not in weights]
    if missing:
        errors.append("missing " + ", ".join(missing))
    total = sum(float(weights.get(name) or 0) for name in COMPONENTS)
    if abs(total - 100.0) > 1e-6:
        errors.append("weights must sum to 100")
    return errors


def band_for(score: int | None, *, nr: bool) -> str:
    if nr or score is None:
        return "NR"
    if score >= 80:
        return "A"
    if score >= 65:
        return "B"
    if score >= 50:
        return "C"
    if score >= 35:
        return "D"
    return "F"


def score_return(net_annualized, tbill_pct, *, past_due: bool = False, r_cap: float = 0.10) -> dict:
    if past_due:
        return {"score": 0, "available": True, "input": {"net_annualized": net_annualized, "tbill_pct": tbill_pct, "past_due": True}, "nr_flag": "timeline"}
    if net_annualized is None or tbill_pct is None:
        return {"score": None, "available": False, "input": {"net_annualized": net_annualized, "tbill_pct": tbill_pct}}
    x = float(net_annualized) - float(tbill_pct) / 100.0
    return {
        "score": round(clamp(100.0 * x / float(r_cap or 0.10), 0, 100)),
        "available": True,
        "input": {"excess": x, "net_annualized": net_annualized, "tbill_pct": tbill_pct},
    }


def score_risk_reward(offer, price, break_price) -> dict:
    if offer is None or price is None or break_price is None:
        return {"score": None, "available": False, "input": {"offer": offer, "price": price, "break_price": break_price}}
    o, p, b = float(offer), float(price), float(break_price)
    warning = ""
    if b >= p:
        return {"score": 100, "available": True, "warning": "break price is at or above the target price", "input": {"offer": o, "price": p, "break_price": b}}
    if p == b:
        r = None
    else:
        r = (o - p) / (p - b)
    if r is None:
        return {"score": None, "available": False, "input": {"offer": o, "price": p, "break_price": b}}
    s = clamp(100.0 * (r - 0.05) / (0.50 - 0.05), 0, 100)
    return {"score": round(s), "available": True, "input": {"ratio": r, "offer": o, "price": p, "break_price": b}, "warning": warning}


def house_probability(flags: dict | None = None, thresholds: dict | None = None) -> float:
    th = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    flags = flags or {}
    p = float(th["house_anchor"])
    if flags.get("second_request"):
        p -= float(th["second_request"])
    if flags.get("agency_suit"):
        p -= float(th["agency_suit"])
    if flags.get("cfius"):
        p -= float(th["cfius"])
    if flags.get("eu_phase_ii"):
        p -= float(th["eu_phase_ii"])
    if flags.get("samr"):
        p -= float(th["samr"])
    if flags.get("financing_condition"):
        p -= float(th["financing_condition"])
    if flags.get("hostile"):
        p -= float(th["hostile"])
    slips = int(flags.get("slips") or 0)
    p -= float(th["date_slip"]) * slips
    if flags.get("hsr_cleared") and flags.get("vote_passed"):
        p += float(th["hsr_and_vote_bonus"])
    return clamp(p, 0.05, 0.99)


def score_edge(p_house, p_implied) -> dict:
    if p_house is None or p_implied is None:
        return {"score": None, "available": False, "input": {"p_house": p_house, "p_implied": p_implied}}
    e = (float(p_house) - float(p_implied)) * 100.0
    return {
        "score": round(clamp(50 + 5 * e, 0, 100)),
        "available": True,
        "input": {"edge_points": e, "p_house": p_house, "p_implied": p_implied},
    }


def score_regulatory(regulators: list[dict] | None = None, *, horizontal_overlap: bool = False) -> dict:
    s = 100
    sector_hits = 0
    for row in regulators or []:
        name = str(row.get("regulator") or "").upper()
        stage = str(row.get("stage") or "").lower()
        if stage in {"cleared", "expired", "et", "early_termination"}:
            continue
        if name == "HSR" and stage in {"pending", "filed", ""}:
            s -= 5
        elif "2R" in name or stage in {"second_request", "2r"}:
            s -= 30
        elif stage in {"suit", "pi", "complaint"}:
            s -= 60
        elif stage == "consent":
            s -= 10
        elif name == "CFIUS":
            s -= 15
        elif name in {"EU", "EU-I"} and "ii" not in stage and "2" not in stage:
            s -= 5
        elif name in {"EU-II", "EU"} and ("ii" in stage or "2" in stage or name == "EU-II"):
            s -= 25
        elif name in {"CMA"} and ("2" in stage or "ii" in stage):
            s -= 25
        elif name == "SAMR":
            s -= 20
        elif name in {"FCC", "FERC", "PUC", "BANK", "FED", "OCC"}:
            sector_hits += 1
    s -= min(30, 10 * sector_hits)
    if horizontal_overlap:
        s -= 15
    return {"score": round(clamp(s, 0, 100)), "available": True, "input": {"regulators": regulators or [], "horizontal_overlap": horizontal_overlap}}


def score_financing(inputs: dict) -> dict:
    kind = str(inputs.get("consideration") or "").lower()
    if kind == "stock" and not inputs.get("acquirer_vote_needed"):
        return {"score": 100, "available": True, "input": {"consideration": kind}}
    s = 100
    if inputs.get("financing_condition"):
        s -= 50
    if kind in {"cash", "mixed"} and not inputs.get("committed_financing", True):
        s -= 25
    nd = inputs.get("acquirer_nd_ebitda")
    if nd is not None and float(nd) > 4:
        s -= 15
    if str(inputs.get("acquirer_kind") or "").lower() == "pe":
        rtf = inputs.get("rtf_pct")
        if rtf is not None and float(rtf) < 4:
            s -= 10
    if kind == "stock" and inputs.get("acquirer_vote_needed"):
        s -= 10
    return {"score": round(clamp(s, 0, 100)), "available": True, "input": dict(inputs)}


def score_timeline(days, slack_to_outside, slips, *, past_due: bool = False) -> dict:
    if past_due:
        return {"score": 0, "available": True, "nr_flag": "timeline", "input": {"days": days, "past_due": True}}
    if days is None:
        return {"score": None, "available": False, "input": {"days": days}}
    s = 100
    if days > 270:
        s -= 40
    if days > 180:
        s -= 20
    if slack_to_outside is not None and slack_to_outside < 60:
        s -= 30
    s -= 15 * min(int(slips or 0), 2)
    return {"score": round(clamp(s, 0, 100)), "available": True, "input": {"days": days, "slack_to_outside": slack_to_outside, "slips": slips}}


def score_quality(inputs: dict) -> dict:
    s = 100
    if inputs.get("hostile"):
        s -= 40
    fee = inputs.get("termination_fee_pct")
    if fee is not None and float(fee) < 2:
        s -= 10
    if inputs.get("controlled_target") and not inputs.get("voting_agreement"):
        s -= 10
    if inputs.get("collar") or inputs.get("election"):
        s -= 10
    fit = inputs.get("strategic_fit")
    if fit is not None:
        s += (float(fit) - 3) * 10
    return {"score": round(clamp(s, 0, 100)), "available": True, "input": dict(inputs)}


def score_optionality(inputs: dict) -> dict:
    s = 30
    if inputs.get("go_shop"):
        s += 20
    if inputs.get("contested"):
        s += 40
    offer = inputs.get("offer")
    price = inputs.get("price")
    if offer is not None and price is not None and float(price) > float(offer):
        s += 20
    cvr = inputs.get("cvr_max_pct")
    if cvr is not None and float(cvr) > 3:
        s += 10
    return {"score": round(clamp(s, 0, 100)), "available": True, "input": dict(inputs)}


def _override_score(component: dict, override: dict | None) -> dict:
    if not override:
        return component
    out = dict(component)
    if override.get("score") is not None:
        out["score"] = round(clamp(float(override["score"]), 0, 100))
        out["available"] = True
    out["override"] = {
        "note": override.get("note") or "",
        "user": override.get("user") or "",
        "at": override.get("at") or "",
    }
    return out


def score_deal(inputs: dict, *, weights: dict | None = None, thresholds: dict | None = None, overrides: dict | None = None, config_version: int = 0) -> dict:
    weights = dict(DEFAULT_WEIGHTS if weights is None else weights)
    errors = validate_weights(weights)
    if errors:
        raise ValueError("; ".join(errors))
    th = {**DEFAULT_THRESHOLDS, **(thresholds or {})}
    overrides = overrides or {}
    flags = {
        "second_request": bool(inputs.get("second_request")),
        "agency_suit": bool(inputs.get("agency_suit")),
        "cfius": bool(inputs.get("cfius")),
        "eu_phase_ii": bool(inputs.get("eu_phase_ii")),
        "samr": bool(inputs.get("samr")),
        "financing_condition": bool(inputs.get("financing_condition")),
        "hostile": bool(inputs.get("hostile")),
        "slips": int(inputs.get("slips") or 0),
        "hsr_cleared": bool(inputs.get("hsr_cleared")),
        "vote_passed": bool(inputs.get("vote_passed")),
    }
    house_override = overrides.get("house_p")
    if house_override and house_override.get("value") is not None:
        if not (house_override.get("note") or "").strip():
            raise ValueError("house probability override requires a note")
        p_house = float(house_override["value"])
        house_source = "override"
    else:
        p_house = house_probability(flags, th)
        house_source = "model"

    components = {
        "return": score_return(
            inputs.get("net_annualized"),
            inputs.get("tbill_pct"),
            past_due=bool(inputs.get("past_due")),
            r_cap=float(th.get("r_cap") or 0.10),
        ),
        "risk_reward": score_risk_reward(inputs.get("offer"), inputs.get("price"), inputs.get("break_price")),
        "edge": score_edge(p_house, inputs.get("implied_p")),
        "regulatory": score_regulatory(inputs.get("regulators") or [], horizontal_overlap=bool(inputs.get("horizontal_overlap"))),
        "financing": score_financing(inputs),
        "timeline": score_timeline(
            inputs.get("days_to_close"),
            inputs.get("slack_to_outside"),
            inputs.get("slips") or 0,
            past_due=bool(inputs.get("past_due")),
        ),
        "quality": score_quality(inputs),
        "optionality": score_optionality(inputs),
    }
    for name in COMPONENTS:
        components[name] = _override_score(components[name], overrides.get(name))
        components[name]["weight"] = float(weights[name])

    available_w = sum(float(weights[name]) for name in COMPONENTS if components[name].get("available") and components[name].get("score") is not None)
    weighted = sum(float(weights[name]) * float(components[name]["score"]) for name in COMPONENTS if components[name].get("available") and components[name].get("score") is not None)
    total = None if available_w == 0 else round(weighted / available_w)
    coverage = available_w / 100.0
    missing_core = (not components["return"].get("available")) or (not components["risk_reward"].get("available"))
    nr = missing_core or coverage < 0.70
    for name, row in components.items():
        if row.get("score") is not None:
            row["contribution"] = round(float(weights[name]) * float(row["score"]) / 100.0, 2)
        else:
            row["contribution"] = None
    return {
        "score": total,
        "score_band": band_for(total, nr=nr),
        "coverage": round(coverage, 4),
        "nr": nr,
        "components": components,
        "p_house": p_house,
        "house_source": house_source,
        "weights": weights,
        "config_version": config_version,
        "overrides": deepcopy(overrides),
    }


def inputs_from_deal(deal: dict) -> dict:
    metrics = deal.get("metrics_json") or deal.get("metrics") or {}
    if not isinstance(metrics, dict):
        metrics = {}
    terms = deal.get("terms_json") or {}
    fields = deal.get("fields") or []
    if not fields and isinstance(terms, dict):
        fields = [{"field_name": name, "value": value, "is_current": True} for name, value in terms.items()]
    candidate = {
        "metrics": metrics,
        "current_price": deal.get("target_price") or metrics.get("target_price"),
        "fields": fields,
        "consideration_type": deal.get("deal_type") or metrics.get("consideration") or "",
        "hostile": deal.get("hostile"),
        "contested": deal.get("contested"),
        "hsr": deal.get("hsr") or "",
        "acquirer_kind": deal.get("acquirer_kind") or "",
        "slips": deal.get("slips") or 0,
        "slack_to_outside": metrics.get("slack_to_outside") or deal.get("slack_to_outside"),
        "break_price": metrics.get("break_price") or deal.get("break_price"),
        "regulators": deal.get("regulators") or [],
        "annualized_assumption": metrics.get("annualized_assumption") or "",
    }
    inputs = inputs_from_candidate(candidate)
    if inputs.get("net_annualized") is None:
        inputs["net_annualized"] = deal.get("ann_pct")
    if inputs.get("offer") is None:
        inputs["offer"] = deal.get("offer_value")
    if inputs.get("price") is None:
        inputs["price"] = deal.get("target_price")
    if inputs.get("implied_p") is None:
        inputs["implied_p"] = deal.get("implied_p")
    if inputs.get("tbill_pct") is None:
        inputs["tbill_pct"] = metrics.get("tbill_pct")
    if inputs.get("days_to_close") is None:
        inputs["days_to_close"] = metrics.get("days_to_close")
    return inputs


def inputs_from_candidate(candidate: dict) -> dict:
    metrics = candidate.get("metrics") or {}
    fields = {}
    for row in candidate.get("fields") or []:
        if isinstance(row, dict) and row.get("is_current", True) and row.get("field_name"):
            fields[row["field_name"]] = row.get("value")
    offer = metrics.get("offer_value")
    price = _float(candidate.get("current_price")) or metrics.get("target_price")
    return {
        "net_annualized": metrics.get("annualized_pct"),
        "tbill_pct": metrics.get("tbill_pct"),
        "past_due": "past due" in str(candidate.get("annualized_assumption") or metrics.get("annualized_assumption") or ""),
        "offer": offer,
        "price": price,
        "break_price": metrics.get("break_price") or candidate.get("break_price"),
        "implied_p": metrics.get("implied_p"),
        "days_to_close": metrics.get("days_to_close"),
        "consideration": candidate.get("consideration_type") or metrics.get("consideration") or "",
        "hostile": bool(candidate.get("hostile")),
        "collar": any(str(fields.get(name) or "") for name in ("collar",)),
        "election": bool(fields.get("election") or fields.get("proration")),
        "go_shop": bool(fields.get("go_shop")),
        "contested": bool(candidate.get("contested")),
        "cvr_max_pct": _cvr_pct(fields.get("cvr"), offer),
        "regulators": candidate.get("regulators") or [],
        "hsr_cleared": (candidate.get("hsr") or "") in {"early_termination_granted", "cleared"},
        "financing_condition": bool(fields.get("financing_condition")),
        "acquirer_kind": candidate.get("acquirer_kind") or "",
        "slips": int(candidate.get("slips") or 0),
        "slack_to_outside": candidate.get("slack_to_outside"),
        "termination_fee_pct": _float(fields.get("termination_fee_pct")),
    }


def _float(value):
    if value in (None, ""):
        return None
    try:
        return float(str(value).replace(",", "").replace("$", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return None


def _cvr_pct(cvr, offer):
    cvr_n = _float(cvr)
    offer_n = _float(offer)
    if cvr_n is None or not offer_n:
        return None
    return 100.0 * cvr_n / offer_n
