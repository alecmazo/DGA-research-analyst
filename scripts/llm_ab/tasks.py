"""Four A/B tasks: deal terms, spread math, MD&A summary, filing Q&A."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from merger_arb.calc import annualized, gross_spread, offer_value  # noqa: E402

from scripts.llm_ab.common import (  # noqa: E402
    CHAT_MODELS,
    DEAL_FIELDS,
    EMBED_MODELS,
    INDEXES,
    chat_completion,
    cosine,
    embed_texts_ollama,
    field_match,
    load_json,
    load_items_from_local_db,
    norm_field,
    parse_json_object,
    unload_model,
)

DEAL_SYSTEM = (
    "Extract merger deal terms from the filing excerpt. Reply with ONLY JSON "
    "using keys: acquirer, target, consideration (cash|stock|mixed), "
    "cash_per_share, exchange_ratio, cvr (boolean), termination_fee, "
    "outside_date (YYYY-MM-DD), approvals. Use null when absent. Temperature is 0."
)

SPREAD_SYSTEM = (
    "You are a merger-arb calculator. Given deal terms and prices, compute "
    "JSON only with keys: offer_value, gross_spread_pct (decimal, e.g. 0.0526), "
    "annualized_spread_pct (compound annualized decimal), stock_deal_ratio "
    "(exchange ratio or null). Do the arithmetic carefully. No prose."
)

MDA_SYSTEM = (
    "Summarize the MD&A in about 200 words. List exactly 5 key drivers as a "
    "numbered list after the summary. Use only figures present in the text. "
    "Do not invent numbers."
)


def _within_pct(pred, gold, tol: float = 0.0001) -> bool:
    try:
        return abs(float(pred) - float(gold)) <= tol
    except (TypeError, ValueError):
        return False


def ground_truth_spread(item: dict) -> dict:
    ov = offer_value(
        consideration=item["consideration"],
        cash=item.get("cash"),
        ratio=item.get("ratio"),
        acquirer_price=item.get("acquirer_price"),
    )
    offer = ov["value"]
    dollars, pct = gross_spread(offer, item.get("target_price"))
    compound, _simple = annualized(pct, item.get("years_to_close"))
    return {
        "offer_value": offer,
        "gross_spread_pct": pct,
        "annualized_spread_pct": compound,
        "stock_deal_ratio": item.get("ratio"),
    }


def run_deal_terms(models: list[str] | None = None) -> dict:
    models = models or CHAT_MODELS
    items = load_json("deal_terms.json")
    # Prefer local DB packets when present (read-only, localhost only).
    db_rows = load_items_from_local_db("deal_terms", limit=10)
    if len(db_rows) >= 10:
        print("[llm_ab] deal_terms: using 10 packets from local DB", flush=True)
    rows = []
    wins = {m: 0 for m in models}
    for model in models:
        unload_model(model)
        field_hits = 0
        field_total = 0
        json_ok = 0
        mem_fail = False
        metrics = []
        for item in items:
            user = item["filing_excerpt"]
            resp = chat_completion(
                model, DEAL_SYSTEM, user, temperature=0.0, format_json=True, num_predict=512,
            )
            metrics.append(resp)
            if not resp.get("ok"):
                mem_fail = True
                continue
            parsed = parse_json_object(resp.get("text") or "")
            if parsed is None:
                continue
            json_ok += 1
            gold = item["gold"]
            for key in DEAL_FIELDS:
                field_total += 1
                if field_match(parsed.get(key), gold.get(key)):
                    field_hits += 1
        score = (field_hits / field_total) if field_total else 0.0
        rows.append({
            "model": model,
            "json_validity": json_ok / max(1, len(items)),
            "field_exact": score,
            "avg_tok_s": _avg([m.get("tok_s") for m in metrics]),
            "avg_ttft_s": _avg([m.get("ttft_s") for m in metrics]),
            "memory_failure": mem_fail,
            "sample_memory": (metrics[-1].get("memory") if metrics else {}),
        })
        unload_model(model)
    # Winner: highest field_exact among models with no memory failure.
    ranked = sorted(
        [r for r in rows if not r["memory_failure"]],
        key=lambda r: (r["field_exact"], r["json_validity"]),
        reverse=True,
    )
    if ranked:
        wins[ranked[0]["model"]] = 1
    return {"task": "deal_terms", "rows": rows, "wins": wins, "n": len(items)}


def run_spread(models: list[str] | None = None) -> dict:
    models = models or CHAT_MODELS
    items = load_json("spread.json")
    rows = []
    wins = {m: 0 for m in models}
    for model in models:
        unload_model(model)
        ok = 0
        mem_fail = False
        metrics = []
        for item in items:
            gold = ground_truth_spread(item)
            user = json.dumps({
                "consideration": item["consideration"],
                "cash_per_share": item.get("cash"),
                "exchange_ratio": item.get("ratio"),
                "acquirer_price": item.get("acquirer_price"),
                "target_price": item.get("target_price"),
                "years_to_close": item.get("years_to_close"),
            })
            resp = chat_completion(
                model, SPREAD_SYSTEM, user, temperature=0.0, format_json=True, num_predict=256,
            )
            metrics.append(resp)
            if not resp.get("ok"):
                mem_fail = True
                continue
            parsed = parse_json_object(resp.get("text") or "") or {}
            checks = [
                _within_pct(parsed.get("offer_value"), gold["offer_value"], 0.01),
                _within_pct(parsed.get("gross_spread_pct"), gold["gross_spread_pct"], 0.0001),
                _within_pct(
                    parsed.get("annualized_spread_pct"),
                    gold["annualized_spread_pct"],
                    0.0001,
                ),
            ]
            if item.get("ratio") is not None:
                checks.append(
                    _within_pct(parsed.get("stock_deal_ratio"), gold["stock_deal_ratio"], 0.0001)
                    or field_match(parsed.get("stock_deal_ratio"), gold["stock_deal_ratio"])
                )
            if all(checks):
                ok += 1
        rows.append({
            "model": model,
            "pass_rate": ok / max(1, len(items)),
            "passed": ok,
            "n": len(items),
            "avg_tok_s": _avg([m.get("tok_s") for m in metrics]),
            "avg_ttft_s": _avg([m.get("ttft_s") for m in metrics]),
            "memory_failure": mem_fail,
        })
        unload_model(model)
    ranked = sorted(
        [r for r in rows if not r["memory_failure"]],
        key=lambda r: r["pass_rate"],
        reverse=True,
    )
    if ranked:
        wins[ranked[0]["model"]] = 1
    return {"task": "spread", "rows": rows, "wins": wins, "n": len(items)}


def _mda_rubric(text: str, source: str) -> dict:
    """Heuristic rubric when cloud judge is off. Scores 0–1 each."""
    body = text or ""
    words = re.findall(r"[A-Za-z0-9%$.,]+", body)
    # Faithfulness: every $ or % number in the answer should appear in source.
    nums = re.findall(r"\$?\d+(?:\.\d+)?%?", body)
    invented = 0
    checked = 0
    src_norm = norm_field(source)
    for n in nums:
        checked += 1
        if norm_field(n) and norm_field(n) not in src_norm and n.replace("$", "") not in source:
            invented += 1
    faithfulness = 1.0 if checked == 0 else max(0.0, 1.0 - invented / checked)
    # Coverage: look for 5 drivers (numbered list or bullets).
    drivers = len(re.findall(r"(?:^|\n)\s*(?:\d+[\).]|[-*])\s+\S+", body))
    coverage = min(1.0, drivers / 5.0)
    # Length near 200 words (±50%).
    wc = len(words)
    length_score = 1.0 if 100 <= wc <= 300 else (0.5 if 50 <= wc <= 400 else 0.2)
    # Numeric accuracy: share of source numbers that appear in the answer.
    src_nums = re.findall(r"\$?\d+(?:\.\d+)?%?", source)
    hit = sum(1 for n in src_nums if n in body or n.replace("$", "") in body)
    numeric = (hit / len(src_nums)) if src_nums else 0.0
    overall = (faithfulness + coverage + length_score + numeric) / 4.0
    return {
        "faithfulness": round(faithfulness, 3),
        "coverage": round(coverage, 3),
        "length": round(length_score, 3),
        "numeric": round(numeric, 3),
        "overall": round(overall, 3),
        "word_count": wc,
    }


def run_mda(models: list[str] | None = None) -> dict:
    models = models or CHAT_MODELS
    items = load_json("mda.json")
    rows = []
    wins = {m: 0 for m in models}
    for model in models:
        unload_model(model)
        scores = []
        mem_fail = False
        metrics = []
        for item in items:
            resp = chat_completion(
                model, MDA_SYSTEM, item["text"], temperature=0.0, num_predict=800,
            )
            metrics.append(resp)
            if not resp.get("ok"):
                mem_fail = True
                scores.append(0.0)
                continue
            rub = _mda_rubric(resp.get("text") or "", item["text"])
            scores.append(rub["overall"])
        rows.append({
            "model": model,
            "rubric_avg": _avg(scores) or 0.0,
            "avg_tok_s": _avg([m.get("tok_s") for m in metrics]),
            "avg_ttft_s": _avg([m.get("ttft_s") for m in metrics]),
            "memory_failure": mem_fail,
        })
        unload_model(model)
    ranked = sorted(
        [r for r in rows if not r["memory_failure"]],
        key=lambda r: r["rubric_avg"],
        reverse=True,
    )
    if ranked:
        wins[ranked[0]["model"]] = 1
    return {"task": "mda", "rows": rows, "wins": wins, "n": len(items)}


def _build_corpus() -> list[dict]:
    """Local file index corpus from MD&A fixtures (+ optional local DB chunks)."""
    mda = load_json("mda.json")
    corpus = []
    for i, item in enumerate(mda):
        corpus.append({
            "chunk_id": f"{item['ticker']}_0",
            "ticker": item["ticker"],
            "text": item["text"],
        })
        # Distractors so recall@5 is meaningful.
        corpus.append({
            "chunk_id": f"{item['ticker']}_noise",
            "ticker": item["ticker"],
            "text": (
                f"{item['ticker']} discussed litigation reserves and tax rates "
                f"without mentioning the metrics in question {i}."
            ),
        })
    db = load_items_from_local_db("rag", limit=40)
    for j, row in enumerate(db):
        corpus.append({
            "chunk_id": f"db_{row.get('ticker')}_{row.get('quarter')}_{row.get('chunk_idx')}_{j}",
            "ticker": row.get("ticker") or "UNK",
            "text": (row.get("chunk_text") or "")[:2000],
        })
    return corpus


def _index_path(model: str) -> Path:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", model).strip("_").lower()
    return INDEXES / f"call_chunks__{slug}.json"


def build_embed_index(model: str, corpus: list[dict]) -> Path:
    """Write a separate on-disk index per embed model. Never touches Postgres."""
    path = _index_path(model)
    path.parent.mkdir(parents=True, exist_ok=True)
    vectors = embed_texts_ollama(model, [c["text"] for c in corpus])
    payload = {
        "embed_model": model,
        "chunks": [
            {**c, "embedding": vectors[i]}
            for i, c in enumerate(corpus)
        ],
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    print(f"[llm_ab] wrote separate index {path} ({len(corpus)} chunks)", flush=True)
    return path


def run_rag(embed_models: list[str] | None = None, chat_model: str | None = None) -> dict:
    embed_models = embed_models or EMBED_MODELS
    chat_model = chat_model or (CHAT_MODELS[0] if CHAT_MODELS else "gpt-oss-20b-finance")
    questions = load_json("rag.json")
    corpus = _build_corpus()
    rows = []
    recall_by_model = {}
    for emb in embed_models:
        unload_model(emb)
        try:
            path = build_embed_index(emb, corpus)
        except Exception as exc:
            rows.append({
                "embed_model": emb,
                "recall_at_5": 0.0,
                "answer_correct": 0.0,
                "citation_correct": 0.0,
                "error": str(exc)[:200],
                "memory_failure": True,
            })
            unload_model(emb)
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        chunks = data["chunks"]
        hits = 0
        ans_ok = 0
        cite_ok = 0
        for q in questions:
            qvec = embed_texts_ollama(emb, [q["question"]])[0]
            scored = []
            for ch in chunks:
                scored.append((cosine(qvec, ch["embedding"]), ch))
            scored.sort(key=lambda x: -x[0])
            top5 = [c for _, c in scored[:5]]
            gold_id = q["gold_chunk_id"]
            if any(c["chunk_id"] == gold_id for c in top5):
                hits += 1
            context = "\n\n".join(
                f"[{c['chunk_id']}] {c['text']}" for c in top5
            )
            system = (
                "Answer using only the passages. Cite chunk ids like [AAPL_0]. "
                "If unknown, say N/A. JSON: {\"answer\": \"...\", \"citations\": [\"...\"]}"
            )
            unload_model(emb)
            resp = chat_completion(
                chat_model,
                system,
                f"Question: {q['question']}\n\nPassages:\n{context}",
                temperature=0.0,
                format_json=True,
                num_predict=400,
            )
            unload_model(chat_model)
            parsed = parse_json_object(resp.get("text") or "") or {}
            answer = str(parsed.get("answer") or "")
            cites = parsed.get("citations") or []
            if all(tok.lower() in answer.lower() for tok in q.get("gold_answer_contains") or []):
                ans_ok += 1
            if gold_id in [str(c) for c in cites] or gold_id in answer:
                cite_ok += 1
        n = max(1, len(questions))
        recall = hits / n
        recall_by_model[emb] = recall
        rows.append({
            "embed_model": emb,
            "recall_at_5": round(recall, 3),
            "answer_correct": round(ans_ok / n, 3),
            "citation_correct": round(cite_ok / n, 3),
            "chat_model": chat_model,
            "index_path": str(path),
            "memory_failure": False,
        })
        unload_model(emb)
    baseline = recall_by_model.get("nomic-embed-text")
    best = max(recall_by_model.values()) if recall_by_model else 0.0
    switch = False
    if baseline is not None:
        # 10 points = 0.10 absolute recall.
        for emb, rec in recall_by_model.items():
            if emb != "nomic-embed-text" and (rec - baseline) >= 0.10:
                switch = True
                break
    return {
        "task": "rag",
        "rows": rows,
        "recall_by_model": recall_by_model,
        "switch_default_embedder": switch,
        "best_recall": best,
        "n": len(questions),
    }


def _avg(vals) -> float | None:
    nums = [float(v) for v in vals if v is not None]
    if not nums:
        return None
    return round(sum(nums) / len(nums), 3)


def markdown_table(headers: list[str], rows: list[list]) -> str:
    line = "| " + " | ".join(headers) + " |"
    sep = "| " + " | ".join("---" for _ in headers) + " |"
    body = ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join([line, sep, *body])


def format_task_md(result: dict) -> str:
    task = result["task"]
    if task == "deal_terms":
        table = markdown_table(
            ["model", "field_exact", "json_validity", "tok/s", "ttft_s", "mem_fail"],
            [
                [
                    r["model"],
                    f"{r['field_exact']:.3f}",
                    f"{r['json_validity']:.3f}",
                    r.get("avg_tok_s"),
                    r.get("avg_ttft_s"),
                    r.get("memory_failure"),
                ]
                for r in result["rows"]
            ],
        )
    elif task == "spread":
        table = markdown_table(
            ["model", "pass_rate", "passed/n", "tok/s", "ttft_s", "mem_fail"],
            [
                [
                    r["model"],
                    f"{r['pass_rate']:.3f}",
                    f"{r['passed']}/{r['n']}",
                    r.get("avg_tok_s"),
                    r.get("avg_ttft_s"),
                    r.get("memory_failure"),
                ]
                for r in result["rows"]
            ],
        )
    elif task == "mda":
        table = markdown_table(
            ["model", "rubric_avg", "tok/s", "ttft_s", "mem_fail"],
            [
                [
                    r["model"],
                    f"{r['rubric_avg']:.3f}",
                    r.get("avg_tok_s"),
                    r.get("avg_ttft_s"),
                    r.get("memory_failure"),
                ]
                for r in result["rows"]
            ],
        )
    else:
        table = markdown_table(
            ["embed_model", "recall@5", "answer", "citation", "index"],
            [
                [
                    r["embed_model"],
                    r.get("recall_at_5"),
                    r.get("answer_correct"),
                    r.get("citation_correct"),
                    r.get("index_path") or r.get("error") or "",
                ]
                for r in result["rows"]
            ],
        )
        table += (
            f"\n\nSwitch default embedder (≥+10 recall points vs nomic): "
            f"**{result.get('switch_default_embedder')}**"
        )
    return table
