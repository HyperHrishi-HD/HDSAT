#!/usr/bin/env python3
"""
HDSAT figure-based Math items.

The scaled bank is strong on symbolic algebra but thin on questions whose
stimulus is a coordinate plane or a labelled geometry diagram. This module adds
those, with figure_metadata that the client renders as real SVG:

  coordinate_plane — grid, axes, lines, labelled points, parabolas
  geometry_figure  — right triangles, triangles, rectangles, circles

Every answer is computed from the same numbers the figure draws, so the diagram
and the key can never disagree.

Output: merged by generate_bank_scale.py into expansion/extra_questions.json.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from generate_bank_expansion import ALL_ASSESSMENTS, EXP_DIR, mc  # noqa: E402

MATH = "Math"
ALG = "Algebra"
ADV = "Advanced Math"
GEO = "Geometry and Trigonometry"
D_E, D_M, D_H = "Easy", "Medium", "Hard"


def _coordinate(figure):
    return {"type": "coordinate_plane", **figure}


def _geometry(figure):
    return {"type": "geometry_figure", **figure}


def _wrongs(correct, candidates):
    """Three distractors that never repeat the key or each other."""
    out = []
    for value in candidates:
        if value != correct and value not in out:
            out.append(value)
    bump = 1
    while len(out) < 3:
        try:
            base = float(correct)
            candidate = str(int(base + bump)) if base == int(base) else str(base + bump)
        except ValueError:
            candidate = correct + str(bump)
        if candidate != correct and candidate not in out:
            out.append(candidate)
        bump += 1
    return out[:3]


# ---------------------------------------------------------------------------
# Coordinate plane: linear functions
# ---------------------------------------------------------------------------
LINEAR_CASES = [
    (2, 1, 3),
    (-1, 4, 2),
    (3, -2, 1),
    (-2, -1, -3),
    (1, 3, 4),
    (-3, 2, 2),
    (0.5, -3, 4),
    (2, -4, 3),
    (-1.5, 1, 3),
    (4, -1, 2),
]


def gen_linear_graphs():
    items = []
    qid = 0
    for m, b, xq in LINEAR_CASES:
        yq = m * xq + b
        figure = _coordinate(
            {
                "caption": "The graph of a linear function is shown in the xy-plane.",
                "x_min": -6,
                "x_max": 6,
                "y_min": -8,
                "y_max": 8,
                "x_label": "x",
                "y_label": "y",
                "lines": [{"slope": m, "intercept": b}],
            }
        )
        qid += 1
        items.append(
            mc(
                f"M-FIG-L{qid:03d}",
                MATH, ALG, "Linear functions",
                D_E if abs(m) <= 1 else D_M,
                None,
                "The graph of the linear function f is shown. What is the slope of the line?",
                str(m), _wrongs(str(m), [str(-m), str(b), str(m + b)]),
                f"The line rises {m} unit(s) for each 1 unit to the right, so its slope is {m}.",
                [
                    "This value reverses the sign of the slope shown in the graph.",
                    f"This is the y-intercept, not the slope.",
                    "This mixes the slope with the y-intercept.",
                ],
                figure=figure,
            )
        )
        qid += 1
        items.append(
            mc(
                f"M-FIG-L{qid:03d}",
                MATH, ALG, "Linear functions",
                D_E,
                None,
                "The graph of the linear function f is shown. What is the y-intercept of the line?",
                str(b), _wrongs(str(b), [str(m), str(-b), str(b + m)]),
                f"The line crosses the y-axis at (0, {b}), so the y-intercept is {b}.",
                [
                    "This is the slope of the line, not its y-intercept.",
                    "This flips the sign of the y-intercept.",
                    "This adds the slope to the intercept instead of reading the crossing point.",
                ],
                figure=figure,
            )
        )
        qid += 1
        items.append(
            mc(
                f"M-FIG-L{qid:03d}",
                MATH, ALG, "Linear functions",
                D_M,
                None,
                f"The graph of the linear function f is shown. What is the value of f({xq})?",
                str(yq), _wrongs(str(yq), [str(m * xq), str(yq + b), str(b)]),
                f"At x = {xq}, the graph is at y = {yq}, so f({xq}) = {yq}.",
                [
                    "This multiplies the x-value by the slope but forgets the y-intercept.",
                    "This adds the y-intercept twice.",
                    "This is the y-intercept, not the value at this x.",
                ],
                figure=figure,
            )
        )
    return items


# ---------------------------------------------------------------------------
# Coordinate plane: systems of two lines
# ---------------------------------------------------------------------------
SYSTEM_CASES = [
    ((1, 1), (-1, 5)),
    ((2, 0), (-1, 6)),
    ((1, -2), (-2, 7)),
    ((-1, 4), (2, -2)),
    ((0.5, 2), (-0.5, 5)),
    ((3, -1), (-1, 7)),
    ((1, 3), (-3, -5)),
    ((2, 4), (-1, -2)),
]


def gen_systems():
    items = []
    for idx, ((m1, b1), (m2, b2)) in enumerate(SYSTEM_CASES):
        # Intersection of the two drawn lines, rounded to keep the figure clean.
        x = (b2 - b1) / (m1 - m2)
        y = m1 * x + b1
        if abs(x - round(x)) > 1e-9 or abs(y - round(y)) > 1e-9:
            continue
        x, y = int(round(x)), int(round(y))
        figure = _coordinate(
            {
                "caption": "Two lines are shown in the xy-plane.",
                "x_min": -6,
                "x_max": 6,
                "y_min": -8,
                "y_max": 8,
                "x_label": "x",
                "y_label": "y",
                "lines": [
                    {"slope": m1, "intercept": b1, "label": f"y = {m1}x + {b1}"},
                    {"slope": m2, "intercept": b2, "label": f"y = {m2}x + {b2}"},
                ],
                "points": [{"x": x, "y": y, "open": True}],
            }
        )
        pair_wrongs = [f"({y}, {x})", f"({x}, {-y})", f"({-x}, {y})", f"({x + 1}, {y})", f"({x}, {y + 1})"]
        pair_wrongs = [w for w in pair_wrongs if w != f"({x}, {y})"]
        deduped = []
        for w in pair_wrongs:
            if w not in deduped:
                deduped.append(w)
        pair_wrongs = deduped[:3]
        items.append(
            mc(
                f"M-FIG-S{idx:03d}",
                MATH, ALG, "Systems of two linear equations",
                D_M,
                None,
                "The graphs of two linear equations are shown. What is the solution (x, y) to the system?",
                f"({x}, {y})",
                pair_wrongs,
                f"The lines intersect at ({x}, {y}), which is the ordered pair that satisfies both equations.",
                [
                    "This swaps the x- and y-coordinates of the intersection.",
                    "This flips the sign of one coordinate.",
                    "This does not name the point where the lines cross.",
                ],
                figure=figure,
            )
        )
    return items


# ---------------------------------------------------------------------------
# Coordinate plane: parabolas
# ---------------------------------------------------------------------------
PARABOLA_CASES = [
    (1, -1, -4),
    (1, 2, -3),
    (-1, 1, 4),
    (1, 3, 1),
    (-1, -2, 5),
    (1, 0, -9),
    (1, 4, 2),
    (-1, 3, 1),
]


def gen_parabolas():
    items = []
    for idx, (a, h, k) in enumerate(PARABOLA_CASES):
        figure = _coordinate(
            {
                "caption": "The graph of a quadratic function is shown in the xy-plane.",
                "x_min": -7,
                "x_max": 7,
                "y_min": -10,
                "y_max": 12,
                "x_label": "x",
                "y_label": "y",
                "parabolas": [{"a": a, "b": -2 * a * h, "c": a * h * h + k}],
                "points": [{"x": h, "y": k, "open": True}],
            }
        )
        ask_min = a > 0
        items.append(
            mc(
                f"M-FIG-P{idx:03d}",
                MATH, ADV, "Quadratic functions",
                D_M if ask_min else D_H,
                None,
                (
                    "The graph of the quadratic function f is shown. What is the minimum value of f?"
                    if ask_min
                    else "The graph of the quadratic function f is shown. What is the maximum value of f?"
                ),
                str(k),
                _wrongs(str(k), [str(h), str(-k), str(k + h)]),
                f"The vertex is at ({h}, {k}), and the parabola opens {'upward' if ask_min else 'downward'}, "
                f"so the {'minimum' if ask_min else 'maximum'} value is {k}.",
                [
                    "This is the x-coordinate of the vertex, not the function's extreme value.",
                    "This flips the sign of the extreme value.",
                    "This combines the vertex coordinates instead of reading the y-value.",
                ],
                figure=figure,
            )
        )
        items.append(
            mc(
                f"M-FIG-P{idx:03d}b",
                MATH, ADV, "Quadratic functions",
                D_E,
                None,
                "The graph of the quadratic function f is shown. What is the axis of symmetry?",
                f"x = {h}",
                [f"y = {k}", f"x = {k}", f"y = {h}"],
                f"The parabola is symmetric about the vertical line through its vertex ({h}, {k}), so the axis is x = {h}.",
                [
                    "The axis of symmetry is a vertical line, not a horizontal one.",
                    "This uses the y-coordinate where the x-coordinate belongs.",
                    "A horizontal line cannot be the axis of a vertical parabola.",
                ],
                figure=figure,
            )
        )
    return items


# ---------------------------------------------------------------------------
# Geometry figures
# ---------------------------------------------------------------------------
TRIPLES = [(3, 4, 5), (5, 12, 13), (6, 8, 10), (8, 15, 17), (7, 24, 25), (9, 12, 15)]


def gen_right_triangles():
    items = []
    for idx, (a, b, c) in enumerate(TRIPLES):
        base_fig = _geometry(
            {
                "caption": "A right triangle is shown.",
                "shape": "right_triangle",
                "labels": {"a": str(a), "b": str(b), "c": "?"},
            }
        )
        items.append(
            mc(
                f"M-FIG-R{idx:03d}",
                MATH, GEO, "Right triangles",
                D_E,
                None,
                "What is the length of the hypotenuse of the right triangle shown?",
                str(c),
                _wrongs(str(c), [str(a + b), str(c + 1), str(abs(b - a))]),
                f"By the Pythagorean theorem, a^2 + b^2 = c^2, so c = sqrt({a * a} + {b * b}) = {c}.",
                [
                    "This adds the legs instead of using the Pythagorean theorem.",
                    "This is one more than the correct hypotenuse.",
                    "This subtracts the legs instead of combining their squares.",
                ],
                figure=base_fig,
            )
        )
        area_fig = _geometry(
            {
                "caption": "A right triangle is shown with leg lengths labelled.",
                "shape": "right_triangle",
                "labels": {"a": str(a), "b": str(b), "c": ""},
            }
        )
        items.append(
            mc(
                f"M-FIG-R{idx:03d}b",
                MATH, GEO, "Area and volume",
                D_M,
                None,
                "What is the area of the right triangle shown?",
                str((a * b) // 2),
                _wrongs(str((a * b) // 2), [str(a * b), str(a + b), str(c)]),
                f"The area of a triangle is (1/2)(base)(height) = (1/2)({a})({b}) = {(a * b) // 2}.",
                [
                    "This is the area of the rectangle with the same base and height.",
                    "This adds the legs instead of multiplying and halving them.",
                    "This is the hypotenuse, not the area.",
                ],
                figure=area_fig,
            )
        )
        perimeter = a + b + c
        items.append(
            mc(
                f"M-FIG-R{idx:03d}c",
                MATH, GEO, "Lines, angles, and triangles",
                D_M,
                None,
                "What is the perimeter of the right triangle shown?",
                str(perimeter),
                _wrongs(str(perimeter), [str(a + b), str(c), str(perimeter + 2)]),
                f"The perimeter is the sum of all three sides: {a} + {b} + {c} = {perimeter}.",
                [
                    "This adds only the two legs and omits the hypotenuse.",
                    "This is only the hypotenuse.",
                    "This is slightly larger than the sum of the three sides.",
                ],
                figure=base_fig,
            )
        )
    return items


RECTANGLES = [(4, 7), (5, 9), (6, 8), (3, 10), (7, 12), (8, 11)]


def gen_rectangles():
    items = []
    for idx, (w, h) in enumerate(RECTANGLES):
        figure = _geometry(
            {
                "caption": "A rectangle is shown with its side lengths labelled.",
                "shape": "rectangle",
                "labels": {"w": str(w), "h": str(h)},
            }
        )
        items.append(
            mc(
                f"M-FIG-A{idx:03d}",
                MATH, GEO, "Area and volume",
                D_E,
                None,
                "What is the area of the rectangle shown?",
                str(w * h),
                _wrongs(str(w * h), [str(2 * (w + h)), str(w + h), str(w * h + w)]),
                f"The area of a rectangle is length times width: {w} x {h} = {w * h}.",
                [
                    "This is the perimeter, not the area.",
                    "This adds the sides instead of multiplying them.",
                    "This multiplies the sides and then adds an extra width.",
                ],
                figure=figure,
            )
        )
        items.append(
            mc(
                f"M-FIG-A{idx:03d}b",
                MATH, GEO, "Area and volume",
                D_E,
                None,
                "What is the perimeter of the rectangle shown?",
                str(2 * (w + h)),
                _wrongs(str(2 * (w + h)), [str(w * h), str(w + h), str(2 * w + h)]),
                f"The perimeter is 2(length + width) = 2({w} + {h}) = {2 * (w + h)}.",
                [
                    "This is the area, not the perimeter.",
                    "This adds the two sides once instead of twice.",
                    "This doubles only one of the dimensions.",
                ],
                figure=figure,
            )
        )
    return items


CIRCLES = [2, 3, 4, 5, 6, 8, 10]


def _pi(value):
    """LaTeX for an integer multiple of pi, rendered by MathText."""
    return "$" + str(value) + "\\pi$"


def _distinct_pi(correct, candidates):
    """Three wrong integer multiples of pi, never equal to the key or each other."""
    out = []
    for value in candidates:
        if value != correct and value not in out:
            out.append(value)
    bump = 1
    while len(out) < 3:
        candidate = correct + bump
        if candidate != correct and candidate not in out:
            out.append(candidate)
        bump += 1
    return [_pi(v) for v in out[:3]]


def gen_circles():
    items = []
    for idx, r in enumerate(CIRCLES):
        figure = _geometry(
            {
                "caption": "A circle is shown with its radius labelled.",
                "shape": "circle",
                "labels": {"r": str(r)},
            }
        )
        items.append(
            mc(
                f"M-FIG-C{idx:03d}",
                MATH, GEO, "Circles",
                D_E,
                None,
                "What is the area of the circle shown?",
                correct=_pi(r * r),
                wrongs=_distinct_pi(r * r, [2 * r, r, 2 * r * r, r * r + 1]),
                explanation=f"The area of a circle is pi r^2 = pi({r})^2 = {r * r}pi.",
                rationales=[
                    "This is the circumference, 2 pi r, not the area.",
                    "This uses pi r instead of pi r squared.",
                    "This doubles the correct area.",
                ],
                figure=figure,
            )
        )
        items.append(
            mc(
                f"M-FIG-C{idx:03d}b",
                MATH, GEO, "Circles",
                D_E,
                None,
                "What is the circumference of the circle shown?",
                correct=_pi(2 * r),
                wrongs=_distinct_pi(2 * r, [r * r, r, 4 * r, 3 * r]),
                explanation=f"The circumference is 2 pi r = 2 pi({r}) = {2 * r}pi.",
                rationales=[
                    "This is the area, pi r squared, not the circumference.",
                    "This omits the factor of 2.",
                    "This uses 4 pi r, which is twice the circumference.",
                ],
                figure=figure,
            )
        )
        items.append(
            mc(
                f"M-FIG-C{idx:03d}c",
                MATH, GEO, "Circles",
                D_M,
                None,
                "The circle shown has the radius labelled. What is the diameter?",
                str(2 * r),
                _wrongs(str(2 * r), [str(r), str(r * r), str(4 * r)]),
                f"The diameter is twice the radius: 2 x {r} = {2 * r}.",
                [
                    "This is the radius, not the diameter.",
                    "This squares the radius instead of doubling it.",
                    "This is four times the radius.",
                ],
                figure=figure,
            )
        )
    return items


TRIANGLES = [(6, 4), (10, 3), (8, 5), (12, 7), (9, 6), (14, 5)]


def gen_triangles():
    items = []
    for idx, (base, height) in enumerate(TRIANGLES):
        figure = _geometry(
            {
                "caption": "A triangle is shown with its base and height labelled.",
                "shape": "triangle",
                "labels": {"b": str(base), "h": str(height)},
            }
        )
        items.append(
            mc(
                f"M-FIG-T{idx:03d}",
                MATH, GEO, "Area and volume",
                D_E,
                None,
                "What is the area of the triangle shown?",
                str((base * height) // 2),
                _wrongs(str((base * height) // 2), [str(base * height), str(base + height), str(base * height // 2 + 1)]),
                f"The area is (1/2)(base)(height) = (1/2)({base})({height}) = {(base * height) // 2}.",
                [
                    "This is the area of a rectangle with the same base and height.",
                    "This adds the base and height instead of multiplying them.",
                    "This is one more than the correct area.",
                ],
                figure=figure,
            )
        )
    return items


def build():
    items = []
    items.extend(gen_linear_graphs())
    items.extend(gen_systems())
    items.extend(gen_parabolas())
    items.extend(gen_right_triangles())
    items.extend(gen_rectangles())
    items.extend(gen_circles())
    items.extend(gen_triangles())
    # Keep the bank's assessment coverage consistent with the rest of the
    # original items; geometry here uses no trigonometry.
    for item in items:
        item["assessments"] = list(ALL_ASSESSMENTS)
    return items


def main():
    items = build()
    os.makedirs(EXP_DIR, exist_ok=True)
    out = os.path.join(EXP_DIR, "extra_math_figures.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"questions": items}, fh, ensure_ascii=False, indent=1)
    by_domain = {}
    for item in items:
        by_domain[item["domain"]] = by_domain.get(item["domain"], 0) + 1
    print(f"wrote {len(items)} figure items to {out}")
    print(by_domain)


if __name__ == "__main__":
    main()
