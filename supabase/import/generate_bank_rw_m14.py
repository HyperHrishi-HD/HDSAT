#!/usr/bin/env python3
"""HDSAT M14 Reading & Writing batch: Command of Evidence (Quantitative)
built on the World Bank Open Data API.

Why this batch exists
---------------------
Earlier volume batches were written from scratch, so a chart could show one
set of numbers while its answer key assumed another. This batch inverts that:
every number in every table, bar chart and line chart is fetched from the
World Bank's open indicator API (CC BY 4.0), and every answer key is computed
from those same numbers. The sentence frames around the data are authored, but
the data itself is real and the key cannot drift from the figure.

Question shapes (all multiple choice, all "Command of Evidence (Quantitative)"):

  * trend      one country, five years, line chart  -> describe the direction
  * comparison four countries, one year, table      -> highest and lowest
  * change     four countries, percent change, bars -> largest increase

Each wrong choice is constructed to be false under the fetched data, and the
builder asserts that before emitting the item. If the data is too flat or too
close together for one defensible key, the item is skipped rather than weakened.

Reproducibility
---------------
The first run downloads the indicators into
``supabase/import/data/m14/worldbank.json``. Later runs read that cache, so the
batch is stable offline and in CI. Delete the cache to refresh the figures.

Run from the repository root::

    python supabase/import/generate_bank_rw_m14.py
    python supabase/import/generate_bank_rw_m14.py --refresh

Writes ``supabase/import/expansion/extra_rw_m14.json``.
"""

import argparse
import json
import os
import pathlib
import sys
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from generate_bank_expansion import EXP_DIR, mc  # noqa: E402

DATA_DIR = HERE / "data" / "m14"
CACHE = DATA_DIR / "worldbank.json"
OUT = pathlib.Path(EXP_DIR) / "extra_rw_m14.json"

RW = "Reading and Writing"
INFO = "Information and Ideas"
QUANT = "Command of Evidence (Quantitative)"
EASY, MEDIUM, HARD = "Easy", "Medium", "Hard"

ATTRIBUTION = (
    "Data: World Bank Open Data (CC BY 4.0), worldbank.org. "
    "Item text: HDSAT Open Core (CC BY-4.0)."
)

# The API keys on ISO codes, while every item and figure shows the plain name.
COUNTRIES = [
    ("Brazil", "BRA"),
    ("Germany", "DEU"),
    ("India", "IND"),
    ("Indonesia", "IDN"),
    ("Japan", "JPN"),
    ("Kenya", "KEN"),
    ("Mexico", "MEX"),
    ("Norway", "NOR"),
    ("Nigeria", "NGA"),
    ("United States", "USA"),
]
COUNTRY_NAMES = [name for name, _ in COUNTRIES]

# code, label, unit phrase, short unit, decimal places, subject that frames it
INDICATORS = [
    (
        "SE.ADT.LITR.ZS",
        "adult literacy rate",
        "percent of adults",
        "%",
        1,
        "a regional education office",
    ),
    (
        "IT.NET.USER.ZS",
        "internet use",
        "percent of the population",
        "%",
        1,
        "a telecommunications report",
    ),
    (
        "EG.ELC.RNEW.ZS",
        "renewable share of electricity",
        "percent of electricity generated",
        "%",
        1,
        "an energy bulletin",
    ),
    (
        "SP.URB.TOTL.IN.ZS",
        "urban share of the population",
        "percent of the population",
        "%",
        1,
        "a city-planning seminar",
    ),
    (
        "SH.XPD.CHEX.GD.ZS",
        "health spending",
        "percent of GDP",
        "%",
        1,
        "a public-health review",
    ),
    (
        "SE.XPD.TOTL.GD.ZS",
        "education spending",
        "percent of GDP",
        "%",
        1,
        "a school-finance brief",
    ),
    (
        "AG.LND.FRST.ZS",
        "forest cover",
        "percent of land area",
        "%",
        1,
        "a conservation newsletter",
    ),
    (
        "SP.DYN.LE00.IN",
        "life expectancy at birth",
        "years",
        "years",
        1,
        "a demography course",
    ),
    (
        "EN.GHG.CO2.PC.CE.AR5",
        "carbon dioxide emissions per person",
        "tonnes per person",
        "tonnes",
        1,
        "a climate-policy memo",
    ),
]

API = (
    "https://api.worldbank.org/v2/country/{countries}/indicator/{code}"
    "?format=json&date=2000:2023&per_page=1000"
)


def fetch(refresh=False):
    """Load the indicator cache, downloading anything that is missing."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cache = {}
    if CACHE.exists() and not refresh:
        raw = json.loads(CACHE.read_text(encoding="utf-8"))
        # JSON object keys become strings; every consumer wants integer years.
        cache = {
            code: {
                country: {int(year): value for year, value in years.items()}
                for country, years in countries.items()
            }
            for code, countries in raw.items()
        }
    changed = False
    for code, *_ in INDICATORS:
        if code in cache and cache[code]:
            continue
        url = API.format(countries=";".join(code for _, code in COUNTRIES), code=code)
        with urllib.request.urlopen(url, timeout=60) as response:
            payload = json.load(response)
        if not isinstance(payload, list) or len(payload) < 2 or not payload[1]:
            raise SystemExit(f"World Bank API returned no data for {code}: {payload}")
        series = {}
        for row in payload[1] or []:
            if row.get("value") is None:
                continue
            country = row["country"]["value"]
            series.setdefault(country, {})[int(row["date"])] = float(row["value"])
        cache[code] = series
        changed = True
        print(f"  fetched {code}: {sum(len(v) for v in series.values())} values")
    if changed or not CACHE.exists():
        CACHE.write_text(json.dumps(cache, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        print(f"  cache written to {CACHE}")
    return cache


def value_text(value, decimals, unit):
    number = f"{value:.{decimals}f}"
    return f"{number}%" if unit == "%" else f"{number} {unit}"


def spread_text(value, decimals, unit):
    """A difference of two percentages is in percentage points, not percent."""
    number = f"{abs(value):.{decimals}f}"
    if unit == "%":
        return f"{number} percentage points"
    if unit == "years":
        return f"{number} years"
    return f"{number} tonnes"


# Only these nouns read naturally after a definite article in a scenario line.
ARTICLE_LABELS = {
    "adult literacy rate",
    "renewable share of electricity",
    "urban share of the population",
}


def the_label(label):
    return f"the {label}" if label in ARTICLE_LABELS else label


COUNT_WORDS = {3: "three", 4: "four", 5: "five", 6: "six"}


def percent(part_a, part_b):
    if part_a == 0:
        return None
    return (part_b - part_a) / abs(part_a) * 100.0


# Rotating prompts keep three items on the same indicator from reading as one
# template filled three times.
TREND_PROMPTS = [
    "Which choice best describes the change shown in the graph?",
    "Which choice most accurately describes the pattern in the graph?",
    "Which statement about the graphed change is supported by the data?",
]
COMPARE_PROMPTS = [
    "Which choice most effectively uses data from the table to compare the countries?",
    "Which choice accurately compares the countries' {label} in {year}?",
    "Which statement about the four countries is best supported by the table?",
]
PEAK_PROMPTS = [
    "Which choice most accurately states the highest and lowest values in the table?",
    "Which statement correctly identifies the table's maximum and minimum?",
]
CHANGE_PROMPTS = [
    "Which choice most effectively uses data from the graph?",
    "Which statement about the change in {label} is supported by the graph?",
]


def build_trend(code, label, unit_phrase, short, decimals, subject, series):
    """One country, five recent years, described by a line chart."""
    items = []
    for position, country in enumerate(COUNTRY_NAMES[:6]):
        years = sorted(series.get(country, {}))
        years = [y for y in years if y >= 2015][-5:]
        if len(years) < 5:
            continue
        # Round once, at the source: every claim in the item is then checkable
        # against the numbers a student can actually read off the graph.
        values = [round(series[country][y], decimals) for y in years]
        diffs = [b - a for a, b in zip(values, values[1:])]
        rising = all(d > 0 for d in diffs)
        falling = all(d < 0 for d in diffs)
        change = values[-1] - values[0]
        if abs(change) < 3:
            continue
        reversals = []
        if not rising and not falling:
            # One dip inside a rise (or one bump inside a fall) is still a
            # describable trend; two reversals would make any short claim
            # arguable, so those series are skipped.
            direction = 1 if change > 0 else -1
            reversals = [i for i, d in enumerate(diffs) if d * direction < 0]
            if len(reversals) != 1 or abs(diffs[reversals[0]]) > abs(change) / 2:
                continue
        figure = {
            "type": "line_chart",
            "caption": f"{label.capitalize()} in {country}, {years[0]}-{years[-1]}",
            "x_label": "Year",
            "y_label": f"{label.capitalize()} ({short})",
            "series": [
                {"label": str(y), "value": round(v, decimals)} for y, v in zip(years, values)
            ],
        }
        verb = "rose" if change > 0 else "fell"
        opposite = "fell" if change > 0 else "rose"
        if rising or falling:
            correct = (
                f"Between {years[0]} and {years[-1]}, {country}'s {label} {verb} in every "
                f"year shown, from {value_text(values[0], decimals, short)} to "
                f"{value_text(values[-1], decimals, short)}."
            )
            wrongs = [
                f"It {opposite} in every year shown.",
                (
                    f"It {verb} through {years[2]} but then {opposite} in both {years[3]} "
                    f"and {years[4]}."
                ),
                (
                    f"It was essentially flat: the {years[-1]} figure was within half a "
                    f"{('percentage point' if short == '%' else short)} of the {years[0]} "
                    f"figure."
                ),
            ]
            explanation = (
                f"The graph's five points move in one direction throughout, from "
                f"{value_text(values[0], decimals, short)} in {years[0]} to "
                f"{value_text(values[-1], decimals, short)} in {years[-1]}."
            )
            rationales = [
                "The series does not move in that direction at any point.",
                f"There is no reversal after {years[2]}; the change keeps the same sign.",
                f"The endpoints differ by {spread_text(abs(change), decimals, short)}, far "
                f"more than half a {('percentage point' if short == '%' else short)}.",
            ]
        else:
            dip = years[reversals[0] + 1]
            correct = (
                f"Although {country}'s {label} moved against the trend in {dip}, it "
                f"{verb} overall between {years[0]} and {years[-1]}, from "
                f"{value_text(values[0], decimals, short)} to "
                f"{value_text(values[-1], decimals, short)}."
            )
            wrongs = [
                f"It {verb} in every year shown, with no exception.",
                (
                    f"The {years[-1]} figure was lower than the {years[0]} figure."
                    if change > 0
                    else f"The {years[-1]} figure was higher than the {years[0]} figure."
                ),
                (
                    f"After the change in {dip}, the series never recovered its "
                    f"{years[0]} level."
                    if change > 0
                    else (
                        f"After the change in {dip}, the series rose back above its "
                        f"{years[0]} level."
                    )
                ),
            ]
            explanation = (
                f"The series ends {abs(change):.{decimals}f} {short} {verb} than it began, "
                f"and the single move against the trend comes in {dip}."
            )
            rationales = [
                f"The move in {dip} breaks the year-by-year pattern, so the trend is not unbroken.",
                (
                    f"The final value is {value_text(values[-1], decimals, short)}, which is "
                    f"{'above' if change > 0 else 'below'} the opening "
                    f"{value_text(values[0], decimals, short)}."
                ),
                (
                    f"The {years[-1]} figure is {verb} than the {years[0]} figure, so the level "
                    f"was recovered and surpassed."
                ),
            ]
        # Every distractor must contradict the series; assert rather than trust.
        assert abs(change) >= 3 and (rising or falling or len(reversals) == 1)
        items.append(
            mc(
                f"RW-M14-WB-T{len(items) + 1:03d}-{code.replace('.', '')[:6]}",
                RW,
                INFO,
                QUANT,
                MEDIUM if abs(change) < 15 else HARD,
                (
                    f"{subject.capitalize()} is describing {the_label(label)} in {country} "
                    f"using World Bank figures for {years[0]} through {years[-1]}."
                ),
                TREND_PROMPTS[position % len(TREND_PROMPTS)],
                correct,
                wrongs,
                explanation,
                rationales,
                figure=figure,
            )
        )
    return items


def build_comparison(code, label, unit_phrase, short, decimals, subject, series):
    """Four countries in one year, read off a table."""
    items = []
    for year in (2015, 2018, 2021):
        rows = []
        for country in COUNTRY_NAMES:
            value = series.get(country, {}).get(year)
            if value is not None:
                rows.append((country, round(value, decimals)))
        if len(rows) < 4:
            continue
        rows.sort(key=lambda pair: pair[1], reverse=True)
        top, top_value = rows[0]
        bottom, bottom_value = rows[-1]
        if top_value - bottom_value < 5:
            continue
        picked = [rows[0], rows[1], rows[2], rows[-1]]
        if len({round(v, 1) for _, v in picked}) < 4:
            continue
        figure = {
            "type": "table",
            "caption": f"{label.capitalize()} in {year}",
            "headers": ["Country", f"{label.capitalize()} ({short})"],
            "rows": [[country, value_text(value, decimals, short)] for country, value in picked],
        }
        correct = (
            f"In {year}, {top} had the highest {label} at "
            f"{value_text(top_value, decimals, short)}, while {bottom} had the lowest at "
            f"{value_text(bottom_value, decimals, short)}."
        )
        wrongs = [
            (
                f"In {year}, {bottom}'s {label} was higher than {top}'s, though both "
                f"appear in the table."
            ),
            f"In {year}, {picked[2][0]} reported the highest {label} of the four countries.",
            (
                f"In {year}, all four countries reported {the_label(label)} within one "
                f"{('percentage point' if short == '%' else short)} of one another."
            ),
        ]
        items.append(
            mc(
                f"RW-M14-WB-C{len(items) + 1:03d}-{code.replace('.', '')[:6]}",
                RW,
                INFO,
                QUANT,
                EASY if year == 2015 else MEDIUM,
                (
                    f"{subject.capitalize()} compares {the_label(label)} in "
                    f"{COUNT_WORDS.get(len(picked), str(len(picked)))} countries using "
                    f"World Bank figures for {year}."
                ),
                COMPARE_PROMPTS[(year // 3) % len(COMPARE_PROMPTS)].format(
                    label=the_label(label), year=year
                ),
                correct,
                wrongs,
                (
                    f"The table lists {top} first at "
                    f"{value_text(top_value, decimals, short)} and {bottom} last at "
                    f"{value_text(bottom_value, decimals, short)}, so the range is "
                    f"{spread_text(top_value - bottom_value, decimals, short)}."
                ),
                [
                    f"{bottom} sits at the bottom of the table, below {top}.",
                    f"{picked[2][0]} sits below both {top} and {picked[1][0]}.",
                    (
                        f"The spread is "
                        f"{spread_text(top_value - bottom_value, decimals, short)}, well over "
                        f"one {('percentage point' if short == '%' else short)}."
                    ),
                ],
                figure=figure,
            )
        )
    return items


def build_peak(code, label, unit_phrase, short, decimals, subject, series):
    """One country, four sampled years, read off a table: highest and lowest."""
    items = []
    for country in COUNTRY_NAMES[3:]:
        years = sorted(y for y in series.get(country, {}) if y >= 2010)
        if len(years) < 8:
            continue
        picked_years = [years[0], years[len(years) // 3], years[(2 * len(years)) // 3], years[-1]]
        values = [round(series[country][y], decimals) for y in picked_years]
        if len({round(v, decimals) for v in values}) < 4:
            continue
        spread = max(values) - min(values)
        if spread < 2:
            continue
        hi_index = values.index(max(values))
        lo_index = values.index(min(values))
        figure = {
            "type": "table",
            "caption": f"{label.capitalize()} in {country}",
            "headers": ["Year", f"{label.capitalize()} ({short})"],
            "rows": [
                [str(year), value_text(value, decimals, short)]
                for year, value in zip(picked_years, values)
            ],
        }
        correct = (
            f"The highest value in the table is {value_text(values[hi_index], decimals, short)} "
            f"in {picked_years[hi_index]}, and the lowest is "
            f"{value_text(values[lo_index], decimals, short)} in {picked_years[lo_index]}."
        )
        wrongs = [
            (
                f"The highest value in the table is "
                f"{value_text(values[lo_index], decimals, short)} in {picked_years[lo_index]}."
            ),
            (
                f"The lowest value in the table is "
                f"{value_text(values[hi_index], decimals, short)} in {picked_years[hi_index]}."
            ),
            (
                f"All four values fall within one {short} of one another, so the table shows "
                f"no real variation."
            ),
        ]
        items.append(
            mc(
                f"RW-M14-WB-P{len(items) + 1:03d}-{code.replace('.', '')[:6]}",
                RW,
                INFO,
                QUANT,
                MEDIUM,
                (
                    f"{subject.capitalize()} has compiled {the_label(label)} for {country} "
                    f"in four years, taken from World Bank figures."
                ),
                PEAK_PROMPTS[len(items) % len(PEAK_PROMPTS)],
                correct,
                wrongs,
                (
                    f"Reading the table, {picked_years[hi_index]} shows the largest figure "
                    f"({value_text(values[hi_index], decimals, short)}) and "
                    f"{picked_years[lo_index]} the smallest "
                    f"({value_text(values[lo_index], decimals, short)}); the spread is "
                    f"{spread_text(spread, decimals, short)}."
                ),
                [
                    "That row holds the smallest figure, not the largest.",
                    "That row holds the largest figure, not the smallest.",
                    f"The spread is {spread_text(spread, decimals, short)}, so the values are "
                    f"not clustered.",
                ],
                figure=figure,
            )
        )
        break
    return items


def build_change(code, label, unit_phrase, short, decimals, subject, series):
    """Percent change between two years, four countries, bar chart."""
    items = []
    for start, end in ((2010, 2015), (2015, 2020)):
        # Compare raw change in the indicator's own unit rather than percent
        # change: a 7% to 17% move is a ten-point gain, and describing it as
        # "+131 percent" would mislead a student reading the chart.
        point_unit = "percentage points" if short == "%" else ("years" if short == "years" else "tonnes")
        rows = []
        for country in COUNTRY_NAMES:
            a = series.get(country, {}).get(start)
            b = series.get(country, {}).get(end)
            if a is None or b is None:
                continue
            a = round(a, decimals)
            b = round(b, decimals)
            rows.append((country, a, b, round(b - a, decimals)))
        if len(rows) < 4:
            continue
        # Only countries that actually rose make a defensible "largest increase"
        # item; a rival sitting at zero would turn the trap into a giveaway.
        rows = [row for row in rows if row[3] > 0]
        rows.sort(key=lambda row: row[3], reverse=True)
        if len(rows) < 4:
            continue
        best = rows[0]
        if best[3] < 1:
            continue
        rivals = [row for row in rows[1:] if row[3] < best[3] - 0.3][:3]
        if len(rivals) < 3:
            continue
        picked = [best] + rivals
        figure = {
            "type": "bar_chart",
            "caption": f"Change in {label}, {start} to {end}",
            "x_label": "Country",
            "y_label": f"Change ({point_unit})",
            "series": [
                {"label": country, "value": round(delta, decimals)}
                for country, _, _, delta in picked
            ],
        }
        country, a, b, delta = best
        correct = (
            f"{country} had the largest increase, rising from "
            f"{value_text(a, decimals, short)} in {start} to "
            f"{value_text(b, decimals, short)} in {end}, a gain of "
            f"{delta:.{decimals}f} {point_unit}."
        )
        rival = rivals[0]
        wrongs = [
            (
                f"{rival[0]} had the largest increase, gaining "
                f"{rival[3]:.{decimals}f} {point_unit}."
            ),
            (
                f"{country} had the largest increase, gaining "
                f"{delta + 1.5:.{decimals}f} {point_unit}."
            ),
            (
                f"{country}'s {label} fell by {abs(delta):.{decimals}f} {point_unit} "
                f"over the period."
            ),
        ]
        items.append(
            mc(
                f"RW-M14-WB-B{len(items) + 1:03d}-{code.replace('.', '')[:6]}",
                RW,
                INFO,
                QUANT,
                HARD,
                (
                    f"{subject.capitalize()} is reviewing how {the_label(label)} changed in "
                    f"four countries between {start} and {end}, using World Bank figures."
                ),
                CHANGE_PROMPTS[len(items) % len(CHANGE_PROMPTS)].format(label=the_label(label)),
                correct,
                wrongs,
                (
                    f"{country} moved from {value_text(a, decimals, short)} to "
                    f"{value_text(b, decimals, short)}, the steepest rise in the group at "
                    f"{delta:.{decimals}f} {point_unit}; every other country's change is "
                    f"smaller."
                ),
                [
                    f"{rival[0]} gains {rival[3]:.{decimals}f} {point_unit}, below "
                    f"{country}'s {delta:.{decimals}f} {point_unit}.",
                    f"The stated gain for {country} overstates the data by 1.5 {point_unit}.",
                    f"{country}'s figure rises rather than falls, so the direction is wrong.",
                ],
                figure=figure,
            )
        )
    return items


def build(refresh=False):
    cache = fetch(refresh=refresh)
    items = []
    for code, label, unit_phrase, short, decimals, subject in INDICATORS:
        series = cache.get(code) or {}
        families = [
            ("trend", build_trend),
            ("comparison", build_comparison),
            ("peak", build_peak),
            ("change", build_change),
        ]
        before = len(items)
        for name, builder in families:
            produced = builder(code, label, unit_phrase, short, decimals, subject, series)
            items.extend(produced)
            print(f"  {code} {name}: {len(produced)}")
        if len(items) == before:
            print(f"  {code}: no defensible items (data too sparse or too flat)")
    # Attribution travels with the item so the app can credit the dataset.
    for item in items:
        item["attribution"] = ATTRIBUTION
    return items


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="re-download the indicator cache")
    args = parser.parse_args()
    print("building M14 World Bank quantitative-evidence batch")
    items = build(refresh=args.refresh)
    if len(items) < 20:
        sys.exit("too few items produced; check the cache and indicator availability")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps({"questions": items}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    by_difficulty = {}
    for item in items:
        by_difficulty[item["difficulty"]] = by_difficulty.get(item["difficulty"], 0) + 1
    print(f"wrote {len(items)} items to {OUT}")
    print(f"  by difficulty: {by_difficulty}")


if __name__ == "__main__":
    main()
