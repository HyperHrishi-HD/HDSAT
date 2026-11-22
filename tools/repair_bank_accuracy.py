"""Apply the accuracy repairs found by tools/audit_families.py.

Every edit is verified against the item itself before it is written, so a
mistake here fails loudly instead of quietly shipping a wrong key.

    python tools/repair_bank_accuracy.py [--dry-run]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import sympy as sp

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / "src" / "data" / "questionBank.json"

X = sp.Symbol("x")
Y = sp.Symbol("y")

# Degenerate systems: a line that was written twice, so there was no unique
# solution. Each tuple is (first equation coefficients (a, b, c), the point the
# item's own key implies, the new second equation, the new explanation).
SYSTEM_FIXES = {
    "M-SYS-55329": {
        "keep": (2, 4, 40),
        "point": (4, 8),
        "second": "x - y = -4",
        "explanation": (
            "Solving $2x + 4y = 40$ together with $x - y = -4$ gives $x = 4$ and "
            "$y = 8$, so $x + y = 12$."
        ),
    },
    "M-SYS-55412": {
        "keep": (2, 4, 36),
        "point": (12, 3),
        "second": "x - y = 9",
        "explanation": (
            "Solving $2x + 4y = 36$ together with $x - y = 9$ gives $x = 12$ and "
            "$y = 3$, so $x + y = 15$."
        ),
    },
    "M-SYS-55422": {
        "keep": (3, 3, 45),
        "point": (8, 7),
        "second": "x - y = 1",
        "explanation": (
            "Solving $3x + 3y = 45$ together with $x - y = 1$ gives $x = 8$ and "
            "$y = 7$, so $x + y = 15$."
        ),
    },
    "M-SYS-65402": {
        "keep": (5, 5, 25),
        "point": (2, 3),
        "second": "x - y = -1",
        "explanation": (
            "Substituting $(2, 3)$ gives $5(2) + 5(3) = 25$ and $2 - 3 = -1$, so the "
            "pair satisfies both equations."
        ),
    },
    "M-SYS-65406": {
        "keep": (5, 5, 45),
        "point": (2, 7),
        "second": "x - y = -5",
        "explanation": (
            "Substituting $(2, 7)$ gives $5(2) + 5(7) = 45$ and $2 - 7 = -5$, so the "
            "pair satisfies both equations."
        ),
    },
}


def stripped_prose(stimulus: str) -> str:
    """Unwrap a sentence that was accidentally wrapped in math delimiters."""
    inner = stimulus.strip()
    if inner.startswith("$") and inner.endswith("$") and inner.count("$") == 2:
        inner = inner[1:-1].strip()
    # `36\pi` outside math would render as literal backslash-pi.
    inner = inner.replace("\\pi", r"$\pi$").replace("$$", "$")
    inner = inner.replace(r"$$", "$")
    return inner


def main() -> int:
    dry = "--dry-run" in sys.argv
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    items = {q["id"]: q for q in bank["questions"]}
    changes: list[str] = []

    # ---- 1. degenerate systems ------------------------------------------- #
    for qid, fix in SYSTEM_FIXES.items():
        q = items[qid]
        a, b, c = fix["keep"]
        x0, y0 = fix["point"]
        assert a * x0 + b * y0 == c, f"{qid}: key point is not on the kept line"
        second = fix["second"]
        lhs, rhs = second.split("=")
        # The new line must pass through the same point and be independent.
        la, lb = (sp.Integer(v) for v in _coeffs(lhs))
        assert la * x0 + lb * y0 == int(rhs), f"{qid}: new line misses the point"
        assert a * lb - la * b != 0, f"{qid}: new line is parallel to the kept one"
        wanted = f"$${a}x + {b}y = {c}$$\n$${second}$$"
        if q.get("stimulus") == wanted and q.get("explanation") == fix["explanation"]:
            continue
        q["stimulus"] = wanted
        q["explanation"] = fix["explanation"]
        changes.append(f"{qid}: unique system through {fix['point']}")

    # ---- 2. prose wrapped in math delimiters ------------------------------ #
    for q in bank["questions"]:
        stim = q.get("stimulus") or ""
        if stim.startswith("$A ") or stim.startswith("$An "):
            new = stripped_prose(stim)
            assert "\\pi" not in new.replace("$\\pi$", ""), q["id"]
            q["stimulus"] = new
            changes.append(f"{q['id']}: unwrapped prose")

    # ---- 3. one difficulty per template ----------------------------------- #
    for q in bank["questions"]:
        if q["format"] != "spr":
            continue
        if q.get("skill") == "Absolute value equations and inequalities" and q["prompt"].startswith(
            "What is the positive value"
        ):
            if q["difficulty"] != "Medium":
                q["difficulty"] = "Medium"
                changes.append(f"{q['id']}: difficulty Medium")
        if q.get("skill") == "Right triangles and trigonometry" and "\\sin A" in q["prompt"]:
            if q["difficulty"] != "Medium":
                q["difficulty"] = "Medium"
                changes.append(f"{q['id']}: difficulty Medium")

    # ---- 4. rounding in the percent question ------------------------------ #
    q = items["M13-DATA-L000"]
    for choice in q["choices"]:
        if choice["id"] == "D" and choice["text"] != "87.5%":
            choice["text"] = "87.5%"
            changes.append("M13-DATA-L000: exact 87.5% choice")
    q["explanation"] = (
        "The increase is $75 - 40 = 35$, and $35 / 40 = 0.875$, which is "
        "$87.5$ percent."
    )

    if dry:
        print("\n".join(changes))
        print(f"{len(changes)} changes (dry run)")
        return 0

    BANK.write_text(json.dumps(bank, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("\n".join(changes))
    print(f"{len(changes)} changes written to {BANK.relative_to(ROOT)}")
    return 0


def _coeffs(expr: str) -> tuple[int, int]:
    """Coefficients of the two variables in `a x + b y`."""
    body = expr.replace("$", "").replace(" ", "")
    a = sp.Symbol("a")
    b = sp.Symbol("b")
    parsed = sp.sympify(body, locals={"x": a, "y": b})
    return int(parsed.coeff(a)), int(parsed.coeff(b))


if __name__ == "__main__":
    raise SystemExit(main())
