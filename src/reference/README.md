# Reference data

Every code or standard value the app uses lives in a JSON file in this folder, not in the program code.
Each file can be checked line by line against the printed table.

| File | Source |
| --- | --- |
| `ashrae-62.1-2022_table-6-1.json` | ASHRAE 62.1-2022 Table 6-1, breathing-zone ventilation rates |
| `ashrae-62.1-2022_table-6-4.json` | ASHRAE 62.1-2022 Table 6-4, minimum exhaust rates |
| `room-templates.json` | Built-in room templates. Links to the rows above, plus typical lighting/equipment W/SF (design allowances, not code) |
| `upc-2021-wa_table-610-3.json` | 2021 UPC as adopted in Washington (WAC 51-56), Table 610.3, water supply fixture units |
| `upc-2021-wa_table-702-1.json` | 2021 UPC (WA) Table 702.1, drainage fixture units and trap sizes |
| `plumbing-catalog_upc-2021-wa.json` | The fixtures you can pick for a project. Links each one to a 610.3 row and a 702.1 row, with a plan symbol and size |

## File format

```json
{
  "meta": { "id": "...", "standard": "UPC (Washington, WAC 51-56)", "edition": "2021", "table": "Table 610.3",
            "title": "...", "units": { ... }, "notes": [ "..." ] },
  "rows": [ { "id": "lavatory", ..., "verified": null } ]
}
```

* `id` is what the app and other files point at. **Don't rename an id** once projects use it. Add a new row instead.
* `null` means "the table gives no value here".

## Verifying a table

1. Print or open the table next to its file. `node src/reference/check-reference.mjs --csv upc-2021-wa_table-610-3.json` prints the rows as CSV, which is easier to compare.
2. Fix any wrong value in the file.
3. Mark the row checked: `"verified": { "by": "DP", "date": "2026-11-02", "note": "matches 2021 UPC p.87" }`.
4. Run `node src/reference/check-reference.mjs` to see what's left. It also catches typos, duplicate ids and broken links between files.

The app shows **unverified** next to any value that comes from an unchecked row. Settings, under Reference data, lists each file and how much of it is verified.

Projects copy the values when you pick a fixture or apply a template. Fixing a reference file later doesn't silently change a finished project. Instead, the Libraries window flags "differs from reference" so you can choose to update it.
