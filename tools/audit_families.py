"""Independent content verification for the question bank.

Every item whose answer can be re-derived from its own stimulus is solved here,
independently of the stored key. Two things are checked:

  * multiple choice: exactly one option is correct, and it is the stored key;
  * grid-in (SPR): the stored key equals the re-derived value.

Items whose family has no solver are counted and listed, so coverage is visible
instead of implied.

    python tools/audit_families.py            # summary + findings
    python tools/audit_families.py --json     # machine-readable
    python tools/audit_families.py --list     # also list every finding
"""

from __future__ import annotations

import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import sympy as sp

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / "src" / "data" / "questionBank.json"

X = sp.Symbol("x")
Y = sp.Symbol("y")


# --------------------------------------------------------------------------- #
# LaTeX-light -> Python
# --------------------------------------------------------------------------- #
def unwrap(raw: str | None) -> str:
    if not raw:
        return ""
    s = str(raw)
    s = s.replace("\\$", "$")
    s = s.replace("\\dfrac", "\\frac").replace("\\tfrac", "\\frac")
    s = s.replace("\\left", "").replace("\\right", "")
    s = s.replace("\\,", " ").replace("\\;", " ").replace("\\!", " ")
    s = s.replace("\\qquad", " ").replace("\\quad", " ")
    s = s.replace("^\\circ", " degrees").replace("\\circ", " degrees")
    s = s.replace("\\cdot", "*").replace("\\times", "*")
    s = s.replace("\\pi", "pi").replace("π", "pi")
    s = s.replace("\\%", "%")
    # Exponents first: this removes the braces that would block \frac.
    s = re.sub(r"\^\{([^{}]*)\}", r"**(\1)", s)
    s = re.sub(r"\^([0-9A-Za-z+-])", r"**\1", s)
    s = re.sub(r"\\sqrt\{([^{}]*)\}", r"sqrt(\1)", s)
    for _ in range(8):
        nxt = re.sub(r"\\frac\{([^{}]*)\}\{([^{}]*)\}", r"((\1)/(\2))", s)
        if nxt == s:
            break
        s = nxt
    s = re.sub(r"\|([^|]+)\|", r"Abs(\1)", s)
    s = s.replace("$", " ").replace("\\", " ")
    return s.strip()


_LETTER_RUN = re.compile(r"[A-Za-z]{2,}")


def sym(expr: str):
    """Sympy expression for a bank math string, or None."""
    s = unwrap(expr)
    # Implicit multiplication, without splitting identifiers like `pi`.
    s = re.sub(r"(?<=[0-9)])\s*(?=[a-zA-Z(])", "*", s)
    s = re.sub(r"(?<=[a-zA-Z])\s+(?=[a-zA-Z(])", "*", s)
    try:
        return sp.sympify(s, locals={"sqrt": sp.sqrt, "pi": sp.pi, "Abs": sp.Abs})
    except Exception:
        return None


def num(value, default=None):
    """Numeric value of a choice or key, or `default` when it is not a number."""
    if value is None:
        return default
    s = unwrap(str(value))
    s = s.strip().rstrip(".").strip()
    if s.endswith("%"):
        s = s[:-1]
    if len(s) > 60 or not re.search(r"\d", s) or len(s.split()) > 6:
        return default
    try:
        return float(s)
    except ValueError:
        pass
    expr = sym(s)
    if expr is None:
        return default
    try:
        expr = sp.simplify(expr)
    except Exception:
        return default
    if expr.free_symbols:
        return default
    try:
        return float(expr.evalf())
    except Exception:
        return default


def close(a, b, tol=1e-6) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def numbers(s: str) -> list[float]:
    out = []
    for raw in re.findall(r"-?\d+(?:\.\d+)?", unwrap(s)):
        try:
            out.append(float(raw))
        except ValueError:
            pass
    return out


def choice_values(q) -> dict[str, float | None]:
    return {c["id"]: num(c["text"]) for c in q.get("choices") or []}


# --------------------------------------------------------------------------- #
# solvers
# --------------------------------------------------------------------------- #
def solve_linear_in_x(stimulus: str):
    """ax + b = cx + d (one variable)."""
    s = unwrap(stimulus)
    m = re.search(r"Solve\s+for\s+\$?x\$?\s*:?\s*(.+)$", s, re.I)
    body = m.group(1) if m else s
    if "=" not in body:
        return None
    lhs, rhs = body.split("=", 1)
    a, b = sym(lhs), sym(rhs)
    if a is None or b is None:
        return None
    diff = sp.expand(a - b)
    try:
        poly = sp.Poly(diff, X)
    except Exception:
        return None
    if poly.degree() != 1:
        return None
    coef = poly.coeff_monomial(X)
    const = poly.coeff_monomial(1)
    return float(sp.nsimplify(-const / coef))


def solve_inequality(q):
    raw = q.get("stimulus") or ""
    block = re.findall(r"\$\$(.+?)\$\$", raw, re.S)
    s = unwrap(block[0] if block else raw)
    m = re.search(r"(.+?)\s*([<>])\s*(.+)$", s)
    if not m:
        return None
    left, rel, right = sym(m.group(1)), m.group(2), sym(m.group(3))
    if left is None or right is None:
        return None
    try:
        poly = sp.Poly(sp.expand(left - right), X)
    except Exception:
        return None
    if poly.degree() != 1:
        return None
    a = poly.coeff_monomial(X)
    b = poly.coeff_monomial(1)
    if a == 0:
        return None
    bound = float(sp.nsimplify(-b / a))
    if a < 0:
        rel = ">" if rel == "<" else "<"
    return bound, rel


def parse_choice_inequality(text: str):
    s = unwrap(text)
    m = re.search(r"x\s*([<>])\s*(-?\d+(?:\.\d+)?)", s)
    if not m:
        return None
    return m.group(1), float(m.group(2))


def factored_roots(stimulus: str):
    factors = re.findall(r"\((x)\s*([+-])\s*(\d+)\)", stimulus)
    if not factors:
        return None
    roots = []
    for _, sign, n in factors:
        roots.append(-float(n) if sign == "+" else float(n))
    return roots


def linear_coeffs(raw: str):
    """(a, b, c) for a*x + b*y + c = 0, or None."""
    if "=" not in raw:
        return None
    lhs, rhs = raw.split("=", 1)
    a, b = sym(lhs), sym(rhs)
    if a is None or b is None:
        return None
    diff = sp.expand(a - b)
    try:
        poly = sp.Poly(diff, X, Y)
    except Exception:
        return None
    if poly.degree() > 1:
        return None
    return (
        sp.nsimplify(poly.coeff_monomial(X)),
        sp.nsimplify(poly.coeff_monomial(Y)),
        sp.nsimplify(poly.coeff_monomial(1)),
    )


def solve_system(q):
    raw_eqs = re.findall(r"\$\$(.+?)\$\$", q.get("stimulus") or "", re.S)
    rows = [c for c in (linear_coeffs(r) for r in raw_eqs) if c]
    if len(rows) != 2:
        return {"status": "unparsed"}
    (a1, b1, c1), (a2, b2, c2) = rows
    det = a1 * b2 - a2 * b1
    if det == 0:
        if sp.simplify(a1 * c2 - a2 * c1) == 0 and sp.simplify(b1 * c2 - b2 * c1) == 0:
            return {"status": "infinite"}
        return {"status": "none"}
    xs = sp.nsimplify((b1 * c2 - b2 * c1) / det)
    ys = sp.nsimplify((c1 * a2 - c2 * a1) / det)
    if xs.free_symbols or ys.free_symbols:
        return {"status": "unparsed"}
    return {"status": "unique", "x": float(xs), "y": float(ys)}


def two_point_slope(stimulus: str):
    pts = re.findall(r"\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)", unwrap(stimulus))
    if len(pts) < 2:
        return None
    (x1, y1), (x2, y2) = [(float(a), float(b)) for a, b in pts[:2]]
    if x2 == x1:
        return None
    return (y2 - y1) / (x2 - x1)


def parabola_coeffs(stimulus: str):
    body = unwrap(stimulus)
    m = re.search(r"f\(x\)\s*=\s*(.+)$", body)
    if not m:
        return None
    expr = sym(m.group(1))
    if expr is None:
        return None
    try:
        poly = sp.Poly(expr, X)
    except Exception:
        return None
    if poly.degree() != 2:
        return None
    return (
        float(poly.coeff_monomial(X**2)),
        float(poly.coeff_monomial(X)),
        float(poly.coeff_monomial(1)),
    )


def vieta(q):
    got = parabola_coeffs(q.get("stimulus") or "")
    if not got:
        return None
    a, b, c = got
    prompt = unwrap(q["prompt"])
    if "product" in prompt or re.search(r"r_?1\s*\*\s*r_?2", prompt):
        return c / a
    if "sum" in prompt or re.search(r"r_?1\s*\+\s*r_?2", prompt):
        return -b / a
    return None


def abs_equation(stimulus: str):
    s = unwrap(stimulus)
    m = re.search(r"Abs\(([^)]+)\)\s*=\s*(-?\d+(?:\.\d+)?)", s)
    if not m:
        return None
    expr = sym(m.group(1))
    if expr is None:
        return None
    try:
        poly = sp.Poly(expr, X)
    except Exception:
        return None
    if poly.degree() != 1:
        return None
    a = poly.coeff_monomial(X)
    b = poly.coeff_monomial(1)
    rhs = float(m.group(2))
    solutions = []
    for sign in (1, -1):
        solutions.append(float(sp.nsimplify((sign * rhs - b) / a)))
    return solutions


def circle_radius(stimulus: str):
    s = unwrap(stimulus)
    m = re.search(r"\(x\s*[+-]\s*(-?\d+(?:\.\d+)?)\)\*\*2\s*\+\s*\(y\s*[+-]\s*(-?\d+(?:\.\d+)?)\)\*\*2\s*=\s*(\d+(?:\.\d+)?)", s)
    if m:
        return math.sqrt(float(m.group(3)))
    # One centre coordinate may be zero, so its bracket is dropped.
    m = re.search(
        r"(?:\(x\s*[+-]\s*-?\d+(?:\.\d+)?\)\*\*2|\bx\*\*2)\s*\+\s*"
        r"(?:\(y\s*[+-]\s*-?\d+(?:\.\d+)?\)\*\*2|\by\*\*2)\s*=\s*(\d+(?:\.\d+)?)",
        s,
    )
    if m:
        return math.sqrt(float(m.group(1)))
    return None


def mean_median(q):
    s = unwrap(q.get("stimulus") or "")
    prompt = q["prompt"].lower()
    vals: list[float] = []
    m = re.search(r"recorded:\s*([0-9.,\s]+)", s)
    if m:
        vals = [float(v) for v in re.findall(r"\d+(?:\.\d+)?", m.group(1))]
    fig = q.get("figure_metadata") or {}
    if not vals and fig.get("type") == "table":
        for row in fig.get("rows") or []:
            try:
                vals.append(float(unwrap(str(row[-1]))))
            except ValueError:
                pass
    extra = re.search(r"reading of\s*(\d+(?:\.\d+)?)\s*[a-z]+", s)
    if extra and vals:
        vals.append(float(extra.group(1)))
    if not vals:
        return None

    def mean():
        return sum(vals) / len(vals)

    def median():
        ordered = sorted(vals)
        n = len(ordered)
        return ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2

    if "exceed" in prompt and "median" in prompt:
        return mean() - median()
    if "median" in prompt:
        return median()
    if "mean" in prompt:
        return mean()
    return None


def probability(q):
    s = unwrap(q.get("stimulus") or "")
    m = re.search(
        r"(\d+)\s+red\s*,\s*(\d+)\s+blue\s*,?\s*(?:and\s+)?(\d+)\s+green", s
    )
    if not m:
        return None
    red, blue, green = (int(v) for v in m.groups())
    total = red + blue + green
    if not total:
        return None
    return red / total


def exponent_k(stimulus: str):
    s = unwrap(stimulus)
    m = re.search(r"\((\d+)\*\*\((\d+)\)\s*\*\s*\1\*\*\((\d+)\)\)\s*/\s*\(?\1\*\*\((\d+)\)\)?", s)
    if not m:
        # Fallback: plain exponents with implicit multiplication inserted.
        body = re.search(r"(.+?)=\s*(\d+)\*\*\(k\)", s)
        if not body:
            return None
        base = body.group(2)
        pattern = re.compile(
            rf"\({base}\*\*\((\d+)\)\s*\*+\s*{base}\*\*\((\d+)\)\)\s*/\s*\(\s*{base}\*\*\((\d+)\)\s*\)"
        )
        m = pattern.search(s)
        if not m:
            return None
    base_pow = m.group(1) if len(m.groups()) == 4 else None
    nums = [int(v) for v in m.groups() if v is not None]
    if len(nums) == 4:
        return nums[1] + nums[2] - nums[3]
    return None


def composition(q):
    s = unwrap(q.get("stimulus") or "")
    funcs = {}
    for name, body in re.findall(r"([fg])\(x\)\s*=\s*([^,]+?)(?=\s+[fg]\(x\)|$)", s):
        funcs[name] = sym(body)
    if set(funcs) != {"f", "g"}:
        return None
    m = re.search(r"f\(g\((-?\d+(?:\.\d+)?)\)\)", q["prompt"])
    if not m:
        return None
    k = float(m.group(1))
    g = funcs["g"]
    f = funcs["f"]
    if g is None or f is None:
        return None
    if g.free_symbols - {X} or f.free_symbols - {X}:
        return None
    try:
        inner = g.subs(X, k)
        value = f.subs(X, inner)
        return float(value)
    except Exception:
        return None


def exponential_value(q):
    s = unwrap(q.get("stimulus") or "")
    m = re.search(r"V\s*=\s*(.+?)(?:\s+where|$)", s)
    if not m:
        return None
    t = sp.Symbol("t")
    try:
        body = re.sub(r"(?<=[0-9)])\s*(?=[a-zA-Z(])", "*", m.group(1).strip())
        expr = sp.sympify(body, locals={"sqrt": sp.sqrt, "pi": sp.pi, "t": t})
    except Exception:
        return None
    tm = re.search(r"t\s*=\s*(-?\d+(?:\.\d+)?)", q["prompt"])
    if not tm:
        return None
    try:
        value = sp.simplify(expr.subs(t, float(tm.group(1))))
        return float(value.evalf())
    except Exception:
        return None


def percent_price(q):
    s = unwrap(q.get("stimulus") or "")
    m = re.search(r"from\s*\$?(\d+(?:\.\d+)?)\s*(?:\\?%)?.*?by\s*(\d+(?:\.\d+)?)\s*(?:\\?%)", s)
    if not m:
        m = re.search(r"from\s*\$?(\d+(?:\.\d+)?)\s*(?:dollars)?.*?by\s*(\d+(?:\.\d+)?)\s*(?:\\?%)", s)
    if not m:
        return None
    start = float(m.group(1))
    pct = float(m.group(2))
    word = s.lower()
    if "discount" in word or "decreas" in word or "lower" in word or "reduc" in word:
        return start * (1 - pct / 100)
    return start * (1 + pct / 100)


def per_unit_rate(q):
    s = unwrap(q.get("stimulus") or "")
    start = re.search(r"starts? (?:the \w+ )?with\s*\$?(\d+(?:\.\d+)?)", s, re.I)
    if not start:
        start = re.search(r"begins? (?:the \w+ )?with\s*\$?(\d+(?:\.\d+)?)", s, re.I)
    if not start:
        start = re.search(r"charges\s*\$?(\d+(?:\.\d+)?)\s*dollars?", s, re.I)
    if not start:
        start = re.search(r"(?:fee|cost)\D{0,30}?(\d+(?:\.\d+)?)\s*dollars?(?!\s*total)", s, re.I)
    total = None
    for pat in (
        r"cost\s*\$?(\d+(?:\.\d+)?)\s*dollars?",
        r"has\s*\$?(\d+(?:\.\d+)?)\s*(?:trays|gallons|liters|items|cars|pages|seats|units|dollars)",
        r"holds\s*\$?(\d+(?:\.\d+)?)",
        r"reaching\s*\$?(\d+(?:\.\d+)?)",
        r"total (?:of|raised is)\s*\$?(\d+(?:\.\d+)?)",
        r"(?:paid|owes?)\s*\$?(\d+(?:\.\d+)?)",
        r"total\s*\$?(\d+(?:\.\d+)?)",
    ):
        m = re.search(pat, s, re.I)
        if m:
            total = float(m.group(1))
            break
    steps = re.search(r"(?:for|after)\s*(\d+)\s*(?:hours|weeks|cycles|days|months|minutes|sessions)", s, re.I)
    if not steps:
        steps = re.search(r"group of\s*(\d+)\s*(?:passengers|people|students|tickets|items)", s, re.I)
    if not steps:
        steps = re.search(r"(?:order of|batch of|group of)\s*(\d+)", s, re.I)
    if not steps:
        steps = re.search(r"(\d+)\s*(?:days|hours|weeks|passengers|megabytes|sessions|posters|tickets)\b", s, re.I)
    if start is None or total is None or steps is None:
        return None
    n = float(steps.group(1))
    if not n:
        return None
    if "overage" in s.lower():
        rate = total / n
    else:
        rate = (total - float(start.group(1))) / n
    # A parsed word problem always has a positive per-unit rate; anything else
    # means two different numbers were read as the same quantity.
    if rate <= 0:
        return None
    return rate


def prose_circle_radius(q):
    if "radius" not in q["prompt"].lower():
        return None
    s = unwrap(q.get("stimulus") or "")
    m = re.search(r"area of\s*(\d+(?:\.\d+)?)\s*pi", s)
    if m:
        return math.sqrt(float(m.group(1)))
    return None


def submarine_rate(q):
    if "rate" not in q["prompt"].lower():
        return None
    s = unwrap(q.get("stimulus") or "")
    m = re.search(r"depth of\s*(\d+(?:\.\d+)?)\s*(?:meters|feet).*?after\s*(\d+(?:\.\d+)?)\s*minutes.*?depth of\s*(\d+(?:\.\d+)?)", s, re.I)
    if m:
        start, minutes, end = (float(v) for v in m.groups())
        if minutes:
            return abs(end - start) / minutes
    return None


def sector_area(q):
    s = unwrap(q.get("stimulus") or "")
    if "sector" not in s.lower():
        return None
    r = re.search(r"radius\s*(?:r\s*=\s*)?(?:of\s*)?(\d+(?:\.\d+)?)", s)
    ang = re.search(r"central angle\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(?:degrees?|°)", s)
    if not r or not ang:
        return None
    return math.pi * float(r.group(1)) ** 2 * float(ang.group(1)) / 360


def solid_volume(q):
    s = unwrap(q.get("stimulus") or "")
    low = s.lower()
    if "volume" not in q["prompt"].lower():
        return None
    r = re.search(r"radius\s*(?:r\s*=\s*)?(?:of\s*)?(\d+(?:\.\d+)?)", s)
    h = re.search(r"height\s*(?:h\s*=\s*)?(?:of\s*)?(\d+(?:\.\d+)?)", s)
    if "cylinder" in low and r and h:
        return math.pi * float(r.group(1)) ** 2 * float(h.group(1)), "pi"
    if "cone" in low and r and h:
        return math.pi * float(r.group(1)) ** 2 * float(h.group(1)) / 3, "pi"
    if "sphere" in low and r:
        return 4 / 3 * math.pi * float(r.group(1)) ** 3, "pi"
    return None


def chart_value(q):
    fig = q.get("figure_metadata") or {}
    if fig.get("type") not in {"table", "bar_chart", "line_chart"}:
        return None
    fig = q.get("figure_metadata") or {}
    labels, vals = [], []
    if fig.get("rows"):
        for row in fig["rows"]:
            labels.append(unwrap(str(row[0])))
            try:
                vals.append(float(unwrap(str(row[-1]))))
            except ValueError:
                vals.append(float("nan"))
    else:
        for item in fig.get("series") or []:
            labels.append(unwrap(str(item.get("label"))))
            vals.append(float(item.get("value")))
    if not vals:
        return None
    prompt = unwrap(q["prompt"])

    m = re.search(r"in (\w[\w ]*?) than in (\w[\w ]*)\?", prompt)
    if m and m.group(1).strip() in labels and m.group(2).strip() in labels:
        return vals[labels.index(m.group(1).strip())] - vals[labels.index(m.group(2).strip())], "number"

    m = re.search(r"From ([\w ]+?) to ([\w ]+?), the value increased by what percent", prompt)
    if m and m.group(1).strip() in labels and m.group(2).strip() in labels:
        a, b = vals[labels.index(m.group(1).strip())], vals[labels.index(m.group(2).strip())]
        if a:
            return (b - a) / a * 100, "percent"

    m = re.search(r"By what factor does g\(x\) change each time x increases by (\d+)", prompt)
    if m and len(vals) > int(m.group(1)) and vals[0]:
        return vals[int(m.group(1))] / vals[0], "number"

    m = re.search(r"f\(\s*(-?\d+(?:\.\d+)?)\s*\)", prompt)
    if m and fig.get("rows"):
        want = float(m.group(1))
        for row in fig["rows"]:
            if unwrap(str(row[0])) == str(int(want)):
                try:
                    return float(unwrap(str(row[-1]))), "number"
                except ValueError:
                    return None
        # A table of a linear function can be extrapolated from two rows.
        points = []
        for row in fig["rows"]:
            try:
                points.append((float(unwrap(str(row[0]))), float(unwrap(str(row[-1])))))
            except ValueError:
                continue
        if len(points) >= 2:
            (x1, y1), (x2, y2) = points[-2], points[-1]
            if x2 != x1:
                slope = (y2 - y1) / (x2 - x1)
                return y1 + slope * (want - x1), "number"
    return None


def figure_line(q):
    fig = q.get("figure_metadata") or {}
    lines = fig.get("lines") or []
    if not lines:
        return None
    line = lines[0]
    slope, intercept = line.get("slope"), line.get("intercept")
    if slope is None or intercept is None:
        return None
    prompt = q["prompt"]
    if "slope" in prompt.lower():
        return float(slope), "number"
    if "y-intercept" in prompt.lower():
        return float(intercept), "number"
    m = re.search(r"f\(\s*(-?\d+(?:\.\d+)?)\s*\)", prompt)
    if m:
        return slope * float(m.group(1)) + intercept, "number"
    return None


def figure_parabola(q):
    fig = q.get("figure_metadata") or {}
    par = fig.get("parabolas") or []
    if not par:
        return None
    a, b, c = par[0].get("a", 1), par[0].get("b", 0), par[0].get("c", 0)
    prompt = q["prompt"].lower()
    if "crosses the x-axis" in prompt:
        disc = b * b - 4 * a * c
        if disc < 0:
            return None
        return sorted({round((-b + s * math.sqrt(disc)) / (2 * a), 6) for s in (1, -1)}), "roots"
    if "vertex" in prompt:
        return (-b / (2 * a), c - b * b / (4 * a)), "point"
    if "axis of symmetry" in prompt:
        return -b / (2 * a), "axis"
    if "minimum value" in prompt or "maximum value" in prompt:
        return c - b * b / (4 * a), "number"
    return None


def geometry_figure(q):
    fig = q.get("figure_metadata") or {}
    if fig.get("type") != "geometry_figure":
        return None
    shape = (fig.get("shape") or "").lower()
    labels = {k: unwrap(str(v)) for k, v in (fig.get("labels") or {}).items()}
    prompt = unwrap(q["prompt"]).lower()
    stim = unwrap(q.get("stimulus") or "")
    known = {}
    for key, raw in labels.items():
        try:
            known[key] = float(raw)
        except ValueError:
            pass
    area = None
    m = re.search(r"area of (\d+(?:\.\d+)?)", stim)
    if m:
        area = float(m.group(1))

    if shape == "right_triangle":
        a, b, c = known.get("a"), known.get("b"), known.get("c")
        if "hypotenuse" in prompt and a is not None and b is not None:
            return math.hypot(a, b), "number"
        if "other leg" in prompt and a is not None and c is not None:
            return math.sqrt(max(0.0, c * c - a * a)), "number"
        if "area" in prompt and a is not None and b is not None:
            return a * b / 2, "number"
        if "perimeter" in prompt and a is not None and b is not None:
            return a + b + math.hypot(a, b), "number"
    if shape == "triangle":
        b, h = known.get("b"), known.get("h")
        if "area" in prompt and b is not None and h is not None:
            return b * h / 2, "number"
    if shape == "rectangle":
        w, h = known.get("w"), known.get("h")
        if "adjacent side" in prompt and area is not None and w is not None:
            return area / w, "number"
        if "area" in prompt and w is not None and h is not None:
            return w * h, "number"
        if "perimeter" in prompt and w is not None and h is not None:
            return 2 * (w + h), "number"
    if shape == "circle":
        r = known.get("r")
        if r is None:
            m = re.search(r"area of (\d+(?:\.\d+)?)\s*(?:pi|\\pi)", stim)
            if m:
                return math.sqrt(float(m.group(1))), "number"
        if r is not None:
            if "area" in prompt:
                return math.pi * r * r, "pi"
            if "circumference" in prompt:
                return 2 * math.pi * r, "pi"
            if "diameter" in prompt:
                return 2 * r, "number"
            if "radius" in prompt:
                return r, "number"
    return None


def trig_ratio(q):
    s = unwrap(q.get("stimulus") or "")
    prompt = q["prompt"]
    m = re.search(r"sin\s*A\s*=\s*([0-9./]+)\s*and\s*cos\s*A\s*=\s*([0-9./]+)", s)
    if m and "tan" in prompt:
        sin_a, cos_a = float(sp.sympify(m.group(1))), float(sp.sympify(m.group(2)))
        if cos_a:
            return sin_a / cos_a
    if not any(fn in prompt for fn in ("\\sin A", "\\cos A", "\\tan A", "sin A", "cos A", "tan A")):
        return None
    opp = adj = hyp = None
    mo = re.search(r"opposite\s+(?:angle\s+)?A\b\D{0,20}?(\d+(?:\.\d+)?)", s)
    ma = re.search(r"adjacent\s+to\s+(?:angle\s+)?A\b\D{0,20}?(\d+(?:\.\d+)?)", s)
    mh = re.search(r"hypotenuse\D{0,20}?(\d+(?:\.\d+)?)", s)
    if mo:
        opp = float(mo.group(1))
    if ma:
        adj = float(ma.group(1))
    if mh:
        hyp = float(mh.group(1))
    if adj is None or hyp is None:
        sides = re.search(r"AC\D{0,12}?(\d+(?:\.\d+)?).*?AB\D{0,12}?(\d+(?:\.\d+)?)", s)
        if sides:
            adj, hyp = float(sides.group(1)), float(sides.group(2))
    if adj is None or hyp is None:
        return None
    if opp is None:
        opp = math.sqrt(max(0.0, hyp * hyp - adj * adj))
    if "sin A" in prompt:
        return opp / hyp
    if "cos A" in prompt:
        return adj / hyp
    if "tan A" in prompt and adj:
        return opp / adj
    return None


def unit_rate_miles(q):
    s = unwrap(q.get("stimulus") or "")
    m = re.search(r"(\d+(?:\.\d+)?)\s*miles per hour.*?(\d+(?:\.\d+)?)\s*-?\s*hour", s)
    if m:
        return float(m.group(1)) * float(m.group(2))
    return None


def system_expression(q):
    got = solve_system(q)
    if got["status"] != "unique":
        return None
    xs, ys = got["x"], got["y"]
    prompt = q["prompt"]
    body = unwrap(prompt)
    if re.search(r"\bx\s*\+\s*y\b", body):
        return xs + ys, "number"
    if re.search(r"\bx\s*-\s*y\b", body):
        return xs - ys, "number"
    if re.search(r"\by\s*-\s*x\b", body):
        return ys - xs, "number"
    if re.search(r"\bx\s*\*\s*y\b|\bxy\b", body):
        return xs * ys, "number"
    if re.search(r"what is the value of x\b", body, re.I):
        return xs, "number"
    if re.search(r"what is the value of y\b", body, re.I):
        return ys, "number"
    return None


# --------------------------------------------------------------------------- #
# dispatch
# --------------------------------------------------------------------------- #
def family_answer(q):
    """(target, mode, family) for an item we can solve, else None."""
    prompt = q["prompt"]
    stimulus = q.get("stimulus") or ""
    fmt = q.get("format")
    text = unwrap(prompt)

    if (
        "satisfies the system" in prompt
        or "solves the system" in prompt
        or ("solution to the" in prompt and "system" in prompt)
    ):
        got = solve_system(q)
        if got["status"] in {"infinite", "none"}:
            return None, "degenerate", f"system-{got['status']}"
        if got["status"] == "unique":
            if "satisfies the system" in prompt:
                return (got["x"], got["y"]), "point", "system-point"
            expr = system_expression(q)
            if expr:
                return expr[0], expr[1], "system-expression"
        return None, None, None

    if "zero of" in prompt and "Which value" in prompt:
        roots = factored_roots(stimulus)
        if roots:
            return roots, "roots", "zeros"

    if "solution" in prompt.lower() and ("inequalit" in prompt.lower() or "in $x$" in prompt):
        got = solve_inequality(q)
        if got:
            return got[0], f"ineq:{got[1]}", "inequality"

    if re.search(r"whole number", text, re.I):
        pass

    if "Solve for" in prompt or "Solve for" in stimulus or re.search(r"value of \$?x\$?\s*\?", prompt):
        value = solve_linear_in_x(stimulus)
        if value is not None:
            return value, "number", "linear-equation"

    if "when $W =" in prompt:
        s = unwrap(stimulus)
        m = re.search(r"starts? the day with\s*\$?(\d+(?:\.\d+)?)", s)
        rate_m = re.search(r"(\d+(?:\.\d+)?)\s*(?:\w+\s+)?per hour", s)
        target = re.search(r"W\s*=\s*\$?(\d+(?:\.\d+)?)", unwrap(prompt))
        if m and rate_m and target:
            start, rate = float(m.group(1)), float(rate_m.group(1))
            if rate:
                return (start - float(target.group(1))) / rate, "number", "rate-time"

    if "positive value of $x$" in prompt and "equati" in prompt:
        sols = abs_equation(stimulus)
        if sols:
            positive = [v for v in sols if v > 0]
            if positive:
                return positive[0], "number", "absolute-value"

    if "radius of the circle" in prompt:
        r = circle_radius(stimulus)
        if r is not None:
            return r, "number", "circle-radius"

    if "radius of the" in prompt:
        r = prose_circle_radius(q)
        if r is not None:
            return r, "number", "circle-prose"

    if "submarine" in prompt.lower() or "submarine" in stimulus.lower():
        r = submarine_rate(q)
        if r is not None:
            return r, "number", "submarine-rate"

    if re.search(r"\bf\(g\(", prompt):
        value = composition(q)
        if value is not None:
            return value, "number", "composition"

    if "real zeros" in prompt:
        value = vieta(q)
        if value is not None:
            return value, "number", "vieta"

    if "mean of the" in prompt or "median of the" in prompt:
        value = mean_median(q)
        if value is not None:
            return value, "number", "mean-median"

    if "probability" in prompt and "fraction" in prompt:
        value = probability(q)
        if value is not None:
            return value, "number", "probability"

    if re.search(r"=\s*\d+\*\*\(k\)", unwrap(stimulus)):
        value = exponent_k(stimulus)
        if value is not None:
            return value, "number", "exponents"

    if "Predict the population" in prompt or "model predicts a population" in prompt:
        value = exponential_value(q)
        if value is not None:
            return value, "number", "exponential"

    if "miles does the van cover" in prompt:
        value = unit_rate_miles(q)
        if value is not None:
            return value, "number", "unit-rate"

    if "new price" in prompt or "final price" in prompt:
        value = percent_price(q)
        if value is not None:
            return value, "number", "percent-price"

    if "per-unit rate" in prompt:
        value = per_unit_rate(q)
        if value is not None:
            return value, "number", "per-unit"

    if "sector" in prompt.lower() or "sector" in stimulus.lower():
        value = sector_area(q)
        if value is not None:
            return value, "pi", "sector-area"

    if "volume" in prompt.lower():
        got = solid_volume(q)
        if got:
            return got[0], got[1], "solid-volume"

    if prompt.startswith("What is the slope of"):
        got = figure_line(q)
        if got is None:
            slope = two_point_slope(stimulus)
            if slope is not None:
                got = (slope, "number")
        if got:
            return got[0], got[1], "slope"

    if "y-intercept of line" in prompt:
        got = figure_line(q)
        if got:
            return got[0], got[1], "intercept"

    if "reach its minimum" in prompt:
        got = parabola_coeffs(stimulus)
        if got:
            a, b, _ = got
            if a:
                return -b / (2 * a), "number", "vertex-x"

    got = figure_parabola(q)
    if got:
        return got[0], got[1], "parabola-figure"

    got = figure_line(q)
    if got:
        return got[0], got[1], "line-figure"

    got = chart_value(q)
    if got:
        return got[0], got[1], "chart"

    got = geometry_figure(q)
    if got:
        return got[0], got[1], "geometry"

    got = trig_ratio(q)
    if got is not None:
        return got, "number", "trig"

    return None, None, None


def matches_for(q, target, mode) -> list[str]:
    out = []
    if mode == "point":
        for c in q["choices"]:
            nums = numbers(c["text"])
            if len(nums) == 2 and close(nums[0], target[0]) and close(nums[1], target[1]):
                out.append(c["id"])
        return out
    if mode == "roots":
        want = {round(float(v), 6) for v in target}
        for c in q["choices"]:
            have = {round(v, 6) for v in numbers(c["text"])}
            if have and have <= want:
                out.append(c["id"])
        return out
    if mode and mode.startswith("ineq:"):
        rel = mode.split(":", 1)[1]
        for c in q["choices"]:
            parsed = parse_choice_inequality(c["text"])
            if parsed and parsed[0] == rel and close(parsed[1], target):
                out.append(c["id"])
        return out
    if mode == "pi":
        for cid, v in choice_values(q).items():
            if v is not None and close(v / math.pi, target / math.pi):
                out.append(cid)
        return out
    if mode == "percent":
        for cid, v in choice_values(q).items():
            if v is not None and close(v, target, tol=6e-3):
                out.append(cid)
        return out
    if mode == "axis":
        for c in q["choices"]:
            nums = numbers(c["text"])
            if len(nums) == 1 and close(nums[0], target) and "y" not in unwrap(c["text"]).lower().split("=")[0]:
                out.append(c["id"])
        return out
    for cid, v in choice_values(q).items():
        if close(v, target):
            out.append(cid)
    return out


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def main() -> int:
    emit_json = "--json" in sys.argv
    show_all = "--list" in sys.argv
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    questions = bank["questions"]

    findings: list[dict] = []
    checked = Counter()
    solved = Counter()
    uncovered = Counter()
    covered_formats = Counter()

    for q in questions:
        checked["questions"] += 1
        fmt = q.get("format")
        choices = q.get("choices") or []
        checked[fmt] += 1

        if fmt == "multiple_choice":
            if len(choices) != 4:
                findings.append({"id": q["id"], "kind": "choice-count", "detail": len(choices)})
            if q.get("correct_answer") not in [c["id"] for c in choices]:
                findings.append({"id": q["id"], "kind": "key-not-a-choice", "detail": q.get("correct_answer")})
            seen = Counter(c["text"].strip() for c in choices)
            for text, n in seen.items():
                if n > 1:
                    findings.append({"id": q["id"], "kind": "duplicate-choice", "detail": text[:60]})
        else:
            accepted = [str(a) for a in (q.get("acceptable_answers") or [])]
            key = str(q.get("correct_answer") or "")
            if not key:
                findings.append({"id": q["id"], "kind": "missing-key", "detail": None})
            elif key not in accepted:
                findings.append({"id": q["id"], "kind": "key-not-accepted", "detail": accepted})

        blob = " ".join([q.get("stimulus") or "", q["prompt"], " ".join(c["text"] for c in choices)])
        # `\$` inside math is a literal dollar sign, not a delimiter.
        blob = blob.replace("\\$", "")
        prose_blob = re.sub(r"\$\$.+?\$\$", " ", blob, flags=re.S)
        if blob.count("$") % 2:
            findings.append({"id": q["id"], "kind": "unbalanced-dollar", "detail": blob.count("$")})
        for m in re.finditer(r"\$([^$]+)\$", prose_blob):
            seg = m.group(1)
            words = re.findall(r"[A-Za-z]{3,}", seg)
            if len(words) >= 5 and not re.search(r"\\text\{", seg):
                findings.append({"id": q["id"], "kind": "prose-in-math", "detail": seg[:70]})
                break

        try:
            target, mode, family = family_answer(q)
        except Exception as error:  # a broken family must not abort the whole audit
            findings.append({"id": q["id"], "kind": "audit-error", "detail": repr(error)})
            continue
        if family and mode == "degenerate":
            findings.append({"id": q["id"], "kind": "system-degenerate", "detail": q.get("stimulus")})
        if family:
            covered_formats[fmt] += 1
        if target is None:
            ps = re.sub(r"\$[^$]*\$", "$X$", q["prompt"])
            ps = re.sub(r"\d+", "N", ps)[:64]
            uncovered[(q["section"], q.get("skill"), ps)] += 1
            continue

        solved[family] += 1
        if fmt == "multiple_choice":
            hits = matches_for(q, target, mode)
            if len(hits) != 1 or hits[0] != q["correct_answer"]:
                findings.append({
                    "id": q["id"],
                    "kind": "mc-correctness",
                    "family": family,
                    "target": target if not isinstance(target, (list, tuple)) else list(target),
                    "matches": hits,
                    "key": q["correct_answer"],
                })
        else:
            key_value = num(q.get("correct_answer"))
            ok = False
            if key_value is not None and isinstance(target, (int, float)):
                if mode == "pi":
                    ok = close(key_value / math.pi, target / math.pi)
                else:
                    ok = close(key_value, target, tol=1e-4)
            if not ok:
                findings.append({
                    "id": q["id"],
                    "kind": "spr-correctness",
                    "family": family,
                    "target": target if not isinstance(target, (list, tuple)) else list(target),
                    "key": q.get("correct_answer"),
                })

    if emit_json:
        print(json.dumps({
            "findings": findings,
            "solved": solved,
            "checked": checked,
            "covered_formats": covered_formats,
            "uncovered": {f"{k[0]} | {k[1]} | {k[2]}": v for k, v in uncovered.items()},
        }, indent=1))
        return 0

    print(f"{checked['questions']} questions: {checked['multiple_choice']} MC, {checked['spr']} SPR")
    print(f"solved by family: {sum(solved.values())} "
          f"(MC {covered_formats['multiple_choice']}, SPR {covered_formats['spr']})")
    for family, count in solved.most_common():
        print(f"   {family:22s} {count}")

    kinds = defaultdict(list)
    for f in findings:
        kinds[f["kind"]].append(f)
    print(f"\nfindings: {len(findings)}")
    for kind, items in sorted(kinds.items(), key=lambda kv: -len(kv[1])):
        print(f"  {kind:24s} {len(items)}")
        limit = len(items) if show_all else 8
        for item in items[:limit]:
            print("     ", item["id"], json.dumps(item.get("detail") if "detail" in item else item)[:190])

    print("\nlargest uncovered families:")
    for key, count in uncovered.most_common(25):
        print(f"   {count:4d}  {key[0][:4]} | {str(key[1])[:30]:30s} | {key[2]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
