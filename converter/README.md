# Architecture data converter

Converts Amr Alieg's Databricks reference-architecture data — the hand-authored
`ARCH` platform literal and 62 Python-authored industry overlays — into Lucid
Standard Import JSON (`document.json`), the payload inside a `.lucid` archive
that Lucidchart imports as a multi-page diagram.

## ⚠️ Security: executing third-party Python

The industry overlays live in `batch_*.py` files that call helper functions
from `common.py` (`tile()`, `flow()`, `medallion()`, `ing_rail()`, etc.).
Because those functions *are* the schema, the converter **executes** the
batch files as Python modules — there is no practical way to extract the
data via static AST parsing alone (the dicts are built by function calls,
not written as literals).

Two mitigations are in place:

1. **Commit pin** — `parse_industries.py` pins the upstream repo to a specific
   commit SHA (`PINNED_COMMIT`). On load it verifies the repo HEAD matches
   the pin and checks out the pinned commit if it doesn't. Update the pin
   deliberately after reviewing the diff.
2. **AST safety scan** — before executing each batch file, the converter
   parses its AST and refuses to run if it imports a dangerous module
   (`os`, `subprocess`, `socket`, `http`, `urllib`, `ctypes`, `pickle`, …)
   or calls a dangerous builtin (`exec`, `eval`, `__import__`, `open`, …).
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

The converter automatically verifies the clone is at the pinned commit
(`8a5d798`) and checks it out if needed.

The default output is `converter/sample-output/document.json` (1.9 MB, under
Lucid's 2 MB limit). To also retain the normalized ArchitectureDoc semantic
model:

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
            map_to_lucid.py
   components → shapes (by zone/category)
   edges → lines (elbow, arrow)
   industries → pages
                    │
                    ▼
          document.json (Lucid SI)
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

### map_to_lucid.py — Lucid Standard Import JSON

Maps to the [Lucid SI format](https://developer.lucid.co/docs/overview-si)
(field names match the official spec):

| ArchitectureDoc | Lucid SI |
|-----------------|----------|
| Component | `rectangle` shape (`boundingBox` with x/y/w/h, `text`, `style` with `fill`/`stroke`/`rounding`) |
| Edge | `elbow` line (`endpoint1`/`endpoint2` as `shapeEndpoint`, colored `stroke` by kind) |
| Industry | `page` (with `title`, `shapes`, `lines`, `groups`) |

Shapes are positioned in columns by zone (src → ing → ppl → cons → top →
platform → cloud) and colored by category. Lines connect shapes by stable ID
with arrow endpoints. The platform gets its own page (all ARCH components);
each industry gets one page (that industry's components only).

## Validate

```bash
python3 -m py_compile converter/*.py
python3 converter/index.py
python3 -m json.tool converter/sample-output/document.json >/dev/null
```

## Output stats (from Amr's real data)

- **63 pages** (1 platform + 62 industries)
- **4,306 shapes** (min 60 per page, all ≥ 20)
- **2,517 connectors** (min 29 per page, all ≥ 10)
- **1.9 MB** document.json (under Lucid's 2 MB limit)
- **432 warnings** for unresolved name-based references (printed to stdout)
