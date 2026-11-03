#!/usr/bin/env python3
"""Generate the final Math top-up needed to reach 10,000 bank items.

Every answer is computed exactly in Python from the numbers printed in the
stimulus, and each item is checked before it is written: unique stem, four
distinct choices, key present, and a rationale long enough for the content gate.
No item is copied from an external source; Math drills are HDSAT-authored.

Usage:
    python supabase/import/generate_math_topup.py --out expansion/math_topup.json
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import sys
from fractions import Fraction

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from generate_bank_expansion import ALL_ASSESSMENTS, mc, spr  # noqa: E402

MATH = "Math"
ALG, ADV, GEO, PSD = (
    "Algebra", "Advanced Math", "Geometry and Trigonometry",
    "Problem-Solving and Data Analysis",
)
D_E, D_M, D_H = "Easy", "Medium", "Hard"
TARGET = 1870

items: list[dict] = []
_seen: set[tuple[str, str]] = set()


def push(question: dict) -> bool:
    key = (question["stimulus"].strip(), question["prompt"].strip())
    if key in _seen:
        return False
    _seen.add(key)
    items.append(question)
    return True


def qid() -> str:
    return f"M-TOP-{len(items) + 1:04d}"


def frac(value: Fraction) -> str:
    if value.denominator == 1:
        return str(value.numerator)
    return f"$\\dfrac{{{value.numerator}}}{{{value.denominator}}}$"


def numeric_wrongs(correct: int, candidates: list[int]) -> list[int]:
    """Three distinct integers, never equal to the key or to each other."""
    out: list[int] = []
    for value in candidates:
        if value != correct and value not in out:
            out.append(value)
    bump = 1
    while len(out) < 3:
        value = correct + bump
        if value != correct and value not in out:
            out.append(value)
        bump += 1
    return out


# ---------------------------------------------------------------------------
# Algebra: one-variable linear rate
# ---------------------------------------------------------------------------
RATE_CONTEXTS = [
    "A community garden starts the month with {b} seedling trays and adds the same number of trays every cycle. After {w} cycles it holds {c} trays.",
    "A ferry charges a flat {b}-dollar boarding fee plus the same amount per passenger. A group of {w} passengers paid {c} dollars in total.",
    "A clay studio keeps {b} finished mugs in reserve and restocks the same number at every firing. After {w} firings the shelf holds {c} mugs.",
    "A courier bills {b} dollars for pickup plus the same rate per mile on a {w}-mile run, totaling {c} dollars.",
    "A print shop charges {b} dollars to set up a press plus the same price per poster. An order of {w} posters cost {c} dollars.",
    "An aquarium begins with {b} gallons and receives the same number of gallons each hour for {w} hours, reaching {c} gallons.",
    "A bakery starts the morning with {b} loaves and bakes the same number every hour. After {w} hours it has {c} loaves.",
    "A repair shop charges {b} dollars for diagnostics plus the same labor rate per hour. A {w}-hour job cost {c} dollars.",
    "A library begins with {b} returned books and receives the same number each day. After {w} days it holds {c} books.",
    "An orchard starts with {b} full crates and fills the same number each picking round. After {w} rounds it has {c} crates.",
    "A candle maker starts with {b} jars and fills the same number every batch. After {w} batches there are {c} jars.",
    "A box office starts with {b} reserved seats and releases the same number each hour. After {w} hours {c} seats are reserved.",
]


def gen_rates(target: int) -> None:
    made = 0
    for ctx in RATE_CONTEXTS:
        for rate in range(2, 16):
            for base in (10, 15, 20, 25, 30, 40, 50, 60, 70, 80):
                if made >= target:
                    return
                periods = 4 + (rate + base) % 7
                total = base + rate * periods
                text = ctx.format(b=base, w=periods, c=total)
                question = spr(
                    qid(), MATH, ALG, "Linear equations in one variable",
                    D_E if rate <= 8 else D_M,
                    text,
                    "What is the repeated amount added each cycle, in units per cycle?",
                    str(rate),
                    f"The model is start plus rate times cycles: {base} + r({periods}) = "
                    f"{total}. Subtracting {base} gives {rate * periods}, and dividing "
                    f"by {periods} gives r = {rate}. Substitution reproduces {total}.",
                )
                if push(question):
                    made += 1


# ---------------------------------------------------------------------------
# Algebra: variables on both sides
# ---------------------------------------------------------------------------
def gen_two_sided(target: int) -> None:
    made = 0
    for a in range(4, 13):
        for c in range(1, a - 1):
            for x in range(2, 13):
                for b in range(5, 42, 3):
                    if made >= target:
                        return
                    d = b + (a - c) * x
                    text = f"Solve for $x$: ${a}x + {b} = {c}x + {d}$"
                    cand = [x + 1, x - 1, d - b]
                    cand = [v for v in dict.fromkeys(cand) if v != x and v > 0][:3]
                    bump = 2
                    while len(cand) < 3:
                        if x + bump not in cand:
                            cand.append(x + bump)
                        bump += 1
                    question = mc(
                        qid(), MATH, ALG, "Linear equations in one variable",
                        D_M, text, "What is the value of $x$?",
                        f"${x}$", [f"${v}$" for v in cand],
                        f"Subtract ${c}x$ from both sides: ${a - c}x + {b} = {d}$, so "
                        f"${a - c}x = {d - b}$ and $x = {x}$. Substitution makes both "
                        f"sides equal {a * x + b}.",
                        [f"Substituting {v} gives ${a}({v}) + {b} = {a * v + b}$, not "
                         f"${c}({v}) + {d} = {c * v + d}$." for v in cand],
                    )
                    if push(question):
                        made += 1


# ---------------------------------------------------------------------------
# Algebra: systems
# ---------------------------------------------------------------------------
def gen_systems(target: int) -> None:
    made = 0
    for x in range(2, 13):
        for y in range(2, 11):
            for a1, b1 in ((2, 1), (3, 2), (1, 4), (4, 1), (2, 3)):
                for a2, b2 in ((1, 3), (3, 1), (2, 5), (5, 2), (1, 2)):
                    if made >= target:
                        return
                    if a1 * b2 - a2 * b1 == 0:
                        continue
                    e1 = a1 * x + b1 * y
                    e2 = a2 * x + b2 * y
                    ask_x = made % 2 == 0
                    answer = x if ask_x else y
                    text = (f"Solve the system: ${a1}x + {b1}y = {e1}$ and "
                            f"${a2}x + {b2}y = {e2}$")
                    question = spr(
                        qid(), MATH, ALG,
                        "Systems of two linear equations in two variables",
                        D_M, text,
                        "What is the value of $x$?" if ask_x else "What is the value of $y$?",
                        str(answer),
                        f"Eliminating one variable gives $x = {x}$ and $y = {y}$. "
                        f"Substitution checks both equations: {a1}({x}) + {b1}({y}) = "
                        f"{e1} and {a2}({x}) + {b2}({y}) = {e2}.",
                    )
                    if push(question):
                        made += 1


# ---------------------------------------------------------------------------
# Algebra: slope
# ---------------------------------------------------------------------------
def gen_slopes(target: int) -> None:
    made = 0
    for x1 in range(0, 9):
        for x2 in range(x1 + 1, 12):
            for y1 in range(0, 9):
                for y2 in range(0, 12):
                    if made >= target:
                        return
                    if y1 == y2:
                        continue
                    slope = Fraction(y2 - y1, x2 - x1)
                    text = (f"A line passes through the points $({x1}, {y1})$ and "
                            f"$({x2}, {y2})$.")
                    wrongs = []
                    for cand in (Fraction(y2 + y1, x2 - x1), Fraction(y2 - y1, x2 + x1 + 1),
                                 Fraction(x2 - x1, y2 - y1)):
                        if cand != slope and cand not in wrongs:
                            wrongs.append(cand)
                    bump = 1
                    while len(wrongs) < 3:
                        cand = slope + bump
                        if cand != slope and cand not in wrongs:
                            wrongs.append(cand)
                        bump += 1
                    question = mc(
                        qid(), MATH, ALG, "Linear functions: slope and intercepts",
                        D_E if slope.denominator == 1 else D_M,
                        text, "What is the slope of the line?",
                        frac(slope), [frac(v) for v in wrongs],
                        f"Slope is the change in $y$ over the change in $x$: "
                        f"({y2} - {y1})/({x2} - {x1}) = {y2 - y1}/{x2 - x1} = "
                        f"{frac(slope)}.",
                        ["This reverses which difference belongs in the numerator.",
                         "This uses the sum of the x-coordinates instead of their difference.",
                         "This inverts the slope."][:len(wrongs)],
                    )
                    if push(question):
                        made += 1


# ---------------------------------------------------------------------------
# Advanced Math: exponential growth
# ---------------------------------------------------------------------------
def gen_exponential(target: int) -> None:
    made = 0
    for factor in (2, 3, 4):
        for years in (2, 3, 4):
            for start in range(5, 26):
                if made >= target:
                    return
                final = start * factor ** years
                question = spr(
                    qid(), MATH, ADV, "Exponential growth and decay",
                    D_M, f"A colony starts with {start} cells and grows by a factor "
                         f"of {factor} every year for {years} years.",
                    "How many cells are present at the end of the period?",
                    str(final),
                    f"The population multiplies by {factor} each year, so after "
                    f"{years} years it is {start} times {factor}^{years} = {final}. "
                    f"Repeated multiplication confirms the same value.",
                )
                if push(question):
                    made += 1


# ---------------------------------------------------------------------------
# Problem solving: percent discount
# ---------------------------------------------------------------------------
def gen_percents(target: int) -> None:
    made = 0
    for original in range(20, 210, 10):
        for discount in range(5, 55, 5):
            if made >= target:
                return
            if original * discount % 100:
                continue
            sale = original - original * discount // 100
            wrongs = numeric_wrongs(
                sale,
                [sale + discount, original - discount,
                 original * (100 - discount) // 100 + 5],
            )
            question = mc(
                qid(), MATH, PSD, "Percentages", D_E if discount <= 20 else D_M,
                f"A jacket priced at ${original} is discounted by {discount}%.",
                "What is the sale price, in dollars?",
                f"${sale}", [f"${v}" for v in wrongs],
                f"The discount is {discount}% of ${original}, or ${original * discount // 100}. "
                f"Subtracting that from ${original} gives ${sale}.",
                [f"${v} does not equal {original} minus {discount}% of {original}."
                 for v in wrongs],
            )
            if push(question):
                made += 1


# ---------------------------------------------------------------------------
# Advanced Math: vertex of a parabola
# ---------------------------------------------------------------------------
def gen_vertices(target: int) -> None:
    made = 0
    for a in (1, 2, -1):
        for h in range(-5, 6):
            for k in range(-5, 6):
                if made >= target:
                    return
                text = (f"The equation $y = {a}(x - ({h}))^2 + ({k})$ is graphed in "
                        f"the coordinate plane.")
                wrongs = [f"({k}, {h})", f"({-h}, {k})", f"({h}, {-k})"]
                wrongs = [v for v in dict.fromkeys(wrongs) if v != f"({h}, {k})"][:3]
                bump = 1
                while len(wrongs) < 3:
                    cand = f"({h + bump}, {k})"
                    if cand != f"({h}, {k})" and cand not in wrongs:
                        wrongs.append(cand)
                    bump += 1
                question = mc(
                    qid(), MATH, ADV, "Quadratic functions: vertex and symmetry",
                    D_M, text, "What are the coordinates of the vertex of the parabola?",
                    f"({h}, {k})", wrongs,
                    f"The vertex form is $y = a(x - h)^2 + k$, so the vertex is "
                    f"$(h, k) = ({h}, {k})$. The squared term is zero at $x = {h}$.",
                    ["This swaps the coordinates.", "This negates the x-coordinate.",
                     "This negates the y-coordinate."],
                )
                if push(question):
                    made += 1


# ---------------------------------------------------------------------------
# Advanced Math: integer roots
# ---------------------------------------------------------------------------
def gen_roots(target: int) -> None:
    made = 0
    for a in (1, 2):
        for r1 in range(1, 11):
            for r2 in range(r1 + 1, 16):
                if made >= target:
                    return
                b = -a * (r1 + r2)
                c = a * r1 * r2
                text = (f"The quadratic ${a}x^2 {'+' if b >= 0 else '-'} {abs(b)}x "
                        f"{'+' if c >= 0 else '-'} {abs(c)} = 0$ has two positive roots.")
                question = spr(
                    qid(), MATH, ADV, "Factoring quadratics and zeros", D_M,
                    text, "What is the smaller of the two positive roots?",
                    str(r1),
                    f"Factoring gives ${a}(x - {r1})(x - {r2}) = 0$, so the roots are "
                    f"{r1} and {r2}. The smaller root is {r1}. Substitution makes the "
                    f"expression zero.",
                )
                if push(question):
                    made += 1


# ---------------------------------------------------------------------------
# Problem solving: mean and probability
# ---------------------------------------------------------------------------
def gen_means(target: int) -> None:
    made = 0
    for step in (2, 3, 4):
        for start in range(1, 41):
            if made >= target:
                return
            values = [start + step * i for i in range(5)]
            mean = sum(values) // 5
            if sum(values) % 5:
                continue
            question = spr(
                qid(), MATH, PSD,
                "One-variable data: distributions and measures of center and spread",
                D_E, "A data set contains the values " + ", ".join(map(str, values)) + ".",
                "What is the mean of the data set?",
                str(mean),
                f"The sum is {sum(values)}, and there are 5 values, so the mean is "
                f"{sum(values)}/5 = {mean}. The values are equally spaced, so the middle "
                f"value also equals the mean.",
            )
            if push(question):
                made += 1


def gen_probability(target: int) -> None:
    made = 0
    for red in range(1, 13):
        for blue in range(1, 13):
            if made >= target:
                return
            total = red + blue
            p = Fraction(red, total)
            question = spr(
                qid(), MATH, PSD, "Probability and conditional probability",
                D_E if total <= 12 else D_M,
                f"A bag contains {red} red marbles and {blue} blue marbles. One marble "
                f"is drawn at random.",
                "What is the probability that the marble is red?",
                f"{p.numerator}/{p.denominator}",
                f"There are {red} red marbles out of {total} total, so the probability "
                f"is {red}/{total}, which simplifies to {p.numerator}/{p.denominator}.",
            )
            if push(question):
                made += 1


# ---------------------------------------------------------------------------
# Problem solving: unit rates
# ---------------------------------------------------------------------------
def gen_rates_units(target: int) -> None:
    made = 0
    for miles in range(60, 321, 10):
        for hours in range(2, 7):
            if made >= target:
                return
            speed = miles // hours
            if speed * hours != miles:
                continue
            question = spr(
                qid(), MATH, PSD, "Unit rates and conversions",
                D_E if speed <= 60 else D_M,
                f"A train travels {miles} miles in {hours} hours at a constant speed.",
                "What is the train's speed in miles per hour?",
                str(speed),
                f"Speed is distance divided by time: {miles} miles / {hours} hours = "
                f"{speed} miles per hour. Multiplying {speed} by {hours} returns "
                f"{miles}.",
            )
            if push(question):
                made += 1


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------
def gen_geometry(target: int) -> None:
    made = 0
    for radius in range(2, 15):
        if made >= target:
            return
        area = radius * radius
        coeffs = numeric_wrongs(area, [2 * radius, radius, 2 * area])
        wrongs = [f"${value}\\pi$" for value in coeffs]
        question = mc(
            qid(), MATH, GEO, "Circles: area and circumference", D_E,
            f"A circle has radius ${radius}$ centimeters.",
            "What is the area of the circle, in square centimeters?",
            f"${area}\\pi$", wrongs,
            f"The area of a circle is $\\pi r^2$. Substituting r = {radius} gives "
            f"$\\pi({radius})^2 = {area}\\pi$ square centimeters.",
            ["This is the circumference, not the area.", "This uses r instead of r squared.",
             "This doubles the square of the radius."],
        )
        if push(question):
            made += 1

    for length in range(3, 16):
        for width in range(2, 13):
            if made >= target:
                return
            area = length * width
            wrongs = numeric_wrongs(
                area, [2 * (length + width), length + width, area + length]
            )
            question = mc(
                qid(), MATH, GEO, "Volume and surface area", D_E,
                f"A rectangle has length {length} centimeters and width {width} centimeters.",
                "What is the area of the rectangle, in square centimeters?",
                f"${area}$", [f"${v}$" for v in wrongs],
                f"The area of a rectangle is length times width: {length} times {width} "
                f"equals {area} square centimeters.",
                ["This is the perimeter, not the area.", "This adds the sides instead of multiplying.",
                 "This adds the length to the product."],
            )
            if push(question):
                made += 1

    for base in range(4, 20, 2):
        for height in range(3, 16):
            if made >= target:
                return
            area = base * height // 2
            if base * height % 2:
                continue
            wrongs = numeric_wrongs(area, [base * height, base + height, area + base])
            question = mc(
                qid(), MATH, GEO, "Lines, angles, and triangles", D_M,
                f"A triangle has base {base} centimeters and height {height} centimeters.",
                "What is the area of the triangle, in square centimeters?",
                f"${area}$", [f"${v}$" for v in wrongs],
                f"The area of a triangle is one half of base times height: "
                f"(1/2)({base})({height}) = {area} square centimeters.",
                ["This omits the factor of one half.", "This adds the base and height.",
                 "This adds the base to the correct area."],
            )
            if push(question):
                made += 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="expansion/math_topup.json")
    args = parser.parse_args()

    gen_rates(280)
    gen_two_sided(205)
    gen_systems(205)
    gen_slopes(205)
    gen_exponential(145)
    gen_percents(145)
    gen_vertices(145)
    gen_roots(145)
    gen_means(95)
    gen_probability(95)
    gen_rates_units(95)
    gen_geometry(119)

    # Re-index once, after every family has contributed.
    for index, question in enumerate(items, start=1):
        question["id"] = f"M-TOP-{index:04d}"
        question["external_id"] = "HDSAT-" + question["id"]

    failures = 0
    stems: set[tuple[str, str]] = set()
    for question in items:
        key = (question["stimulus"], question["prompt"])
        if key in stems:
            failures += 1
            print("DUPLICATE", question["id"])
        stems.add(key)
        if question["section"] != MATH:
            failures += 1
        if len(question["explanation"]) < 40:
            failures += 1
        if question["format"] == "multiple_choice":
            texts = [c["text"] for c in question["choices"]]
            if len(texts) != 4 or len(set(texts)) != 4:
                failures += 1
                print("CHOICES", question["id"])
            if question["correct_answer"] not in [c["id"] for c in question["choices"]]:
                failures += 1
        else:
            if question["correct_answer"] not in question["acceptable_answers"]:
                failures += 1

    out = HERE / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"questions": items[:TARGET]}, indent=1, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    by_domain: dict[str, int] = {}
    by_format: dict[str, int] = {}
    for question in items[:TARGET]:
        by_domain[question["domain"]] = by_domain.get(question["domain"], 0) + 1
        by_format[question["format"]] = by_format.get(question["format"], 0) + 1
    print(f"wrote {len(items[:TARGET])} items to {out}")
    print(by_domain)
    print(by_format)
    print(f"validation failures: {failures}")
    return 1 if failures or len(items) < TARGET else 0


if __name__ == "__main__":
    raise SystemExit(main())
