"""Map ArchitectureDoc v1 to Lucid Standard Import document JSON."""

from __future__ import annotations

from collections import defaultdict
from html import escape
from typing import Any


COLORS = {
    "platform": "#1B75BB", "source": "#E8F1FB", "ingestion": "#DDF4EE",
    "consumer": "#FFF1D6", "usecase": "#FDE2E2", "cloud": "#ECE5F7",
}
ZONE_ORDER = {"src": 0, "ing": 1, "ppl": 2, "cons": 3, "top": 4, "platform": 5, "cloud": 6}


def _page(industry: dict[str, Any], components: dict[str, dict[str, Any]], edges: list[dict[str, Any]]) -> dict[str, Any]:
    ids = set(industry["componentIds"])
    selected = [components[item] for item in ids if item in components]
    selected.sort(key=lambda c: (ZONE_ORDER.get(c["zone"], 9), c["name"].casefold()))
    counters: dict[str, int] = defaultdict(int)
    shapes = []
    # Page prefix + UUID prefix stays globally unique while keeping the import
    # below Lucid's 2 MB document.json limit.
    shape_ids = {component["id"]: f"{industry['id']}-s-{component['id'][:12]}" for component in selected}
    for component in selected:
        zone = component["zone"]
        index = counters[zone]
        counters[zone] += 1
        column = ZONE_ORDER.get(zone, 7)
        shapes.append({
            "id": shape_ids[component["id"]], "type": "rectangle",
            "boundingBox": {"x": 80 + column * 260, "y": 100 + index * 105, "w": 220, "h": 72},
            "text": f"<span style='font-size: 10pt; color: #172033;'>{escape(component['name'])}</span>",
            "style": {"fill": {"color": COLORS.get(component["category"], COLORS.get(zone, "#F3F4F6"))}},
        })
    lines = [
        {"id": f"{industry['id']}-l-{edge['id'][:12]}", "lineType": "elbow",
         "endpoint1": {"type": "shapeEndpoint", "style": "none", "shapeId": shape_ids[edge["sourceId"]]},
         "endpoint2": {"type": "shapeEndpoint", "style": "arrow", "shapeId": shape_ids[edge["targetId"]]}}
        for edge in edges if edge["sourceId"] in ids and edge["targetId"] in ids
    ]
    return {"id": f"industry-{industry['id']}", "title": industry["label"], "shapes": shapes, "lines": lines}


def map_to_lucid(architecture: dict[str, Any]) -> dict[str, Any]:
    components = {item["id"]: item for item in architecture["components"]}
    platform = {
        "id": "platform", "label": "Databricks Platform",
        "componentIds": [item["id"] for item in components.values() if item["zone"] == "platform"],
    }
    pages = [_page(platform, components, architecture["edges"])]
    pages.extend(_page(item, components, architecture["edges"]) for item in architecture["industries"])
    return {"version": 1, "pages": pages}
