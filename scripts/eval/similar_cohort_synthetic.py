"""AI-580: deterministic, synthetic-only cohort feasibility examples.

These rows are invented in this file. Do not feed production events to this tool.
The threshold is an illustration, not a release policy.
"""

import json
from collections import defaultdict


ILLUSTRATIVE_MIN_SUBJECTS = 5
CANDIDATES = ("A", "B")


def person(subject, account, *, model="m1", ui="u1", first="A", tried="A", undo=False):
    """Make one invented presentation followed by an optional try and undo."""
    common = {"subject": subject, "account": account, "category": "synthetic-c1",
              "model": model, "ui": ui}
    events = [dict(common, action="shown", candidate=candidate,
                   slot=1 if candidate == first else 2) for candidate in CANDIDATES]
    events.append(dict(common, action="try", candidate=tried))
    if undo:
        events.append(dict(common, action="undo", candidate=tried))
    return events


def aggregate(events, consented, withdrawn=(), min_subjects=ILLUSTRATIVE_MIN_SUBJECTS):
    """Return synthetic aggregates only; one invented subject counts once per cell."""
    valid = set(consented) - set(withdrawn)
    groups = defaultdict(list)
    for event in events:
        if event["subject"] in valid:
            key = (event["category"], event["model"], event["ui"])
            groups[key].append(event)

    result = {}
    for key, rows in sorted(groups.items()):
        shown = {(r["subject"], r["candidate"]): r["slot"] for r in rows
                 if r["action"] == "shown"}
        subjects = {subject for subject, _ in shown}
        tries = {(r["subject"], r["candidate"]) for r in rows
                 if r["action"] == "try" and (r["subject"], r["candidate"]) in shown}
        undos = {(r["subject"], r["candidate"]) for r in rows
                 if r["action"] == "undo" and (r["subject"], r["candidate"]) in tries}
        cell = {"status": "suppressed" if len(subjects) < min_subjects else "test-only-pass"}
        if cell["status"] != "suppressed":
            cell["subjects"] = len(subjects)
            cell["shown"] = {c: len({s for s, candidate in shown if candidate == c})
                             for c in CANDIDATES}
            cell["tried"] = {c: len({s for s, candidate in tries if candidate == c})
                             for c in CANDIDATES}
            cell["undone"] = {c: len({s for s, candidate in undos if candidate == c})
                              for c in CANDIDATES}
            cell["first_slot_shown"] = {c: sum(slot == 1 for (s, candidate), slot in shown.items()
                                                 if candidate == c) for c in CANDIDATES}
            cell["first_slot_tried"] = sum(shown[pair] == 1 for pair in tries)
            if tries and cell["first_slot_tried"] == len(tries):
                cell["status"] = "order-confounded"
        result["/".join(key)] = cell
    return result


def scenarios():
    base = [person(f"s{i}", f"a{i}", first="A" if i % 2 else "B",
                   tried="A" if i % 2 else "B") for i in range(1, 6)]
    five = [event for rows in base for event in rows]
    four = five[:-len(base[-1])]
    duplicate = four[:]
    duplicate.extend(person("s1", "second-account", first="A", tried="A"))
    split = [event for i in range(1, 7)
             for event in person(f"s{i}", f"a{i}", model="m1" if i <= 3 else "m2")]
    split_ui = [event for i in range(1, 7)
                for event in person(f"s{i}", f"a{i}", ui="u1" if i <= 3 else "u2")]
    order = [event for i in range(1, 9)
             for event in person(f"s{i}", f"a{i}", first="A" if i <= 6 else "B",
                                 tried="A" if i <= 6 else "B", undo=i == 1)]
    return {
        "small_group": (four, {f"s{i}" for i in range(1, 6)}, set()),
        "duplicate_account": (duplicate, {f"s{i}" for i in range(1, 6)}, set()),
        "model_split": (split, {f"s{i}" for i in range(1, 7)}, set()),
        "ui_split": (split_ui, {f"s{i}" for i in range(1, 7)}, set()),
        "consent_missing": (five, {f"s{i}" for i in range(1, 5)}, set()),
        "withdrawal": (five, {f"s{i}" for i in range(1, 6)}, {"s5"}),
        "order_and_undo": (order, {f"s{i}" for i in range(1, 9)}, set()),
    }


def report():
    return {name: aggregate(*case) for name, case in scenarios().items()}


if __name__ == "__main__":
    print(json.dumps({"data": "synthetic-only", "threshold": "illustrative 5, not policy",
                      "decision": "DEFER", "cases": report()}, ensure_ascii=False, indent=2,
                     sort_keys=True))
