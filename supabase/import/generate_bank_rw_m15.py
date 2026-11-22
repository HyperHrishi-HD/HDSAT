#!/usr/bin/env python3
"""HDSAT M15 Reading & Writing batch: Command of Evidence (Quantitative).

Every figure in this batch is drawn from the World Bank Open Data cache that
the M14 batch downloaded (CC BY 4.0), so no number is invented. The M14 audit
found keys that quoted a country's level ("from 31.1% to 57.4%") while the
chart plotted only the change, which a student cannot verify on the figure.
This batch inverts that rule: the builder rounds each value once, puts the
rounded value in the figure, and composes the key from the same rounded value,
so a key can only mention a number the figure shows.

Shapes (all "Command of Evidence (Quantitative)"):

  * trend      line chart, one country, five years   -> direction and endpoints
  * comparison table, four countries, one year       -> highest and lowest
  * change     bar chart, four countries, two years  -> largest increase
  * peak       line chart, one country, six years    -> highest year and value

Windows and country rotations are offset from M14 so the two batches do not
repeat a figure. Items whose data are flat, tied or incomplete are skipped
rather than weakened.

Run from the repository root::

    python supabase/import/generate_bank_rw_m15.py

Writes ``supabase/import/expansion/extra_rw_m15.json``.
"""

import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from generate_bank_expansion import EXP_DIR, mc  # noqa: E402
from generate_bank_rw_m14 import COUNTRIES, INDICATORS  # noqa: E402

CACHE = HERE / "data" / "m14" / "worldbank.json"
OUT = pathlib.Path(EXP_DIR) / "extra_rw_m15.json"

RW = "Reading and Writing"
INFO = "Information and Ideas"
QUANT = "Command of Evidence (Quantitative)"
EASY, MEDIUM, HARD = "Easy", "Medium", "Hard"

ATTRIBUTION = (
    "Data: World Bank Open Data (CC BY 4.0), worldbank.org. "
    "Item text: HDSAT Open Core (CC BY-4.0)."
)

TREND_WINDOWS = [(2000, 2004), (2005, 2009), (2012, 2016), (2017, 2021)]
PEAK_WINDOWS = [(2001, 2006), (2008, 2013), (2014, 2019), (2016, 2021)]
COMPARE_YEARS = [2003, 2007, 2012, 2018, 2021]
CHANGE_WINDOWS = [(2000, 2005), (2006, 2011), (2011, 2016), (2017, 2022)]


def load():
    with open(CACHE, "r", encoding="utf-8") as fh:
        return json.load(fh)


def fmt(value, decimals):
    return f"{value:.{decimals}f}"


def unit_text(value, decimals, short):
    if short == "%":
        return f"{fmt(value, decimals)}%"
    return f"{fmt(value, decimals)} {short}"


def series_for(data, code, country):
    raw = data.get(code, {}).get(country, {})
    out = {}
    for year, value in raw.items():
        if value is None:
            continue
        try:
            out[int(year)] = float(value)
        except (TypeError, ValueError):
            continue
    return out


def window(series, start, end):
    years = list(range(start, end + 1))
    if not all(y in series for y in years):
        return None
    return years, [round(series[y], 4) for y in years]


def figure_line(years, values, caption, y_label):
    return {
        "type": "line_chart",
        "caption": caption,
        "x_label": "Year",
        "y_label": y_label,
        "series": [{"label": str(y), "value": v} for y, v in zip(years, values)],
    }


def figure_bars(pairs, caption, y_label):
    return {
        "type": "bar_chart",
        "caption": caption,
        "x_label": "Country",
        "y_label": y_label,
        "series": [{"label": c, "value": v} for c, v in pairs],
    }


def figure_table(rows, caption, y_label):
    # The renderer and content QA both key on "headers".
    return {
        "type": "table",
        "caption": caption,
        "headers": ["Country", y_label],
        "rows": rows,
    }


def build_trend(data, code, label, unit_phrase, short, decimals, subject, picked):
    for country in picked:
        series = series_for(data, code, country)
        for start, end in TREND_WINDOWS:
            got = window(series, start, end)
            if not got:
                continue
            years, raw = got
            values = [round(v, decimals) for v in raw]
            delta = values[-1] - values[0]
            if abs(delta) < max(1.0, decimals * 1.0):
                continue
            if len(set(values)) < 3:
                continue
            verb = "rose" if delta > 0 else "fell"
            other = "fell" if delta > 0 else "rose"
            first, last = unit_text(values[0], decimals, short), unit_text(values[-1], decimals, short)
            mid_year, mid_value = years[2], unit_text(values[2], decimals, short)
            peak_value = unit_text(max(values), decimals, short)
            if years[values.index(max(values))] == mid_year:
                continue
            if not fresh(("trend", code, country, start)):
                continue
            stimulus = (
                f"{subject.capitalize()} is describing {label} in {country} using World Bank "
                f"figures for {start} through {end}."
            )
            prompt = "Which statement about the graphed change is supported by the data?"
            correct = (
                f"Between {start} and {end}, {country}'s {label} {verb} overall, "
                f"from {first} to {last}."
            )
            wrongs = [
                f"Between {start} and {end}, {country}'s {label} {other} overall, "
                f"from {first} to {last}.",
                f"It stayed essentially unchanged across the period, ending near {mid_value}.",
                f"It peaked in {mid_year}, at {mid_value}.",
            ]
            explanation = (
                f"The line begins at {first} in {start} and ends at {last} in {end}, so the "
                f"overall movement is a {verb.replace('rose', 'rise').replace('fell', 'fall')}. "
                f"The highest point shown is {peak_value}, not the middle year."
            )
            rationales = [
                f"The endpoints move {verb}, not {other}.",
                f"A change from {first} to {last} is not an unchanged series.",
                f"{mid_year} is not the highest point; the graph reaches {peak_value}.",
            ]
            qid = f"RW-M15-WB-T{len(items):03d}-{code.split('.')[0][:4]}{start}"
            items.append(
                mc(
                    qid, RW, INFO, QUANT, MEDIUM, stimulus, prompt, correct, wrongs,
                    explanation, rationales,
                    figure=figure_line(years, values, f"{label.capitalize()} in {country}, {start}-{end}", unit_phrase),
                )
            )
            return True
    return False


def build_comparison(data, code, label, unit_phrase, short, decimals, subject, picked, year):
    values = {}
    for country in picked[:4]:
        series = series_for(data, code, country)
        if year in series:
            values[country] = round(series[year], decimals)
    if len(values) < 4:
        return False
    if not fresh(("comparison", code, year, tuple(sorted(values)))):
        return False
    ordered = sorted(values.items(), key=lambda kv: kv[1])
    low_country, low_value = ordered[0]
    high_country, high_value = ordered[-1]
    if high_value - low_value < max(2.0, decimals * 2.0):
        return False
    mid_country, mid_value = ordered[1]
    if len({round(v, decimals) for v in values.values()}) < 4:
        return False
    names = sorted(values)
    shown = ", ".join(names[:3]) + f" and {names[3]}"
    stimulus = (
        f"{subject.capitalize()} is comparing {label} in {shown} in {year} "
        "using World Bank figures."
    )
    prompt = "Which statement about the data in the table is accurate?"
    correct = (
        f"{high_country} had the highest {label}, at "
        f"{unit_text(high_value, decimals, short)}; {low_country} had the lowest, at "
        f"{unit_text(low_value, decimals, short)}."
    )
    wrongs = [
        f"{low_country} had the highest {label}, at {unit_text(low_value, decimals, short)}.",
        f"{high_country} had the lowest {label}, at {unit_text(high_value, decimals, short)}.",
        f"{mid_country} had the highest {label}, at {unit_text(mid_value, decimals, short)}.",
    ]
    explanation = (
        f"In {year}, {high_country} records {unit_text(high_value, decimals, short)}, the "
        f"largest value in the table, while {low_country} records "
        f"{unit_text(low_value, decimals, short)}."
    )
    rationales = [
        f"{low_country} has the smallest value in the table, not the largest.",
        f"{high_country} has the largest value, so it cannot be the lowest.",
        f"{mid_country} is neither the highest nor the lowest row.",
    ]
    rows = [[c, fmt(values[c], decimals)] for c in sorted(values)]
    qid = f"RW-M15-WB-C{len(items):03d}-{code.split('.')[0][:4]}{year}"
    items.append(
        mc(
            qid, RW, INFO, QUANT, EASY, stimulus, prompt, correct, wrongs,
            explanation, rationales,
            figure=figure_table(rows, f"{label.capitalize()} by country, {year}", unit_phrase),
        )
    )
    return True


def build_change(data, code, label, unit_phrase, short, decimals, subject, picked):
    for start, end in CHANGE_WINDOWS:
        deltas = {}
        for country in picked[:4]:
            series = series_for(data, code, country)
            if start in series and end in series:
                deltas[country] = round(
                    round(series[end], decimals) - round(series[start], decimals), decimals
                )
        if len(deltas) < 4:
            continue
        rises = sorted(((c, d) for c, d in deltas.items() if d > 0), key=lambda kv: -kv[1])
        if not rises:
            continue
        if not fresh(("change", code, start, end, tuple(sorted(deltas)))):
            continue
        top_country, top_value = rises[0]
        if top_value < max(1.0, decimals):
            continue
        if len(rises) > 1 and top_value - rises[1][1] < max(0.4, decimals * 0.4):
            continue
        second_country, second_value = rises[1] if len(rises) > 1 else rises[0]
        falls = sorted(((c, d) for c, d in deltas.items() if d < 0), key=lambda kv: kv[1])
        fall_country, fall_value = falls[0] if falls else (top_country, -top_value)
        wrong_number = round(top_value + max(1.0, decimals * 3), decimals)
        names = sorted(deltas)
        shown = ", ".join(names[:3]) + f" and {names[3]}"
        stimulus = (
            f"{subject.capitalize()} is reviewing how {label} changed in {shown} "
            f"between {start} and {end}, using World Bank figures."
        )
        prompt = "Which statement about the change shown in the graph is accurate?"
        correct = (
            f"{top_country} had the largest increase, gaining "
            f"{unit_text(top_value, decimals, short)} between {start} and {end}."
        )
        if fall_value >= 0:
            fall_claim = (
                f"{fall_country} had the largest increase, gaining "
                f"{unit_text(fall_value, decimals, short)}."
            )
        else:
            fall_claim = (
                f"{fall_country} had the largest decrease, falling "
                f"{unit_text(abs(fall_value), decimals, short)}."
            )
        wrongs = [
            f"{second_country} had the largest increase, gaining "
            f"{unit_text(second_value, decimals, short)}.",
            fall_claim,
            f"{top_country} had the largest increase, gaining "
            f"{unit_text(wrong_number, decimals, short)}.",
        ]
        explanation = (
            f"The bars show {top_country} at {unit_text(top_value, decimals, short)}, the "
            f"tallest gain; {second_country} is lower at "
            f"{unit_text(second_value, decimals, short)}."
        )
        rationales = [
            f"{second_country}'s gain is smaller than {top_country}'s.",
            f"{fall_country}'s bar shows a decline, not the largest increase.",
            f"{unit_text(wrong_number, decimals, short)} is not the change plotted for {top_country}.",
        ]
        pairs = [(c, deltas[c]) for c in sorted(deltas)]
        qid = f"RW-M15-WB-D{len(items):03d}-{code.split('.')[0][:4]}{start}"
        items.append(
            mc(
                qid, RW, INFO, QUANT, MEDIUM, stimulus, prompt, correct, wrongs,
                explanation, rationales,
                figure=figure_bars(pairs, f"Change in {label}, {start} to {end}", unit_phrase),
            )
        )
        return True
    return False


def build_peak(data, code, label, unit_phrase, short, decimals, subject, picked):
    for country in picked:
        series = series_for(data, code, country)
        for start, end in PEAK_WINDOWS:
            got = window(series, start, end)
            if not got:
                continue
            years, raw = got
            values = [round(v, decimals) for v in raw]
            peak_value = max(values)
            if values.count(peak_value) != 1:
                continue
            if peak_value - min(values) < max(2.0, decimals * 2):
                continue
            peak_year = years[values.index(peak_value)]
            if peak_year in (years[0], years[-1]):
                continue
            if not fresh(("peak", code, country, start)):
                continue
            other_year = years[1] if years[1] != peak_year else years[2]
            other_value = values[years.index(other_year)]
            low_year = years[values.index(min(values))]
            low_value = min(values)
            stimulus = (
                f"{subject.capitalize()} is describing {label} in {country} using World Bank "
                f"figures for {start} through {end}."
            )
            prompt = "Which statement about the data in the graph is accurate?"
            correct = (
                f"{country}'s {label} reached its highest value in {peak_year}, at "
                f"{unit_text(peak_value, decimals, short)}."
            )
            wrongs = [
                f"{country}'s {label} reached its highest value in {other_year}, at "
                f"{unit_text(other_value, decimals, short)}.",
                f"{country}'s {label} reached its highest value in {low_year}, at "
                f"{unit_text(low_value, decimals, short)}.",
                f"{country}'s {label} reached its highest value in {peak_year}, at "
                f"{unit_text(low_value, decimals, short)}.",
            ]
            explanation = (
                f"The line peaks at {unit_text(peak_value, decimals, short)} in {peak_year}. "
                f"{other_year} shows {unit_text(other_value, decimals, short)}, and the lowest "
                f"point is {unit_text(low_value, decimals, short)} in {low_year}."
            )
            rationales = [
                f"{other_year} is below the peak year.",
                f"{low_year} shows the lowest value, not the highest.",
                f"{unit_text(low_value, decimals, short)} is the low point, not the peak.",
            ]
            qid = f"RW-M15-WB-P{len(items):03d}-{code.split('.')[0][:4]}{start}"
            items.append(
                mc(
                    qid, RW, INFO, QUANT, MEDIUM, stimulus, prompt, correct, wrongs,
                    explanation, rationales,
                    figure=figure_line(years, values, f"{label.capitalize()} in {country}, {start}-{end}", unit_phrase),
                )
            )
            return True
    return False


items = []
SEEN = set()


def fresh(signature):
    """Skip a country/indicator/window triple this batch already emitted."""
    if signature in SEEN:
        return False
    SEEN.add(signature)
    return True


def build(limit=132):
    data = load()
    countries = [name for name, _ in COUNTRIES]
    shapes = [build_trend, build_peak, build_comparison, build_change]
    index = 0
    while len(items) < limit and index < 4000:
        code, label, unit_phrase, short, decimals, subject = INDICATORS[index % len(INDICATORS)]
        shape = shapes[(index // len(INDICATORS)) % len(shapes)]
        rotation = index % len(countries)
        picked = countries[rotation:] + countries[:rotation]
        if shape is build_comparison:
            shape(data, code, label, unit_phrase, short, decimals, subject, picked,
                  COMPARE_YEARS[(index // 2) % len(COMPARE_YEARS)])
        else:
            shape(data, code, label, unit_phrase, short, decimals, subject, picked)
        index += 1

    seen = set()
    unique = []
    for item in items:
        texts = [c["text"] for c in item["choices"]]
        if len(set(texts)) < 4:
            continue
        assert item["id"] not in seen, item["id"]
        seen.add(item["id"])
        unique.append(item)
    return unique


def main():
    built = build()
    payload = {
        "questions": built,
        "sources": [
            {
                "source_id": "open_core_m15",
                "name": "HDSAT Open Core M15 (World Bank Open Data)",
                "license": "CC BY 4.0",
                "license_url": "https://creativecommons.org/licenses/by/4.0/",
                "attribution": ATTRIBUTION,
            }
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {len(built)} items to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
