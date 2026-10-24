#!/usr/bin/env python3
"""
HDSAT M13 bank batch.

Builds the figure-bearing math items for this round (geometry, coordinate
planes, tables and charts) and merges the two authored Reading & Writing
files that sit beside it in ``data/m13``.

Every math item is generated from exact arithmetic: the figure, the answer and
each distractor come from the same numbers, so a mis-rendered label can never
leave a wrong key behind. Context sentences are drawn from three pools
(maker / object / setting) so no two stems share a frame, which is what the
near-duplicate scan in tools/content_qa.py looks for.

Run from the repository root::

    python supabase/import/generate_bank_m13.py

Writes supabase/import/expansion/extra_m13.json
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from generate_bank_expansion import EXP_DIR, mc  # noqa: E402

MATH = "Math"
RW = "Reading and Writing"
D_E, D_M, D_H = "Easy", "Medium", "Hard"

GEO = "Geometry and Trigonometry"
ALG = "Algebra"
ADV = "Advanced Math"
PSDA = "Problem-Solving and Data Analysis"

ALL4 = ["SAT", "PSAT/NMSQT", "PSAT 10", "PSAT 8/9"]
NO89 = ["SAT", "PSAT/NMSQT", "PSAT 10"]

MAKERS = [
    "A landscape designer",
    "A stage carpenter",
    "A civil engineer",
    "A quilting instructor",
    "A land surveyor",
    "A set builder",
    "An architect",
    "A metal fabricator",
    "A horticulturist",
    "A sign maker",
    "A furniture maker",
    "A muralist",
]

OBJECTS = [
    "a triangular garden bed",
    "a corner brace",
    "a ramp frame",
    "a pennant",
    "a raised planter",
    "a roof brace",
    "a display panel",
    "a kite",
    "a tarp cover",
    "a bench back",
    "a staircase stringer",
    "a canvas stretcher",
]

SETTINGS = [
    "a community garden",
    "a riverfront park",
    "a school workshop",
    "a mountain trailhead",
    "a city plaza",
    "a rooftop terrace",
    "a museum courtyard",
    "a coastal boardwalk",
    "a farm cooperative",
    "a library atrium",
    "a train platform",
    "a sports pavilion",
]

UNITS = ["centimeters", "inches", "meters", "feet"]


def ctx(i, verb="is laying out"):
    """A fresh three-pool context so no two stems share a frame."""
    maker = MAKERS[i % len(MAKERS)]
    obj = OBJECTS[(i * 5) % len(OBJECTS)]
    place = SETTINGS[(i * 7) % len(SETTINGS)]
    return f"{maker} {verb} {obj} for {place}."


def geometry(shape, labels, caption="Note: Figure not drawn to scale."):
    return {
        "type": "geometry_figure",
        "shape": shape,
        "caption": caption,
        "labels": labels,
    }


def plane(lines=None, points=None, parabolas=None, caption=None, bounds=(-6, 6, -6, 6)):
    meta = {
        "type": "coordinate_plane",
        "x_min": bounds[0],
        "x_max": bounds[1],
        "y_min": bounds[2],
        "y_max": bounds[3],
        "x_label": "x",
        "y_label": "y",
    }
    if lines:
        meta["lines"] = lines
    if points:
        meta["points"] = points
    if parabolas:
        meta["parabolas"] = parabolas
    if caption:
        meta["caption"] = caption
    return meta


def table(caption, headers, rows):
    return {"type": "table", "caption": caption, "headers": headers, "rows": rows}


def chart(kind, caption, x_label, y_label, series):
    return {
        "type": kind,
        "caption": caption,
        "x_label": x_label,
        "y_label": y_label,
        "series": series,
    }


def add(items, qid, domain, skill, difficulty, stimulus, prompt, correct, wrongs, explanation, rationales, figure=None):
    wrongs = _distinct(correct, wrongs)
    items.append(
        mc(
            qid,
            MATH,
            domain,
            skill,
            difficulty,
            stimulus,
            prompt,
            correct,
            wrongs,
            explanation,
            rationales,
            figure=figure,
            assessments=ALL4 if difficulty != D_H else NO89,
        )
    )


def _distinct(correct, wrongs):
    """Three wrong options, nothing equal to the key or to each other."""
    out = []
    for value in wrongs:
        text = str(value)
        if text == str(correct):
            continue
        if text in out:
            continue
        out.append(text)
        if len(out) == 3:
            break
    filler = 1
    while len(out) < 3:
        candidate = str(int(float(correct)) + filler) if _numeric(correct) else f"{correct} (variant {filler})"
        if candidate != str(correct) and candidate not in out:
            out.append(candidate)
        filler += 1
    return out


def _numeric(value):
    try:
        float(str(value).replace(",", ""))
        return True
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------
TRIPLES = [
    (3, 4, 5),
    (5, 12, 13),
    (8, 15, 17),
    (7, 24, 25),
    (6, 8, 10),
    (9, 12, 15),
    (12, 16, 20),
    (10, 24, 26),
    (15, 20, 25),
    (20, 21, 29),
    (9, 40, 41),
    (12, 35, 37),
]


def gen_right_triangles(items):
    n = 0
    for index, (a, b, c) in enumerate(TRIPLES):
        n += 1
        qid = f"M13-GEO-H{n:03d}"
        stimulus = (
            f"{ctx(index)} The two legs measure {a} and {b} {UNITS[index % 4]}, as shown."
        )
        add(
            items, qid, GEO, "Right triangles and trigonometry", D_M,
            stimulus,
            "What is the length of the hypotenuse?",
            str(c),
            [str(a + b), str(abs(b - a)), str(c + 2)],
            f"The legs are perpendicular, so the Pythagorean theorem gives {a}^2 + {b}^2 = {a*a + b*b}, "
            f"and the square root of {a*a + b*b} is {c} {UNITS[index % 4]}.",
            [
                f"Adding the legs treats the triangle as though the two given sides formed one straight side.",
                f"Subtracting assumes the hypotenuse is the longer leg minus the shorter, which no right triangle allows.",
                f"This is off by two; squaring and adding {a} and {b} gives {a*a + b*b}, not {c+2} squared.",
            ],
            geometry("right_triangle", {"a": str(a), "b": str(b)}),
        )
    for index, (a, b, c) in enumerate(TRIPLES[:8]):
        n += 1
        qid = f"M13-GEO-L{n:03d}"
        stimulus = (
            f"{ctx(index + 4, 'is reinforcing')} One leg measures {a} {UNITS[index % 4]} and the "
            f"hypotenuse measures {c} {UNITS[index % 4]}, as shown."
        )
        add(
            items, qid, GEO, "Right triangles and trigonometry", D_M,
            stimulus,
            "What is the length of the other leg?",
            str(b),
            [str(a + c), str(c - a), str(b + 3)],
            f"Rearrange the Pythagorean theorem: the missing leg is the square root of ({c}^2 - {a}^2) = "
            f"{c*c - a*a}, which is {b} {UNITS[index % 4]}.",
            [
                "Adding a leg to the hypotenuse has no geometric meaning in a right triangle.",
                "Subtracting the leg from the hypotenuse gives the difference in lengths, not the third side.",
                "This is three too long; the square root of the difference of the squares is exact here.",
            ],
            geometry("right_triangle", {"a": str(a), "c": str(c)}),
        )


def gen_rectangles(items):
    dims = [(4, 9), (6, 7), (8, 12), (5, 14), (10, 11), (3, 16), (7, 9), (12, 13), (6, 15), (9, 14)]
    for index, (w, h) in enumerate(dims):
        area = w * h
        qid = f"M13-GEO-A{index:03d}"
        stimulus = (
            f"{ctx(index, 'is ordering material for')} The panel is a rectangle measuring {w} "
            f"{UNITS[index % 4]} by {h} {UNITS[index % 4]}, as shown, and it must be covered completely."
        )
        add(
            items, qid, GEO, "Volume and surface area", D_E if index < 4 else D_M,
            stimulus,
            "What is the area of the panel, in square units?",
            str(area),
            [str(2 * (w + h)), str(area + w), str(w + h)],
            f"The area of a rectangle is width times height: {w} times {h} equals {area} square "
            f"{UNITS[index % 4]}.",
            [
                "This is the perimeter, which measures the distance around the panel.",
                "This adds one extra width; area multiplies the two dimensions instead of adding anything.",
                "Adding the sides gives a length, not an area.",
            ],
            geometry("rectangle", {"w": str(w), "h": str(h)}),
        )
    for index, (w, h) in enumerate(dims[:8]):
        qid = f"M13-GEO-P{index:03d}"
        stimulus = (
            f"{ctx(index + 2, 'is framing')} The frame is rectangular with sides of {w} and {h} "
            f"{UNITS[index % 4]}, as shown."
        )
        add(
            items, qid, GEO, "Volume and surface area", D_E,
            stimulus,
            "What is the perimeter of the frame?",
            str(2 * (w + h)),
            [str(w * h), str(w + h), str(2 * (w + h) + 4)],
            f"Perimeter is twice the width plus twice the height: 2({w}) + 2({h}) = {2*(w+h)} "
            f"{UNITS[index % 4]}.",
            [
                "Multiplying the sides gives the area enclosed, not the distance around.",
                "This counts one width and one height only, leaving out the opposite pair.",
                "This adds an extra 4 units that the figure does not contain.",
            ],
            geometry("rectangle", {"w": str(w), "h": str(h), }),
        )
    missing = [(48, 6), (63, 7), (72, 8), (90, 9), (110, 10), (96, 12)]
    for index, (area, w) in enumerate(missing):
        qid = f"M13-GEO-M{index:03d}"
        stimulus = (
            f"{ctx(index + 6, 'is fitting a cover on')} The rectangular face has an area of {area} "
            f"square {UNITS[index % 4]} and one side measures {w} {UNITS[index % 4]}, as shown."
        )
        add(
            items, qid, GEO, "Volume and surface area", D_M,
            stimulus,
            "What is the length of the adjacent side?",
            str(area // w),
            [str(area - w), str(w + 2), str(area // w + 3)],
            f"Area equals length times width, so the missing side is {area} divided by {w}, which is "
            f"{area // w} {UNITS[index % 4]}.",
            [
                "Subtracting the known side from the area mixes an area with a length.",
                "This adds two units rather than dividing the area by the known side.",
                "This is three units too long; the quotient is exact.",
            ],
            geometry("rectangle", {"w": str(w), "h": "?"}),
        )


def gen_circles(items):
    radii = [3, 4, 5, 6, 7, 8, 9, 10, 12, 2, 11, 14]
    for index, r in enumerate(radii):
        qid = f"M13-GEO-C{index:03d}"
        stimulus = (
            f"{ctx(index, 'is marking out')} The circle has a radius of {r} {UNITS[index % 4]}, as shown."
        )
        add(
            items, qid, GEO, "Circles: area and circumference", D_E if index < 4 else D_M,
            stimulus,
            "What is the area of the circle, in square units?",
            f"{r*r}\\pi",
            [f"{2*r}\\pi", f"{r*2}\\pi", f"{r*r + 4}\\pi"],
            f"Area is \\pi r^2, and {r} squared is {r*r}, so the area is {r*r}\\pi square "
            f"{UNITS[index % 4]}.",
            [
                "This is the circumference, which measures the distance around the circle.",
                "This doubles the radius instead of squaring it.",
                "This adds 4 to the square of the radius rather than squaring it directly.",
            ],
            geometry("circle", {"r": str(r)}),
        )
    for index, r in enumerate(radii[:8]):
        qid = f"M13-GEO-K{index:03d}"
        stimulus = (
            f"{ctx(index + 3, 'is edging')} The circular tabletop has a radius of {r} "
            f"{UNITS[index % 4]}, as shown."
        )
        add(
            items, qid, GEO, "Circles: area and circumference", D_E,
            stimulus,
            "What is the circumference of the circle, in units?",
            f"{2*r}\\pi",
            [f"{r*r}\\pi", f"{r}\\pi", f"{2*r + 2}\\pi"],
            f"Circumference is 2\\pi r, so 2({r})\\pi = {2*r}\\pi {UNITS[index % 4]}.",
            [
                "This is the area, which is measured in square units.",
                "This leaves out the factor of 2 that the diameter requires.",
                "This adds 2 before multiplying by \\pi instead of doubling the radius.",
            ],
            geometry("circle", {"r": str(r)}),
        )
    extra = [(36, 6), (64, 8), (81, 9), (100, 10), (121, 11), (144, 12)]
    for index, (area, r) in enumerate(extra):
        qid = f"M13-GEO-R{index:03d}"
        stimulus = (
            f"{ctx(index + 5, 'is sizing a lens for')} The circular lens has an area of {area}\\pi "
            f"square {UNITS[index % 4]}."
        )
        add(
            items, qid, GEO, "Circles: area and circumference", D_M,
            stimulus,
            "What is the radius of the lens?",
            str(r),
            [str(area // 2), str(r + 3), str(area // 4)],
            f"Dividing both sides of \\pi r^2 = {area}\\pi by \\pi leaves r^2 = {area}, and the square "
            f"root of {area} is {r}.",
            [
                "Halving the area does not give the radius; the radius is the square root of the area divided by \\pi.",
                "This is three units too large; the square root of the coefficient is exact.",
                "Dividing by 4 ignores that area grows with the square of the radius.",
            ],
        )


# ---------------------------------------------------------------------------
# Coordinate plane and functions
# ---------------------------------------------------------------------------
PROJECTS = [
    "a footbridge replacement",
    "a pier repair",
    "a playground rebuild",
    "a floodwall survey",
    "a bike-lane extension",
    "a greenhouse retrofit",
    "a wellfield expansion",
    "a trail resurfacing",
    "a seawall inspection",
    "a barn restoration",
    "a transit shelter upgrade",
    "a wetland boardwalk",
    "a rooftop garden",
    "a culvert replacement",
    "a stairway renovation",
    "a dock rebuild",
]

AXIS_NOTES = [
    "The vertical axis is in dollars and the horizontal axis is in days.",
    "The vertical axis is in litres and the horizontal axis is in hours.",
    "The vertical axis is in kilometres and the horizontal axis is in weeks.",
    "The vertical axis is in grams and the horizontal axis is in months.",
    "The vertical axis is in degrees and the horizontal axis is in minutes.",
    "The vertical axis is in metres and the horizontal axis is in shifts.",
    "The vertical axis is in tickets and the horizontal axis is in days.",
    "The vertical axis is in kilowatt-hours and the horizontal axis is in weeks.",
    "The vertical axis is in litres per hectare and the horizontal axis is in seasons.",
    "The vertical axis is in dollars per crate and the horizontal axis is in weeks.",
    "The vertical axis is in millimetres and the horizontal axis is in hours.",
    "The vertical axis is in pages and the horizontal axis is in evenings.",
    "The vertical axis is in coupons and the horizontal axis is in visits.",
    "The vertical axis is in parcels and the horizontal axis is in routes.",
    "The vertical axis is in seats and the horizontal axis is in performances.",
    "The vertical axis is in samples and the horizontal axis is in months.",
]

LINE_ROLES = [
    "a delivery cost",
    "a reservoir depth",
    "a seedling height",
    "a bus fare",
    "a kiln temperature",
    "a storage charge",
    "a walking pace",
    "a print run",
    "a water level",
    "a ticket price",
    "a battery drain",
    "a paint mixture",
    "a rental fee",
    "a signal delay",
    "a fuel reserve",
    "a kiln schedule",
]


def gen_lines(items):
    specs = [
        (2, 3), (3, -2), (-2, 4), (4, 1), (-3, 5), (1, -4), (5, 2), (-4, -3),
        (2, -1), (6, 2), (-2, -5), (3, 4), (4, -2), (-5, 3), (2, 6), (5, -4),
    ]
    for index, (m, b) in enumerate(specs):
        qid = f"M13-COORD-S{index:03d}"
        # The slope itself is never stated: the student reads it off the grid.
        stimulus = (
            f"A planning team is costing {PROJECTS[index % len(PROJECTS)]}. The graph shows line l, "
            f"which models {LINE_ROLES[index % len(LINE_ROLES)]}. Line l crosses the y-axis at {b}. "
            f"{AXIS_NOTES[index % len(AXIS_NOTES)]}"
        )
        add(
            items, qid, ALG, "Linear functions: slope and intercepts", D_M,
            stimulus,
            "What is the slope of line l?",
            str(m),
            [str(b), str(-m), str(m + 2)],
            f"The line rises {abs(m)} unit{'s' if abs(m) != 1 else ''} for every 1 unit to the right, "
            f"so its slope is {m}.",
            [
                f"This is the y-intercept, the height where the line crosses the y-axis, not its steepness.",
                f"This flips the sign; the line rises (or falls) in the direction shown, giving {m}.",
                f"This adds two to the rise; counting the grid shows {m}.",
            ],
            plane(lines=[{"slope": m, "intercept": b, "label": "l"}]),
        )
    specs2 = [
        (2, 1), (3, -1), (-1, 4), (4, -2), (-2, 3), (1, 5), (5, -3), (-3, 2),
        (2, -4), (6, 1), (-4, -2), (3, 3),
    ]
    for index, (m, b) in enumerate(specs2):
        qid = f"M13-COORD-I{index:03d}"
        stimulus = (
            f"{ctx(index + 3, 'is checking a joint in')} Line l passes through the points shown on "
            f"the graph, where each grid square is 1 unit."
        )
        add(
            items, qid, ALG, "Linear functions: slope and intercepts", D_M,
            stimulus,
            "What is the y-intercept of line l?",
            str(b),
            [str(m), str(-b), str(b + 2)],
            f"Following the line to the vertical axis gives y = {b} at x = 0, so the y-intercept is {b}.",
            [
                f"This is the slope: the change in y for each step right, not the crossing height.",
                f"This has the wrong sign; the line crosses at y = {b}.",
                f"This is two units too high; the crossing sits on the gridline at {b}.",
            ],
            plane(lines=[{"slope": m, "intercept": b, "label": "l"}], points=[{"x": 0, "y": b}]),
        )
    factored = [(1, 2, -3), (1, -4, 1), (2, 3, -2), (-1, 2, 5), (1, -5, 2), (3, 1, -1), (2, -2, 4), (-2, 3, 1)]
    for index, (a, h, k) in enumerate(factored):
        qid = f"M13-COORD-Q{index:03d}"
        # y = a(x - h)^2 + k  ->  a x^2 - 2ah x + (a h^2 + k)
        bcoef = -2 * a * h
        ccoef = a * h * h + k
        add(
            items, qid, ADV, "Quadratic functions: vertex and symmetry", D_H if index % 3 == 0 else D_M,
            f"{ctx(index + 1, 'is modelling an arch for')} The graph of y = {a}(x - {h})^2 + {k} is "
            f"shown on the coordinate plane.",
            "What are the coordinates of the vertex of the parabola?",
            f"({h}, {k})",
            [f"({-h}, {k})", f"({h}, {-k})", f"({k}, {h})"],
            f"In vertex form y = a(x - h)^2 + k the vertex is (h, k), so here it is ({h}, {k}).",
            [
                "This negates the horizontal coordinate; in this form the vertex uses +h, not -h.",
                "This negates the vertical coordinate, which shifts the parabola below the x-axis.",
                "This swaps the two coordinates, which would be a different point entirely.",
            ],
            plane(parabolas=[{"a": a, "b": bcoef, "c": ccoef, "label": "y"}],
                  points=[{"x": h, "y": k, "label": "vertex"}]),
        )
    roots = [(1, 3), (2, 5), (-1, 4), (-3, -2), (4, 6), (-4, 2), (3, 7), (1, -6)]
    for index, (r1, r2) in enumerate(roots):
        qid = f"M13-COORD-Z{index:03d}"
        bcoef = -(r1 + r2)
        ccoef = r1 * r2
        add(
            items, qid, ADV, "Quadratic functions: vertex and symmetry", D_M,
            f"{ctx(index + 2, 'is tracing a flight path for')} The graph of y = x^2 {bcoef:+d}x "
            f"{ccoef:+d} is shown on the coordinate plane.",
            "What are the x-coordinates where the graph crosses the x-axis?",
            f"x = {r1} and x = {r2}",
            [f"x = {-r1} and x = {-r2}", f"x = {r1} and x = {-r2}", f"x = {r1 + 2} and x = {r2 + 2}"],
            f"Factor the expression as (x - ({r1}))(x - ({r2})) = 0, so the zeros are {r1} and {r2}.",
            [
                "Both signs are flipped; the factors are x minus each zero.",
                "Only one sign is flipped, which would come from a different pair of factors.",
                "This shifts both zeros by two, a translation the graph does not show.",
            ],
            plane(parabolas=[{"a": 1, "b": bcoef, "c": ccoef, "label": "y"}],
                  bounds=(-8, 8, -10, 14)),
        )


def gen_tables_and_charts(items):
    linear = [(2, 5), (3, 8), (4, 11), (5, 14), (6, 17), (7, 20), (8, 23), (9, 26)]
    for index, (m, b) in enumerate(linear):
        xs = [1, 2, 3, 4]
        rows = [[str(x), str(m * x + b)] for x in xs]
        qid = f"M13-DATA-T{index:03d}"
        add(
            items, qid, ALG, "Linear functions: slope and intercepts", D_M,
            f"{ctx(index, 'is recording output from')} The table shows values of a linear function f.",
            "What is the value of f(9)?",
            str(m * 9 + b),
            [str(m * 9), str(m * 9 + b + 3), str(m * 9 - b)],
            f"Each increase of 1 in x raises f(x) by {m}, so f(9) = {m}(9) + {b} = {m*9+b}.",
            [
                f"This leaves out the starting value of {b} that the table already shows.",
                f"This is three too high; the pattern steps by exactly {m} each time.",
                f"Subtracting the starting value doubles back instead of continuing the pattern.",
            ],
            table(
                "Function f",
                ["x", "f(x)"],
                rows,
            ),
        )
    expo = [(3, 2), (5, 2), (4, 3), (2, 5), (6, 2), (3, 4), (7, 2), (2, 9)]
    for index, (start, factor) in enumerate(expo):
        xs = [0, 1, 2, 3]
        rows = [[str(x), str(start * factor ** x)] for x in xs]
        qid = f"M13-DATA-E{index:03d}"
        add(
            items, qid, ADV, "Exponential growth and decay", D_M,
            f"{ctx(index + 2, 'is tracking a culture in')} The table shows values of an exponential "
            f"function g.",
            "By what factor does g(x) change each time x increases by 1?",
            str(factor),
            [str(start), str(factor + 1), str(start * factor)],
            f"Dividing consecutive values always gives {factor}, so g multiplies by {factor} for each "
            f"one-unit increase in x.",
            [
                f"This is the starting value g(0), not the repeated factor.",
                f"This adds one to the multiplier; the ratio of consecutive values is {factor}.",
                f"This is the first value after zero, not the ratio between steps.",
            ],
            table("Function g", ["x", "g(x)"], rows),
        )
    bars = [
        ("Library visits", ["Week 1", "Week 2", "Week 3", "Week 4"], [120, 150, 90, 180], "visits"),
        ("Bike rentals", ["Mon", "Tue", "Wed", "Thu"], [24, 36, 30, 42], "rentals"),
        ("Seedling counts", ["Plot A", "Plot B", "Plot C"], [85, 60, 95], "seedlings"),
        ("Cafeteria meals", ["Mon", "Wed", "Fri"], [210, 180, 240], "meals"),
        ("Bus boardings", ["6 am", "8 am", "5 pm"], [40, 75, 55], "boardings"),
        ("Museum entries", ["Sat", "Sun"], [320, 260], "entries"),
        ("Water samples", ["Site A", "Site B", "Site C"], [64, 48, 80], "samples"),
        ("Tool checkouts", ["Mon", "Tue", "Wed"], [18, 27, 21], "checkouts"),
    ]
    for index, (label, cats, values, unit) in enumerate(bars):
        hi = max(range(len(values)), key=lambda i: values[i])
        lo = min(range(len(values)), key=lambda i: values[i])
        diff = values[hi] - values[lo]
        qid = f"M13-DATA-B{index:03d}"
        add(
            items, qid, PSDA, "Percentages", D_M,
            f"{ctx(index, 'is comparing weekly counts at')} The bar graph shows {label.lower()} "
            f"recorded over the periods shown.",
            f"How many more {unit} were recorded in {cats[hi]} than in {cats[lo]}?",
            str(diff),
            [str(values[hi] + values[lo]), str(diff + 10), str(values[hi])],
            f"{cats[hi]} recorded {values[hi]} and {cats[lo]} recorded {values[lo]}, so the difference "
            f"is {diff} {unit}.",
            [
                f"Adding the two bars gives a total, not the gap between them.",
                f"This is ten more than the gap; subtracting the two bar heights gives {diff}.",
                f"This is the taller bar by itself, without comparing it to the shorter one.",
            ],
            chart("bar_chart", label, "Period", "Number of " + unit,
                  [{"label": c, "value": v} for c, v in zip(cats, values)]),
        )
    lines_data = [
        ("Garden yields", ["2018", "2019", "2020", "2021"], [40, 50, 60, 75], 25, 40),
        ("Repairs logged", ["Jan", "Feb", "Mar", "Apr"], [20, 30, 45, 60], 20, 45),
        ("Memberships", ["2019", "2020", "2021"], [80, 100, 120], 80, 120),
        ("Rainfall", ["Week 1", "Week 2", "Week 3"], [25, 50, 75], 25, 75),
        ("Books donated", ["Term 1", "Term 2", "Term 3"], [120, 150, 210], 120, 210),
        ("Volunteer hours", ["Q1", "Q2", "Q3", "Q4"], [60, 90, 120, 150], 60, 120),
    ]
    for index, (label, cats, values, _unused_a, _unused_b) in enumerate(lines_data):
        # The endpoints come from the series itself; hard-coding them is how a
        # percent-change key drifts away from its own graph.
        first, last = values[0], values[-1]
        pct = round((last - first) / first * 100)
        qid = f"M13-DATA-L{index:03d}"
        add(
            items, qid, PSDA, "Percentages", D_H if index % 2 == 0 else D_M,
            f"{ctx(index + 4, 'is reviewing a trend for')} The line graph shows {label.lower()} over "
            f"the periods shown.",
            f"From {cats[0]} to {cats[-1]}, the value increased by what percent?",
            f"{pct}%",
            [f"{last - first}%", f"{round((last / first) * 100)}%", f"{pct + 10}%"],
            f"The increase is {last} - {first} = {last-first}, and {last-first} divided by {first} is "
            f"{round((last-first)/first*100,1)} percent, about {pct} percent.",
            [
                f"This is the absolute increase, not the percent of the starting value.",
                f"This is the final value as a percent of the starting value, which already includes the original amount.",
                f"This is ten points higher than the computed increase of {pct} percent.",
            ],
            chart("line_chart", label, "Period", "Count",
                  [{"label": c, "value": v} for c, v in zip(cats, values)]),
        )


def build_math():
    items = []
    gen_right_triangles(items)
    gen_rectangles(items)
    gen_circles(items)
    gen_lines(items)
    gen_tables_and_charts(items)
    return items


# ---------------------------------------------------------------------------
# Merge with the authored R&W files
# ---------------------------------------------------------------------------
def load_rw():
    questions = []
    directory = os.path.join(HERE, "data", "m13")
    for name in ("rw_information.json", "rw_language.json"):
        path = os.path.join(directory, name)
        if not os.path.exists(path):
            print(f"missing {name}; skipping")
            continue
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        rows = payload.get("questions") if isinstance(payload, dict) else payload
        questions.extend(rows or [])
    return questions


def main():
    math_items = build_math()
    rw_items = load_rw()
    questions = rw_items + math_items

    seen_ids = set()
    seen_stems = {}
    problems = []
    for question in questions:
        qid = question["id"]
        if qid in seen_ids:
            problems.append(f"duplicate id {qid}")
        seen_ids.add(qid)
        stem = " ".join(
            part for part in [question.get("stimulus") or "", question.get("prompt") or ""] if part
        )
        key = (question["section"], stem.strip().lower())
        if key in seen_stems:
            problems.append(f"duplicate stem {qid} vs {seen_stems[key]}")
        seen_stems[key] = qid

    if problems:
        for problem in problems[:20]:
            print("x", problem)
        raise SystemExit(f"{len(problems)} uniqueness problem(s)")

    os.makedirs(EXP_DIR, exist_ok=True)
    out_path = os.path.join(EXP_DIR, "extra_m13.json")
    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump({"questions": questions}, handle, ensure_ascii=True, indent=1)
        handle.write("\n")

    by_section = {}
    for question in questions:
        by_section[question["section"]] = by_section.get(question["section"], 0) + 1
    print(f"wrote {out_path}: {len(questions)} items {by_section}")


if __name__ == "__main__":
    main()
