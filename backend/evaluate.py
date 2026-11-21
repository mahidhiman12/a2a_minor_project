"""
Validation (Synopsis section 4.6) - run with all agents started (python run_all.py).

    python evaluate.py                         # dev + held-out test set, rules NLU
    python evaluate.py --mode ollama           # evaluate with a local LLM instead
    python evaluate.py --set data/complaints_test.json

Every complaint goes through the REAL system: Concierge NLU -> Orchestrator (A2A)
-> department agents (A2A) -> unified status artifact. We then measure:

  1. Routing accuracy      - exact match of the set of departments
  2. Per-department P/R/F1 and issue-type micro P/R/F1
  3. Location extraction accuracy
  4. Consolidation         - unified artifact has one completed ticket per routed sub-task
  5. Task-state tracking   - every sub-task trail shows submitted -> working -> completed
  6. Baseline comparison   - a conventional "one complaint = one department" portal
                             (assigns only the single most likely department)
"""
import argparse
import asyncio
import json
from collections import Counter
from pathlib import Path

import httpx

from agents.concierge.core import call_orchestrator, skill_catalog
from agents.concierge.nlu import understand
from common import config


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f


async def state_sequence_ok(cid: str) -> bool:
    async with httpx.AsyncClient() as h:
        trail = (await h.get(f"{config.ORCHESTRATOR_URL}/complaints/{cid}/trail")).json()
    per_agent: dict[str, list[str]] = {}
    for e in trail:
        if e["event"].startswith("task_"):
            per_agent.setdefault(e["actor"], []).append(e["event"][5:])
    order = {"submitted": 0, "working": 1, "completed": 2}
    for seq in per_agent.values():
        idx = [order.get(s, -1) for s in seq]
        if -1 in idx or idx != sorted(idx) or seq[-1] != "completed":
            return False
    return bool(per_agent)


async def evaluate(path: Path, mode: str):
    data = json.loads(path.read_text(encoding="utf-8"))
    catalog = await skill_catalog()
    dept_stats = Counter()
    it_tp = it_fp = it_fn = 0
    exact = loc_ok = consolidated = states_ok = dispatched = 0
    comp_total = comp_exact = base_exact = base_comp_exact = 0
    failures = []

    for c in data:
        s = await understand(c["text"], catalog, mode)
        s["citizen_text"] = c["text"]
        pred_d = {i["department"] for i in s["issues"]}
        gold_d = set(c["departments"])
        pred_i, gold_i = {i["issue_type"] for i in s["issues"]}, set(c["issue_types"])

        for d in {"water", "electricity", "roads"}:
            dept_stats[(d, "tp")] += d in pred_d and d in gold_d
            dept_stats[(d, "fp")] += d in pred_d and d not in gold_d
            dept_stats[(d, "fn")] += d not in pred_d and d in gold_d
        it_tp += len(pred_i & gold_i); it_fp += len(pred_i - gold_i); it_fn += len(gold_i - pred_i)
        hit = pred_d == gold_d
        exact += hit
        loc_ok += s["location"] == c["location"]
        is_comp = len(gold_d) > 1
        comp_total += is_comp
        comp_exact += hit and is_comp

        # baseline: single-department portal -> only the top-ranked department
        base = {s["issues"][0]["department"]} if s["issues"] else set()
        base_exact += base == gold_d
        base_comp_exact += (base == gold_d) and is_comp

        if not hit:
            failures.append((c["id"], c["text"], sorted(gold_d), sorted(pred_d)))

        # end-to-end through the live agents
        if s["issues"] and s["location"]:
            dispatched += 1
            u = await call_orchestrator(s)
            routed = {d["department"] for d in u["departments"]}
            if u["all_subtasks_completed"] and all(d["ticket_id"] for d in u["departments"]) \
                    and routed == pred_d:
                consolidated += 1
            states_ok += await state_sequence_ok(u["complaint_id"])

    n = len(data)
    print(f"\n=== {path.name}  ({n} complaints, {comp_total} multi-department)  NLU={mode} ===")
    print(f"Routing accuracy (exact dept set) : {exact}/{n} = {exact / n:.1%}")
    print(f"  on multi-department complaints  : {comp_exact}/{comp_total} = "
          f"{comp_exact / max(comp_total, 1):.1%}")
    print(f"Baseline single-dept portal       : {base_exact}/{n} = {base_exact / n:.1%}"
          f"   (multi-dept: {base_comp_exact}/{comp_total})")
    print(f"Location extraction accuracy      : {loc_ok}/{n} = {loc_ok / n:.1%}")
    p, r, f = prf(it_tp, it_fp, it_fn)
    print(f"Issue-type micro P / R / F1       : {p:.2f} / {r:.2f} / {f:.2f}")
    for d in ("water", "electricity", "roads"):
        p, r, f = prf(dept_stats[(d, 'tp')], dept_stats[(d, 'fp')], dept_stats[(d, 'fn')])
        print(f"  {d:<12} P / R / F1          : {p:.2f} / {r:.2f} / {f:.2f}")
    d = max(dispatched, 1)
    print(f"Dispatched to department agents   : {dispatched}/{n} (rest had no detectable issue)")
    print(f"Unified artifact complete         : {consolidated}/{dispatched} = {consolidated / d:.1%}")
    print(f"Task-state sequence consistent    : {states_ok}/{dispatched} = {states_ok / d:.1%}")
    if failures:
        print("Mis-routed:")
        for fid, text, g, pr in failures:
            print(f"  #{fid}: expected {g}, got {pr} :: {text}")
    return {"set": path.name, "n": n, "routing_accuracy": exact / n,
            "baseline_accuracy": base_exact / n}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default=config.NLU_MODE)
    ap.add_argument("--set", action="append")
    a = ap.parse_args()
    sets = a.set or ["data/complaints_eval.json", "data/complaints_test.json"]
    for s in sets:
        await evaluate(config.ROOT / s, a.mode)
    print("\nNote: complaints_eval.json was used while writing the rules (dev set); "
          "complaints_test.json is held out.")


if __name__ == "__main__":
    asyncio.run(main())
