# Architecture data converter

Converts Amr Alieg's Databricks reference-architecture data — the hand-authored
`ARCH` platform literal and 62 Python-authored industry overlays — into draw.io
mxGraph XML (`architecture.drawio`) that draw.io imports as a multi-page
diagram.

## ⚠️ Security: executing third-party Python

The industry overlays live in `batch_*.py` files that call helper functions
from `common.py` (`tile()`, `flow()`, `medallion()`, `ing_rail()`, etc.).
Because those functions *are* the schema, the converter **executes** the
batch files as Python modules — there is no practical way to extract the
data via static AST parsing alone (the dicts are built by function calls,
not written as literals).

Two mitigations are in place:

1. **Commit pin (fail-closed)** — `parse_industries.py` pins the upstream repo
   to a specific commit SHA (`PINNED_COMMIT`). On load it verifies the repo
   HEAD matches the pin **and** that the working tree is clean (no modified
   or untracked files). If either check fails, it prints an error and exits —
   it never checks out the pin for you or executes code from a dirty or
   mismatched repo. Update the pin deliberately after reviewing the diff.
2. **AST safety scan** — before executing any file, the converter scans
   **every `.py` file** in `tools/industries/` (not just `batch_*.py` —
   `common.py` and any other helpers are imported and executed too). It
   refuses to run if a file:
   - imports a dangerous module (`os`, `subprocess`, `socket`, `http`,
     `urllib`, `ctypes`, `pickle`, `importlib`, …),
   - calls a dangerous builtin (`exec`, `eval`, `__import__`, `open`, …),
   - calls an attribute or subscript ending in `system`/`popen`/`exec`/`eval`
     (catches aliases like `import os as x; x.system(…)` and dynamic dispatch
     like `obj["system"](…)`),
   - uses `getattr(obj, "system")` or `getattr(obj, "modules")`, or
   - references `<name>.modules` (catches `sys.modules` under any alias).
   This is defense-in-depth on top of the pin.

Do **not** point `--repo` at untrusted Python. The pin and scan reduce risk
but do not eliminate it — a sufficiently creative attacker who controls the
repo at the pinned commit could still craft code that passes the AST scan.

## Run

Python 3.10+ is required; there are **no third-party dependencies** (the JS
literal is parsed in pure Python — no Node needed).

```bash
git clone https://github.com/amralieg/interactive-databricks-enterprise-architecture.git converter/tmp/amr-repo
python3 converter/index.py
```

The converter verifies the clone is at the pinned commit (`8a5d798`) and
that the working tree is clean; if either check fails it prints an error and
exits — check out the pinned commit deliberately before re-running.

The default output is `converter/sample-output/architecture.drawio`. To also
retain the normalized ArchitectureDoc semantic model:

```bash
python3 converter/index.py --architecture-output converter/sample-output/architecture.json
```

Use `--repo` and `--output` to override the source repo and output path.

## Source data

From Amr's repo (`converter/tmp/amr-repo`):

| Source | What it holds | Parsed by |
|--------|---------------|-----------|
| `app/index.html` (~line 2666) | `ARCH` — the Databricks platform: 7 bands of products, generic rails (src/ing/ppl/cons), top band (Genie agents + use cases), cloud providers | `parse_arch.py` |
| `tools/industries/common.py` | Schema helpers: `tile()`, `flow()`, `data_out()`, `genie()`, `dashboard()`, `biz()`, `app()`, `uc()`, rail builders | (imported by batch files) |
| `tools/industries/batch_*.py` (62 files) | `INDUSTRIES_BATCH_*` dicts — one per industry: label, blurb, medallion, rails, top, sources | `parse_industries.py` |

## Pipeline

```
parse_arch.py          parse_industries.py
    ARCH literal           62 batch_*.py dicts
    (pure Python)          (pinned commit + AST scan, then imported)
         │                      │
         └──────────┬───────────┘
                    ▼
            normalize.py
   dedupe by name → UUID5
   build edge table from name refs
   track provenance (arch vs industry)
   build industry index
                    │
                    ▼
            map_to_drawio.py
   components → shapes (by zone/category)
   edges → mxCell connectors
   industries → pages
                    │
                    ▼
       architecture.drawio (mxGraph XML)
```

### parse_arch.py — pure-Python JS literal parser

`ARCH` is a JavaScript object literal with unquoted keys, trailing commas, and
`//` + `/* */` comments. Instead of shelling out to Node, this module uses a
self-contained Python scanner that:

1. **Extracts** the balanced object literal (string- and comment-aware, so
   braces inside `"Lakehouse//RT"` or block comments never break depth).
2. **Strips** comments outside of strings.
3. **Converts** to strict JSON by quoting bareword keys, dropping trailing
   commas, and copying double-quoted strings verbatim (apostrophes inside
   strings like `"vendors' platforms"` are preserved).

Extracts: `bands` (7 bands → products with `n`, `s`, `ic`, `long`, `caps`,
`caps2`, `rel`, `st`), `rails` (src/ing/ppl/cons groups with `box`, `ic`,
`from`, `tiles`), `top` (Genie agents + business use cases), `cloud` (extras +
active provider's fed/ingest/bi/identity tiles).

### normalize.py — dedupe, edges, provenance, industry index

- **Stable UUIDs**: one `uuid5` per unique component, deduped by name across
  every industry and the platform — the same product named in two industries
  maps to one component.
- **Provenance tracking**: each component records where it was parsed from —
  `"arch"` for the ARCH platform literal, or an industry id for an industry
  overlay. The platform page shows **all** `"arch"`-provenance components
  regardless of industry membership (fix for ARCH components being excluded
  by name-dedup). Industry pages show only that industry's components.
- **Edge table** from name-based refs: `rel` → related, `feeds` → feeds,
  `comps` → uses. Unresolved refs emit **warnings** (printed by `index.py`)
  instead of being silently dropped.
- **`from` field semantics**: a group's `from` field is a cloud-provider
  *role key* (`ingest`, `fed`, `bi`), not a component name. The original app
  uses it to inject `ARCH.cloud.providers[provider][from]` tiles into the
  group at render time. The converter models each role as a **synthetic
  zone-anchor component** (`Cloud Ingest`, `Federation Sources`,
  `BI Integrations`) and creates `flow` edges from the anchor to the group's
  tiles, preserving the dependency. Unknown `from` values produce warnings.
- **Industry index**: each industry lists its component IDs, medallion
  (Bronze/Silver/Gold), and source citations.

### map_to_drawio.py — draw.io mxGraph XML

Maps ArchitectureDoc to draw.io's editable mxGraph XML format:

| ArchitectureDoc | mxGraph XML |
|-----------------|-------------|
| Component | vertex `mxCell` with geometry, label, and style |
| Edge | edge `mxCell` with source/target references and kind-based color |
| Industry | named `diagram` page |

Shapes are positioned in columns by zone (src → ing → ppl → cons → top →
platform → cloud) and colored by category. Lines connect shapes by stable ID
with arrow endpoints. The platform gets its own page (all ARCH components);
each industry gets one page (that industry's components only).

## Validate

```bash
python3 -m py_compile converter/*.py
python3 converter/index.py
python3 -c "import xml.etree.ElementTree as ET; ET.parse('converter/sample-output/architecture.drawio')"
```

## Output stats (from Amr's real data)

- **63 pages** (1 platform + 62 industries)
- **4,306 shapes** (min 60 per page, all ≥ 20)
- **2,517 connectors** (min 29 per page, all ≥ 10)
- **architecture.drawio** editable draw.io mxGraph XML
- **432 warnings** for unresolved name-based references (printed to stdout)
