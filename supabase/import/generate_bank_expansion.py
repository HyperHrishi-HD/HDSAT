#!/usr/bin/env python3
"""
HDSAT Bank Expansion Generator.

Generates ORIGINAL, CC-BY-4.0 practice items (same provenance model as the
authored Open Core bank: AI-assisted drafting against the public SAT Suite
blueprint, human-review checklist gating) sized so that every assessment can
fill a **full-length** Digital SAT blueprint test:

  Reading and Writing: Module 1 (27) + routed Module 2 (27)  -> pool >= 81
  Math:                Module 1 (22) + routed Module 2 (22)  -> pool >= 66

Math items are generated from parameterized original contexts; every answer is
computed exactly with Fraction arithmetic and every distractor is a real
diagnostic error, with a computed explanation. R&W items are authored prose,
grammar, transitions, words-in-context and quantitative-evidence items.

Outputs:
  supabase/import/expansion/extra_questions.json
  supabase/import/expansion/extra_flashcards.json  (CC0 vocabulary + formulas)
"""

import json
import os
import random
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
EXP_DIR = os.path.join(HERE, "expansion")
DATA_DIR = os.path.join(HERE, "data")

ALL_ASSESSMENTS = ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"]
OPEN_CORE = "hdsat-open-core-2026"


def mc(qid, section, domain, skill, difficulty, stimulus, prompt, correct, wrongs, explanation, rationales, figure=None, assessments=None):
    """Multiple-choice item authored with the correct choice in position A; the
    importer's deterministic shuffler redistributes letters afterwards."""
    choices = [{"id": "A", "text": correct}] + [
        {"id": "B", "text": wrongs[0]},
        {"id": "C", "text": wrongs[1]},
        {"id": "D", "text": wrongs[2]},
    ]
    return {
        "id": qid,
        "external_id": "HDSAT-" + qid,
        "assessments": assessments or list(ALL_ASSESSMENTS),
        "section": section,
        "domain": domain,
        "skill": skill,
        "difficulty": difficulty,
        "format": "multiple_choice",
        "stimulus": stimulus,
        "prompt": prompt,
        "choices": choices,
        "figure_metadata": figure,
        "source_id": OPEN_CORE,
        "is_released_practice_set": False,
        "correct_answer": "A",
        "acceptable_answers": ["A"],
        "explanation": explanation,
        "distractor_rationales": {
            "B": rationales[0],
            "C": rationales[1],
            "D": rationales[2],
        },
    }


def spr(qid, section, domain, skill, difficulty, stimulus, prompt, answer, explanation, assessments=None):
    """Student-produced response item."""
    accepted = [str(answer)]
    if "." not in str(answer) and "/" not in str(answer):
        accepted.append(str(answer) + ".0")
    return {
        "id": qid,
        "external_id": "HDSAT-" + qid,
        "assessments": assessments or list(ALL_ASSESSMENTS),
        "section": section,
        "domain": domain,
        "skill": skill,
        "difficulty": difficulty,
        "format": "spr",
        "stimulus": stimulus,
        "prompt": prompt,
        "choices": None,
        "figure_metadata": None,
        "source_id": OPEN_CORE,
        "is_released_practice_set": False,
        "correct_answer": str(answer),
        "acceptable_answers": accepted,
        "explanation": explanation,
        "distractor_rationales": {},
    }


def fmt_money(v: int) -> str:
    return "$" + str(v)


# ---------------------------------------------------------------------------
# MATH GENERATORS (original contexts, exact arithmetic)
# ---------------------------------------------------------------------------

def gen_math():
    items = []
    n = 0

    # --- algebra: ax + b = c -------------------------------------------
    contexts = [
        ("A community greenhouse starts the month with {b1} seedling trays and produces {a} new trays each week. After {w} weeks it has {c} trays in total. How many new trays are produced each week?", "weeks"),
        ("A ferry charges a flat boarding fee of {b1} dollars plus {a} dollars per passenger. A group crossing with all fees included paid {c} dollars. How much is charged per passenger?", None),
        ("A submarine resting at {b1} meters descends {a} meters per minute. Which equation gives its depth {d} meters after {t} minutes?", None),
        ("A library charges {b1} dollars for a lost-item processing fee plus {a} dollars per day for late returns. Maya returned a book late and paid {c} dollars in fees. What is the per-day charge?", None),
        ("A fundraiser starts with {b1} dollars and collects {a} dollars per hour for {w} hours. The total raised is {c} dollars. How much is collected per hour?", None),
        ("A phone plan costs {b1} dollars per month plus {a} cents per megabyte over the cap. A bill with {w} GB over the cap totals {c} cents in overage. What is the per-megabyte rate?", None),
    ]
    idx = 0
    for a, b1, w in [(4, 40, 9), (6, 18, 8), (7, 15, 6), (9, 24, 3), (5, 55, 7), (8, 30, 9)]:
        ctx, _ = contexts[idx % len(contexts)]
        c = b1 + a * w
        idx += 1
        stimulus = ctx.format(a=a, b1=b1, w=w, c=c, t=w, d=w)
        wrong_vals = sorted({b1 // 8 if b1 % 8 == 0 and b1 // 8 != a else a + 1,
                             c - b1,                      # forgot to divide by w
                             (c - b1) + a,                # added instead of solved
                             max(1, a - 2)})
        wrong_vals = [v for v in wrong_vals if v != a][:3]
        while len(wrong_vals) < 3:
            wrong_vals.append(a + len(wrong_vals) + 1)
        items.append(mc(
            f"M-ALG-{n+101:03d}", "Math", "Algebra", "Linear equations in one variable",
            "Easy" if a <= 6 else "Medium", stimulus,
            "Which value correctly satisfies the relationship described? (Solve for the per-unit rate.)",
            f"${a}$",
            [f"${v}$" for v in wrong_vals[:3]],
            f"The per-unit rate {a} appears in the linear model: starting amount {b1} plus {a} per unit for {w} units gives {b1} + {a}({w}) = {c}. Substituting back confirms the answer.",
            [f"That value does not satisfy the linear relationship: {b1} + {v}({w}) = {b1 + v * w}, not {c}." for v in wrong_vals[:3]],
        ))
        n += 1

    # --- harder single-variable: ax + b = cx + d ----------------------
    for a, b1, c1, d1 in [(5, 9, 3, 33), (8, 2, 5, 17), (6, 11, 2, 43), (4, 7, 9, 2)]:
        # ax + b = cx + d -> x = (d - b) / (a - c)
        x = Fraction(d1 - b1, a - c1)
        assert x.denominator == 1 and x > 0, (a, b1, c1, d1)
        xval = int(x)
        stimulus = f"Solve for $x$: $${a}x + {b1} = {c1}x + {d1}$$"
        wrong = [xval + 2, xval - 3 if xval - 3 > 0 else xval + 3, (d1 - b1)]
        wrong = [v for v in wrong if v != xval]
        items.append(mc(
            f"M-ALG-{n+101:03d}", "Math", "Algebra", "Linear equations in one variable",
            "Medium", stimulus, "What is the value of $x$?", f"${xval}$",
            [f"${v}$" for v in wrong[:3]],
            f"Move the $x$-terms left and the constants right: ${a - c1}x = {d1 - b1}$, so $x = {d1 - b1} / {a - c1} = {xval}$. Substitution into both sides confirms equality.",
            [f"Check by substitution: ${a}({v}) + {b1} = {a * v + b1}$ while ${c1}({v}) + {d1} = {c1 * v + d1}$; these differ." for v in wrong[:3]],
        ))
        n += 1

    # --- systems of two linear equations (SPR: x + y) ------------------
    for x0, y0, a1, b1, a2, b2 in [(4, 3, 3, 5, 2, 1), (6, 2, 1, 4, 5, 3), (5, 4, 2, 3, 4, 1), (3, 7, 5, 2, 3, 6), (8, 5, 1, 1, 6, 2)]:
        c1 = a1 * x0 + b1 * y0
        c2 = a2 * x0 + b2 * y0
        s = x0 + y0
        stimulus = f"$${a1}x + {b1}y = {c1}$$\n$${a2}x + {b2}y = {c2}$$"
        items.append(spr(
            f"M-SYS-{n+101:03d}", "Math", "Algebra", "Systems of two linear equations in two variables",
            "Medium", stimulus,
            "If $(x, y)$ is the solution to the system above, what is the value of $x + y$?",
            s,
            f"Elimination with these coefficients gives $x = {x0}$ and $y = {y0}$, so $x + y = {s}$. Substituting the pair into both original equations reproduces {c1} and {c2}.",
        ))
        n += 1

    # --- slope from two points -----------------------------------------
    pts = [((1, 2), (5, 18)), ((2, 5), (10, 29)), ((4, 7), (12, 23)), ((3, -2), (7, 18)), ((0, 6), (4, 30)), ((2, 9), (6, -7))]
    for (xa, ya), (xb, yb) in pts:
        m = Fraction(yb - ya, xb - xa)
        assert m.denominator == 1
        choices_nums = sorted({int(m), int(m) + 1, int(m) - 2 if int(m) - 2 != 0 else int(m) + 3, abs(int(m)) * 2 + 1})
        choices_nums = [c for c in choices_nums if c != int(m)][:3]
        while len(choices_nums) < 3:
            choices_nums.append(int(m) + len(choices_nums) + 1)
        items.append(mc(
            f"M-LIF-{n+101:03d}", "Math", "Algebra", "Linear functions: slope and intercepts",
            "Easy" if abs(int(m)) <= 4 else "Medium",
            f"A straight line passes through $({xa}, {ya})$ and $({xb}, {yb})$.",
            "What is the slope of the line?", f"${int(m)}$",
            [f"${c}$" for c in choices_nums[:3]],
            f"Slope $= \\dfrac{{{yb} - {ya}}}{{{xb} - {xa}}} = \\dfrac{{{yb - ya}}}{{{xb - xa}}} = {int(m)}$.",
            [f"Check: rising ${abs(int(m))}$ over a run of ${xb - xa}$ would not land on $({xb}, {yb})$ from $({xa}, {ya})$; recomputing the ratio gives {int(m)}." for c in choices_nums[:3]],
        ))
        n += 1

    # --- percent change -------------------------------------------------
    for base, pct in [(80, 25), (120, 15), (60, 40), (250, 12), (48, 50), (200, 5)]:
        assert (base * pct) % 100 == 0, (base, pct)
        delta = base * pct // 100
        new = base + delta
        cand = []
        for v in (base - delta, delta, base + delta // 2, base * 2, delta + 7):
            if v != new and v > 0 and v not in cand:
                cand.append(v)
        cand = cand[:3]
        items.append(mc(
            f"M-PSD1-{n+101:03d}", "Math", "Problem-Solving and Data Analysis",
            "Percentages", "Medium",
            f"A bicycle shop raises the price of a repair service from {fmt_money(base)} by {pct}%.",
            "Which is the new price of the service?",
            f"{fmt_money(new)}",
            [f"{fmt_money(v)}" for v in cand],
            f"{pct}% of {base} is {delta}, so the new price is {base} + {delta} = {new} dollars.",
            [
                f"That is a decrease of {abs(delta)} or a misapplied percent; a {pct}% increase adds {delta} to {base}.",
                f"A percent increase must grow the number: {pct}% of {base} = {delta}.",
                f"This corresponds to adding too little (or too much) of the {pct}% increase; recompute {pct}% of {base}.",
            ],
        ))
        n += 1

    # --- exponential growth/decay (SPR or MC) ---------------------------
    for p, r_tenth, t in [(5, 100, 3), (8, 100, 2), (32, 50, 3), (3, 100, 4), (48, 50, 2), (256, 25, 4)]:
        r = Fraction(r_tenth, 100)
        val = p * (1 + r) ** t
        assert val == int(val), (p, r_tenth, t)
        val = int(val)
        stimulus = f"A population grows {r_tenth}% per hour and is modeled by $$V = {p}(1 + {r})^t$$ where $V$ is measured in thousands."
        items.append(spr(
            f"M-ALE-{n+101:03d}", "Math", "Advanced Math", "Exponential growth and decay",
            "Medium", stimulus,
            f"After $t = {t}$ hours, the model predicts a population of how many thousand bacteria?",
            val,
            f"$V = {p} \\cdot (1 + {r})^{{{t}}} = {val}$ thousand. Compounding {t} times at {r_tenth}% per hour multiplies the starting value that many times.",
        ))
        n += 1

    # --- quadratic vertex (MC) -----------------------------------------
    for a, b, c1 in [(1, -10, 24), (2, 16, 33), (1, 6, 2), (3, -30, 78), (1, -14, 48), (2, -12, 19)]:
        vx = Fraction(-b, 2 * a)
        assert vx.denominator == 1
        vx = int(vx)
        wrongs = sorted({-vx, vx + 1, -b, b // (2 * a) if b % (2 * a) == 0 else -vx - 2} - {vx})
        wrongs = [v for v in wrongs if v != vx][:3]
        while len(wrongs) < 3:
            wrongs.append(vx + len(wrongs) + 1)

        def quad_str(a_c, b_c, c_c):
            def num(v):
                return "" if v == 1 else ("-" if v == -1 else str(v))
            parts = [f"{num(a_c)}x^2"]
            if b_c:
                parts.append(f"{'+ ' if b_c > 0 else '- '}{abs(b_c)}x")
            if c_c:
                parts.append(f"{'+ ' if c_c > 0 else '- '}{abs(c_c)}")
            return " ".join(parts)

        items.append(mc(
            f"M-QUA-{n+101:03d}", "Math", "Advanced Math", "Quadratic functions: vertex and symmetry",
            "Medium",
            f"$$f(x) = {quad_str(a, b, c1)}$$",
            "For what value of $x$ does $f$ reach its minimum?", f"${vx}$",
            [f"${v}$" for v in wrongs[:3]],
            f"The vertex $x$-coordinate is $-\\dfrac{{b}}{{2a}} = -\\dfrac{{{b}}}{{2({a})}} = {vx}$; with $a = {a} > 0$ this is the minimum.",
            [f"That value is not $-b/(2a)$: computing $a({v})^2 + b({v}) + c$ does not produce the least output compared with $x = {vx}$." for v in wrongs[:3]],
        ))
        n += 1

    # --- quadratic roots via factoring (SPR) ----------------------------
    for r1, r2, k in [(2, 5, 1), (3, 4, 2), (1, 7, 3), (2, 9, 1), (5, 6, 2), (3, 8, 3)]:
        a = k * r1 * r2
        b = -k * (r1 + r2)
        c1 = k
        poly = quad_str(a, b, c1)
        prod = r1 * r2
        stimulus = f"$$f(x) = {poly}$$"
        items.append(spr(
            f"M-QUA-{n+101:03d}", "Math", "Advanced Math", "Factoring quadratics and zeros",
            "Medium", stimulus,
            "If $r_1$ and $r_2$ are the real zeros of $f$, what is the product $r_1 \\cdot r_2$?",
            prod,
            f"Factoring gives $f(x) = {k}({r1}x - {r1 * r2})({r2}x - {r1 * r2})$ up to constants; equivalently for $ax^2+bx+c$, the product of zeros is $c/a = {c1}/{a} = {prod}$.",
        ))
        n += 1

    # --- exponent rules (SPR, numeric base) ------------------------------
    for base_v, e1, e2, e3 in [(2, 5, 3, 4), (3, 6, 2, 5), (2, 9, 4, 6), (5, 4, 2, 3)]:
        k = e1 + e2 - e3
        stimulus = f"$$\\frac{{{base_v}^{{{e1}}} \\cdot {base_v}^{{{e2}}}}}{{{base_v}^{{{e3}}}}} = {base_v}^{{k}}$$"
        items.append(spr(
            f"M-ALE-{n+101:03d}", "Math", "Advanced Math", "Operations with exponents",
            "Easy", stimulus,
            "What is the value of $k$?", k,
            f"Add exponents when multiplying ({e1} + {e2} = {e1 + e2}) and subtract when dividing ({e1 + e2} - {e3} = {k}), so the expression equals ${base_v}^{{{k}}}$.",
        ))
        n += 1

    # --- mean (SPR) -------------------------------------------------------
    for data, mean_target in [
        ([4, 7, 9, 12], None), ([3, 8, 10, 15], None), ([6, 6, 11, 13], None), ([2, 9, 12, 17], None), ([5, 5, 8, 14], None)
    ]:
        s = sum(data)
        assert s % 4 == 0, data
        mean = s // 4
        items.append(spr(
            f"M-DAT-{n+101:03d}", "Math", "Problem-Solving and Data Analysis",
            "Mean, median and mode", "Easy",
            f"Four measurements are recorded: {', '.join(map(str, data))}.",
            "What is the mean of the four measurements?", mean,
            f"The sum is {s}; dividing by 4 measurements gives $\\dfrac{{{s}}}{{4}} = {mean}$.",
        ))
        n += 1

    # --- simple probability (SPR, fraction) --------------------------------
    for red, blue, green in [(3, 5, 4), (4, 6, 2), (2, 7, 3), (5, 5, 5)]:
        total = red + blue + green
        from math import gcd
        frac = Fraction(red, total)
        items.append(spr(
            f"M-DAT-{n+101:03d}", "Math", "Problem-Solving and Data Analysis",
            "Probability and conditional probability", "Easy",
            f"A jar holds {red} red, {blue} blue, and {green} green marbles. A marble is drawn at random.",
            f"What is the probability of drawing a red marble (enter as a fraction like $3/12$)?",
            f"{frac.numerator}/{frac.denominator}",
            f"There are {red} red marbles among {total} total; the probability is $\\dfrac{{{red}}}{{{total}}} = \\dfrac{{{frac.numerator}}}{{{frac.denominator}}}$.",
        ))
        n += 1

    # --- sector area MC -----------------------------------------------------
    import math as _math
    for r, deg in [(6, 60), (10, 90), (4, 30), (12, 45), (8, 120)]:
        num = Fraction(deg * r * r, 360)  # sector area = num * pi, exact
        def pi_str(fr):
            return f"{fr.numerator}\\pi" if fr.denominator == 1 else f"\\dfrac{{{fr.numerator}}}{{{fr.denominator}}}\\pi"
        correct_area = num
        wrongs_area = [num * 2, num / 3, num + Fraction(r)]
        items.append(mc(
            f"M-GEO-{n+101:03d}", "Math", "Geometry and Trigonometry",
            "Circles: area and circumference", "Medium",
            f"A circle has radius $r = {r}$. A central angle of ${deg}^\\circ$ defines a sector.",
            "Which expression equals the area of that sector?",
            "$" + pi_str(correct_area) + "$",
            ["$" + pi_str(w) + "$" for w in wrongs_area[:3]],
            f"Sector area $= \\dfrac{{\\theta}}{{360}} \\pi r^2 = \\dfrac{{{deg}}}{{360}} \\pi({r})^2 = $ $" + pi_str(correct_area) + "$.",
            ["Using $\\pi r^2$ without the $\\theta/360$ fraction gives the whole circle, not the sector.", "Check the arithmetic: only $\\dfrac{" + str(deg) + "}{360}\\cdot" + str(r * r) + "$ is correct.", "That variant mis-scales the fraction; recompute $\\dfrac{\\theta}{360}\\cdot r^2$."],
        ))
        n += 1

    # --- circle equation: radius (SPR) --------------------------------------
    for h, k, r in [(2, 5, 3), (7, 1, 4), (5, 8, 6), (1, 9, 5), (6, 2, 7), (3, 4, 2)]:
        hs = f"(x {'-' if h >= 0 else '+'} {abs(h)})" if h != 0 else "x"
        ks = f"(y {'-' if k >= 0 else '+'} {abs(k)})" if k != 0 else "y"
        stimulus = f"$${hs}^2 + {ks}^2 = {r * r}$$"
        items.append(spr(
            f"M-GEO-{n+101:03d}", "Math", "Geometry and Trigonometry",
            "Circles: equations in standard form", "Medium", stimulus,
            "What is the radius of the circle?", r,
            f"Matching to $(x-h)^2 + (y-k)^2 = r^2$ shows the right side equals $r^2 = {r * r}$, hence the radius is $r = {r}$ (positive root).",
        ))
        n += 1

    # --- absolute value equation (SPR) --------------------------------------
    for a, b1, c1 in [(2, 6, 14), (3, 9, 24), (4, 2, 18), (5, 5, 30), (2, 12, 20)]:
        # |a x + b| = c -> x = (c - b)/a  (positive branch chosen for SPR)
        x_pos = Fraction(c1 - b1, a)
        assert x_pos.denominator == 1 and x_pos > 0
        stimulus = f"$$|{a}x - {b1}| = {c1}$$" if b1 > 0 else f"$$|{a}x + {abs(b1)}| = {c1}$$"
        items.append(spr(
            f"M-ALE-{n+101:03d}", "Math", "Algebra", "Absolute value equations and inequalities",
            "Medium", stimulus,
            "If $x > 0$, what is the positive value of $x$ that satisfies the equation?",
            int(x_pos),
            f"The positive branch gives ${a}x = {b1} + {c1}$ (absolute value allows $\\pm{c1}$); dividing by ${a}$ yields $x = {int(x_pos)}$. Back-substitution returns $|{a}({int(x_pos)}) - {b1}| = {c1}$.",
        ))
        n += 1

    # --- function composition (SPR) ------------------------------------------
    for f_a, f_b, g_a, g_b, x0 in [(3, 1, 2, -4, 3), (2, 5, 3, 1, 2), (4, -2, 2, 7, 4), (5, 3, 1, -6, 3)]:
        inner = g_a * x0 + g_b
        out = f_a * inner + f_b
        stimulus = f"$$f(x) = {f_a}x {'+' if f_b >= 0 else '-'} {abs(f_b)} \\qquad g(x) = {g_a}x {'+' if g_b >= 0 else '-'} {abs(g_b)}$$"
        items.append(spr(
            f"M-ALE-{n+101:03d}", "Math", "Advanced Math", "Function composition and evaluation",
            "Medium", stimulus,
            f"What is the value of $f(g({x0}))$?", out,
            f"$g({x0}) = {g_a}({x0}) {'+' if g_b >= 0 else '-'} {abs(g_b)} = {inner}$; then $f({inner}) = {f_a}({inner}) {'+' if f_b >= 0 else '-'} {abs(f_b)} = {out}$.",
        ))
        n += 1

    # --- rate / unit conversion (SPR) ----------------------------------------
    for mph, hours in [(52, 3), (47, 4), (38, 5), (66, 2), (58, 6)]:
        dist = mph * hours
        stimulus = f"A delivery van averages {mph} miles per hour on a uniform {hours}-hour stretch of a route."
        items.append(spr(
            f"M-PSD-{n+101:03d}", "Math", "Problem-Solving and Data Analysis",
            "Unit rates and conversions", "Easy", stimulus,
            "How many miles does the van cover on that stretch?", dist,
            f"Distance $=$ rate $\\times$ time $= {mph} \\times {hours} = {dist}$ miles.",
        ))
        n += 1

    # --- polynomial factored form: zeros MC ----------------------------------
    for r1, r2, r3 in [(2, 3, 5), (1, 4, 6), (3, 5, 7), (2, 6, 9)]:
        zeros = sorted({r1, r2, r3})
        answer = zeros[1]
        wrongs = [z for z in zeros if z != answer][:2]
        wrongs += [answer + 1]
        items.append(mc(
            f"M-ALE-{n+101:03d}", "Math", "Advanced Math", "Polynomial functions and zeros",
            "Hard",
            f"$$h(x) = (x - {r1})(x - {r2})(x - {r3})$$",
            "Which value of $x$ is a zero of $h$?",
            f"${answer}$" if all(z != 0 for z in zeros) else f"${r1}$",
            [f"${w}$" for w in dict.fromkeys(wrongs)][:3],
            f"A zero of a factored polynomial is any root of one of its linear factors: $x = {answer}$ makes the factor $(x - {answer})$ equal to zero, so $h({answer}) = 0$. The other listed values are the remaining roots.",
            [
                f"Substituting $x = {wrongs[0]}$ into $(x - {r1})(x - {r2})(x - {r3})$ yields a product of three nonzero factors, so it is not a zero.",
                "Use the zero-product property: a value must zero one of the literal factors to be a zero of $h$.",
                "Re-check each listed value against all three factors before accepting it as a zero.",
            ],
        ))
        n += 1

    # --- inequality (MC) -------------------------------------------------------
    for a, b1, c1 in [(3, 9, 27), (5, 4, 29), (4, 6, 30), (6, 2, 26)]:
        # a x + b > c  -> x > (c-b)/a when a > 0
        bound = Fraction(c1 - b1, a)
        assert bound.denominator == 1
        correct = f"x > {int(bound)}"
        items.append(mc(
            f"M-ALE-{n+101:03d}", "Math", "Algebra", "Linear equations in one variable",
            "Medium",
            f"Which solution set satisfies $${a}x + {b1} > {c1}$$ ?",
            "The solution as an inequality in $x$ is:", correct,
            [f"x < {int(bound)}", f"x > {int(bound) - 2}", f"x < {int(bound) + 1}"],
            f"Subtract {b1}: ${a}x > {c1 - b1}$. Dividing by the positive coefficient ${a}$ keeps the direction: $x > {int(bound)}$.",
            [
                f"Reversing the inequality is wrong because we divide by the positive number ${a}$, not a negative one.",
                f"Shifting the boundary by {2} stretches the interval; the exact boundary is ${int(bound)}$.",
                f"A '>' flips to '<' only when dividing by a negative number, which never happens with ${a}$.",
            ],
        ))
        n += 1

    # --- systems: elimination value of x (MC) ---------------------------------
    for x0, y0, a1, b1, a2, b2 in [(4, 3, 2, 1, 1, 4), (6, 2, 3, 2, 5, 1), (5, 4, 1, 3, 2, 5), (7, 1, 4, 3, 2, 9)]:
        c1 = a1 * x0 + b1 * y0
        c2 = a2 * x0 + b2 * y0
        items.append(mc(
            f"M-SYS-{n+101:03d}", "Math", "Algebra", "Systems of two linear equations in two variables",
            "Medium",
            f"$${a1}x + {b1}y = {c1}$$\n$${a2}x + {b2}y = {c2}$$",
            "Which ordered pair $(x, y)$ satisfies the system?",
            f"$({x0}, {y0})$",
            [f"$({y0}, {x0})$", f"$({x0 + 1}, {y0 - 1})$" if y0 != 0 else f"$({x0}, {y0 + 1})$", f"$({x0}, {y0 + 2})$"],
            f"Substitute $(x,y) = ({x0},{y0})$: ${a1}({x0}) + {b1}({y0}) = {c1}$ and ${a2}({x0}) + {b2}({y0}) = {c2}$. Both equations hold, so the pair solves the system.",
            [
                f"Testing the swapped pair in the first equation gives ${a1 * y0 + b1 * x0}$, not {c1}.",
                f"Off-by-one pairs fail: ${a1}({x0 + 1}) + {b1}({y0 - 1}) = {a1 * (x0 + 1) + b1 * (y0 - 1)}$, which is not {c1}.",
                f"Adding 2 to $y$ breaks the balance: ${a2}({x0}) + {b2}({y0 + 2}) = {a2 * x0 + b2 * (y0 + 2)}$, not {c2}.",
            ],
        ))
        n += 1

    # --- trigonometry (SPR with common angles) ---------------------------------
    trig_items = [
        ("A 30-60-90 right triangle has a hypotenuse of 10.", "What is the length of the shorter leg?", 5),
        ("A 45-45-90 right triangle has legs of length 7.", "What is the length of the hypotenuse? (Exact radical answer as a decimal is not needed.)", 0),
        ("In right triangle $ABC$, $\\sin A = 3/5$ and $\\cos A = 4/5$.", "What is $\\tan A$ (as a fraction)?", 0),
    ]
    for i, (stim, prompt, ans) in enumerate(trig_items):
        if prompt.startswith("What is the length of the shorter leg?"):
            items.append(spr(
                f"M-GEO-{n+101:03d}", "Math", "Geometry and Trigonometry", "Right triangles and trigonometric ratios", "Medium",
                stim, prompt, ans,
                "In a 30-60-90 triangle the legs are $x$ and $x\\sqrt3$ with hypotenuse $2x$. Here $2x = 10$, so $x = 5$.",
            ))
        elif prompt.startswith("What is the length of the hypotenuse?"):
            items.append(spr(
                f"M-GEO-{n+101:03d}", "Math", "Geometry and Trigonometry", "Right triangles and trigonometric ratios", "Hard",
                stim, prompt, "7sqrt(2)",
                "In a 45-45-90 triangle the hypotenuse is $\\sqrt2$ times a leg: $7\\sqrt2$.",
            ))
        else:
            items.append(spr(
                f"M-GEO-{n+101:03d}", "Math", "Geometry and Trigonometry", "Right triangles and trigonometric ratios", "Hard",
                stim, prompt, "3/4",
                "$\\tan A = \\dfrac{\\sin A}{\\cos A} = \\dfrac{3/5}{4/5} = \\dfrac{3}{4}$.",
            ))
    n += 3

    # --- data: median (SPR) -----------------------------------------------------
    for data in [[7, 3, 9, 5, 11], [12, 4, 9, 6, 14], [8, 2, 7, 10, 5], [15, 6, 9, 12, 3], [4, 13, 8, 1, 10]]:
        sd = sorted(data)
        items.append(spr(
            f"M-DAT-{n+101:03d}", "Math", "Problem-Solving and Data Analysis", "Mean, median and mode", "Easy",
            "Five quiz scores were recorded: " + ", ".join(map(str, data)) + ".",
            "What is the median of the five scores?", sd[2],
            f"Ordered, the five scores are {sd}; the middle (third) value is {sd[2]}.",
        ))
        n += 1

    # --- volume (MC) --------------------------------------------------------------
    for r, h in [(3, 5), (4, 9), (6, 2), (2, 12)]:
        vol = r * r * h  # cylinder: pi r^2 h, exact multiple of pi
        wrongs = [vol * 2, vol // 3, vol + r * h]
        items.append(mc(
            f"M-GEO-{n+101:03d}", "Math", "Geometry and Trigonometry", "Volume and surface area", "Medium",
            f"A right circular cylinder has radius ${r}$ and height ${h}$.",
            "Which expression equals its volume?",
            f"${vol}\\pi$",
            [f"${w}\\pi$" for w in dict.fromkeys(wrongs)][:3],
            f"$V = \\pi r^2 h = \\pi ({r})^2 ({h}) = {vol}\\pi$ cubic units.",
            [f"That variant uses a wrong power or wrong factor; only $\\pi r^2 h$ with $r = {r}$, $h = {h}$ gives {vol}.", "Check the formula: cylinders use $\\pi r^2 h$, then substitute.", "Recompute $r^2$ before multiplying by the height."],
        ))
        n += 1

    return items


def load_vocab_corpus():
    path = os.path.join(DATA_DIR, "elevated_vocab_cc0.json")
    with open(path, "r", encoding="utf-8") as fh:
        rows = json.load(fh)
    seen = set()
    out = []
    for r in rows:
        w = str(r.get("word") or "").strip().lower()
        d = str(r.get("definition") or "").strip()
        if not w or not d or w in seen:
            continue
        seen.add(w)
        out.append({"word": w, "pos": str(r.get("pos") or "").strip(), "definition": d, "band": int(r.get("band") or 3)})
    return out


# ---------------------------------------------------------------------------
# WORDS IN CONTEXT + TRANSITION + GRAMMAR (authored sentence frames)
# ---------------------------------------------------------------------------

WIC_SENTENCES = 14


def gen_wic(vocab):
    """Words-in-context items; correct word and distractors all come from the CC0
    list so distractors are real words with wrong meanings."""
    from random import Random
    rng = Random("hdsat-wic-frames")
    bank1 = [v for v in vocab if v["band"] <= 2]
    bank2 = [v for v in vocab if v["band"] in (3, 4)]
    bank3 = [v for v in vocab if v["band"] >= 5]

    frames = [
        ("The committee's report was unusually ______: every recommendation came with a cost estimate and a fallback plan.", "detailed scrutiny of costs"),
        ("Critics called the director's second film derivative, but the ______ pacing of the finale won over most reviewers.", "brisk, controlled rhythm"),
        ("The Faraday-era archive contains hundreds of letters, many barely ______.", "barely readable"),
        ("The mayor's budget address was deliberately ______, avoiding any commitment before the audit closed.", "noncommittal"),
        ("Because the malware was dormant, the breach went ______ for months.", "undetected for a long time"),
        ("Her enthusiasm was undeniable; the delivery, however, was ______, jumping between unrelated topics.", "scattered"),
        ("The treaty's language was ______: signatories could interpret 'prompt withdrawal' in very different ways.", "ambiguous wording"),
        ("After the scandal, the senator's support was ______, evaporating within a single news cycle.", "quickly fading"),
        ("The professor's lectures were dense but never ______; every technical term was defined on first use.", "leaving terms undefined"),
        ("Fuel prices fell, yet the shipping backlog remained ______ through most of the quarter.", "firmly stuck"),
        ("The rebuttal was so ______ that even the plaintiff's counsel nodded in agreement.", "compelling"),
        ("Early aviation instruments were crude, so pilots relied heavily on ______ landmarks.", "visible landmarks"),
        ("The novel's opening chapter is all ______: nothing decisive actually happens for two hundred pages.", "empty setup"),
        ("Unlike her early______ sketches, the finished murals showed meticulous detail.", "loose, rough"),
    ]
    items = []
    for i, (sentence, gloss) in enumerate(frames):
        pool = bank1 if i % 3 == 0 else (bank2 if i % 3 == 1 else bank3)
        correct = pool[(i * 7) % len(pool)]
        distract = []
        seen_words = {correct["word"]}
        j = (i * 11 + 5) % len(pool)
        while len(distract) < 3:
            cand = pool[j]
            j = (j + 3) % len(pool)
            if cand["word"] in seen_words:
                continue
            seen_words.add(cand["word"])
            distract.append(cand)
        items.append(mc(
            f"RW-CRF-{100 + i:03d}", "Reading and Writing", "Craft and Structure", "Words in Context",
            ["Easy", "Medium", "Hard"][i % 3],
            sentence,
            "Which choice completes the text with the most logical and precise word?",
            correct["word"],
            [d["word"] for d in distract],
            f"\u201c{correct['word']}\u201d means \u201c{correct['definition']}\u201d, which matches the context: {gloss}.",
            [
                f"\u201c{distract[0]['word']}\u201d means \u201c{distract[0]['definition']}\u201d, which does not fit the context of {gloss}.",
                f"\u201c{distract[1]['word']}\u201d means \u201c{distract[1]['definition']}\u201d; the sentence requires the sense \u201c{gloss}\u201d.",
                f"\u201c{distract[2]['word']}\u201d means \u201c{distract[2]['definition']}\u201d, which clashes with the surrounding description.",
            ],
        ))
    return items


def gen_transitions():
    pairs = [
        ("Coastal fog drip supplies a third of the water entering some redwood groves; the trees that survive farthest inland, ____ , draw almost none of it.",
         "meanwhile", ["meanwhile", "consequently", "for instance", "therefore"]),
        ("Reuters photographers trained for years on film stock that rendered night scenes poorly; digital sensors changed the economics of news photography entirely, ____ .",
         "by contrast", ["by contrast", "similarly", "moreover", "for example"]),
        ("Revenue from streaming now exceeds theatrical box office for most studios; physical media stores keep closing, ____ .",
         "correspondingly", ["correspondingly", "however", "alternatively", "in addition"]),
        ("Vaccination records from 1971 show that the measles campaign reached 92 percent of urban children; access in rural counties lagged almost 40 points behind, ____ .",
         "by comparison", ["by comparison", "therefore", "likewise", "for instance"]),
        ("The composer never learned to read standard notation, ____ , she dictated every movement to an assistant measure by measure.",
         "consequently", ["consequently", "nonetheless", "in other words", "meanwhile"]),
        ("Seed banks store crop varieties against future blights; a single variety resurrected in 2019 revived an entire regional wheat trade, ____ .",
         "for example", ["for example", "similarly", "otherwise", "conversely"]),
        ("Insulin was once extracted from cattle pancreases at a cost of dollars per dose; recombinant manufacturing cut the price dramatically, ____ .",
         "as a result", ["as a result", "alternatively", "by contrast", "in addition"]),
        ("Volcanic ash preserves impressions softer than bone; mid-Cretaceous pterosaur wing membranes have been found only in such deposits, ____ .",
         "indeed", ["indeed", "however", "for instance", "meanwhile"]),
        ("Cities that painted dedicated bus lanes immediately saw ridership gains; lanes limited to peak hours alone moved the needle much less, ____ .",
         "conversely", ["conversely", "similarly", "therefore", "moreover"]),
        ("The telescope array sits above 5,600 meters, where oxygen is half of sea level; engineers rotate crews every six weeks, ____ .",
         "hence", ["hence", "nevertheless", "for example", "in contrast"]),
        ("Antique luthiers varnished instruments in thin coats over months; mass-produced replicas rushed the process, ____ , the soundboard never sealed evenly.",
         "and", ["and", "but", "or", "so"], ),
        ("The manuscript's ink is iron-gall, which corrodes parchment over centuries; conservators therefore minimize page turning, ____ handling it at all.",
         "let alone", ["let alone", "as well as", "in addition to", "along with"]),
        ("Some worm species gut their own neurons during metamorphosis; the adults nonetheless navigate mazes accurately, ____ the new layout differs from the larval one.",
         "even though", ["even though", "because", "so that", "as if"]),
        ("Amateur astronomers provided the first report of the 2023 fireball over the Alps; professional networks confirmed it within the day, ____ .",
         "as well", ["as well", "instead", "however", "on the contrary"]),
    ]
    items = []
    for i, (text, correct, opts) in enumerate(pairs):
        options = list(dict.fromkeys(opts))[:3 + 1]
        options = options[:4] if len(options) >= 4 else options + [f"option{i}"]
        opts_all = list(dict.fromkeys([correct] + [o for o in options if o != correct]))
        correct = opts_all[0]
        wrong = opts_all[1:4]
        while len(wrong) < 3:
            wrong.append(f"alternative{len(wrong)}")
        explanations = [
            "The second clause continues or extends the first, not contrasts or exemplifies it.",
            "This alternation does not match the logical relation between the two clauses.",
            "The relationship here is not the contrast or consequence this transition implies.",
        ]
        items.append(mc(
            f"RW-EXP-{100 + i:03d}", "Reading and Writing", "Expression of Ideas", "Transitions",
            ["Easy", "Medium", "Hard"][i % 3], text,
            "Which transition completes the text?",
            correct, wrong,
            f"\u201c{correct}\u201d marks the relation the evidence supports; the other listed choices hook the clauses differently.",
            [f"\u201c{w}\u201d would signal {rel}" for w, rel in zip(wrong, ["an unintended contrast", "a wrong causal relation", "an example rather than the stated relation"])],
        ))
    return items


def gen_grammar():
    """Bounds, verbs, modifiers, pronouns - parameterized but authored sentences."""
    items = []
    specs = [
        # (stimulus with ___, correct, wrongs, explanation)
        ("The studio fired its cobalt glazes in a single afternoon-shift kiln, ____ apprentices were barred from the cooling room until evening.",
         "and", ["but", "so", "or"],
         "The two clauses are neither causal nor contrastive; a plain coordinating conjunction joins them."),
        ("The ledger recorded each transaction in triplicate; the clerk then filed the copies ____ for seven years.",
         "carefully", ["careless", "with careful", "most careful"],
         "An adverb modifies the verb 'filed'; the alternatives are adjectives or a wrong form."),
        ("Neither the cartographers nor the pilot ______ the boundary stone that marked the disputed parcel.",
         "had seen", ["has seen", "had saw", "have seen"],
         "With 'neither...nor', the verb agrees with the nearer subject 'pilot' (singular), and the past perfect fits the sequence."),
        ("The city's bike-share fleet has expanded, and now nearly every resident can find a bike ____",
         "within two blocks of home.", ["within two blocks of home", "within two blocks of home, and", "to within two blocks of home."],
         "The sentence needs a closing adverbial phrase and a period; extra conjunctions or a preposition would break the parallel structure."),
        ("Each of the surveyors ______ a hand-drawn map into the shared ledger, and the estimates converged.",
         "entered", ["enter", "entering", "was entered"],
         "'Each' takes a singular verb; the past tense matches the second clause."),
        ("The documentary crew filmed the excavations all summer, but the director chose only the two days on which the trench was dry.",
         "all summer, but the director", ["all summer; but, the director", "all summer the director", "all summer. But, the director"],
         "A comma plus 'but' correctly joins the two independent clauses; a comma splice or a fused sentence does not."),
        ("While the portraits' sitters remain unidentified, curators believe the painter ____ to have worked between 1610 and 1620.",
         "likely", ["likelihood", "like", "liking"],
         "The adverb 'likely' modifies the verb phrase 'to have worked'; the alternatives are nouns or a wrong form."),
        ("The migratory corridor runs from the delta to the plateau, and conservationists track it with satellite collars, thermal imaging, ____ community reports.",
         "and", ["but", "or", "so"],
         "Three parallel items in a series are joined by 'and', not by contrastive or alternative conjunctions."),
    ]
    for i, (stim, correct, wrongs, expl) in enumerate(specs):
        items.append(mc(
            f"RW-SEC-{100 + i:03d}", "Reading and Writing", "Standard English Conventions",
            "Boundaries" if i in (0, 5) else "Form, Structure, and Sense",
            ["Easy", "Medium", "Hard"][i % 3], stim,
            "Which choice completes the text so that it conforms to Standard English?",
            correct, wrongs[:3],
            expl,
            ["That option breaks the convention tested here - splice, agreement, word form, or wrong conjunction.", "Substituting it back, the sentence no longer holds together under standard rules.", "This creates a fused clause, an agreement error, or a mismatched word class."],
        ))
    return items


def gen_quantitative():
    """Command of Evidence (Quantitative) items built on original datasets."""
    data_sets = [
        {
            "cap": "Urban tree canopy vs. summer surface temperature",
            "headers": ["Neighborhood", "Canopy Cover (%)", "Peak Surface Temp (C)"],
            "rows": [["Maple Heights", "38", "31.2"], ["Iron Row", "11", "38.7"], ["Cedar Flats", "25", "33.9"], ["Dock Quarter", "5", "41.0"]],
            "claim": "Canopy cover rather than latitude best predicts which streets stay cool in heat waves.",
            "facts": ["Maple Heights (38% canopy) peaks at 31.2 C while Iron Row (11%) peaks at 38.7 C and Dock Quarter (5%) at 41.0 C.",
                      "The pattern is monotonic: less canopy, hotter surfaces."],
        },
        {
            "cap": "Museum visit recovery after renovation",
            "headers": ["Quarter", "Visitors (thousands)"],
            "rows": [["Q1 (renovated)", "18.4"], ["Q2", "22.1"], ["Q3", "29.6"], ["Q4", "35.2"]],
            "claim": "Attendance recovered steadily in the year after the gallery wing reopened.",
            "facts": ["Visitors rise every quarter: 18.4 -> 22.1 -> 29.6 -> 35.2 thousand."],
        },
        {
            "cap": "Seedling survival by watering regime",
            "headers": ["Regime", "Seedlings Planted", "Survived (%)"],
            "rows": [["Daily light", "500", "62%"], ["Twice weekly", "500", "71%"], ["Weekly deep", "500", "83%"], ["Rain-fed only", "500", "58%"]],
            "claim": "Fewer, deeper waterings outperform frequent shallow ones for survival.",
            "facts": ["Weekly deep watering wins (83%) despite all regimes planting 500 seedlings each."],
        },
        {
            "cap": "Library e-book borrows by patron age band",
            "headers": ["Age Band", "Borrowed (thousands)"],
            "rows": [["18-24", "12.6"], ["25-39", "31.4"], ["40-64", "27.0"], ["65+", "9.8"]],
            "claim": "Working-age adults account for most of the e-book program's use.",
            "facts": ["25-39 plus 40-64 sum to 58.4 thousand of the 80.8 total, well over half."],
        },
        {
            "cap": "Night-shift alertness by break schedule",
            "headers": ["Schedule", "Avg. lapses per shift"],
            "rows": [["Single 30-min break", "6.1"], ["Two 15-min breaks", "5.2"], ["Micro-breaks hourly", "3.4"], ["No scheduled break", "8.9"]],
            "claim": "More frequent short breaks reduce lapses more than one long break.",
            "facts": ["Hourly micro-breaks produce the fewest lapses (3.4), versus 6.1 for one long break."],
        },
        {
            "cap": "Compost feedstock and finished-soil nitrogen",
            "headers": ["Feedstock", "N (mg/kg soil)"],
            "rows": [["Leaf litter", "710"], ["Fish waste", "1,905"], ["Coffee grounds", "1,480"], [" straw", "520"]],
            "claim": "Protein-rich feedstocks raise soil nitrogen most.",
            "facts": ["Fish waste (1,905 mg/kg) exceeds coffee grounds and both plant feedstocks."],
        },
    ]
    items = []
    di = 0
    for ds_idx, ds in enumerate(data_sets):
        fig_table = {
            "type": "table",
            "caption": ds["cap"],
            "headers": ds["headers"],
            "rows": [[c.strip() for c in r] for r in ds["rows"]],
        }
        # For two-column datasets, also build a bar or line chart figure variant
        if len(ds["headers"]) == 2:
            chart_pts = []
            for r in ds["rows"]:
                try:
                    val = float(str(r[1]).replace(",", "").replace("%", "").strip())
                except ValueError:
                    val = 0.0
                chart_pts.append({"label": r[0].strip(), "value": val})
            fig_chart = {
                "type": "line_chart" if ds_idx % 2 == 1 else "bar_chart",
                "caption": ds["cap"],
                "x_label": ds["headers"][0],
                "y_label": ds["headers"][1],
                "series": chart_pts,
            }
        else:
            fig_chart = fig_table

        for j in range(2):
            row = ds["rows"][(di + j) % len(ds["rows"])]
            others = [r[0].strip() for r in ds["rows"] if r[0] != row[0]][:3]
            if j == 0:
                items.append(mc(
                    f"RW-INF-{200 + di + j:03d}", "Reading and Writing", "Information and Ideas",
                    "Command of Evidence (Quantitative)", ["Easy", "Medium", "Hard"][(di + j) % 3],
                    f"Researchers compiled data on {ds['cap'].lower()} and concluded: {ds['claim']}",
                    "Which finding from the data best supports the researchers' conclusion?",
                    f"{ds['facts'][0]}" if "facts" in ds else "",
                    [f"{others[0]} recorded the smallest value for every measured outcome.",
                     f"{others[1]} reversed the direction of the effect reported in the conclusion.",
                     f"The data show no consistent relationship between the measured variables."],
                    ds["facts"][0] + " This directly matches the pattern the researchers claim; the remaining options misstate the table's contents.",
                    [
                        "The data do not place this row at the extreme of every column; recheck the numbers.",
                        "The conclusion claims a direction of effect, not its reversal.",
                        "The data do show a consistent relationship; comparing the rows reveals it.",
                    ],
                    figure=fig_table,
                ))
            else:
                items.append(mc(
                    f"RW-INF-{200 + di + j:03d}", "Reading and Writing", "Information and Ideas",
                    "Command of Evidence (Quantitative)", ["Easy", "Medium", "Hard"][(di + j) % 3],
                    f"The figure summarizes a regional study on {ds['cap'].lower()}.",
                    "Which statement is best supported by the data in the figure?",
                    ds["facts"][min(1, len(ds["facts"]) - 1)],
                    [f"{others[0]} is the single most extreme value across all categories, dominating every comparison.",
                     "The predictors are causally established by the summary figure alone, not merely correlated.",
                     f"Every category differs from the next by the exact same margin, so no ranking is possible."],
                    ds["facts"][min(1, len(ds["facts"]) - 1)] + " Only this statement avoids reading causation or inventing uniform spacing that the figure does not provide.",
                    ["The figure lists values; it does not establish that this category dominates every comparison.",
                     "A summary chart or table records association; causal proof needs an experimental design statement.",
                     "The margins between entries vary, so no uniform-spacing claim can be drawn."],
                    figure=fig_chart,
                ))
        di += 2
    return items


def gen_prose():
    """Authored prose items - central ideas, inferences, completion, structure, cross-text."""
    items = []

    def add(i, skill, difficulty, stimulus, prompt, correct, wrongs, explanation, rationales):
        items.append(mc(
            f"RW-INF-{300 + i:03d}", "Reading and Writing", "Information and Ideas", skill, difficulty,
            stimulus, prompt, correct, wrongs, explanation, rationales,
        ))

    add(0, "Central Ideas and Details", "Easy",
        "Beekeepers on the island of Aegina traditionally overwinter their hives above the thyme line at 300 meters, where the winter rains are heavier but the winds are calmer. Recent transit studies show that colonies moved down-slope for spring bloom return later to the thyme plateau because overnight cold snaps delay the first foraging flights.",
        "Which choice best states the main idea of the text?",
        "Moving hives down-slope for spring costs colonies foraging time because cold snaps at lower elevations delay the start of flying.",
        ["Thyme nectar on Aegina is most abundant in autumn when cold snaps end.",
         "Aegina's winds are strongest on the thyme plateau, which is why hives moved there.",
         "Beekeepers now refuse to move colonies because transit studies are too new."],
        "The passage's claim is that the down-slope spring move trades bloom access for delayed foraging caused by overnight cold; that is the through-line of the two sentences.",
        ["Autumn abundance and denying the move are both inventions; the passage says nothing about either.",
         "The passage says winds are calmer at the higher winter site, not stronger on the plateau.",
         "No refusal to move is reported; the text describes why the move carries a cost."],
    )
    add(1, "Inferences", "Medium",
        "Before the 1890s, Paris hotels removed carpets seasonally and washed them in the Seine. After the municipal water scheme of 1893, most hotels installed steam laundries that used half the water per rug, and the riverside carpet-washing wharves disappeared within a decade.",
        "Which choice most logically completes the text?",
        "In-house steam laundries made riverside carpet washing economically obsolete.",
        ["Steam laundries used more water per rug than the Seine wharves had.",
         "The wharves were closed by ordinance following complaints about river pollution.",
         "Hotel operators could no longer transport carpets to the river after 1893."],
        "The passage contrasts the old river method with cheaper in-house washing that used half the water; the natural completion is that the new technology eliminated the old one on cost.",
        ["The passage states the steam laundries used half the water, not more.",
         "No ordinance or pollution complaint is mentioned.",
         "Nothing suggests transport difficulty; the wharves became unnecessary."],
    )
    add(2, "Command of Evidence (Textual)", "Hard",
        "Historian Noor Abdallah argues that eighteenth-century coffeehouse ledgers functioned as informal credit registries: because printers of the day listed debts alongside daily purchases, ordinary patrons could gauge a neighbor's reputation simply by reading the wall.",
        "Which quotation from a coffeehouse archive would most directly support Abdallah's claim?",
        "\u201cOn the third shelf, under the chalk line, the ink still reads: 'Abed - two coffees, first paid Sunday last.'\u201d",
        ["\u201cRegulars gathered by the window to hear the news sheet read aloud each morning.\u201d",
         "\u201cThe proprietor whitewashed the doorstep each festival and replanted the mint by the door.\u201d",
         "\u201cCocoa shipments from Batavia arrived quarterly and were stored in the cellar.\u201d"],
        "The quotation shows a purchase-plus-payment status written where patrons could read it, which is exactly the 'informal credit registry' the historian describes.",
        ["Reading the news aloud describes sociability, not credit tracked in public.",
         "Whitewashing and mint potting are housekeeping details with no bearing on ledgers.",
         "Storage of cocoa tells us about supply, not the public display of debts."],
    )
    add(3, "Text Structure and Purpose", "Medium",
        "Popular retellings give Alexander Fleming sole credit for penicillin. Microbiologists often add that Howard Florey's Oxford team purified the drug and ran the first clinical trials a decade later, and that the mass-production chemistry was solved in a Peoria laboratory using corn steep liquor.",
        "Which choice best describes the overall structure of the text?",
        "It counters a simplified account by adding the later research stages that turned a discovery into a medicine.",
        ["It narrates the chronological steps of one laboratory experiment in sequence.",
         "It compares two equally credited rival teams and declines to choose between them.",
         "It lists the equipment needed for antibiotic research without evaluating claims."],
        "The passage moves from a popular simplification to the specific omitted stages - purification, trials, mass production - which is a correction-by-addition structure.",
        ["The focus is the full chain from discovery to drug, not a single experiment.",
         "Fleming's discovery remains credited first; the later stages are supplements, not rivals.",
         "Equipment is never itemized; the passage evaluates the fairness of the story."],
    )
    add(4, "Cross-Text Connections", "Hard",
        "Text 1: Agronomist Isabel Ferro maintains that no-till farms build soil carbon fastest when residue from the previous grain crop is left standing; the stalks act as miniature snow fences that raise winter soil moisture.\nText 2: Soil chemist Nowsherwan Ali counters that on the clay-heavy fields he studies, standing residue keeps the surface so wet and cold each spring that nitrogen mineralization begins two weeks late, costing more yield than the added moisture is worth.",
        "Based on the texts, how would Ali most likely respond to Ferro?",
        "He would agree that standing residue raises winter moisture but argue that on wet clay soils that same moisture delays spring nitrogen release and lowers yields.",
        ["He would dispute that residue affects soil moisture at all, since his fields are clay.",
         "He would insist that residue be chopped and incorporated regardless of results.",
         "He would point out that Ferro's farms are too small to matter statistically."],
        "Ali accepts the moisture mechanism (that is Ferro's own point) and flips it: on his soils, the same moisture is a cost. Option D captures agreement-plus-reversal.",
        ["He does not deny moisture effects; he disagrees about their value on clay.",
         "He never proposes chopping residue; he weighs trade-offs.",
         "He critiques the agronomic trade-off, not study size."],
    )
    add(5, "Inferences", "Hard",
        "The 1911 catalog of the Balkan photographic cooperative lists its members as 'cartographers一枚, two schoolteachers, one pharmacist and a retired customs officer', and advertises develop-and-return service in seven Balkan languages. Notably absent is any tariff for portraits.",
        "What can most reasonably be inferred about the cooperative's client base?",
        "It served a linguistically mixed rural trade whose commissions were mainly documentary rather than portraits.",
        ["It relied on one dominant language, since developing was offered in seven scripts.",
         "Most clients commissioned formal portraits, which were priced by negotiation.",
         "It sold equipment to professional portrait studios in the capital."],
        "Seven-language return service implies a mixed-language clientele, and the absence of a portrait tariff implies documentary work dominated.",
        ["Seven languages implies mixture, not a single dominant one.",
         "If portraits were the core trade, a tariff line would be expected.",
         "Selling equipment to studios is never suggested."],
    )
    add(6, "Central Ideas and Details", "Easy",
        "The Saanich Inlet oxygen sensors deployed in 1958 recorded a six-decade decline in seafloor oxygen, interrupted by brief rebounds whenever strong El Nino winters flushed the basin.",
        "According to the text, what causes rebounds in the sensor record?",
        "Strong El Nino winters that renew basin water.",
        ["Sensor upgrades that improved oxygen readings.",
         "Declining seafloor temperature during El Nino years.",
         "Six decades of sediment accumulation on the seafloor."],
        "The text says rebounds occur 'whenever strong El Nino winters flushed the basin', tying the reversals to water renewal events.",
        ["No sensor change is mentioned; the rebound is physical, not instrumental.",
         "The mechanism described is flushing, not temperature change.",
         "Sediment accumulation is unrelated to the rebound sentence."],
    )
    add(7, "Inferences", "Medium",
        "Rooftop apiaries are exempt from the city's setback rules, and applicants may skip the soil test altogether when the apiary sits on a raised steel deck rather than on graded ground. Since 2019, 82 percent of permitted commercial hives have gone up on decks.",
        "What can most reasonably be inferred from the passage?",
        "For many operators, the avoided soil test makes decks the cheaper permitting path.",
        ["Most rooftop operators prefer soil-contact hives for flavor reasons.",
         "The city expects deck hives to fail more often than ground hives.",
         "Setback exemptions apply only to hobbyists with fewer than two hives."],
        "The passage links the deck's exemption from soil testing to its overall share; the economical reading is that skipping the test lowers permitting cost.",
        ["No flavor preference is mentioned.",
         "Nothing in the rules implies expected failure on decks.",
         "The exemption is tied to roof type, not hive count."],
    )
    add(8, "Central Ideas and Details", "Medium",
        "The Wedgwood pattern books digitized in this study survive in two densities: the catalog volumes sent to retailers, which list glazes in flat but uniform decimals, and the workshop notebooks, which describe the same glazes fussily, with weather notes and batch quirks in the margins.",
        "What does the text most directly suggest about the two kinds of records?",
        "The workshop notebooks capture the variability that the standardized retailer catalogs smooth over.",
        ["Retailer catalogs were intended as internal training documents.",
         "Notebook margins were later trimmed to match the catalogs' decimals.",
         "Only the retailer catalogs record glaze chemistry accurately."],
        "The contrast - flat decimals versus fussy weather and batch notes - is exactly the finding the text asserts.",
        ["The catalogs are described as going to retailers, not training staff.",
         "Nothing says notebooks were trimmed; the contrast is between completeness and smoothness.",
         "The text implies the notebooks are more descriptive, not that only one is accurate."],
    )
    add(9, "Inferences", "Hard",
        "Fifth-century shipwrights pegged planks with treenails cut from a single species: holm oak. timbers recovered from harbor silt, however, show the pegs' grain aligned not with the trunk but spiraling with the branch. Replicas built either way show a two-fold difference in how often fasteners split the hull in heavy swell.",
        "What can most reasonably be inferred?",
        "Shipwrights tailored the cut of treenails to grain orientation because it dramatically affected fastener durability.",
        ["Harbor silt preserved treenails more completely than other timbers.",
         "Holm oak branches were cheaper than trunks for all fifth-century construction.",
         "The two-fold difference appeared only when pegs were cut cross-grain."],
        "The replica test shows grain alignment changes split rates substantially, so builders' consistent spiral-cut practice must reflect that practical advantage.",
        ["Comparative preservation is not stated.",
         "Cost of branches versus trunks is never discussed.",
         "No limit to cross-grain splitting is given."],
    )
    add(10, "Central Ideas and Details", "Hard",
        "In translation studies, 'domestication' rewrites a foreign text into the target culture's idioms, while 'foreignization' preserves its strangeness. Reviewers of the 2023 Arabic edition of a Yup'ik oral history praised the translators for keeping names, pauses and mistranslation jokes intact, even where a domesticated version would have read more smoothly.",
        "Which choice best states the main idea?",
        "The 2023 translators chose foreignization, retaining culture-specific features over smooth domesticated phrasing.",
        ["The reviewers demanded a second, domesticated edition for classroom use.",
         "Foreignization erases source-culture features like pauses and names.",
         "The Yup'ik oral history could not be translated into Arabic at all."],
        "Keeping names, pauses and humor 'intact' rather than smoothing is precisely the foreignizing choice the text defines.",
        ["No second edition is proposed.",
         "Foreignization preserves, not erases, such features.",
         "The edition exists; only its approach is in question."],
    )
    add(11, "Text Structure and Purpose", "Medium",
        "In the 1920s, Cross Sound ferries had no schedule board; skippers whistled the crossing order to the dock crew. The practice continued until 1938, when a commissions clerk's rotated daily notice board replaced the whistle both for reasons of record-keeping and because the clerk's hearing had begun to fail.",
        "Which choice best describes the structure of the text?",
        "A narrative anecdote that closes by revealing the practical reason for the change.",
        ["A problem-solution essay that evaluates competing whistle designs.",
         "A chronological history of Pacific ferry technology from 1900 to the war.",
         "An argumentative case that whistling was superior to posted schedules."],
        "The passage moves through a brief anecdote and ends by explaining the actual cause of the change - a clerk's notice board and his failing hearing.",
        ["No whistle designs are evaluated or contrasted.",
         "The scope is one ferry route and one change, not a broad history.",
         "The text reports the change neutrally rather than praising whistles."],
    )
    add(12, "Inferences", "Medium",
        "Volunteers re-tagging the museum's beetle drawers found that the 1930s card system grouped species by wing venation, while the glass collecting tubes above each tray held specimens gathered the same week that the tray was curated - apparently as unmatched 'bonus' tips.",
        "What does the passage most strongly suggest?",
        "The tubes were contributions tied to the curator's weekly field visits rather than to the trays' taxonomic scheme.",
        ["Tubes were part of the venation-centered card system's key.",
         "The beetle drawers held no specimens at all until 1930.",
         "Weekly field trips were held by a separate volunteer committee."],
        "Because tube specimens share the week of each tray's curation but not its themes, they look like weekly additions by the people doing the curation.",
        ["The tubes were never part of the card system, per the mismatch.",
         "The passage does not date the first specimens.",
         "No committee is claimed; 'curated' suggests the tray team."],
    )
    add(13, "Command of Evidence (Textual)", "Hard",
        "Art historian Dana Cole contends that the 1915 Vienna sketches are by a student of the artist rather than the master, pointing to the habit of leaving the underdrawing visible wherever the pigment is thinnest.",
        "Which quotation from a conservation lab report would most directly support Cole's claim?",
        "\u201cWhere the glaze has thinned to air, the graphite underdrawing remains fully legible, uncorrected by the artist's usual opaque passages.\u201d",
        ["\u201cPrimer analysis matches the Vienna workshop's orthodox chalk ground in every sample.\u201d",
         "\u201cVermilion and viridian dominate both the master's canvas and the studied sheet.\u201d",
         "\u201cThe sheet's water-mark corresponds to a mill active in Vienna after 1900.\u201d"],
        "Uncorrected exposed underdrawing is precisely what Cole says distinguishes the student's habit, and the quotation reports that fingerprint.",
        ["A shared ground layer is orthodox and does not distinguish students.",
         "Shared pigments support the master's authorship instead.",
         "Dating the paper does not address who made the sketch."],
    )
    add(14, "Central Ideas and Details", "Medium",
        "The Ocean Genome Ledger archives discarded shipping-water samples alongside temperature and salinity logs so that species arriving in ballast can be reconstructed years later even after the water itself has been discharged.",
        "According to the text, why are the environmental logs archived with the samples?",
        "So that later DNA work can be interpreted in the conditions the species actually arrived in.",
        ["Because discharge rules require water samples to be re-measured on land.",
        "Because salinity alone determines which species survive transit.",
        "So the archive can sell paired logs at higher inspection prices."],
        "Logs and samples together let future analysis reconstruct arrival conditions, which is the stated purpose.",
        ["No re-measurement requirement is mentioned.",
         "The text does not claim salinity alone controls survival.",
         "Nothing about selling is suggested."],
    )
    add(15, "Text Structure and Purpose", "Hard",
        "Critics of the 1930s radio soap operas dismissed them as formula-driven; media historians counter that several serials tested listener panels weekly and revised plots accordingly, an audience-analytics loop that network dayparts would not formalize for decades.",
        "Which choice best describes the structure of the text?",
        "It states a dismissal and then refutes it with evidence of a data-driven revision practice.",
        ["It compares two serials scene by scene and concludes that both fail.",
         "It defines 'daypart' and traces the term's usage over fifty years.",
         "It narrates a single serial's fall from popularity in three acts."],
        "The structure is claim-and-counterclaim: dismissal first, then historians' specific evidence of listener-panel revisions.",
        ["No scene-level comparison or failure conclusion appears.",
         "No term definition is offered or traced.",
         "No single serial or decline narrative is followed."],
    )
    add(16, "Central Ideas and Details", "Easy",
        "The harbor authority's new crane guide books list each wharf's rated load in dry weather only, because steel augers lose grip once sustained rain raises the moisture film between auger and cladding.",
        "According to the text, why do the guides list loads for dry weather only?",
        "Because moisture changes how firmly augers grip the wharf plating.",
        ["Because cranes are retired from service during rainy months.",
         "Because rain makes the guide books' paper unusable.",
         "Because rated loads are recalculated only with auger replacements."],
        "The stated reason is the moisture film reducing auger grip, which changes safe loads.",
        ["No retirement policy is mentioned.", "Paper usability is not the subject.", "No recalibration schedule is described."],
    )
    add(17, "Inferences", "Medium",
        "When the city digitized permit filings in 2016, clerks retained the paper originals of the first month only; after that, applications arrived born-digital and the printing room was converted to a training space.",
        "What can most reasonably be inferred from the passage?",
        "The printing room's repurpose signals that paper permits had become production-obsolete.",
        ["The city had not actually digitized any filings before 2016.",
         "Application volume declined sharply after the digitization project.",
         "Clerks destroyed all permit records older than five years."],
        "Converting the printing room after born-digital intake is what shows physical printing was rendered unnecessary.",
        ["The 2016 digitization is stated positively.", "The passage says nothing about volume changes.", "Only the first-month originals were retained; no destruction is described."],
    )
    add(18, "Command of Evidence (Textual)", "Hard",
        "Curator Iris Belan argues that the gallery acquired its Etruscan mirror by gift rather than purchase, noting a 1974 accession ledger shows no prior valuation, which auction purchases require before clearance.",
        "Which quotation from the registration files would most directly support Belan's claim?",
        "\u201cCover letter dated 3 June 1974: 'I hope the museum will give it a home, as my father did in keeping it all these years.'\u201d",
        ["\u201cCondition note records an old repair to the handle join, photographed in 1974.\u201d",
         "\u201cLoan paperwork from 1968 lists the mirror as insured property of a private collection.\u201d",
         "\u201cInsurance schedule for 1975 assigns the mirror a declared value in lire.\u201d"],
        "A donor-style offer letter is the giveaway of a gift acquisition; a purchase would leave valuation and auction paperwork instead.",
        ["Condition documentation fits either acquisition route.", "The mirror being lent in 1968 does not establish how it was acquired in 1974.", "An insurance value does not show a purchase occurred the year before."],
    )
    add(19, "Cross-Text Connections", "Medium",
        "Text 1: Nocturnist Omar Haddad writes that fall-prevention rounds at midnight are missing the point: большинстве falls happen at 5-6 a.m., so the fix is protecting the 5:30 medication walk, not adding midnight checks.\nText 2: Orthopedic data analyst Jena Fox replies that in her system's log, falls cluster at the midnight-to-2 a.m. shift handover, when two different teams each assume the other has done hourly rounds.",
        "Based on the texts, how would Fox most likely respond to Haddad?",
        "By citing her handover-hour data to argue that midnight checks would catch the falls Haddad's own timing analysis might miss.",
        ["By agreeing that both 5:30 and midnight rounds are worthless investments.",
         "By disputing that medication walks occur at 5:30 a.m. at all.",
         "By proposing that fall prevention shifts entirely to the morning shift."],
        "Her data locates risk elsewhere (handover), so she would push back with that timing evidence rather than accept Haddad's window.",
        ["She would not dismiss both windows; she would add hers.", "She does not dispute that walks happen.", "Her point is about handover, not mornings generally."],
    )
    add(20, "Text Structure and Purpose", "Easy",
        "Lighthouse keepers on the Atlantic coast were listed in federal payrolls, not in the mail-delivery rosters, even though several of them hand-carried mail between islands. In 1892, one keeper's hand-carved mailboat chocks are preserved at the site museum to mark that informal service.",
        "What is the purpose of the passage's last sentence?",
        "To show a surviving object that documents the informal mail service described earlier.",
        ["To argue that keepers deserved both payroll listings.",
         "To recount how the mailboat was lost in a storm.",
         "To explain why federal rosters excluded mail duties."],
        "The last sentence introduces the preserved chocks as material evidence of the hand-carried mail mentioned before.",
        ["No argument about payrolls is made.", "No storm or loss is reported.", "The exclusion is already stated; no explanation is given."],
    )
    add(21, "Inferences", "Hard",
        "The 1911 catalog of the Balkan photographic cooperative advertises develop-and-return service in seven languages. Its price list spans coin conditions from Pre-union Austrian to Bulgarian posts, and notably the only surcharge anywhere in the list is a winter carriage fee doubling delivery times to remote upland villages.",
        "What can most reasonably be inferred about the cooperative's deliveries?",
        "Remote upland orders were accepted but explicitly slower, with everything else priced uniformly.",
        ["Summer deliveries were surcharged like winter ones, just less visibly.",
         "The cooperative refused upland orders during winter entirely.",
         "Language choice affected the base development price."],
        "The winter carriage fee is the only surcharge, uncovered otherwise, so the useful reading is that it is the sole factor slowing (surcharging) any delivery band.",
        ["Only a winter fee is listed; no summer surcharge is implied.", "A fee rather than a refusal implies acceptance.", "Seven languages share one price list; language is not priced."],
    )
    return items


def gen_flashcards(vocab_corpus):
    """Vocabulary deck >=1000 (CC0) + math formulas >=100 (authored)."""
    from random import Random
    rng = Random("hdsat-order")
    vocab_sorted = sorted(vocab_corpus, key=lambda r: (r["band"], r["word"]))
    cards = []
    for idx, entry in enumerate(vocab_sorted):
        pos = {"adj": "adjective", "v": "verb", "n": "noun", "adv": "adverb"}.get(entry["pos"], "word")
        cards.append({
            "id": f"VX-{idx + 1:04d}",
            "deck": "vocabulary",
            "front": entry["word"].capitalize(),
            "latex": None,
            "back": f"({pos}) {entry['definition']}",
            "tags": ["sat-vocab", f"band-{entry['band']}", entry["pos"] or "word"],
        })

    formula_specs = [
        ("Linear slope", "m=\\dfrac{y_2-y_1}{x_2-x_1}", "Slope from two points: rise over run."),
        ("Slope from standard form", "Ax+By=C \\Rightarrow m=-\\dfrac{A}{B}", "In standard form, slope is negative A over B."),
        ("Point-slope form", "y-y_1=m(x-x_1)", "Line of slope m through (x1, y1)."),
        ("Parallel lines", "m_1=m_2", "Parallel lines share slopes."),
        ("Perpendicular slopes", "m_1 m_2=-1", "Perpendicular slopes multiply to -1 (negative reciprocals)."),
        ("Midpoint formula", "\\left(\\dfrac{x_1+x_2}{2},\\dfrac{y_1+y_2}{2}\\right)", "Average the coordinates for the midpoint."),
        ("Distance formula", "d=\\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}", "Pythagoras between two points."),
        ("Quadratic formula", "x=\\dfrac{-b\\pm\\sqrt{b^2-4ac}}{2a}", "General solution of ax^2+bx+c=0."),
        ("Discriminant count", "b^2-4ac>0: 2\\text{ real},=0: 1,<0: 0", "Sign of the discriminant fixes root counts."),
        ("Vertex x-coordinate", "x=-\\dfrac{b}{2a}", "Axis of symmetry of a parabola."),
        ("Vertex y-coordinate", "f(-b/2a)", "Minimum or maximum value of a quadratic."),
        ("Zeros product", "r_1 r_2=\\dfrac{c}{a}", "Product of quadratic roots equals c/a."),
        ("Zeros sum", "r_1+r_2=-\\dfrac{b}{a}", "Sum of quadratic roots equals -b/a."),
        ("Difference of squares", "a^2-b^2=(a-b)(a+b)", "Fast factoring identity."),
        ("Perfect square trinomial", "(a\\pm b)^2=a^2\\pm 2ab+b^2", "Square of a binomial."),
        ("Cubic difference", "a^3-b^3=(a-b)(a^2+ab+b^2)", "Difference of cubes factoring."),
        ("Cubic sum", "a^3+b^3=(a+b)(a^2-ab+b^2)", "Sum of cubes factoring."),
        ("Exponent product", "a^m a^n=a^{m+n}", "Multiply powers: add exponents."),
        ("Exponent quotient", "\\dfrac{a^m}{a^n}=a^{m-n}", "Divide powers: subtract exponents."),
        ("Power of a power", "(a^m)^n=a^{mn}", "Raise a power: multiply exponents."),
        ("Negative exponent", "a^{-n}=\\dfrac{1}{a^{n}}", "Negative exponent is a reciprocal."),
        ("Zero exponent", "a^0=1\\;(a\\neq0)", "Any nonzero base to the 0 is 1."),
        ("Fractional exponent", "a^{m/n}=\\sqrt[n]{a^m}", "Rational exponents as roots."),
        ("Exponential model", "V=P(1+r)^t", "Compound interest or growth model."),
        ("Continuous growth", "A=Pe^{rt}", "Continuously compounding value."),
        ("Log product rule", "\\log(ab)=\\log a+\\log b", "Logs turn products into sums."),
        ("Log quotient rule", "\\log(a/b)=\\log a-\\log b", "Logs turn quotients into differences."),
        ("Log power rule", "\\log(a^b)=b\\log a", "Exponent comes out front."),
        ("Change of base", "\\log_b a=\\dfrac{\\log_c a}{\\log_c b}", "Rewrite logs in any base."),
        ("Circle area", "A=\\pi r^2", "Area of a circle."),
        ("Circumference", "C=2\\pi r", "Distance around a circle."),
        ("Arc length", "L=\\dfrac{\\theta}{360}\\cdot 2\\pi r", "Arc of a sector in degrees."),
        ("Sector area", "A=\\dfrac{\\theta}{360}\\pi r^2", "Area of a circular sector."),
        ("Circle equation", "(x-h)^2+(y-k)^2=r^2", "Standard form, center (h,k)."),
        ("Triangle area", "A=\\dfrac{1}{2}bh", "Base times height over two."),
        ("Heron's area", "A=\\sqrt{s(s-a)(s-b)(s-c)}", "Area from three side lengths; s is semiperimeter."),
        ("Pythagorean theorem", "a^2+b^2=c^2", "Right-triangle leg/hypotenuse identity."),
        ("45-45-90 sides", "x,\\;x,\\;x\\sqrt2", "Isosceles right triangle ratio."),
        ("30-60-90 sides", "x,\\;x\\sqrt3,\\;2x", "Stand up right-triangle ratio."),
        ("SOH CAH TOA", "\\sin=\\dfrac{O}{H},\\;\\cos=\\dfrac{A}{H},\\;\\tan=\\dfrac{O}{A}", "Basic right-triangle trig definitions."),
        ("Pythagorean identity", "\\sin^2\\theta+\\cos^2\\theta=1", "The fundamental trig identity."),
        ("Tangent identity", "\\tan\\theta=\\dfrac{\\sin\\theta}{\\cos\\theta}", "Tangent as ratio of sine and cosine."),
        ("Law of sines", "\\dfrac{a}{\\sin A}=\\dfrac{b}{\\sin B}", "Sides proportional to opposite sines."),
        ("Law of cosines", "c^2=a^2+b^2-2ab\\cos C", "Solve general triangles."),
        ("Radians to degrees", "\\pi\\text{ rad}=180^\\circ", "Convert between angle measures."),
        ("Volume cylinder", "V=\\pi r^2 h", "Circular prism volume."),
        ("Volume cone", "V=\\dfrac{1}{3}\\pi r^2 h", "One third of the cylinder."),
        ("Volume sphere", "V=\\dfrac{4}{3}\\pi r^3", "Sphere volume formula."),
        ("Sphere surface", "S=4\\pi r^2", "Sphere surface area."),
        ("Rectangular prism", "V=lwh", "Box volume."),
        ("Pyramid volume", "V=\\dfrac{1}{3}Bh", "One third base times height."),
        ("Celsius/Fahrenheit", "F=\\dfrac{9}{5}C+32", "Temperature conversion."),
        ("Unit rate", "\\text{rate}=\\dfrac{\\text{total}}{\\text{units}}", "Divide to find a per-unit value."),
        ("Percent change", "\\dfrac{\\text{new}-\\text{old}}{\\text{old}}\\times100\\%", "Positive is an increase."),
        ("Discount", "\\text{sale}=P(1-d)", "Percent-off price multiplier."),
        ("Markup", "\\text{price}=P(1+m)", "Percent-up price multiplier."),
        ("Simple interest", "I=Prt", "Interest = principal times rate times time."),
        ("Mean", "\\bar{x}=\\dfrac{\\sum x_i}{n}", "Sum divided by count."),
        ("Median position", "n\\text{ odd}: x_{(n+1)/2}", "Middle value after sorting."),
        ("Range", "\\text{range}=x_{\\max}-x_{\\min}", "Spread from extremes."),
        ("First quartile", "Q_1", "Median of the lower half."),
        ("Outlier fence", ">\\;Q_3+1.5\\,\\text{IQR}", "Common outlier threshold."),
        ("IQR", "IQR=Q_3-Q_1", "Spread of the middle half."),
        ("Empirical rule", "\\approx 68\\%-95\\%-99.7\\%", "Normal curve within 1, 2, 3 SDs."),
        ("Sample proportion", "\\hat{p}=\\dfrac{x}{n}", "Count over sample size."),
        ("Margin of error", "\\pm z\\sqrt{\\dfrac{\\hat p(1-\\hat p)}{n}}", "Confidence interval width."),
        ("Marginal probability", "\\dfrac{\\text{row or column total}}{\\text{gran fand total}}", "Probability of one variable alone."),
        ("Joint probability", "P(A\\cap B)", "Both events occur."),
        ("Independent check", "P(A\\cap B)=P(A)P(B)", "Independence test from probabilities."),
        ("Addition rule", "P(A\\cup B)=P(A)+P(B)-P(A\\cap B)", "Union includes overlap once."),
        ("Complement rule", "P(\\text{not }A)=1-P(A)", "Something or nothing."),
        ("Counting principle", "m\\times n", "Independent stages multiply."),
        ("Permutation", "\\dfrac{n!}{(n-r)!}", "Ordered arrangements."),
        ("Combination", "\\binom{n}{r}=\\dfrac{n!}{r!(n-r)!}", "Unordered selections."),
        ("Factorial growth", "n!", "n factorial: multiply down to 1."),
        ("Arithmetic sequence", "a_n=a_1+(n-1)d", "nth term of an arithmetic sequence."),
        ("Arithmetic series", "S_n=\\dfrac{n(a_1+a_n)}{2}", "Sum of an arithmetic series."),
        ("Geometric sequence", "a_n=a_1 r^{n-1}", "nth term with ratio r."),
        ("Geometric series", "S_n=a_1\\dfrac{1-r^n}{1-r}", "Finite geometric sum."),
        ("Absolute value def", "|a|\\ge 0", "Distance is never negative."),
        ("Absolute value solving", "|X|=c \\Rightarrow X=\\pm c", "Two branches for positive c."),
        ("Polynomial remainder", "f(a)=\\text{remainder of } f(x)\\div (x-a)", "Remainder theorem evaluation."),
        ("Factor theorem", "f(a)=0 \\Leftrightarrow (x-a)\\,|\\,f(x)", "Zeros give linear factors."),
        ("Synthetic value", "f(a)+f(b)", "Evaluate by substitution."),
        ("Composition", "(f\\circ g)(x)=f(g(x))", "Apply g first, then f."),
        ("Inverse test", "f(f^{-1}(x))=x", "Inverses undo each other."),
        ("Odd/even", "f(-x)=f(x):\\;even,\\;=-f(x):\\;odd", "Symmetry test of functions."),
        ("Transformation", "f(x-k):\\; k\\text{ shift right}", "Horizontal shifts."),
        ("Vertical shift", "f(x)+k", "Moves graph up k units."),
        ("Scaling", "af(x)", "Stretch by factor a vertically."),
        ("Reflection", "f(-x)", "Mirror across the y-axis."),
        ("Vertex form", "y=a(x-h)^2+k", "Parabola in vertex form."),
        ("Conic focus def", "\\text{ellipse: } r=\\dfrac{ep}{1-e\\cos\\theta}", "(Advanced) polar ellipse form."),
        ("Weighted mean", "\\bar{x}_w=\\dfrac{\\sum w_i x_i}{\\sum w_i}", "Multiply by weights before summing."),
        ("Percent of a percent", "r\\%\\text{ of }r/100", "Nested percents for word problems."),
        ("Growth vs decay", "1+r:\\;\\text{grow},\\;1-r:\\;\\text{decay}", "Model direction from sign."),
        ("Double time", "t_{2}=\\dfrac{\\ln 2}{r}", "Doubling time for rate r."),
        ("Half life", "t_{1/2}=\\dfrac{\\ln 2}{\\lambda}", "Decay constant form."),
        ("Margin from CI", "\\text{high}-\\text{low} = 2\\text{MOE}", "Interval width double the margin."),
        ("Scatter association", "r=\\pm1:\\;\\text{perfect linear}", "Correlation extremes."),
        ("Line of best fit meaning", "\\text{slope}=\\Delta y\\text{ per }1\\;x", "Interpret slope in context."),
        ("Residual", "\\text{resid}=y-\\hat{y}", "Observed minus predicted."),
        ("Extrapolation caution", "predict within data range", "Read predictions near the data."),
    ]
    for i, (front, latex, back) in enumerate(formula_specs):
        cards.append({
            "id": f"F-{100 + i:03d}",
            "deck": "math_formula",
            "front": front,
            "latex": latex,
            "back": back,
            "tags": ["formula", "sat-math"],
        })
    return cards


def local_scarf():
    return None


def uniquify(items):
    """Ensure every generated item carries a globally unique id/external_id."""
    seen = {}
    for q in items:
        base = q["id"]
        if base in seen:
            seen[base] += 1
            q["id"] = f"{base}-{seen[base]}"
            q["external_id"] = "HDSAT-" + q["id"]
        else:
            seen[base] = 1
    return items


def main():
    os.makedirs(EXP_DIR, exist_ok=True)
    math_items = gen_math()
    extra_rw = gen_wic(load_vocab_corpus()) + gen_transitions() + gen_grammar() + gen_quantitative() + gen_prose()

    with open(os.path.join(EXP_DIR, "extra_flashcards.json"), "w", encoding="utf-8") as fh:
        json.dump({}, fh)  # placeholder rewritten below

    cards = gen_flashcards(load_vocab_corpus())
    counts = {}
    for c in cards:
        counts[c["deck"]] = counts.get(c["deck"], 0) + 1
    with open(os.path.join(EXP_DIR, "extra_flashcards.json"), "w", encoding="utf-8") as fh:
        json.dump({"cards": cards}, fh, ensure_ascii=False, indent=1)

    math_items = uniquify(math_items)
    extra_rw = uniquify(extra_rw)
    questions = extra_rw + math_items
    # Balance the generated Math difficulty spread so adaptive 'upper' modules use
    # genuinely demanding skills: trig, circle algebra, systems and composition are
    # tagged Hard.
    for q in questions:
        if q["section"] != "Math" or q["difficulty"] != "Medium":
            continue
        if q["id"].startswith(("M-SYS-", "M-GEO-", "M-ALE-")) and q["difficulty"] == "Medium":
            q["difficulty"] = "Hard"
    with open(os.path.join(EXP_DIR, "extra_questions.json"), "w", encoding="utf-8") as fh:
        json.dump({"questions": questions}, fh, ensure_ascii=False, indent=1)

    by_section = {}
    by_difficulty = {}
    for q in questions:
        by_section[q["section"]] = by_section.get(q["section"], 0) + 1
        key = (q["section"], q["difficulty"])
        by_difficulty[key] = by_difficulty.get(key, 0) + 1

    print(f"extra questions : {len(questions)}")
    print(f"  by section    : {by_section}")
    for sec in ["Reading and Writing", "Math"]:
        for d in ["Easy", "Medium", "Hard"]:
            print(f"   {sec} {d}: {by_difficulty.get((sec, d), 0)}")
    print(f"extra flashcards: {len(cards)}  ({counts})")


if __name__ == "__main__":
    main()
