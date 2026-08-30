"""Convert the Lucid Standard Import JSON (document.json) into a draw.io
mxfile (.drawio) so the Architecture Studio app can embed the diagrams.net
editor without any Lucid dependency.

Each Lucid page becomes a <diagram>; each rectangle shape becomes a rounded
vertex <mxCell>; each elbow line becomes an orthogonal edge <mxCell>. The
output is uncompressed XML so it stays human-readable and regex-parseable by
the backend (which extracts diagram id+name with a simple regex).

Usage:
    python3 converter/json_to_drawio.py \
        --input converter/sample-output/document.json \
        --output converter/sample-output/architecture.drawio
"""

from __future__ import annotations

import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


def _shape_style(shape: dict[str, Any]) -> str:
    """Build a draw.io style string for a Lucid rectangle shape."""
    style = shape.get("style", {})
    fill_color = style.get("fill", {}).get("color", "#FFFFFF")
    stroke = style.get("stroke", {})
    stroke_color = stroke.get("color", "#475569")
    stroke_width = stroke.get("width", 1)
    text_color = style.get("textColor", "#172033")
    # Lucid "rounding": 6 → draw.io rounded=1 (anything truthy rounds corners).
    rounded = 1 if style.get("rounding") else 0
    return (
        f"rounded={rounded};whiteSpace=wrap;html=1;"
        f"fillColor={fill_color};strokeColor={stroke_color};"
        f"fontColor={text_color};strokeWidth={stroke_width};"
    )


def _edge_style(line: dict[str, Any]) -> str:
    """Build a draw.io style string for a Lucid elbow connector.

    Lucid endpoint1.style is always "none" (no source arrow); endpoint2.style
    is "arrow" (arrowhead at target) or "none" (plain line).
    """
    stroke = line.get("stroke", {})
    color = stroke.get("color", "#6B7280")
    width = stroke.get("width", 1)
    has_arrow = line.get("endpoint2", {}).get("style") == "arrow"
    end_arrow = "block" if has_arrow else "none"
    end_fill = 1 if has_arrow else 0
    return (
        "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;"
        f"startArrow=none;startFill=0;"
        f"endArrow={end_arrow};endFill={end_fill};"
        f"strokeColor={color};strokeWidth={width};"
    )


def _build_diagram(page: dict[str, Any]) -> ET.Element:
    """Convert a single Lucid page into a draw.io <diagram> element."""
    diagram = ET.Element(
        "diagram",
        {"id": page["id"], "name": page.get("title", page["id"])},
    )
    model = ET.SubElement(
        diagram,
        "mxGraphModel",
        {
            "dx": "800",
            "dy": "600",
            "grid": "1",
            "gridSize": "10",
            "guides": "1",
            "tooltips": "1",
            "connect": "1",
            "arrows": "1",
            "fold": "1",
            "page": "1",
            "pageScale": "1",
            "pageWidth": "1169",
            "pageHeight": "826",
            "math": "0",
            "shadow": "0",
        },
    )
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", {"id": "0"})
    ET.SubElement(root, "mxCell", {"id": "1", "parent": "0"})

    for shape in page.get("shapes", []):
        bb = shape.get("boundingBox", {})
        cell = ET.SubElement(
            root,
            "mxCell",
            {
                "id": shape["id"],
                "value": shape.get("text", ""),
                "style": _shape_style(shape),
                "vertex": "1",
                "parent": "1",
            },
        )
        ET.SubElement(
            cell,
            "mxGeometry",
            {
                "x": str(bb.get("x", 0)),
                "y": str(bb.get("y", 0)),
                "width": str(bb.get("w", 220)),
                "height": str(bb.get("h", 72)),
                "as": "geometry",
            },
        )

    for line in page.get("lines", []):
        ep1 = line.get("endpoint1", {})
        ep2 = line.get("endpoint2", {})
        cell = ET.SubElement(
            root,
            "mxCell",
            {
                "id": line["id"],
                "style": _edge_style(line),
                "edge": "1",
                "parent": "1",
                "source": ep1.get("shapeId", ""),
                "target": ep2.get("shapeId", ""),
            },
        )
        ET.SubElement(cell, "mxGeometry", {"relative": "1", "as": "geometry"})

    return diagram


def json_to_drawio(document: dict[str, Any]) -> ET.Element:
    """Convert a Lucid Standard Import document into a draw.io mxfile element."""
    mxfile = ET.Element(
        "mxfile",
        {
            "host": "Architecture Studio",
            "agent": "converter/json_to_drawio.py",
            "version": "24.0.0",
        },
    )
    for page in document.get("pages", []):
        mxfile.append(_build_diagram(page))
    return mxfile


def main() -> None:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=here / "sample-output" / "document.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=here / "sample-output" / "architecture.drawio",
    )
    args = parser.parse_args()

    document = json.loads(args.input.read_text(encoding="utf-8"))
    mxfile = json_to_drawio(document)

    ET.indent(mxfile, space="  ")
    xml_body = ET.tostring(mxfile, encoding="unicode")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n' + xml_body + "\n",
        encoding="utf-8",
    )

    pages = document.get("pages", [])
    shapes = sum(len(p.get("shapes", [])) for p in pages)
    edges = sum(len(p.get("lines", [])) for p in pages)
    print(
        f"Wrote {args.output}: {len(pages)} diagrams, "
        f"{shapes} shapes, {edges} edges"
    )


if __name__ == "__main__":
    main()
