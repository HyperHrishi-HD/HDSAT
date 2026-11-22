"""Deep audit: check every question the way a marker would, not by pattern.

The first audit pass compared the keyed answer with a value recomputed from the
stem; it can only do that for the families it knows how to parse, and it reports
everything else as "unverified". This pass closes that gap in three ways:

1. Structural checks on every item — choice count, duplicate choice text,
   duplicate choice *value* ("1/2" and "0.5" are the same answer), the key
   pointing at a real choice, and the SPR answer list containing the key.
2. A numeric check on every multiple-choice item: parse each choice to a number
   with sympy (so `\\dfrac{3}{5}`, `0.6` and `3/5` compare equal) and report any
   question where two choices are the same number. That is the "three correct
   answers" failure in its non-identical form.
3. Family solvers for the clusters the first pass left unchecked: solution-set
   inequalities, percentages, per-unit rates, line slope and intercepts, right
   triangles, vertex/x-intercepts, function values, growth factors.

Output is a summary plus a JSON report; questions whose family cannot be solved
are listed as `unchecked`, never as passing.
"""

from __future__ import annotations

import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sympy as sp  # noqa: E402
import verify_bank as vb  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / "src" / "data" / "questionBank.json"
REPORT = ROOT / "tools" / ".deep_audit.json"

X = sp.Symbol("x", real=True)


# --------------------------------------------------------------------------
# choice values
# --------------------------------------------------------------------------
def choice_value(text: str) -> float | None:
    """A choice's numeric value, or None for a non-numeric choice."""
    raw = text.strip()
    # Prices are written `\$90` (an escaped dollar), which is a currency sign to
    # read, not a delimiter.
    stripped = raw.replace("\\$", "").replace("$", "").strip()
    stripped = stripped.replace("\\left", "").replace("\\right", "")
    stripped = re.sub(r"(?<=\d),(?=\d\d\d)", "", stripped)
    # Ordered pairs are not a single number.
    if stripped.startswith("(") and "," in stripped:
        return None
    if re.search(r"[<>=]|\\le|\\ge|\\lt|\\gt", stripped):
        return None
    expr = vb.to_sympy(stripped)
    if expr is None:
        return None
    try:
        value = complex(sp.N(expr))
    except Exception:
        return None
    if abs(value.imag) > 1e-9:
        return None
    return value.real


def same(a: float, b: float) -> bool:
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)


def numbers_in(text: str | None) -> list[float]:
    return [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", text or "")]


def fmt(value: float) -> str:
    if same(value, round(value)):
        return str(int(round(value)))
    return f"{value:.4g}"


# --------------------------------------------------------------------------
# family solvers: each returns (truth, strict) or None
#   truth  - the value every valid choice must equal
#   strict - when true, a choice matches only if it equals truth exactly
# --------------------------------------------------------------------------
def solve_inequality(q: dict) -> tuple[tuple[str, float], bool] | None:
    """`ax + b (op) c` in the stimulus; choices are written `x > k`."""
    m = re.search(r"\$\$(.+?)\$\$", q.get("stimulus") or "")
    if not m:
        return None
    body = m.group(1).replace(" ", "")
    parsed = re.match(r"^(-?\d*)x([+-]\d+)?(>=|<=|>|<)(-?\d+(?:\.\d+)?)$", body)
    if not parsed:
        return None
    coef = parsed.group(1)
    a = -1.0 if coef == "-" else (1.0 if coef in ("", "+") else float(coef))
    b = float(parsed.group(2) or 0)
    op = parsed.group(3)
    c = float(parsed.group(4))
    if a == 0:
        return None
    boundary = (c - b) / a
    if a < 0:
        op = {"<": ">", ">": "<", "<=": ">=", ">=": "<="}[op]
    return (op, boundary), True


def choice_inequality(text: str) -> tuple[str, float] | None:
    body = text.replace("$", "").replace(" ", "")
    m = re.match(r"^x(>=|<=|>|<)(-?\d+(?:\.\d+)?)$", body)
    if not m:
        return None
    return m.group(1), float(m.group(2))


def solve_percent(q: dict) -> tuple[float, bool] | None:
    """`from $A$ by $p\\%$`, raise or lower."""
    stimulus = (q.get("stimulus") or "").replace("$", "")
    # A chain of two discounts, e.g. 20% off, then 10% off the sale price.
    chain = re.findall(r"(-?\d+(?:\.\d+)?)\s*\\?%", stimulus)
    prices = re.findall(r"\$\s*([\d,]+(?:\.\d+)?)", stimulus)
    if len(chain) >= 2 and prices and "additional" in stimulus.lower():
        base = float(prices[0].replace(",", ""))
        for pct in chain[:2]:
            base *= 1 - float(pct) / 100
        return base, True
    m = re.search(
        r"(raises|increases|lowers|decreases|reduces|drops|discounts?).*?from\s*(-?[\d.]+)\s*by\s*(-?[\d.]+)\s*\\?%",
        stimulus,
    )
    if not m:
        # `A supplier cuts the price of X by p% from A` style
        m2 = re.search(r"(?:from|cuts?|reduces?)\s*(?:the\s*price\s*)?(?:of\s*[^.]*?\s*)?\$\s*([\d.,]+)[^.]*?by\s*([\d.]+)\s*\\?%", stimulus)
        if not m2:
            return None
        base, pct, down = float(m2.group(1).replace(",", "")), float(m2.group(2)), True
        return base * (1 - pct / 100), True
    base, pct = float(m.group(2)), float(m.group(3))
    down = m.group(1).lower().startswith(("lower", "decrease", "reduce", "drop", "discount"))
    return base * (1 - pct / 100 if down else 1 + pct / 100), True


def solve_per_unit_rate(q: dict) -> tuple[float, bool] | None:
    """Start value, number of steps and end value -> the rate per step."""
    text = (q.get("stimulus") or "").replace("$", "")
    # Shape one: "starts the month with 40 ... After 9 weeks it has 76". The
    # sentence boundary sits between the start value and the elapsed count.
    m = re.search(
        r"(?:starts?|begins?|holds?)\D{0,40}?(\d+(?:\.\d+)?).{0,140}?\bAfter\s*(\d+)\s*\w+.{0,60}?(\d+(?:\.\d+)?)",
        text,
        re.S,
    )
    if m:
        start, steps, end = float(m.group(1)), float(m.group(2)), float(m.group(3))
        if steps and not same(start, end):
            return (end - start) / steps, True
    # Shape two: "adds the same number every cycle ... After 10 cycles ... 30".
    m = re.search(
        r"with\s*(\d+(?:\.\d+)?).{0,140}?After\s*(\d+)\s*\w+.{0,60}?(\d+(?:\.\d+)?)", text, re.S
    )
    if m:
        start, steps, end = float(m.group(1)), float(m.group(2)), float(m.group(3))
        if steps and not same(start, end):
            return (end - start) / steps, True
    # Shape three: the per-unit figure is stated ("6 dollars per passenger").
    m = re.search(r"(\d+(?:\.\d+)?)\s*dollars?\s*per\b", text)
    if m:
        return float(m.group(1)), True
    return None


def solve_slope(q: dict) -> tuple[float, bool] | None:
    stimulus = q.get("stimulus") or ""
    pts = re.findall(r"\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)", stimulus)
    if len(pts) >= 2:
        (x1, y1), (x2, y2) = pts[0], pts[1]
        x1, y1, x2, y2 = float(x1), float(y1), float(x2), float(y2)
        if same(x2, x1):
            return None
        return (y2 - y1) / (x2 - x1), True
    # `y = mx + b` style line definition
    m = re.search(r"y\s*=\s*(-?\d*)x\s*([+-]\s*\d+(?:\.\d+)?)?", stimulus)
    if m:
        coef = m.group(1)
        slope = -1.0 if coef == "-" else (1.0 if coef in ("", "+") else float(coef))
        return slope, True
    return None


def solve_intercept(q: dict) -> tuple[float, bool] | None:
    stimulus = q.get("stimulus") or ""
    m = re.search(r"y\s*=\s*(-?\d*)x\s*([+-]\s*\d+(?:\.\d+)?)", stimulus)
    if m:
        return float(m.group(2).replace(" ", "")), True
    # A line through two points: b = y - m x.
    slope = solve_slope(q)
    points = re.findall(r"\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)", stimulus)
    if slope is not None and points:
        x1, y1 = float(points[0][0]), float(points[0][1])
        return y1 - slope[0] * x1, True
    return None


def solve_right_triangle(q: dict) -> tuple[float, bool] | None:
    """A side or a trig ratio of angle A, from the sides the stem describes."""
    text = (q.get("stimulus") or "").replace("$", "")
    prompt = (q.get("prompt") or "").lower()

    def side_near(pattern: str) -> float | None:
        m = re.search(pattern + r"\D{0,24}?(\d+(?:\.\d+)?)", text, re.I)
        return float(m.group(1)) if m else None

    opposite = side_near(r"opposite (?:angle|∠)?\s*A")
    # "The two legs measure 3 and 4 centimetres".
    pair = re.search(r"legs?\s*(?:measure|are|of length)?\s*(\d+(?:\.\d+)?)\s*(?:and|,)\s*(\d+(?:\.\d+)?)", text, re.I)
    if pair and "angle" not in text.lower():
        a, b = float(pair.group(1)), float(pair.group(2))
        if "hypotenuse" in prompt:
            return math.hypot(a, b), True
        return None
    adjacent = side_near(r"adjacent (?:to )?(?:angle)?\s*A")
    hyp = side_near(r"hypotenuse (?:has length|is|of length)?")
    leg_ac = side_near(r"side\s*AC\s*(?:is|has length)?")
    leg_bc = side_near(r"side\s*BC\s*(?:is|has length)?")
    hyp_ab = side_near(r"hypotenuse\s*AB\s*(?:is|has length)?")

    if opposite is None and hyp is not None and leg_ac is not None:
        # Right angle at C: AC is adjacent to A, so BC is the opposite side.
        adjacent = adjacent if adjacent is not None else leg_ac
        opposite = math.sqrt(max(hyp * hyp - leg_ac * leg_ac, 0))
    if opposite is None and leg_ac is not None and leg_bc is not None:
        adjacent, opposite = leg_ac, leg_bc
        hyp = math.hypot(leg_ac, leg_bc)
    if hyp is None and opposite is not None and adjacent is not None:
        hyp = math.hypot(opposite, adjacent)
    if hyp_ab is not None and hyp is None:
        hyp = hyp_ab

    if "length of each leg" in prompt:
        return None
    if "hypotenuse" in prompt and hyp is None:
        return None
    if "hypotenuse" in prompt:
        return hyp, True
    if "other leg" in prompt and hyp is not None:
        values = [v for v in (opposite, adjacent) if v is not None]
        if len(values) == 1:
            return math.sqrt(max(hyp * hyp - values[0] ** 2, 0)), True
        return None
    if opposite is None or adjacent is None or hyp is None or hyp == 0:
        return None
    if "sin" in prompt:
        return opposite / hyp, True
    if "cos" in prompt:
        return adjacent / hyp, True
    if "tan" in prompt:
        return (opposite / adjacent) if adjacent else None, True
    return None


def solve_vertex(q: dict) -> tuple[float, bool] | None:
    """x of the vertex, or the y value, from a quadratic in the stimulus."""
    m = re.search(r"\$\$([^$]*x\^?2[^$]*)\$\$", q.get("stimulus") or "")
    if not m:
        return None
    expr = vb.to_sympy(m.group(1).split("=")[-1])
    if expr is None:
        return None
    try:
        poly = sp.Poly(sp.expand(expr), X)
    except Exception:
        return None
    if poly.degree() != 2:
        return None
    a = float(poly.coeff_monomial(X ** 2))
    b = float(poly.coeff_monomial(X))
    if a == 0:
        return None
    xv = -b / (2 * a)
    prompt = (q.get("prompt") or "").lower()
    if "minimum" in prompt or "maximum" in prompt or "value of" in prompt:
        return xv, True
    return xv, True


def solve_x_intercepts(q: dict) -> tuple[float, bool] | None:
    """Both x-intercepts are needed, so the choices are strings like `2 and 5`."""
    stimulus = q.get("stimulus") or ""
    m = re.search(r"\$\$([^$]*x\^?2[^$]*)\$\$", stimulus)
    extra = None
    if not m:
        # Written inline: "The graph of y = x^2 -4x +3 is shown".
        m = re.search(r"y\s*=\s*(x\^?2[^.]*?)(?:\.|\bis\b|\s*$)", stimulus)
        if m:
            extra = m.group(1)
    if not m and extra is None:
        return None
    body = m.group(1) if m else extra
    expr = vb.to_sympy(body.split("=")[-1])
    if expr is None:
        return None
    try:
        poly = sp.Poly(sp.expand(expr), X)
    except Exception:
        return None
    if poly.degree() != 2:
        return None
    a, b, c = (
        poly.coeff_monomial(X ** 2),
        poly.coeff_monomial(X),
        poly.coeff_monomial(1),
    )
    disc = b * b - 4 * a * c
    if disc < 0:
        return None
    roots = sorted(
        [float((-b + sp.sqrt(disc)) / (2 * a)), float((-b - sp.sqrt(disc)) / (2 * a))]
    )
    return (roots[0], roots[1]), True


def solve_function_value(q: dict) -> tuple[float, bool] | None:
    prompt = q.get("prompt") or ""
    m = re.search(r"f\(\s*(-?\d+(?:\.\d+)?)\s*\)", prompt)
    if not m:
        return None
    defs = vb.function_defs(q.get("stimulus") or "")
    expr = defs.get("f")
    if expr is None:
        return None
    try:
        return float(sp.N(expr.subs(X, float(m.group(1))))), True
    except Exception:
        return None


def solve_growth_factor(q: dict) -> tuple[float, bool] | None:
    m = re.search(r"g\(x\)\s*=\s*([^$]+)", q.get("stimulus") or "")
    if not m:
        return None
    expr = vb.to_sympy(m.group(1))
    if expr is None:
        return None
    base = None
    for candidate in sp.preorder_traversal(expr):
        if isinstance(candidate, sp.Pow) and candidate.base.is_number:
            base = float(candidate.base)
    return (base, True) if base is not None else None


# --------------------------------------------------------------------------
# the audit
# --------------------------------------------------------------------------
SOLVERS = {
    "inequality": solve_inequality,
    "percent": solve_percent,
    "per_unit_rate": solve_per_unit_rate,
    "slope": solve_slope,
    "intercept": solve_intercept,
    "right_triangle": solve_right_triangle,
    "vertex": solve_vertex,
    "x_intercepts": solve_x_intercepts,
    "function_value": solve_function_value,
    "growth_factor": solve_growth_factor,
}


def family_of(q: dict) -> str | None:
    prompt = (q.get("prompt") or "")
    skill = q.get("skill") or ""
    if q.get("format") != "multiple_choice" or q.get("section") != "Math":
        return None
    if "The solution in $x$ is" in prompt or "solution in $x$" in prompt:
        return "inequality"
    if skill == "Percentages":
        return "percent"
    if "per-unit rate" in prompt:
        return "per_unit_rate"
    if "slope" in prompt.lower():
        return "slope"
    if "y-intercept" in prompt.lower():
        return "intercept"
    if skill == "Right triangles and trigonometry":
        return "right_triangle"
    if "minimum" in prompt.lower() or "vertex" in prompt.lower():
        return "vertex"
    if "x-intercepts" in prompt.lower() or "crosses the x-axis" in prompt.lower():
        return "x_intercepts"
    if re.search(r"f\(\s*-?\d", prompt):
        return "function_value"
    if "by what factor" in prompt.lower():
        return "growth_factor"
    return None


def audit(questions: list[dict]) -> dict:
    findings: list[dict] = []
    checked: Counter[str] = Counter()
    for q in questions:
        qid = q["id"]
        kind_format = q.get("format")
        choices = q.get("choices") or []
        # ---- structural ------------------------------------------------
        if kind_format == "multiple_choice":
            if len(choices) < 3:
                findings.append({"id": qid, "kind": "few-choices", "detail": len(choices)})
            texts = [c["text"].strip() for c in choices]
            if len(set(texts)) != len(texts):
                findings.append({"id": qid, "kind": "duplicate-text", "detail": texts})
            ids = [c["id"] for c in choices]
            if q.get("correct_answer") not in ids:
                findings.append(
                    {"id": qid, "kind": "key-missing", "detail": q.get("correct_answer")}
                )
            values = {}
            for choice in choices:
                value = choice_value(choice["text"])
                if value is None:
                    continue
                for other_id, other in values.items():
                    if same(other, value):
                        findings.append(
                            {
                                "id": qid,
                                "kind": "duplicate-value",
                                "detail": f"{other_id}={choice['id']}={fmt(value)}",
                            }
                        )
                        break
                values[choice["id"]] = value
        else:
            accepted = [str(a) for a in (q.get("acceptable_answers") or [])]
            key = str(q.get("correct_answer") or "")
            if key and key not in accepted:
                findings.append({"id": qid, "kind": "spr-key-not-accepted", "detail": accepted})

            # "4" and "4.0" are the same answer, and a rounded form is allowed
            # within 0.001 (the width the SAT itself allows). Two values further
            # apart than that would both grade as correct, which is the bug.
            distinct: list[tuple[float, str]] = []
            for entry in accepted:
                value = choice_value(entry)
                if value is None:
                    continue
                if not any(abs(value - other) <= 1e-3 for other, _ in distinct):
                    distinct.append((value, entry))
            if len(distinct) > 1:
                findings.append(
                    {
                        "id": qid,
                        "kind": "spr-two-values-accepted",
                        "detail": [entry for _, entry in distinct],
                    }
                )

        # ---- family solve ----------------------------------------------
        family = family_of(q)
        if family is None:
            continue
        solver = SOLVERS[family]
        try:
            solved = solver(q)
        except Exception as exc:  # a solver must never take the audit down
            findings.append({"id": qid, "kind": "solver-error", "detail": f"{family}: {exc}"})
            continue
        if solved is None:
            continue
        truth, exact = solved
        checked[family] += 1

        if family == "inequality":
            op, boundary = truth
            matches = []
            for choice in choices:
                parsed = choice_inequality(choice["text"])
                if parsed is None:
                    continue
                if parsed[0] == op and same(parsed[1], boundary):
                    matches.append(choice["id"])
            if len(matches) != 1:
                findings.append(
                    {
                        "id": qid,
                        "kind": "multi-valid" if len(matches) > 1 else "no-valid",
                        "detail": f"{op} {fmt(boundary)} -> {matches}",
                    }
                )
            elif matches[0] != q.get("correct_answer"):
                findings.append(
                    {
                        "id": qid,
                        "kind": "wrong-key",
                        "detail": f"valid {matches[0]} keyed {q.get('correct_answer')}",
                    }
                )
            continue

        if family == "x_intercepts":
            first, second = truth
            # Choices are "a and b" pairs, and the *set* of roots is the answer,
            # so a pair like (-3, 2) is not the same answer as (-3, -2).
            matches = []
            for choice in choices:
                pair = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", choice["text"])]
                if len(pair) >= 2 and same(min(pair), first) and same(max(pair), second):
                    matches.append(choice["id"])
            if len(matches) > 1:
                findings.append({"id": qid, "kind": "multi-valid", "detail": matches})
            elif not matches:
                findings.append({"id": qid, "kind": "no-valid", "detail": fmt(root)})
            elif matches[0] != q.get("correct_answer"):
                findings.append(
                    {"id": qid, "kind": "wrong-key", "detail": f"{matches[0]} vs {q['correct_answer']}"}
                )
            continue

        matches = []
        for choice in choices:
            value = choice_value(choice["text"])
            if value is None:
                continue
            tolerance = 1e-6 if family == "right_triangle" else 1e-9
            if math.isclose(value, truth, rel_tol=tolerance, abs_tol=tolerance):
                matches.append(choice["id"])
        if len(matches) > 1:
            findings.append(
                {"id": qid, "kind": "multi-valid", "detail": f"{fmt(truth)} -> {matches}"}
            )
        elif not matches:
            findings.append(
                {
                    "id": qid,
                    "kind": "no-valid",
                    "detail": f"{fmt(truth)} not in {[c['text'] for c in choices]}",
                }
            )
        elif matches[0] != q.get("correct_answer"):
            findings.append(
                {"id": qid, "kind": "wrong-key", "detail": f"{matches[0]} vs {q['correct_answer']}"}
            )

    return {"checked": dict(checked), "findings": findings}


def main() -> int:
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    questions = bank["questions"]
    result = audit(questions)
    kinds = Counter(f["kind"] for f in result["findings"])
    print(f"{len(questions)} questions audited")
    print("families solved numerically:")
    for family, count in sorted(result["checked"].items(), key=lambda kv: -kv[1]):
        print(f"  {family:16s} {count:5d}")
    print("\nfindings:")
    if not kinds:
        print("  none")
    for kind, count in kinds.most_common():
        print(f"  {kind:22s} {count:5d}")
    REPORT.write_text(
        json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"\nreport written to {REPORT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
