"""Map ArchitectureDoc v1 to a Lucid Standard Import document.

The output is ``document.json`` — the JSON payload inside a ``.lucid`` archive
(https://developer.lucid.co/docs/overview-si). Each industry (and the
platform itself) becomes a Lucid page; components become rectangle shapes
coloured by category and laid out in columns by zone; edges become elbow
lines connecting the shapes by stable ID.
"""

from __future__ import annotations

from collections import defaultdict
from html import escape
from typing import Any


# Fill colours per component category (light, readable on a white canvas).
CATEGORY_COLORS: dict[str, str] = {
    "platform": "#1B75BB",  # Databricks blue
    "source": "#E8F1FB",    # pale blue
    "ingestion": "#DDF4EE",  # pale teal
    "consumer": "#FFF1D6",  # pale amber
    "usecase": "#FDE2E2",    # pale red
    "cloud": "#ECE5F7",      # pale violet
}

# Stroke colours per edge kind.
EDGE_COLORS: dict[str, str] = {
    "related": "#9CA3AF",
    "flow": "#1B75BB",
    "feeds": "#10B981",
    "uses": "#6366F1",
}

# Column order left-to-right, mirroring the reference architecture's layout.
ZONE_ORDER: dict[str, int] = {
    "src": 0, "ing": 1, "ppl": 2, "cons": 3, "top": 4,
    "platform": 5, "cloud": 6,
}

SHAPE_W = 220
SHAPE_H = 72
COL_GAP = 260   # column pitch (x)
ROW_GAP = 100    # row pitch (y)
MARGIN_X = 80
MARGIN_Y = 100


def _text_html(component: dict[str, Any]) -> str:
    """Build the shape's text as a styled HTML span (Lucid accepts HTML)."""
    name = escape(component["name"])
    return f"<span style='font-size: 11pt; font-weight: 600; color: #172033;'>{name}</span>"


def _shape(component: dict[str, Any], shape_id: str, x: int, y: int) -> dict[str, Any]:
    colour = CATEGORY_COLORS.get(component["category"], "#F3F4F6")
    return {
        "id": shape_id,
        "type": "rectangle",
        "boundingBox": {"x": x, "y": y, "w": SHAPE_W, "h": SHAPE_H},
        "text": _text_html(component),
        "style": {
            "fill": {"type": "color", "color": colour},
            "stroke": {"color": "#475569", "width": 1, "style": "solid"},
            "rounding": 6,
            "textColor": "#172033",
        },
    }


def _line(line_id: str, edge: dict[str, Any], shape_ids: dict[str, str]) -> dict[str, Any]:
    src = shape_ids.get(edge["sourceId"])
    dst = shape_ids.get(edge["targetId"])
    if not src or not dst:
        raise ValueError(f"edge {edge['id']} references a shape not on this page")
    return {
        "id": line_id,
        "lineType": "elbow",
        "endpoint1": {"type": "shapeEndpoint", "style": "none", "shapeId": src},
        "endpoint2": {"type": "shapeEndpoint", "style": "arrow", "shapeId": dst},
        "stroke": {"color": EDGE_COLORS.get(edge["kind"], "#6B7280"), "width": 1, "style": "solid"},
    }


def _page(
    page_id: str,
    title: str,
    component_ids: list[str],
    components: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
) -> dict[str, Any]:
    selected = [components[cid] for cid in component_ids if cid in components]
    selected.sort(key=lambda c: (ZONE_ORDER.get(c["zone"], 9), c["name"].casefold()))

    # Short, page-scoped sequential IDs keep document.json well under Lucid's
    # 2 MB limit while staying unique across the document (page_id is unique).
    shape_ids = {c["id"]: f"{page_id}-s{i}" for i, c in enumerate(selected)}

    # Lay shapes out in columns by zone.
    row_counters: dict[str, int] = defaultdict(int)
    shapes: list[dict[str, Any]] = []
    for component in selected:
        zone = component["zone"]
        col = ZONE_ORDER.get(zone, 7)
        row = row_counters[zone]
        row_counters[zone] += 1
        x = MARGIN_X + col * COL_GAP
        y = MARGIN_Y + row * ROW_GAP
        shapes.append(_shape(component, shape_ids[component["id"]], x, y))

    # Only edges whose both endpoints are on this page.
    ids = set(component_ids)
    page_edges = [e for e in edges if e["sourceId"] in ids and e["targetId"] in ids]
    lines = [
        _line(f"{page_id}-l{i}", e, shape_ids)
        for i, e in enumerate(page_edges)
    ]

    return {"id": page_id, "title": title, "shapes": shapes, "lines": lines, "groups": []}


def map_to_lucid(architecture: dict[str, Any]) -> dict[str, Any]:
    components = {c["id"]: c for c in architecture["components"]}
    edges = architecture["edges"]

    # The platform page shows ALL components parsed from the ARCH literal,
    # regardless of whether they also appear in an industry. Provenance
    # tracking (``"arch"`` in the component's provenance list) ensures the
    # platform page is complete; industry pages show only that industry's
    # components (from ``componentIds``).
    platform_ids = [
        c["id"] for c in components.values()
        if "arch" in c.get("provenance", [])
    ]

    pages = [_page("p0", "Databricks Platform", platform_ids, components, edges)]
    for i, ind in enumerate(architecture["industries"], start=1):
        pages.append(
            _page(
                f"p{i}",
                ind["label"],
                ind["componentIds"],
                components,
                edges,
            )
        )
    return {"version": 1, "pages": pages}
