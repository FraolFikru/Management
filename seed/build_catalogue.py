#!/usr/bin/env python3
"""Write the stock item list (api/eirsha_api/catalogue.py) into the Sales and Manager apps' catalog.ts.

    python3 -I seed/build_catalogue.py

Rewrites, in apps/sales/src/catalog.ts and apps/manager/src/catalog.ts:
  * the food & drink inv(...) lines between "// Raw ingredients" and "// Packaging & takeout"
  * the generated group names (FRUITS, CONDIMENTS, CEREMONY) and their main categories
  * the Manager's RESTOCK_MINIMUM entries for these items
Packaging, kitchen and cleaning lines are left as they are.
"""
from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "api"))
from eirsha_api import catalogue as cat  # noqa: E402

START, END = "// Raw ingredients", "// Packaging & takeout"
HEAD = {"teff": "// Grains, flours & legumes", "beef": "// Meats, poultry & fish", "onion": "// Fresh vegetables & aromatics",
        "avocado": "// Fruits", "berbere": "// Spices, herbs & condiments", "kibbeh": "// Dairy, oils & fats",
        "coffee": "// Beverages & coffee supplies", "sd-coca-cola": "// Soft drinks (one item each)", "beer-st-george": "// Beers (one item each)"}


def js(s: str) -> str:
    return json.dumps(s, ensure_ascii=False)


def num(n: float) -> str:
    return f"{n:g}"


def inv_lines() -> str:
    out = [f"{START} (generated from api/eirsha_api/catalogue.py by seed/build_catalogue.py; edit there)"]
    for r in cat.rows():
        if r["id"] in HEAD:
            out.append(HEAD[r["id"]])
        aliases = f", [{', '.join(js(a) for a in r['aliases'])}]" if r["aliases"] else ""
        out.append(f'inv({js(r["id"])}, {js(r["category"])}, {js(r["group"])}, {js(r["unit"])}, {num(r["cost"])}, '
                   f'L({js(r["en"])}, {js(r["am"] or r["en"])}, {js(r["om"] or r["en"])}){aliases});')
    return "\n".join(out) + "\n"


def patch(path: str, manager: bool) -> None:
    src = open(path, encoding="utf-8").read()
    a, b = src.index(START), src.index(END)
    src = src[:a] + inv_lines() + src[b:]
    # new groups: names + main category
    for g, (en, am, om) in cat.NEW_GROUPS.items():
        line = f"  {g}: L({js(en)}, {js(am)}, {js(om)}),"
        if f"\n  {g}: L(" not in src:
            src = src.replace('reg("group", {\n', 'reg("group", {\n' + line + "\n", 1)
    gm = re.search(r"const GROUP_MAIN: Record<string, MainCategory> = \{\n(.*?)\n\};", src, re.S)
    if gm:
        body = gm.group(1)
        extra = [f"{g}: \"{cat.GROUP_MAIN[g]}\"" for g in cat.NEW_GROUPS if f"{g}:" not in body]
        if extra:
            src = src.replace(gm.group(0), gm.group(0).replace("\n};", f"\n  {', '.join(extra)},\n}};"), 1)
    if manager:
        m = re.search(r"export const RESTOCK_MINIMUM: Record<string, number> = \{(.*?)\};", src)
        cur = dict(re.findall(r'"([^"]+)": ([0-9.]+)', m.group(1)))
        for old in cat.RETIRED:
            cur.pop(old, None)
        for r in cat.rows():
            cur[r["id"]] = num(r["minimum"])
        src = src.replace(m.group(0), "export const RESTOCK_MINIMUM: Record<string, number> = { "
                          + ", ".join(f'"{k}": {v}' for k, v in cur.items()) + " };", 1)
    open(path, "w", encoding="utf-8").write(src)
    print("wrote", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    patch(os.path.join(ROOT, "apps/sales/src/catalog.ts"), manager=False)
    patch(os.path.join(ROOT, "apps/manager/src/catalog.ts"), manager=True)
