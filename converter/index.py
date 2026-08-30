"""Command-line entry point for the Amr data to draw.io converter."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from map_to_drawio import map_to_drawio
from normalize import normalize
from parse_arch import parse_arch
from parse_industries import parse_industries


def main() -> None:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=here / "tmp" / "amr-repo")
    parser.add_argument("--output", type=Path, default=here / "sample-output" / "architecture.drawio")
    parser.add_argument("--architecture-output", type=Path)
    args = parser.parse_args()
    architecture = normalize(
        parse_arch(args.repo / "app" / "index.html"),
        parse_industries(args.repo / "tools" / "industries"),
    )
    document = map_to_drawio(architecture)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(document + "\n", encoding="utf-8")
    if args.architecture_output:
        args.architecture_output.parent.mkdir(parents=True, exist_ok=True)
        args.architecture_output.write_text(json.dumps(architecture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    page_count = 1 + len(architecture["industries"])
    arch_ids = {c["id"] for c in architecture["components"] if "arch" in c.get("provenance", [])}
    shape_count = len(arch_ids) + sum(len(industry["componentIds"]) for industry in architecture["industries"])
    line_count = sum(1 for edge in architecture["edges"] if edge["sourceId"] in arch_ids and edge["targetId"] in arch_ids)
    for industry in architecture["industries"]:
        ids = set(industry["componentIds"])
        line_count += sum(1 for edge in architecture["edges"] if edge["sourceId"] in ids and edge["targetId"] in ids)
    print(f"Wrote {args.output}: {page_count} pages, {shape_count} shapes, {line_count} connectors")
    warnings = architecture.get("warnings", [])
    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings:
            print(f"  - {w}")


if __name__ == "__main__":
    main()
