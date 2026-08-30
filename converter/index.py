"""Command-line entry point for the Amr data to Lucid converter."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from map_to_lucid import map_to_lucid
from normalize import normalize
from parse_arch import parse_arch
from parse_industries import parse_industries


def main() -> None:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=here / "tmp" / "amr-repo")
    parser.add_argument("--output", type=Path, default=here / "sample-output" / "document.json")
    parser.add_argument("--architecture-output", type=Path)
    args = parser.parse_args()
    architecture = normalize(
        parse_arch(args.repo / "app" / "index.html"),
        parse_industries(args.repo / "tools" / "industries"),
    )
    document = map_to_lucid(architecture)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Lucid caps document.json at 2 MB; compact JSON preserves room for all pages.
    args.output.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    if args.architecture_output:
        args.architecture_output.parent.mkdir(parents=True, exist_ok=True)
        args.architecture_output.write_text(json.dumps(architecture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    shape_count = sum(len(page["shapes"]) for page in document["pages"])
    line_count = sum(len(page["lines"]) for page in document["pages"])
    print(f"Wrote {args.output}: {len(document['pages'])} pages, {shape_count} shapes, {line_count} connectors")
    warnings = architecture.get("warnings", [])
    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings:
            print(f"  - {w}")


if __name__ == "__main__":
    main()
