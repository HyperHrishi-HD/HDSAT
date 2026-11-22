"""Recompute the answer to every generated math item and report disagreements.

The bank was produced by scripts, so a wrong template does not produce one bad
question: it produces a whole family of them. Sampling cannot catch that, so
this tool solves the items.

Each verifier takes a question, parses the stem and works the answer out from
first principles. Verdicts:

    ok           the stored key agrees with the recomputed answer
    wrong        the key is wrong and the expected value is known
    multi        a multiple-choice item where more than one choice is valid
    duplicate    two choices have the same text
    latex        unbalanced delimiters, a leaked "(variant N)", or raw TeX that
                 never renders
    unverified   no verifier applies (figure items, pure prose, all R&W)

The verifiers are deliberately narrow: a stem that does not match the expected
shape reports "unverified" rather than guessing, so a green result means
"everything this tool can check is right", never "everything is right".

    python tools/verify_bank.py                  # report
    python tools/verify_bank.py --json out.json  # machine-readable findings
    python tools/verify_bank.py --ids M-QUA-140  # one item
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from fractions import Fraction
from pathlib import Path

import sympy as sp

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / "src" / "data" / "questionBank.json"

SYMBOL_POOL = "xytnkhrabcdgw"


# ---------------------------------------------------------------------------
# LaTeX -> sympy
# ---------------------------------------------------------------------------

SUPERSCRIPTS = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-",
}


def desuperscript(text: str) -> str:
    out, i = [], 0
    while i < len(text):
        if text[i] in SUPERSCRIPTS:
            digits = []
            while i < len(text) and text[i] in SUPERSCRIPTS:
                digits.append(SUPERSCRIPTS[text[i]])
                i += 1
            out.append("^(" + "".join(digits) + ")")
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def strip_math(text: str | None) -> str:
    if not text:
        return ""
    return text.replace("$$", " ").replace("$", " ")


def latex_to_expr(text: str) -> str:
    s = desuperscript(strip_math(text))
    s = s.replace("\\left", "").replace("\\right", "")
    for name in ("\\dfrac", "\\tfrac"):
        s = s.replace(name, "\\frac")
    s = s.replace("\\cdot", "*").replace("\\times", "*").replace("×", "*").replace("·", "*")
    s = s.replace("\\div", "/").replace("÷", "/")
    s = s.replace("\\pi", "pi").replace("π", "pi")
    s = s.replace("\\%", "/100")
    s = s.replace("−", "-").replace("–", "-").replace("—", "-")
    for a, b in (("\\geq", ">="), ("\\leq", "<="), ("\\ge", ">="), ("\\le", "<="), ("\\neq", "!=")):
        s = s.replace(a, b)
    s = re.sub(r"\\q?quad|\\;|\\,|\\!|\\ |~", " ", s)
    s = re.sub(r"\\text\s*\{([^{}]*)\}", r"\1", s)
    s = s.replace("\\$", "").replace("\\%", "/100")

    s = _expand_command(s, "frac", lambda parts: f"(({parts[0]})/({parts[1]}))")
    s = _expand_command(s, "sqrt", lambda parts: f"sqrt({parts[0]})")
    s = s.replace("\\sqrt", "sqrt")

    s = re.sub(r"\^\s*\{([^{}]*)\}", r"**(\1)", s)
    s = re.sub(r"\^\s*(-?\d+(?:\.\d+)?)", r"**(\1)", s)
    s = s.replace("{", "").replace("}", "")

    # Absolute-value bars around an expression, e.g. |2x - 6| = 14.
    s = re.sub(r"\|([^|]+)\|", r"Abs(\1)", s)

    # Implicit multiplication, which sympify refuses: 10x -> 10*x, 3(x + 1)
    # -> 3*(x + 1), (x - 1)(x + 2) -> (x - 1)*(x + 2). Function names are masked
    # first so `sqrt(` never becomes `sqrt*(`.
    s = s.replace("sqrt(", "~SQ~(").replace("Abs(", "~AB~(")
    s = re.sub(r"(?<=\d)(?=[a-zA-Z(])", "*", s)
    s = re.sub(r"(?<=[a-zA-Z)])(?=\()", "*", s)
    s = re.sub(r"(?<=\))(?=[a-zA-Z0-9])", "*", s)
    s = s.replace("~SQ~(", "sqrt(").replace("~AB~(", "Abs(")
    return s.strip()


def to_sympy(text: str | None, symbols: str = SYMBOL_POOL):
    if not text:
        return None
    expr = latex_to_expr(text)
    if not expr:
        return None
    local = {name: sp.Symbol(name, real=True) for name in symbols}
    local.update({"pi": sp.pi, "sqrt": sp.sqrt, "Abs": sp.Abs, "abs": sp.Abs, "e": sp.E})
    try:
        return sp.sympify(expr, locals=local, evaluate=True)
    except Exception:
        return None


def as_fraction(value) -> Fraction | None:
    if value is None:
        return None
    try:
        simplified = sp.nsimplify(sp.N(value, 24), rational=True)
    except Exception:
        return None
    if simplified.is_rational:
        return Fraction(int(simplified.p), int(simplified.q))
    try:
        return Fraction(float(value)).limit_denominator(10**9)
    except Exception:
        return None


def numeric(text) -> Fraction | None:
    """Parse a choice or answer that is a number, fraction, radical or pi form."""
    if text is None:
        return None
    raw = str(text)
    # An answer string may already be sympy-ish ("7sqrt(2)").
    expr = to_sympy(raw)
    if expr is not None and getattr(expr, "is_number", False):
        try:
            if expr.is_real is not False:
                return as_fraction(expr)
        except Exception:
            pass
    if expr is not None and getattr(expr, "is_number", False) is True:
        try:
            return as_fraction(sp.N(expr))
        except Exception:
            return None
    return None


def nearly(a: Fraction | None, b: Fraction | None, tol: float = 1e-6) -> bool:
    if a is None or b is None:
        return False
    return abs(float(a) - float(b)) <= tol * max(1.0, abs(float(b)))


# ---------------------------------------------------------------------------
# Stem helpers
# ---------------------------------------------------------------------------


def math_spans(text: str | None) -> list[str]:
    """Every $...$ or $$...$$ span, in order, without its delimiters."""
    if not text:
        return []
    spans = []
    for match in re.finditer(r"\$\$(.+?)\$\$|\$(.+?)\$", text, re.S):
        spans.append(match.group(1) if match.group(1) is not None else match.group(2))
    return spans


def _read_braced(text: str, start: int) -> tuple[str, int]:
    """Read a {...} group starting at `start`, returning its contents and end."""
    depth = 0
    index = start
    while index < len(text):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1 : index], index + 1
        index += 1
    return text[start + 1 :], len(text)


def _expand_command(text: str, command: str, build) -> str:
    """Replace `\\frac{a}{b}` / `\\sqrt{a}` with a function call, nesting and all."""
    marker = "\\" + command
    out = ""
    index = 0
    while index < len(text):
        if not text.startswith(marker, index):
            out += text[index]
            index += 1
            continue
        cursor = index + len(marker)
        while cursor < len(text) and text[cursor] in " \t":
            cursor += 1
        if cursor >= len(text) or text[cursor] != "{":
            out += text[index]
            index += 1
            continue
        first, cursor = _read_braced(text, cursor)
        first = _expand_command(first, command, build)
        if command == "frac":
            while cursor < len(text) and text[cursor] in " \t":
                cursor += 1
            if cursor < len(text) and text[cursor] == "{":
                second, cursor = _read_braced(text, cursor)
                second = _expand_command(second, command, build)
            else:
                second = "1"
            out += build([first, second])
        else:
            out += build([first])
        index = cursor
    return out


def equations_in(*texts: str) -> list[tuple[sp.Expr, sp.Expr, str]]:
    found = []
    for text in texts:
        for body in math_spans(text):
            body = body.strip()
            match = re.search(r"^(.+?)\s*(>=|<=|=|>|<)\s*(.+)$", body, re.S)
            if not match:
                continue
            left = to_sympy(match.group(1))
            right = to_sympy(match.group(3))
            if left is None or right is None:
                continue
            found.append((left, right, match.group(2)))
    return found


def first_number(text: str | None) -> Fraction | None:
    if not text:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    return Fraction(match.group(0)) if match else None


def function_defs(stimulus: str) -> dict[str, sp.Expr]:
    """`f(x) = 3x + 1 \\qquad g(x) = 2x - 4` -> two definitions."""
    defs: dict[str, sp.Expr] = {}
    clean = strip_math(stimulus)
    clean = clean.replace("\\qquad", ";").replace("\\quad", ";")
    pieces = re.split(r";|\n|\band\b", clean)
    for piece in pieces:
        match = re.match(r"\s*([fghpq])\s*\(\s*x\s*\)\s*=\s*(.+?)\s*$", piece, re.S)
        if not match:
            continue
        expression = re.sub(r"[,.]\s*$", "", match.group(2))
        expr = to_sympy(expression)
        if expr is not None:
            defs[match.group(1)] = expr
    return defs


def choice_values(question: dict) -> list[tuple[str, str, Fraction | None]]:
    return [(c["id"], c["text"], numeric(c["text"])) for c in (question.get("choices") or [])]


def split_choices(question: dict):
    letter = str(question.get("correct_answer", "")).strip()
    for cid, text, value in choice_values(question):
        if cid == letter:
            return letter, text, value
    return letter, None, None


def answer_value(question: dict) -> Fraction | None:
    if question.get("format") == "spr":
        return numeric(question.get("correct_answer"))
    return split_choices(question)[2]


def target_symbol(prompt: str) -> sp.Symbol | None:
    """The variable the prompt is asking about: `what is the value of $t$?`."""
    for span in reversed(math_spans(prompt)):
        candidate = span.strip().replace("\\", "")
        if re.fullmatch(r"[a-zA-Z]", candidate):
            return sp.Symbol(candidate, real=True)
    return None


# ---------------------------------------------------------------------------
# Verifiers
# ---------------------------------------------------------------------------


def solve_equation(q: dict):
    """Solve the stem's equation(s), honouring values given in the prompt."""
    eqs = equations_in(q.get("stimulus"), q.get("prompt"))
    if not eqs:
        return None
    target = target_symbol(q.get("prompt") or "")
    known: dict[sp.Symbol, sp.Expr] = {}
    conditions = []
    pending = []
    for left, right, op in eqs:
        symbols = left.free_symbols | right.free_symbols
        if op in (">", "<", ">=", "<="):
            conditions.append((left, right, op))
            continue
        if not symbols:
            continue
        if len(symbols) == 1:
            symbol = next(iter(symbols))
            if target is not None and symbol != target:
                # e.g. "$P = 240$" next to "$P = 3x + 30$"
                known[symbol] = sp.solve(sp.Eq(left, right), symbol)[0]
                continue
            if target is None:
                known[symbol] = sp.solve(sp.Eq(left, right), symbol)[0]
                continue
        pending.append((left, right))

    for left, right in list(pending):
        left = left.subs(known)
        right = right.subs(known)
        if left == right:
            continue
        symbols = left.free_symbols | right.free_symbols
        if target is not None:
            symbols = symbols if target in symbols else symbols
        if len(symbols) != 1:
            continue
        symbol = next(iter(symbols))
        try:
            solutions = sp.solve(sp.Eq(left, right), symbol)
        except Exception:
            continue
        real = [s for s in solutions if sp.N(s).is_real]
        if not real:
            continue
        if any("positive" in (q.get("prompt") or "").lower() for _ in [0]):
            positive = [s for s in real if sp.N(s) > 0]
            if positive:
                real = positive
        if any("greatest" in (q.get("prompt") or "").lower() for _ in [0]):
            real = [max(real, key=lambda s: sp.N(s))]
        if len(real) != 1:
            continue
        return as_fraction(real[0])
    return None


def solve_for_target_value(q: dict):
    """`V = 5(1 + 1)^t` with `t = 3` given: evaluate the model."""
    eqs = equations_in(q.get("stimulus"), q.get("prompt"))
    if not eqs:
        return None
    target = target_symbol(q.get("prompt") or "")
    known: dict[sp.Symbol, sp.Expr] = {}
    models = []
    for left, right, op in eqs:
        if op != "=":
            continue
        symbols = left.free_symbols | right.free_symbols
        if len(symbols) == 1:
            symbol = next(iter(symbols))
            try:
                known[symbol] = sp.solve(sp.Eq(left, right), symbol)[0]
            except Exception:
                continue
        elif len(symbols) == 2:
            models.append((left, right))
    for left, right in models:
        for side, other in ((left, right), (right, left)):
            symbols = side.free_symbols
            if target is not None and target in symbols and other.free_symbols <= set(known):
                try:
                    value = side.subs(known)
                except Exception:
                    continue
                return as_fraction(value)
    return None


def check_zeros_relation(q: dict):
    prompt = q.get("prompt") or ""
    if "zero" not in prompt.lower():
        return None
    stimulus = strip_math(q.get("stimulus"))
    match = re.search(r"[fghpq]\s*\(\s*x\s*\)\s*=\s*([^,]+)", stimulus)
    if not match:
        return None
    expression = to_sympy(match.group(1))
    if expression is None:
        return None
    x = sp.Symbol("x", real=True)
    try:
        poly = sp.Poly(sp.expand(expression), x)
    except Exception:
        return None
    if poly.degree() != 2:
        return None
    a = poly.coeff_monomial(x**2)
    b = poly.coeff_monomial(x)
    c = poly.coeff_monomial(1)
    if a == 0:
        return None
    # The prompt may name the relation ("the product") or just show it
    # ("what is $r_1 \cdot r_2$?").
    if "product" in prompt or "\\cdot r_2" in prompt or "r_1 r_2" in prompt:
        return as_fraction(c / a)
    if "sum" in prompt or "r_1 + r_2" in prompt:
        return as_fraction(-b / a)
    return None


def check_zero_is_unique(q: dict):
    """`Which value of x is a zero of h?` must have exactly one valid choice."""
    prompt = q.get("prompt") or ""
    if "zero" not in prompt.lower() or q.get("format") != "multiple_choice":
        return None
    stimulus = strip_math(q.get("stimulus"))
    match = re.search(r"[fghpq]\s*\(\s*x\s*\)\s*=\s*(.+)$", stimulus.strip())
    if not match:
        return None
    expression = to_sympy(match.group(1))
    if expression is None:
        return None
    x = sp.Symbol("x", real=True)
    valid = []
    for cid, text, value in choice_values(q):
        if value is None:
            continue
        try:
            if sp.simplify(expression.subs(x, sp.Rational(value.numerator, value.denominator))) == 0:
                valid.append(cid)
        except Exception:
            continue
    if not valid:
        return None
    if len(valid) > 1:
        return ("multi", valid)
    key = str(q.get("correct_answer"))
    return ("one", valid[0] == key)


def check_vertex(q: dict):
    prompt = q.get("prompt") or ""
    if "minimum" not in prompt and "maximum" not in prompt:
        return None
    stimulus = strip_math(q.get("stimulus"))
    match = re.search(r"[fghpq]\s*\(\s*x\s*\)\s*=\s*([^,]+)", stimulus)
    if not match:
        return None
    expression = to_sympy(match.group(1))
    if expression is None:
        return None
    x = sp.Symbol("x", real=True)
    try:
        poly = sp.Poly(sp.expand(expression), x)
    except Exception:
        return None
    if poly.degree() != 2:
        return None
    a = poly.coeff_monomial(x**2)
    b = poly.coeff_monomial(x)
    c = poly.coeff_monomial(1)
    if a == 0:
        return None
    # "minimum/maximum value" asks for the y-coordinate of the vertex. A
    # prompt asking where the minimum/maximum occurs asks for its x-coordinate.
    if re.search(r"\b(?:minimum|maximum)\s+value\b", prompt, re.I):
        return as_fraction(c - b**2 / (4 * a))
    return as_fraction(-b / (2 * a))


def check_slope(q: dict):
    if "slope" not in (q.get("prompt") or "").lower():
        return None
    stimulus = strip_math(q.get("stimulus"))
    points = re.findall(r"\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)", stimulus)
    if len(points) != 2:
        return None
    (x1, y1), (x2, y2) = [(Fraction(a), Fraction(b)) for a, b in points]
    if x2 == x1:
        return None
    return (y2 - y1) / (x2 - x1)


def check_radius(q: dict):
    if "radius" not in (q.get("prompt") or "").lower():
        return None
    stimulus = strip_math(q.get("stimulus"))
    centred_at_origin = re.search(r"x\s*(?:\^|\*\*)\s*2\s*\+\s*y\s*(?:\^|\*\*)\s*2\s*=\s*(\d+(?:\.\d+)?)", stimulus)
    if centred_at_origin:
        right = Fraction(centred_at_origin.group(1))
        return as_fraction(sp.sqrt(sp.Rational(right.numerator, right.denominator)))
    match = re.search(
        r"\(\s*x\s*([+-])\s*(\d+(?:\.\d+)?)\s*\)\s*(?:\^|\*\*)\s*2\s*\+\s*\(\s*y\s*([+-])\s*(\d+(?:\.\d+)?)\s*\)\s*(?:\^|\*\*)\s*2\s*=\s*(-?\d+(?:\.\d+)?)",
        stimulus,
    )
    if not match:
        return None
    right = Fraction(match.group(5))
    if right < 0:
        return None
    root = sp.sqrt(sp.Rational(right.numerator, right.denominator))
    return as_fraction(root)


def check_vertex_form(q: dict):
    """`y = a(x - h)^2 + k` asked as "coordinates of the vertex"."""
    prompt = q.get("prompt") or ""
    if "vertex" not in prompt.lower():
        return None
    stimulus = strip_math(q.get("stimulus"))
    match = re.search(r"y\s*=\s*([^,]+?)(?:\s+is\s+shown|\s+on\s+the|$)", stimulus)
    if not match:
        return None
    expression = to_sympy(match.group(1))
    if expression is None:
        return None
    x = sp.Symbol("x", real=True)
    try:
        poly = sp.Poly(sp.expand(expression), x)
    except Exception:
        return None
    if poly.degree() != 2:
        return None
    a = poly.coeff_monomial(x**2)
    b = poly.coeff_monomial(x)
    c = poly.coeff_monomial(1)
    if a == 0:
        return None
    # Vertex of ax^2 + bx + c is (-b/2a, c - b^2/4a); expanding first means the
    # signs of a `(x - h)^2` form cannot be read backwards.
    h = sp.nsimplify(-b / (2 * a))
    k = sp.nsimplify(c - b**2 / (4 * a))
    return ("pair", h, k)


def check_trig_ratio(q: dict):
    """sin / cos / tan of angle A from the sides named in the stem."""
    prompt = q.get("prompt") or ""
    match = re.search(r"\\(sin|cos|tan)\s*A", prompt)
    if not match:
        return None
    function = match.group(1)
    stimulus = strip_math(q.get("stimulus"))
    opposite = re.search(r"opposite angle\s*\$?A\$?\s*has length\s*(\d+(?:\.\d+)?)", stimulus)
    adjacent = re.search(r"adjacent to angle\s*\$?A\$?\s*has length\s*(\d+(?:\.\d+)?)", stimulus)
    hypotenuse = re.search(r"hypotenuse\s*(?:has|is)\s*(?:length\s*)?(\d+(?:\.\d+)?)", stimulus)
    if opposite and adjacent and hypotenuse:
        o, a, h = (Fraction(x.group(1)) for x in (opposite, adjacent, hypotenuse))
        if function == "sin":
            return o / h
        if function == "cos":
            return a / h
        return o / a
    # The two-sides form: right angle at C, one leg and the hypotenuse.
    leg = re.search(r"length of side\s*\$?AC\$?\s*is\s*(\d+(?:\.\d+)?)", stimulus)
    hyp = re.search(r"length of hypotenuse\s*\$?AB\$?\s*is\s*(\d+(?:\.\d+)?)", stimulus)
    if leg and hyp:
        adjacent_value = Fraction(leg.group(1))
        hypotenuse_value = Fraction(hyp.group(1))
        if function == "cos":
            return adjacent_value / hypotenuse_value
        other = (hypotenuse_value**2 - adjacent_value**2)
        root = sp.sqrt(sp.Rational(other.numerator, other.denominator))
        if function == "sin":
            return as_fraction(root) / hypotenuse_value
        return as_fraction(root) / adjacent_value
    return None


def check_system_constant(q: dict):
    """"The system has infinitely many solutions, what is k?"""
    prompt = q.get("prompt") or ""
    if "infinitely many" not in prompt:
        return None
    eqs = [e for e in equations_in(q.get("stimulus")) if e[2] == "="]
    if len(eqs) != 2:
        return None
    k = sp.Symbol("k", real=True)
    x, y = sp.Symbol("x", real=True), sp.Symbol("y", real=True)
    (l1, r1, _), (l2, r2, _) = eqs
    try:
        # Remove k from the first equation and match the coefficients of the two.
        if k in l1.free_symbols:
            coefficient_source = sp.expand(l2)
            target_symbols = (x, y)
            ratio = sp.simplify((l1.coeff(x)) / (l2.coeff(x))) if l2.coeff(x) != 0 else None
            if ratio is None:
                ratio = sp.simplify((l1.coeff(y)) / (l2.coeff(y)))
            constant_ratio = sp.simplify(r1 / r2)
            if sp.simplify(ratio - constant_ratio) == 0:
                return None
        # Fall back to: proportional equations -> cross-multiply the constants.
        det = sp.simplify(l1.coeff(x) * l2.coeff(y) - l1.coeff(y) * l2.coeff(x))
        if det == 0:
            return None
        solutions = sp.solve(sp.Eq(l1 * l2.coeff(y) - l1.coeff(y) * l2, 0), k)
        real = [s for s in solutions if sp.N(s).is_real]
        return as_fraction(real[0]) if len(real) == 1 else None
    except Exception:
        return None


def check_per_unit(q: dict):
    """`starts with N ... after U ... holds T` -> rate = (T - N) / U.

    Only the shapes where the rate is genuinely derivable are verified. A stem
    that simply states the rate ("descends 7 metres per minute") is a reading
    question, not a computation, and guessing at it produced false positives.
    """
    prompt = q.get("prompt") or ""
    if "per-unit rate" not in prompt and "per cycle" not in prompt:
        return None
    stimulus = strip_math(q.get("stimulus"))
    patterns = [
        r"starts the month with\s+(\d+(?:\.\d+)?).*?adds the same number.*?After\s+(\d+(?:\.\d+)?)\s+cycles.*?holds\s+(\d+(?:\.\d+)?)",
        r"starts the month with\s+(\d+(?:\.\d+)?).*?\s(\d+(?:\.\d+)?)\s+more trays every cycle.*?After\s+(\d+(?:\.\d+)?)\s+cycles.*?holds\s+(\d+(?:\.\d+)?)",
        r"keeps\s+(\d+(?:\.\d+)?)\s+finished mugs.*?(?:restocks\s+(\d+(?:\.\d+)?)\s+mugs|the same number).*?After\s+(\d+(?:\.\d+)?)\s+firings.*?holds\s+(\d+(?:\.\d+)?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, stimulus, re.S)
        if not match:
            continue
        groups = [Fraction(g) for g in match.groups() if g is not None]
        if len(groups) == 3:  # start, units, total
            start, units, total = groups
        elif len(groups) == 4:  # start, rate, units, total
            start, _rate, units, total = groups
        else:
            continue
        if units == 0:
            return None
        return (total - start) / units
    return None


def check_composition(q: dict):
    prompt = q.get("prompt") or ""
    defs = function_defs(q.get("stimulus"))
    if not defs:
        return None
    x = sp.Symbol("x", real=True)
    match = re.search(r"([fghpq])\s*\(\s*([fghpq])\s*\(\s*(-?\d+(?:\.\d+)?)\s*\)\s*\)", prompt)
    if match:
        outer, inner, arg = match.group(1), match.group(2), Fraction(match.group(3))
        if outer not in defs or inner not in defs:
            return None
        try:
            inner_value = defs[inner].subs(x, sp.Rational(arg.numerator, arg.denominator))
            return as_fraction(defs[outer].subs(x, inner_value))
        except Exception:
            return None
    match = re.search(r"([fghpq])\s*\(\s*(-?\d+(?:\.\d+)?)\s*\)", prompt)
    if match and match.group(1) in defs:
        arg = Fraction(match.group(2))
        try:
            return as_fraction(defs[match.group(1)].subs(x, sp.Rational(arg.numerator, arg.denominator)))
        except Exception:
            return None
    return None


def check_system(q: dict):
    prompt = q.get("prompt") or ""
    eqs = [e for e in equations_in(q.get("stimulus")) if e[2] == "="]
    if len(eqs) != 2:
        return None
    x, y = sp.Symbol("x", real=True), sp.Symbol("y", real=True)
    try:
        solution = sp.solve([sp.Eq(a, b) for a, b, _ in eqs], (x, y), dict=True)
    except Exception:
        return None
    if not solution:
        return None
    values = solution[0]
    if x not in values or y not in values:
        return None
    if "ordered pair" in prompt:
        return ("pair", values[x], values[y])
    if "x + y" in prompt:
        return as_fraction(sp.simplify(values[x] + values[y]))
    if "value of" in prompt:
        wanted = target_symbol(prompt)
        if wanted == x:
            return as_fraction(values[x])
        if wanted == y:
            return as_fraction(values[y])
        total = sp.simplify(values[x] + values[y])
        return as_fraction(total)
    return None


def check_mean_median(q: dict):
    prompt = q.get("prompt") or ""
    stimulus = strip_math(q.get("stimulus"))
    listed = re.search(r":\s*([\d,\s]+?)s*\.?$", stimulus.strip())
    if not listed:
        return None
    try:
        values = [Fraction(v.strip()) for v in listed.group(1).split(",") if v.strip()]
    except Exception:
        return None
    if not values:
        return None
    if "mean" in prompt:
        return sum(values) / len(values)
    if "median" in prompt:
        ordered = sorted(values)
        n = len(ordered)
        return ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2
    return None


def check_percent(q: dict):
    prompt = q.get("prompt") or ""
    stimulus = strip_math(q.get("stimulus"))
    if "new price" not in prompt:
        return None
    match = re.search(r"from\s+(\d+(?:\.\d+)?)\s+by\s+(\d+(?:\.\d+)?)\s*/?\s*100", stimulus)
    if match:
        base, pct = Fraction(match.group(1)), Fraction(match.group(2))
        return base + base * pct / 100 if ("raise" in stimulus or "increase" in stimulus) else base - base * pct / 100
    match = re.search(r"from\s+(\d+(?:\.\d+)?)\s+to\s+(\d+(?:\.\d+)?)", stimulus)
    if match and "percent" in prompt:
        base, new = Fraction(match.group(1)), Fraction(match.group(2))
        return (new - base) / base * 100
    return None


def check_probability(q: dict):
    prompt = q.get("prompt") or ""
    stimulus = strip_math(q.get("stimulus"))
    if "probability" not in prompt:
        return None
    counts = re.findall(r"(\d+)\s+(red|blue|green|yellow|black|white)\b", stimulus)
    if not counts:
        return None
    wanted = None
    for colour in ("red", "blue", "green", "yellow", "black", "white"):
        if f"is {colour}" in prompt or f"{colour})" in prompt:
            wanted = colour
            break
    if not wanted:
        return None
    mapping = {colour: int(n) for n, colour in counts}
    total = sum(mapping.values())
    if total <= 0:
        return None
    return Fraction(mapping.get(wanted, 0), total)


def check_volume_area(q: dict):
    prompt = q.get("prompt") or ""
    stimulus = strip_math(q.get("stimulus"))
    cyl = re.search(r"cylinder has radius\s+(\d+(?:\.\d+)?)\s+and height\s+(\d+(?:\.\d+)?)", stimulus)
    if cyl and "volume" in prompt:
        r, h = Fraction(cyl.group(1)), Fraction(cyl.group(2))
        return r * r * h * sp.pi
    rect = re.search(r"rectangle measuring\s+(\d+(?:\.\d+)?)\s+\w+\s+by\s+(\d+(?:\.\d+)?)", stimulus)
    if rect:
        w, h = Fraction(rect.group(1)), Fraction(rect.group(2))
        if "area" in prompt:
            return w * h
        if "perimeter" in prompt:
            return 2 * (w + h)
    rect2 = re.search(r"rectangular with sides of\s+(\d+(?:\.\d+)?)\s+and\s+(\d+(?:\.\d+)?)", stimulus)
    if rect2:
        w, h = Fraction(rect2.group(1)), Fraction(rect2.group(2))
        if "area" in prompt:
            return w * h
        if "perimeter" in prompt:
            return 2 * (w + h)
    missing = re.search(r"area of\s+(\d+(?:\.\d+)?)\s+\w+\s+and one side measures\s+(\d+(?:\.\d+)?)", stimulus)
    if missing and "adjacent" in prompt:
        area, side = Fraction(missing.group(1)), Fraction(missing.group(2))
        return area / side
    return None


def check_circle_measure(q: dict):
    prompt = q.get("prompt") or ""
    stimulus = strip_math(q.get("stimulus"))
    radius = re.search(r"radius\s+(?:of\s+)?\$?([\d.]+)\$?", stimulus)
    if not radius:
        return None
    r = Fraction(radius.group(1))
    if "sector" in prompt or "sector" in stimulus:
        angle = re.search(r"central angle of\s+\$?([\d.]+)\$?\s*\^?\s*\\?circ", stimulus)
        if not angle:
            return None
        theta = Fraction(angle.group(1))
        return theta / 360 * r * r * sp.pi
    if "area" in prompt:
        return r * r * sp.pi
    if "circumference" in prompt:
        return 2 * r * sp.pi
    if "diameter" in prompt:
        return 2 * r
    return None


def check_trig(q: dict):
    prompt = q.get("prompt") or ""
    if not re.search(r"\\(sin|cos|tan)\s*[A-Z]", prompt):
        return None
    stimulus = strip_math(q.get("stimulus"))
    sides = {}
    for name, value in re.findall(r"side\s+([A-Z]{2})\s+is\s+(\d+(?:\.\d+)?)", stimulus):
        sides[name] = Fraction(value)
    match = re.search(r"side\s+([A-Z]{2})\s+is\s+(\d+(?:\.\d+)?)", stimulus)
    if not match:
        return None
    hypotenuse = None
    for name, value in sides.items():
        if "hypotenuse" in stimulus and name in re.findall(r"hypotenuse\s+([A-Z]{2})", stimulus):
            hypotenuse = value
    if hypotenuse is None:
        return None
    function = "sin" if "sin" in prompt else "cos" if "cos" in prompt else "tan"
    leg = next((v for k, v in sides.items() if v != hypotenuse), None)
    if leg is None:
        return None
    opposite = leg
    adjacent = (hypotenuse**2 - leg**2) ** 0.5
    if function == "sin":
        return Fraction(opposite) / Fraction(hypotenuse)
    if function == "cos":
        return Fraction(adjacent).limit_denominator(1000) / Fraction(hypotenuse)
    return Fraction(opposite) / Fraction(adjacent).limit_denominator(1000)


def check_exponent_equation(q: dict):
    """2^a * 2^b / 2^c = 2^k style, solved symbolically."""
    stimulus = q.get("stimulus") or ""
    prompt = q.get("prompt") or ""
    if not re.search(r"2\s*\^", stimulus):
        return None
    match = re.match(r"^\s*What is \$(k|n|x)\$\?", prompt)
    if not match:
        return None
    eqs = equations_in(stimulus)
    if not eqs:
        return None
    left, right, op = eqs[0]
    if op != "=":
        return None
    symbol = sp.Symbol(match.group(1))
    try:
        solutions = sp.solve(sp.Eq(left, right), symbol)
    except Exception:
        return None
    real = [s for s in solutions if sp.N(s).is_real]
    if len(real) != 1:
        return None
    return as_fraction(real[0])


def check_right_triangle(q: dict):
    prompt = q.get("prompt") or ""
    stimulus = strip_math(q.get("stimulus"))
    special = re.search(r"45-45-90 right triangle has legs of length\s+(\d+(?:\.\d+)?)", stimulus)
    if special and "hypotenuse" in prompt:
        leg = Fraction(special.group(1))
        return leg * sp.sqrt(2)
    return None


VERIFIERS = [
    check_zero_is_unique,
    check_zeros_relation,
    check_vertex_form,
    check_vertex,
    check_trig_ratio,
    check_per_unit,
    check_system_constant,
    check_radius,
    check_composition,
    check_system,
    check_slope,
    check_mean_median,
    check_percent,
    check_probability,
    check_volume_area,
    check_circle_measure,
    check_trig,
    check_exponent_equation,
    check_right_triangle,
    solve_for_target_value,
    solve_equation,
]


# ---------------------------------------------------------------------------
# Structural checks
# ---------------------------------------------------------------------------


def latex_problems(*texts: str) -> str | None:
    for text in texts:
        if not text:
            continue
        if "(variant" in text.lower():
            return "leaked variant marker"
        # An escaped `\$` is a price, not a delimiter.
        if len(re.findall(r"(?<!\\)\$", text)) % 2:
            return "unbalanced $"
        if re.search(r"(?<!\\)\$\s*\d+(?:\.\d+)?\s*(?:by|to)?\s*$", text.strip()):
            return "unclosed currency"
        # Raw TeX outside any math span: "\pi r^2" in a choice, for example.
        outside = re.sub(r"\$\$?.+?\$\$?", "", text)
        if re.search(r"\\[a-zA-Z]{2,}", outside):
            return "raw TeX outside math"
        if text.count("{") != text.count("}") and "\\" in text:
            return "unbalanced braces"
    return None


def audit(questions: list[dict]) -> dict:
    findings = []
    statuses = []
    counts = Counter()
    for q in questions:
        status, detail = "unverified", None
        expected = None
        for verifier in VERIFIERS:
            try:
                result = verifier(q)
            except Exception:
                result = None
            if result is None:
                continue
            if isinstance(result, tuple):
                kind, payload = result[0], result[1:]
                if kind == "multi":
                    status, detail = "multi", ",".join(str(p) for p in payload)
                    break
                if kind == "one":
                    status = "ok" if payload[0] else "wrong"
                    detail = None
                    break
                if kind == "pair":
                    expected = ("pair", payload)
                    break
            else:
                expected = result
                break

        choices = q.get("choices") or []
        texts = [c["text"].strip() for c in choices]

        if status in ("unverified", "ok") and expected is not None:
            if isinstance(expected, tuple):
                stored = [numeric(c["text"]) for c in choices]
                wanted = (as_fraction(expected[1][0]), as_fraction(expected[1][1]))
                matching = [
                    c["id"]
                    for c, value in zip(choices, stored)
                    if value is None
                ]
                # Ordered pairs are matched by text, not by a single number.
                wanted_text = f"({sp.nsimplify(expected[1][0])}, {sp.nsimplify(expected[1][1])})"
                normalised = {
                    c["id"]: re.sub(r"[\s$]", "", c["text"]).replace("\\left", "").replace("\\right", "")
                    for c in choices
                }
                hits = [
                    cid for cid, value in normalised.items() if value == re.sub(r"[\s$]", "", wanted_text)
                ]
                if len(hits) > 1:
                    status, detail = "multi", ",".join(hits)
                elif len(hits) == 1:
                    status = "ok" if hits[0] == q.get("correct_answer") else "wrong"
                    detail = wanted_text
                else:
                    status, detail = "wrong", wanted_text
            else:
                target = as_fraction(expected)
                if target is None:
                    status = "unparsed"
                else:
                    stored = answer_value(q)
                    if stored is None:
                        # An SPR answer like `7sqrt(2)` cannot be read as one
                        # number, but its accepted decimal forms can.
                        accepted = [numeric(a) for a in (q.get("acceptable_answers") or [])]
                        if any(nearly(value, target) for value in accepted):
                            status = "ok"
                        else:
                            status, detail = "unparsed_answer", str(target)
                    elif not nearly(stored, target):
                        status, detail = "wrong", str(target)
                    else:
                        status = "ok"
                        if q.get("format") == "multiple_choice":
                            same = [cid for cid, _, value in choice_values(q) if nearly(value, target)]
                            if len(same) > 1:
                                status, detail = "multi", ",".join(same)

        if status in ("ok", "unverified"):
            if len(set(texts)) != len(texts):
                status = "duplicate"
        if status in ("ok", "unverified"):
            problem = latex_problems(q.get("stimulus"), q.get("prompt"), *texts)
            if problem:
                status, detail = "latex", problem

        counts[status] += 1
        statuses.append({"id": q["id"], "skill": q.get("skill"), "status": status})
        if status not in ("ok", "unverified"):
            findings.append(
                {
                    "id": q["id"],
                    "skill": q.get("skill"),
                    "status": status,
                    "detail": detail,
                    "prompt": (q.get("prompt") or "")[:140],
                    "answer": q.get("correct_answer"),
                }
            )
    return {"counts": dict(counts), "findings": findings, "items": statuses}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", type=Path)
    parser.add_argument("--family", help="only ids starting with this prefix")
    parser.add_argument("--ids", nargs="*", help="only these ids")
    args = parser.parse_args()

    bank = json.loads(BANK.read_text(encoding="utf-8"))
    questions = bank["questions"]
    if args.family:
        questions = [q for q in questions if q["id"].startswith(args.family)]
    if args.ids:
        wanted = set(args.ids)
        questions = [q for q in questions if q["id"] in wanted]

    result = audit(questions)
    total = max(1, len(questions))
    print(f"{len(questions)} items checked")
    for status, count in sorted(result["counts"].items(), key=lambda kv: -kv[1]):
        print(f"  {status:16s} {count:5d}  ({count / total:.1%})")

    by_skill = defaultdict(Counter)
    for finding in result["findings"]:
        by_skill[finding["skill"]][finding["status"]] += 1
    print("\nfindings by skill:")
    for skill, counter in sorted(by_skill.items(), key=lambda kv: -sum(kv[1].values())):
        detail = ", ".join(f"{k}={v}" for k, v in counter.most_common())
        print(f"  {skill:52s} {detail}")

    if args.json:
        args.json.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(f"\nreport written to {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
