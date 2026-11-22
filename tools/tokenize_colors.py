"""Move the hard-coded colours in global.css onto the theme tokens.

Dark mode works only if every surface, border and text colour comes from a
token; a literal `background: #ffffff` stays white in the dark no matter what
the palette says. This script rewrites the literal declarations that mirror a
token value, and leaves alone the places that are deliberately fixed:

* the test runner's Bluebook-style chrome (it imitates the real test app),
* the admin console (its own dark furniture),
* figures, graph canvases, diagrams and embedded calculators (paper surfaces),
* the arcade rooms and their canvases.

Anything it cannot map with confidence is left untouched, and the script prints
what is left so the residue can be reviewed by hand.
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

PATH = Path(__file__).resolve().parents[1] / "src" / "styles" / "global.css"

# Scopes that keep their own colours in both modes.
FIXED_SCOPES = (
    ".bb-",
    ".adm-",
    ".hl-note",
    ".vault",
    ".rune",
    ".arcade",
    ".game-",
    ".figure",
    ".fig-",
    ".desmos",
    ".coordinate",
    ".math-tool",
    ".graph",
    ".pdf-",
    ".paper-",
    ".test-bar",
)

BACKGROUND = {
    "#ffffff": "var(--surface)",
    "#fff": "var(--surface)",
    "#fbfcfe": "var(--surface)",
    "#f8fafc": "var(--surface)",
    "#f2f4f7": "var(--surface-2)",
    "#eff2f6": "var(--surface-2)",
    "#eef4ff": "var(--accent-soft)",
    "#f2f6fe": "var(--accent-soft)",
    "#e8effc": "var(--accent-soft)",
    "#2557d6": "var(--accent)",
    "#1d4ed8": "var(--accent)",
    "#1f5fd0": "var(--accent)",
}

COLOR = {
    "#14181f": "var(--ink)",
    "#111111": "var(--ink)",
    "#1e242c": "var(--ink)",
    "#3d4756": "var(--ink-2)",
    "#4a5563": "var(--ink-2)",
    "#5a6472": "var(--ink-2)",
    "#6b7686": "var(--muted)",
    "#555": "var(--muted)",
    "#b3261e": "var(--bad)",
    "#8c1d17": "var(--bad)",
    "#145c39": "var(--good)",
    "#1d4ed8": "var(--accent)",
    "#2557d6": "var(--accent)",
    "#ffffff": "var(--on-accent)",
    "#fff": "var(--on-accent)",
}

BORDER = {
    "#c5ccd6": "var(--line)",
    "#e2e6ec": "var(--line)",
    "#d5dae0": "var(--line)",
    "#cfd6e0": "var(--line)",
    "#cbd5e1": "var(--line)",
    "#dde1e7": "var(--line)",
    "#1d4ed8": "var(--accent)",
    "#2557d6": "var(--accent)",
    "#b3261e": "var(--bad)",
}

RULE = re.compile(r"([^{}]+)\{([^{}]*)\}")
DECL = re.compile(r"((?:^|;)\s*)([a-z-]+)\s*:\s*([^;{}]+)")
HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")


def is_fixed(selector: str) -> bool:
    return any(scope in selector for scope in FIXED_SCOPES)


def remap(prop: str, value: str) -> str:
    if prop == "background" or prop == "background-color":
        table = BACKGROUND
    elif prop == "color":
        table = COLOR
    elif prop.startswith("border") or prop in {"outline"}:
        table = BORDER
    else:
        return value

    def replace(match: re.Match[str]) -> str:
        raw = match.group(0)
        return table.get(raw.lower(), raw)

    return HEX.sub(replace, value)


def main() -> None:
    with PATH.open(encoding="utf-8", newline="") as handle:
        css = handle.read()
    start = css.index("* { box-sizing")
    head, body = css[:start], css[start:]

    changed = 0
    leftover: Counter[tuple[str, str]] = Counter()

    def on_rule(match: re.Match[str]) -> str:
        nonlocal changed
        selector, declarations = match.group(1), match.group(2)
        if is_fixed(selector):
            return match.group(0)

        def on_decl(decl: re.Match[str]) -> str:
            nonlocal changed
            lead, prop, value = decl.group(1), decl.group(2), decl.group(3)
            new_value = remap(prop, value)
            if new_value != value:
                changed += 1
            elif HEX.search(value) and prop in {
                "background",
                "background-color",
                "color",
                "border",
                "border-color",
                "border-top",
                "border-bottom",
                "border-left",
                "border-right",
            }:
                for literal in HEX.findall(value):
                    leftover[(prop, literal)] += 1
            return f"{lead}{prop}: {new_value}"

        return f"{selector}{{{DECL.sub(on_decl, declarations)}}}"

    body = RULE.sub(on_rule, body)
    with PATH.open("w", encoding="utf-8", newline="") as handle:
        handle.write(head + body)
    print(f"rewrote {changed} declarations")
    print("left untouched (deliberate or unknown):")
    for (prop, literal), count in leftover.most_common(30):
        print(f"  {count:3d}  {prop}: {literal}")


if __name__ == "__main__":
    main()
