# Architecture data converter

Converts Amr Alieg's Databricks reference-architecture data — the hand-authored
`ARCH` platform literal and 62 Python-authored industry overlays — into Lucid
Standard Import JSON (`document.json`), the payload inside a `.lucid` archive
that Lucidchart imports as a multi-page diagram.

## Run

Python 3.10+ is required; there are **no third-party dependencies** (the JS
literal is parsed in pure Python — no Node needed).

```bash
git clone https://github.com/amralieg/interactive-databricks-enterprise-architecture.git converter/tmp/amr-repo
python3 converter/index.py
```

The default output is `converter/sample-output/document.json` (1.8 MB, under
Lucid's 2 MB limit). To also retain the normalized ArchitectureDoc semantic
model:

```bash
python3 converter/index.py --architecture-output converter/sample-output/architecture.json
```

Use `--repo` and `--output` to override the source repo and output path. The
loader executes the trusted, locally cloned industry source modules because
their `tile()`, `flow()`, and rail helpers *are* the schema. Do not point
`--repo` at untrusted Python code.

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
    (pure Python)          (imported as modules)
         │                      │
         └──────────┬───────────┘
                    ▼
            normalize.py
   dedupe by name → UUID5
   build edge table from name refs
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

### normalize.py — dedupe, edges, industry index

- **Stable UUIDs**: one `uuid5` per unique component, deduped by name across
  every industry and the platform — the same product named in two industries
  maps to one component.
- **Edge table** from name-based refs: `rel` → related, `feeds` → feeds,
  `comps` → uses. Group `from` values are rail-injection directives (not
  component names) so they don't produce edges.
- **Industry index**: each industry lists its component IDs, medallion
  (Bronze/Silver/Gold), and source citations.

### map_to_lucid.py — Lucid Standard Import JSON

Maps to the [Lucid SI format](https://developer.lucid.co/docs/overview-si):

| ArchitectureDoc | Lucid SI |
|-----------------|----------|
| Component | `rectangle` shape (`boundingBox`, `text`, `style` with fill/stroke/rounding) |
| Edge | `elbow` line (`endpoint1`/`endpoint2` as `shapeEndpoint`, colored `stroke` by kind) |
| Industry | `page` (with `title`, `shapes`, `lines`) |

Shapes are positioned in columns by zone (src → ing → ppl → cons → top →
platform → cloud) and colored by category. Lines connect shapes by stable ID
with arrow endpoints. The platform gets its own page; each industry gets one.

## Validate

```bash
python3 -m py_compile converter/*.py
python3 converter/index.py
python3 -m json.tool converter/sample-output/document.json >/dev/null
```

## Output stats (from Amr's real data)

- **63 pages** (1 platform + 62 industries)
- **4,097 shapes** (min 57 per page, all ≥ 20)
- **2,238 connectors** (min 25 per page, all ≥ 10)
- **1.86 MB** document.json (under Lucid's 2 MB limit)
