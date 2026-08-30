# Architecture data converter

Converts Amr Alieg's Databricks platform `ARCH` and 62 Python-authored industry overlays into the Architecture Studio semantic model, then emits Lucid Standard Import JSON.

## Run

Python 3.10+ is required; there are no third-party dependencies.

```bash
git clone https://github.com/amralieg/interactive-databricks-enterprise-architecture.git converter/tmp/amr-repo
python3 converter/index.py
```

The default output is `converter/sample-output/document.json`. To retain the normalized semantic data too:

```bash
python3 converter/index.py --architecture-output converter/sample-output/architecture.json
```

Use `--repo` and `--output` to override either location. The loader executes the trusted, locally cloned industry source modules because their `tile()`, `flow()`, and rail helpers are the schema itself. Do not point `--repo` at untrusted Python code.

## Mapping

- Platform products are recursively extracted from `ARCH.bands` with `n`, `s`, `ic`, `long`, `caps`, `caps2`, `rel`, and `st`.
- Industry rails (`src`, `ing`, `ppl`, `cons`) and `top` tiles become components. Names are deduplicated globally with deterministic UUIDv5 identifiers.
- `rel`, `feeds`, and `comps` references become `related`, `feeds`, and `uses` edges when the named target exists. Resolvable group `from` references become `flow` edges.
- Each industry becomes a Lucid page. Shapes are positioned in zone columns and colored by category; resolvable edges become lines.

## Validate

```bash
python3 -m py_compile converter/*.py
python3 converter/index.py
python3 -m json.tool converter/sample-output/document.json >/dev/null
```
