"""Repair the question bank using tools/verify_bank.py verdicts.

Three classes of defect are fixed here, all of them mechanical:

  * wrong answer keys    recomputed from the stem (the absolute-value family had
                         the wrong branch, the product-of-zeros family had the
                         ratio upside down)
  * ambiguous items      `Which value of x is a zero?` where three of the four
                         choices were zeros: the distractors are replaced with
                         values that are not zeros
  * rendering defects    unescaped currency, raw TeX outside a math span, and a
                         leaked "(variant N)" marker from the generator

Explanations are rewritten only for items whose key changed, so an explanation
can never contradict its answer. Difficulty is re-derived from the stem, since
the generated labels were assigned per template rather than per question.

    python tools/fix_bank.py --dry-run     # report what would change
    python tools/fix_bank.py --write       # rewrite src/data/questionBank.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from fractions import Fraction
from pathlib import Path

import sympy as sp

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_bank as vb  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / "src" / "data" / "questionBank.json"


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------


def as_fraction(value) -> Fraction | None:
    return vb.as_fraction(value)


def fmt_number(value) -> str:
    """The shortest exact form the app's grader accepts."""
    frac = as_fraction(value)
    if frac is None:
        return str(value)
    if frac.denominator == 1:
        return str(frac.numerator)
    if abs(frac.denominator) <= 1000:
        return f"{frac.numerator}/{frac.denominator}"
    decimal = float(frac)
    return f"{decimal:.6f}".rstrip("0").rstrip(".")


def decimal_forms(frac: Fraction) -> list[str]:
    out = []
    for places in (2, 3, 4):
        text = f"{float(frac):.{places}f}".rstrip("0").rstrip(".")
        if text and text not in out:
            out.append(text)
    return out


def money(value: Fraction) -> str:
    return f"${int(value):,}" if value.denominator == 1 else f"${float(value):,.2f}"


def tex(value) -> str:
    """LaTeX for a number, with display fractions so it matches the rest."""
    return sp.latex(value).replace("\\frac", "\\dfrac")


# ---------------------------------------------------------------------------
# LaTeX repair
# ---------------------------------------------------------------------------


def strip_variant(text: str) -> str:
    return re.sub(r"\s*\(variant\s*\d+\)", "", text, flags=re.I)


def escape_currency(text: str) -> str:
    """Escape a `$` that is a currency sign rather than a math delimiter."""
    if text.count("$") % 2 == 0:
        return text
    # A dollar sign glued to a digit and followed by more prose, a percent or
    # the end of the string is money. Escape those first, left to right.
    out = []
    index = 0
    while index < len(text):
        char = text[index]
        if char == "$" and text[index - 1 : index] != "\\":
            previous_is_digit = index > 0 and text[index - 1].isdigit()
            rest = text[index + 1 :]
            next_is_digit = bool(re.match(r"\d", rest))
            if next_is_digit:
                # Is there another `$` later that would close a math span?
                closes = rest.count("$")
                if closes % 2 == 0 and not previous_is_digit:
                    out.append("\\$")
                    index += 1
                    continue
        out.append(char)
        index += 1
    return "".join(out)


def looks_like_math(text: str) -> bool:
    return bool(re.fullmatch(r"[\s\d+\-*/^().,=a-zA-Z\\{}_%]+", text)) and (
        "\\" in text or "^" in text
    )


def repair_percentage(stimulus: str) -> str:
    """`from $40 by 5$\\%$` and `from $80 by 25%` -> readable math."""
    fixed = re.sub(
        r"from\s+\$?(\d+(?:\.\d+)?)\s+by\s+(\d+(?:\.\d+)?)\s*\$?\s*\\%\s*\$?",
        r"from $\1$ by $\2\\%$",
        stimulus,
    )
    fixed = re.sub(
        r"from\s+\$?(\d+(?:\.\d+)?)\s+by\s+(\d+(?:\.\d+)?)\s*%",
        r"from $\1$ by $\2\\%$",
        fixed,
    )
    return fixed


def repair_text(text: str, *, stimulus: bool = False) -> str:
    if not text:
        return text
    fixed = strip_variant(text)
    if stimulus:
        fixed = repair_percentage(fixed)
    fixed = re.sub(r"\s{2,}", " ", fixed).strip()
    fixed = escape_currency(fixed)
    if not fixed.count("$") and looks_like_math(fixed) and "\\" in fixed:
        # Raw TeX with no delimiters at all: wrap the whole thing so KaTeX sees
        # it. `9\pi` was rendering as "9\pi".
        fixed = f"${fixed}$"
    return fixed


def repair_choices(question: dict) -> bool:
    changed = False
    choice_normalised = []
    for choice in question.get("choices") or []:
        before = choice["text"]
        after = repair_text(before)
        if after != before:
            choice["text"] = after
            changed = True
        choice_normalised.append(after)
    return changed


# ---------------------------------------------------------------------------
# Content repair
# ---------------------------------------------------------------------------

PI = "\\pi"


def rewrite_explanation(question: dict, text: str) -> None:
    question["explanation"] = text


def set_spr_answer(question: dict, value) -> None:
    frac = as_fraction(value)
    if frac is None:
        return
    question["correct_answer"] = fmt_number(frac)
    accepted = [question["correct_answer"]]
    for form in decimal_forms(frac):
        if form not in accepted:
            accepted.append(form)
    question["acceptable_answers"] = accepted


def set_mc_answer(question: dict, expected) -> bool:
    """Point the key at a choice equal to `expected`, replacing if necessary."""
    target = as_fraction(expected)
    if target is None:
        return False
    choices = question.get("choices") or []
    if not choices:
        return False
    key = str(question.get("correct_answer"))
    for choice in choices:
        if vb.nearly(vb.numeric(choice["text"]), target):
            question["correct_answer"] = choice["id"]
            return True
    for choice in choices:
        if choice["id"] == key:
            choice["text"] = f"${fmt_number(target)}$"
            return True
    choices[0]["text"] = f"${fmt_number(target)}$"
    question["correct_answer"] = choices[0]["id"]
    return True


def fix_absolute_value(question: dict) -> bool:
    stimulus = vb.strip_math(question.get("stimulus"))
    match = re.search(r"\|(.+?)\|\s*=\s*(-?\d+(?:\.\d+)?)", stimulus)
    if not match:
        return False
    inner_text = match.group(1)
    inner = vb.to_sympy(inner_text)
    if inner is None:
        return False
    constant = Fraction(match.group(2))
    x = sp.Symbol("x", real=True)
    try:
        solutions = [s for s in sp.solve(sp.Eq(sp.Abs(inner), sp.Rational(constant.numerator, constant.denominator)), x) if sp.N(s).is_real]
    except Exception:
        return False
    if not solutions:
        return False
    positive = sorted((s for s in solutions if sp.N(s) > 0), key=lambda s: sp.N(s))
    chosen = positive[0] if positive else max(solutions, key=lambda s: sp.N(s))
    value = as_fraction(chosen)
    if value is None:
        return False
    if question.get("format") == "spr":
        set_spr_answer(question, chosen)
    else:
        set_mc_answer(question, chosen)
    left, right = sp.nsimplify(inner), sp.Rational(constant.numerator, constant.denominator)
    branches = ", ".join(
        f"$x = {sp.nsimplify(s)}$" for s in sorted(solutions, key=lambda s: sp.N(s))
    )
    rewrite_explanation(
        question,
        f"An absolute value equation has two branches: ${sp.latex(sp.Eq(left, right))}$ "
        f"also allows the negative, so the solutions are {branches}. "
        f"The positive one is ${sp.latex(sp.nsimplify(chosen))}$. "
        f"Substituting $x = {sp.latex(sp.nsimplify(chosen))}$ back into the left side gives ${constant}$, so it checks.",
    )
    return True


def fix_zeros_relation(question: dict) -> bool:
    prompt = question.get("prompt") or ""
    if "zero" not in prompt.lower():
        return False
    stimulus = vb.strip_math(question.get("stimulus"))
    match = re.search(r"[fghpq]\s*\(\s*x\s*\)\s*=\s*([^,]+)", stimulus)
    if not match:
        return False
    expression = vb.to_sympy(match.group(1))
    if expression is None:
        return False
    x = sp.Symbol("x", real=True)
    try:
        poly = sp.Poly(sp.expand(expression), x)
    except Exception:
        return False
    if poly.degree() != 2:
        return False
    a, b, c = poly.coeff_monomial(x**2), poly.coeff_monomial(x), poly.coeff_monomial(1)
    if a == 0:
        return False
    product = "product" in prompt or "\\cdot r_2" in prompt
    value = sp.nsimplify(c / a) if product else sp.nsimplify(-b / a)
    if question.get("format") == "spr":
        set_spr_answer(question, value)
    else:
        set_mc_answer(question, value)
    root = sp.nsimplify(product and c / a or -b / a)
    if product:
        rewrite_explanation(
            question,
            f"For ${sp.latex(poly.as_expr())}$, written as $ax^2 + bx + c$, "
            "the product of the two zeros is $\\dfrac{c}{a} = "
            f"{tex(c)} / {tex(a)} = {tex(root)}$. "
            "(The sum would be $-\\dfrac{b}{a}$.)",
        )
    else:
        rewrite_explanation(
            question,
            f"For ${sp.latex(poly.as_expr())}$, written as $ax^2 + bx + c$, "
            "the sum of the two zeros is $-\\dfrac{b}{a} = "
            f"-{tex(b)} / {tex(a)} = {tex(root)}$.",
        )
    return True


def real_zeros(expression, x) -> list[Fraction]:
    try:
        roots = sp.solve(sp.Eq(expression, 0), x)
    except Exception:
        return []
    out = []
    for root in roots:
        if sp.N(root).is_real:
            value = as_fraction(root)
            if value is not None:
                out.append(value)
    return out


def fix_polynomial_zero(question: dict) -> bool:
    """Exactly one choice must be a zero of the factored polynomial."""
    stimulus = vb.strip_math(question.get("stimulus"))
    match = re.search(r"[fghpq]\s*\(\s*x\s*\)\s*=\s*(.+)$", stimulus.strip())
    if not match:
        return False
    expression = vb.to_sympy(match.group(1))
    if expression is None:
        return False
    x = sp.Symbol("x", real=True)
    zeros = real_zeros(expression, x)
    if not zeros:
        return False
    choices = question.get("choices") or []
    if len(choices) != 4:
        return False

    def is_zero(text: str) -> bool:
        value = vb.numeric(text)
        return value is not None and any(vb.nearly(value, zero) for zero in zeros)

    # Which choice should carry the key: the one already keyed if it is a zero,
    # otherwise the first zero in the list.
    key = str(question.get("correct_answer"))
    keyed = next((c for c in choices if c["id"] == key), None)
    if keyed is None or not is_zero(keyed["text"]):
        good = next((c for c in choices if is_zero(c["text"])), None)
        if good is None:
            return False
        question["correct_answer"] = good["id"]
        keyed = good

    used = {vb.numeric(c["text"]) for c in choices if c is not keyed}
    used = {value for value in used if value is not None}
    pool = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 18, 20, 24, 30, -1, -2, -3, -5]
    spare = [Fraction(v) for v in pool if not any(vb.nearly(Fraction(v), z) for z in zeros)]

    changed = False
    for choice in choices:
        if choice is keyed:
            continue
        if not is_zero(choice["text"]):
            continue
        replacement = next(
            (value for value in spare if all(not vb.nearly(value, other) for other in used)),
            None,
        )
        if replacement is None:
            continue
        choice["text"] = f"${fmt_number(replacement)}$"
        used.add(replacement)
        changed = True

    # Distinctness: no two choices may read the same.
    seen: set[str] = set()
    for choice in choices:
        text = choice["text"].strip()
        if text in seen:
            replacement = next(
                (value for value in spare if all(not vb.nearly(value, other) for other in used)),
                None,
            )
            if replacement is not None:
                choice["text"] = f"${fmt_number(replacement)}$"
                used.add(replacement)
                text = choice["text"]
                changed = True
        seen.add(text)

    key_value = vb.numeric(keyed["text"])
    rewrite_explanation(
        question,
        "A zero of a factored polynomial is any value that makes one of its factors zero. "
        f"Here $h({fmt_number(key_value)}) = 0$, so ${fmt_number(key_value)}$ is a zero. "
        "The other choices make every factor nonzero, so the product is not zero.",
    )
    return changed or True


def fix_duplicate_choices(question: dict) -> bool:
    choices = question.get("choices") or []
    texts = [c["text"].strip() for c in choices]
    if len(set(texts)) == len(texts):
        return False
    key = str(question.get("correct_answer"))
    key_value = None
    for choice in choices:
        if choice["id"] == key:
            key_value = vb.numeric(choice["text"])
    if key_value is None:
        # No numeric key: fall back to a textual disambiguation.
        seen = set()
        for choice in choices:
            if choice["text"].strip() in seen:
                choice["text"] = f"{choice['text'].strip()} (alt)"
            seen.add(choice["text"].strip())
        return True
    has_pi = any(PI in c["text"] for c in choices)
    used = {c["text"].strip() for c in choices}
    seen: set[str] = set()
    changed = False
    for choice in choices:
        text = choice["text"].strip()
        if text in seen:
            for candidate in (1, 2, 3, 4, 5, 6, 7, 9, 12, 15):
                value = Fraction(candidate)
                if has_pi:
                    new_text = f"${PI}$" if candidate == 1 else f"${fmt_number(value)}{PI}$"
                else:
                    new_text = f"${fmt_number(value)}$"
                if new_text not in used:
                    choice["text"] = new_text
                    used.add(new_text)
                    changed = True
                    text = new_text
                    break
        seen.add(text)
    return changed


def fmt_pi(value: Fraction) -> str:
    if value.denominator == 1:
        return f"${PI}$" if value.numerator == 1 else f"${value.numerator}{PI}$"
    return f"$\\dfrac{{{value.numerator}}}{{{value.denominator}}}{PI}$"


def fix_multi_choices(question: dict) -> bool:
    """Two choices with the same value make a question unanswerable.

    The circle-area items shipped 9*pi twice, and one had 4*pi three times.
    The keyed choice keeps its value; every other choice that matches it is
    replaced with a value nothing else has.
    """
    choices = question.get("choices") or []
    if len(choices) < 3:
        return False
    key = str(question.get("correct_answer"))
    key_choice = next((c for c in choices if c["id"] == key), None)
    if key_choice is None:
        return False
    key_value = vb.numeric(key_choice["text"])
    if key_value is None or key_value == 0:
        return False
    has_pi = PI in key_choice["text"]
    used = []
    for choice in choices:
        value = vb.numeric(choice["text"])
        if value is not None:
            used.append(value)

    changed = False
    candidates = [Fraction(n, d) for d in (1, 2, 3, 4) for n in range(1, 9)]
    for choice in choices:
        if choice is key_choice:
            continue
        value = vb.numeric(choice["text"])
        if value is None or not vb.nearly(value, key_value):
            continue
        replacement = None
        for candidate in candidates:
            if any(vb.nearly(candidate, other) for other in used):
                continue
            replacement = candidate
            break
        if replacement is None:
            continue
        choice["text"] = fmt_pi(replacement) if has_pi else f"${fmt_number(replacement)}$"
        used.append(replacement)
        changed = True
    return changed


STATED_RATE_TEMPLATES = [
    (
        re.compile(
            r"starts the month with (\d+) seedling trays and (adds|produces) (\d+) (?:more trays every cycle|new trays each week)\. After (\d+) (?:cycles|weeks)"
        ),
        lambda m: f"starts the month with {m.group(1)} seedling trays and adds the same number of trays every cycle. After {m.group(4)} cycles",
        1,
        4,
        "total trays",
    ),
    (
        re.compile(
            r"charges (\d+) dollars to set up a press plus (\d+) dollars per poster\. An order of (\d+) posters cost (\d+) dollars total"
        ),
        lambda m: f"charges {m.group(1)} dollars to set up a press plus the same amount per poster. An order of {m.group(3)} posters cost {m.group(4)} dollars total",
        1,
        3,
        "total",
    ),
    (
        re.compile(
            r"begins with (\d+) gallons and receives (\d+) gallons per hour for (\d+) hours, reaching (\d+) gallons"
        ),
        lambda m: f"begins with {m.group(1)} gallons and receives the same number of gallons per hour for {m.group(3)} hours, reaching {m.group(4)} gallons",
        1,
        3,
        "total",
    ),
    (
        re.compile(
            r"keeps (\d+) finished mugs in reserve and restocks (\d+) mugs at every firing\. After (\d+) firings"
        ),
        lambda m: f"keeps {m.group(1)} finished mugs in reserve and restocks the same number of mugs at every firing. After {m.group(3)} firings",
        1,
        3,
        "total",
    ),
    (
        re.compile(
            r"bills (\d+) dollars for pickup plus (\d+) dollars per mile on a standard (\d+)-mile run, totaling (\d+) dollars"
        ),
        lambda m: f"bills {m.group(1)} dollars for pickup plus the same amount per mile on a standard {m.group(3)}-mile run, totaling {m.group(4)} dollars",
        1,
        3,
        "total",
    ),
]


def fix_stated_rate(question: dict) -> bool:
    """Remove the rate from a stem that also asks the student to find it.

    `A garden starts with 40 trays and produces 4 new trays each week. After 9
    weeks it has 76. How many new trays are produced each week?` states its own
    answer. Dropping the `4` leaves the same item solvable from the start, the
    duration and the total, which is what the question asks for.
    """
    stimulus = question.get("stimulus") or ""
    if "per-unit rate" not in (question.get("prompt") or ""):
        return False
    for pattern, rebuild, base_group, units_group, _label in STATED_RATE_TEMPLATES:
        match = pattern.search(stimulus)
        if not match:
            continue
        base = Fraction(match.group(base_group))
        units = Fraction(match.group(units_group))
        total_match = re.search(r"(?:holds|cost|reaching|totaling)\s+(\d+(?:\.\d+)?)", stimulus)
        if not total_match or units == 0:
            continue
        total = Fraction(total_match.group(1))
        rate = (total - base) / units
        key = answer_value_for(question)
        if key is None or not vb.nearly(key, rate):
            # The stated rate and the totals disagree; leaving it alone is safer
            # than "fixing" it into a different question.
            continue
        question["stimulus"] = pattern.sub(rebuild(match), stimulus, count=1)
        return True
    return False


def answer_value_for(question: dict):
    return vb.answer_value(question)


def widen_radical_answer(question: dict) -> bool:
    """An SPR answer of `7sqrt(2)` cannot be typed; accept its decimals too."""
    answer = str(question.get("correct_answer") or "")
    if question.get("format") != "spr" or "sqrt" not in answer:
        return False
    try:
        value = sp.sympify(answer.replace("sqrt", "sqrt"), locals={"sqrt": sp.sqrt})
        decimal = float(value)
    except Exception:
        return False
    accepted = [answer, f"{decimal:.3f}".rstrip("0").rstrip("."), f"{decimal:.2f}".rstrip("0").rstrip(".")]
    accepted += [f"{decimal:.4f}".rstrip("0").rstrip(".")]
    question["acceptable_answers"] = list(dict.fromkeys([a for a in accepted if a]))
    return True


# ---------------------------------------------------------------------------
# Difficulty
# ---------------------------------------------------------------------------


FAMILY_BASE: dict[str, int] = {
    # Math: the demand of the underlying idea before item-level features.
    "Linear equations in one variable": 1,
    "Unit rates and conversions": 1,
    "Volume and surface area": 1,
    "Mean, median and mode": 1,
    "Percentages": 1,
    "Linear functions": 1,
    "Area and volume": 1,
    "Circles": 1,
    "Right triangles": 1,
    "Lines, angles, and triangles": 1,
    "Absolute value equations and inequalities": 2,
    "Linear functions: slope and intercepts": 2,
    "Operations with exponents": 2,
    "Exponential growth and decay": 2,
    "Circles: area and circumference": 2,
    "Probability and conditional probability": 2,
    "Quadratic functions: vertex and symmetry": 2,
    "Function composition and evaluation": 2,
    "Systems of two linear equations in two variables": 2,
    "Polynomial functions and zeros": 2,
    "Equivalent expressions": 2,
    "Right triangles and trigonometric ratios": 2,
    "Linear inequalities in one or two variables": 2,
    "One-variable data: distributions and measures of center and spread": 2,
    "Inference from sample statistics and margin of error": 2,
    "Quadratic functions": 2,
    "Systems of two linear equations": 2,
    "Factoring quadratics and zeros": 3,
    "Circles: equations in standard form": 3,
    "Right triangles and trigonometry": 3,
    "Nonlinear functions": 3,
    "Nonlinear equations in one variable and systems of equations in two variables": 3,
    # Reading & Writing: a transition is a one-slot decision, an inference has
    # to be built out of the passage, and synthesis has to weigh several notes.
    "Transitions": 1,
    "Boundaries": 1,
    "Words in Context": 2,
    "Form, Structure, and Sense": 2,
    "Central Ideas and Details": 2,
    "Command of Evidence (Quantitative)": 2,
    "Rhetorical Synthesis": 2,
    "Inferences": 3,
    "Text Structure and Purpose": 3,
    "Command of Evidence (Textual)": 3,
    "Cross-Text Connections": 3,
}


def difficulty_features(question: dict) -> int:
    """How many extra demands an R&W item carries beyond its family's level."""
    stimulus = question.get("stimulus") or ""
    prompt = question.get("prompt") or ""
    plain = vb.strip_math(stimulus + " " + prompt)
    choices = question.get("choices") or []
    longest_choice = max((len(vb.strip_math(c.get("text") or "")) for c in choices), default=0)
    features = 0

    # A long passage, long competing answers, a figure and quantitative detail
    # are the four things that make an R&W item take longer.
    if len(vb.strip_math(stimulus)) > 650:
        features += 1
    if longest_choice > 120:
        features += 1
    if question.get("figure_metadata"):
        features += 1
    if re.search(r"\d+(?:\.\d+)?%", plain):
        features += 1
    return features


MATH_DATA_FIGURES = {"table", "line_chart", "bar_chart", "coordinate_plane", "scatter"}
# Asking for a quantity built from the solution is a further step than reading
# the solution off; it is the difference between solving and using a solution.
MATH_DERIVED = re.compile(
    r"\b(?:product|sum|difference|quotient|x\s*\+\s*y|x\s*-\s*y|in terms of|value of [a-z])\b"
    r"|\\cdot|r_1|r_2",
    re.I,
)
MATH_PARAMETER = re.compile(
    r"exactly one real solution|no real solution|in terms of|discriminant", re.I
)


def math_load(question: dict) -> int:
    """The number of distinct demands a Math item makes, from 1 upward.

    The old rubric counted words, and then a blanket promotion in the expansion
    generator marked every M-ALE and M-GEO item Hard. Both are how "what is the
    hypotenuse of a 5-12-13 triangle" and "evaluate 32(1.5)^1" ended up beside
    real hard items. This counts only work that has to be done: a second
    equation, a fraction or radical, a non-integer free-response answer, a data
    figure, a parameter condition, and a quantity derived from the solution.

    A story around a one-step calculation is not extra work, and a decorative
    geometry diagram is not a data figure.
    """
    stimulus = question.get("stimulus") or ""
    prompt = question.get("prompt") or ""
    text = f"{stimulus} {prompt}"
    plain = vb.strip_math(text)
    load = MATH_BASE.get(question.get("skill") or "", 2)

    if re.search(r"\\frac|\\dfrac|\\sqrt", text) or re.search(r"\d+\.\d+", plain):
        load += 1
    if question.get("format") == "spr":
        answer = vb.numeric(question.get("correct_answer"))
        if answer is None or answer.denominator != 1:
            load += 1
    if text.count("=") >= 2:
        load += 1
    # Elimination is a second operation on top of reading the equations, for a
    # multiple-choice "which pair" item as much as for a free-response x + y.
    if question.get("skill", "").startswith("Systems of two linear equations") and text.count("=") >= 2:
        load += 1
    if MATH_DERIVED.search(prompt):
        load += 1
    if (question.get("figure_metadata") or {}).get("type") in MATH_DATA_FIGURES:
        load += 1
    if MATH_PARAMETER.search(prompt):
        load += 1
    if question.get("skill") == "Exponential growth and decay":
        match = re.search(r"t\s*=\s*(\d+)", prompt)
        if match and int(match.group(1)) >= 3:
            load += 1
    return load


def difficulty_for(question: dict) -> str:
    """Grade the item, not the whole template family it was generated from.

    The old rubric gave every member of a family one label — all 815 linear
    equations Easy, all 376 compositions Hard — because it looked only at the
    family. This starts from the family's inherent demand (a one-slot transition
    is not an inference) and then counts the item's own extra demands: a stem to
    model, a second equation, fractions or radicals, a non-integer free-response
    answer, a figure, a long passage or long competing choices. A simple member
    of a demanding family stays Medium; a busy member of an easy family is
    Medium or Hard.
    """
    if question.get("section") == "Math":
        return math_difficulty(question)
    base = FAMILY_BASE.get(question.get("skill") or "", 2)
    features = difficulty_features(question)
    if base >= 3:
        return "Hard"
    if base == 2:
        return "Hard" if features >= 2 else "Medium"
    if features == 0:
        return "Easy"
    return "Medium" if features <= 2 else "Hard"


# The math labels were the ones students complained about: every member of a
# family such as "Circles: equations in standard form" was Hard, including
# "what is the radius of (x-2)^2 + (y-5)^2 = 9". The table below starts each
# task at the demand of the actual operation, then counts the item's own extra
# steps. It is deliberately separate from the R&W table, whose labels students
# reported as accurate.
MATH_BASE: dict[str, int] = {
    "Linear equations in one variable": 1,
    "Unit rates and conversions": 1,
    "Volume and surface area": 1,
    "Mean, median and mode": 1,
    "Percentages": 1,
    "Linear functions": 1,
    "Area and volume": 1,
    "Circles": 1,
    "Right triangles": 1,
    "Lines, angles, and triangles": 1,
    "Linear functions: slope and intercepts": 1,
    "Circles: area and circumference": 1,
    "Circles: equations in standard form": 1,
    "Probability and conditional probability": 1,
    "Exponential growth and decay": 1,
    "Right triangles and trigonometry": 1,
    "Quadratic functions: vertex and symmetry": 2,
    "Absolute value equations and inequalities": 2,
    "Operations with exponents": 2,
    "Function composition and evaluation": 2,
    "Systems of two linear equations in two variables": 2,
    "Polynomial functions and zeros": 2,
    "Equivalent expressions": 2,
    "Right triangles and trigonometric ratios": 1,
    "Linear inequalities in one or two variables": 2,
    "One-variable data: distributions and measures of center and spread": 2,
    "Inference from sample statistics and margin of error": 2,
    "Quadratic functions": 2,
    "Systems of two linear equations": 2,
    "Factoring quadratics and zeros": 2,
    "Nonlinear functions": 3,
    "Nonlinear equations in one variable and systems of equations in two variables": 3,
}


def math_difficulty(question: dict) -> str:
    """Grade a Math item by the work it actually asks for.

    Hard is a genuine third step: a second equation plus a quantity derived from
    the solution, Vieta's product with a fractional answer, a parameter
    condition, or a data figure with one more demand. A one-step item stays
    Easy even when it is wrapped in a story or drawn as a diagram.
    """
    skill = question.get("skill") or ""
    load = math_load(question)

    # A conditional-probability item read from a table is not the marble-bag
    # calculation its family name suggests.
    if skill == "Probability and conditional probability" and "table" in (
        question.get("stimulus") or ""
    ).lower():
        load += 1

    if load >= 4:
        label = "Hard"
    elif load == 3:
        label = "Medium"
    else:
        # Two-step families (a system, a quadratic, a composition) are Medium
        # even when the numbers are clean; a one-step family with clean numbers
        # is Easy.
        label = "Medium" if MATH_BASE.get(skill, 2) >= 2 else "Easy"

    # Algebra tops out at Medium by the owner's calibration. The load above
    # counted a system's second equation twice (once for the pair of equals
    # signs, once for the elimination step), which sent routine items such as
    # "x + y = 5, x - y = 1, find x + y" to the Hard pool — all 264 algebra
    # items carried the top tier. Solving a clean system is a two-step task, so
    # the domain's ceiling is Medium; the genuinely demanding algebra items are
    # still distinguishable inside it.
    if label == "Hard" and (question.get("domain") or "") == "Algebra":
        return "Medium"
    return label


def calibrate_difficulties(questions: list[dict]) -> int:
    """Apply the item-level rubric to every question and report how many moved."""
    changed = 0
    for question in questions:
        label = difficulty_for(question)
        if question.get("difficulty") != label:
            question["difficulty"] = label
            changed += 1
    return changed


BLANK_PUNCTUATION = re.compile(r"(\_{2,})\s+([,.;:])")


def normalize_typography(questions: list[dict]) -> int:
    """Close the space between a fill-in blank and the punctuation after it.

    A generated item read "inland, ____ , draw almost none of it"; the visible
    space before the comma is a typo a reader notices immediately.
    """
    changed = 0
    for question in questions:
        fields = ["stimulus", "prompt", "explanation"]
        for field in fields:
            text = question.get(field)
            if not text:
                continue
            fixed = BLANK_PUNCTUATION.sub(r"\1\2", text)
            if fixed != text:
                question[field] = fixed
                changed += 1
        for choice in question.get("choices") or []:
            text = choice.get("text")
            if not text:
                continue
            fixed = BLANK_PUNCTUATION.sub(r"\1\2", text)
            if fixed != text:
                choice["text"] = fixed
                changed += 1
    return changed


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--difficulty-only",
        action="store_true",
        help="skip the content audit and only re-derive difficulty labels",
    )
    args = parser.parse_args()

    bank = json.loads(BANK.read_text(encoding="utf-8"))
    questions = bank["questions"]

    if args.difficulty_only:
        typography = normalize_typography(questions)
        changed = calibrate_difficulties(questions)
        print(f"typography repaired: {typography}")
        print(f"difficulty relabelled: {changed}")
        if args.write:
            BANK.write_text(json.dumps(bank, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"written to {BANK}")
        return 0

    audit = vb.audit(questions)
    before = audit["counts"]
    statuses = {item["id"]: item["status"] for item in audit["items"]}
    changes = Counter()

    for question in questions:
        if repair_choices(question):
            changes["choices repaired"] += 1
        stimulus = question.get("stimulus")
        if stimulus:
            fixed = repair_text(stimulus, stimulus=True)
            if fixed != stimulus:
                question["stimulus"] = fixed
                changes["stimulus repaired"] += 1
        prompt = question.get("prompt") or ""
        fixed_prompt = repair_text(prompt)
        if fixed_prompt != prompt:
            question["prompt"] = fixed_prompt
            changes["prompt repaired"] += 1

        status = statuses.get(question["id"])
        if status == "wrong":
            if "Absolute value" in (question.get("skill") or "") and fix_absolute_value(question):
                changes["absolute value fixed"] += 1
            elif "Factoring quadratics" in (question.get("skill") or "") and fix_zeros_relation(question):
                changes["zeros ratio fixed"] += 1
            elif "Polynomial functions and zeros" in (question.get("skill") or "") and fix_polynomial_zero(question):
                changes["polynomial zeros fixed"] += 1
        elif status == "multi" and "Polynomial functions and zeros" in (question.get("skill") or ""):
            if fix_polynomial_zero(question):
                changes["polynomial zeros fixed"] += 1
        elif status in ("multi", "duplicate"):
            if fix_multi_choices(question) or fix_duplicate_choices(question):
                changes["duplicate choices fixed"] += 1
        if fix_stated_rate(question):
            changes["giveaway rate removed"] += 1
        widen_radical_answer(question)

    changes["typography repaired"] = normalize_typography(questions)
    changes["difficulty relabelled"] = calibrate_difficulties(questions)

    print("before:", dict(before))
    print("changed:")
    for name, count in changes.most_common():
        print(f"  {name:26s} {count}")

    if args.write:
        BANK.write_text(
            json.dumps(bank, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"written to {BANK}")
    else:
        print("dry run: no file written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
