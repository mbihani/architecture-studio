"""Map ArchitectureDoc v1 to a draw.io ``mxfile`` document."""

from __future__ import annotations

from collections import defaultdict
from html import escape
from typing import Any
import xml.etree.ElementTree as ET


CATEGORY_COLORS = {
    "platform": "#1B75BB",
    "source": "#E8F1FB",
    "ingestion": "#DDF4EE",
    "consumer": "#FFF1D6",
    "usecase": "#FDE2E2",
    "cloud": "#ECE5F7",
}

EDGE_COLORS = {
    "related": "#9CA3AF",
    "flow": "#1B75BB",
    "feeds": "#10B981",
    "uses": "#6366F1",
}

ZONE_ORDER = {
    "src": 0,
    "ing": 1,
    "ppl": 2,
    "cons": 3,
    "top": 4,
    "platform": 5,
    "cloud": 6,
}

SHAPE_W = 220
SHAPE_H = 72
COL_GAP = 260
ROW_GAP = 100
MARGIN_X = 80
MARGIN_Y = 100


def _page(
    mxfile: ET.Element,
    page_id: str,
    name: str,
    component_ids: list[str],
    components: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
) -> None:
    diagram = ET.SubElement(mxfile, "diagram", {"id": page_id, "name": name})
    model = ET.SubElement(
        diagram,
        "mxGraphModel",
        {"dx": "1200", "dy": "800", "grid": "1", "pageWidth": "1169", "pageHeight": "826"},
    )
    root = ET.SubElement(model, "root")
    ET.SubElement(root, "mxCell", {"id": "0"})
    ET.SubElement(root, "mxCell", {"id": "1", "parent": "0"})

    selected = [components[cid] for cid in component_ids if cid in components]
    selected.sort(key=lambda component: (ZONE_ORDER.get(component["zone"], 9), component["name"].casefold()))
    shape_ids = {component["id"]: f"shape-{component['id']}" for component in selected}

    rows: dict[str, int] = defaultdict(int)
    for component in selected:
        zone = component["zone"]
        x = MARGIN_X + ZONE_ORDER.get(zone, 7) * COL_GAP
        y = MARGIN_Y + rows[zone] * ROW_GAP
        rows[zone] += 1
        fill = CATEGORY_COLORS.get(component["category"], "#F3F4F6")
        cell = ET.SubElement(
            root,
            "mxCell",
            {
                "id": shape_ids[component["id"]],
                "value": escape(component["name"]),
                "style": (
                    "rounded=1;whiteSpace=wrap;html=1;"
                    f"fillColor={fill};strokeColor=#475569;fontSize=11;fontColor=#172033;"
                ),
                "vertex": "1",
                "parent": "1",
            },
        )
        ET.SubElement(
            cell,
            "mxGeometry",
            {"x": str(x), "y": str(y), "width": str(SHAPE_W), "height": str(SHAPE_H), "as": "geometry"},
        )

    for edge in edges:
        source = shape_ids.get(edge["sourceId"])
        target = shape_ids.get(edge["targetId"])
        if source is None or target is None:
            continue
        color = EDGE_COLORS.get(edge["kind"], "#6B7280")
        cell = ET.SubElement(
            root,
            "mxCell",
            {
                "id": f"edge-{edge['id']}",
                "edge": "1",
                "parent": "1",
                "source": source,
                "target": target,
                "style": f"edgeStyle=orthogonalEdgeStyle;strokeColor={color};strokeWidth=1.5;",
            },
        )
        ET.SubElement(cell, "mxGeometry", {"relative": "1", "as": "geometry"})


def map_to_drawio(architecture: dict[str, Any]) -> str:
    """Return an uncompressed, editable draw.io mxGraph XML document."""
    components = {component["id"]: component for component in architecture["components"]}
    edges = architecture["edges"]
    mxfile = ET.Element("mxfile", {"host": "architecture-studio", "type": "device"})

    platform_ids = [cid for cid, c in components.items() if "arch" in c.get("provenance", [])]
    _page(mxfile, "platform", "Platform", platform_ids, components, edges)
    for industry in architecture["industries"]:
        _page(
            mxfile,
            industry["id"],
            industry["label"],
            industry["componentIds"],
            components,
            edges,
        )

    ET.indent(mxfile, space="  ")
    return ET.tostring(mxfile, encoding="unicode", xml_declaration=True)
