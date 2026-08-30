"""Normalize platform and industry source data into ArchitectureDoc v1."""

from __future__ import annotations

import copy
import uuid
from collections import defaultdict
from typing import Any, Iterable


NAMESPACE = uuid.UUID("bd67c26d-02f8-5f6e-89c4-f76a0212bb09")
ZONE_CATEGORY = {
    "platform": "platform", "src": "source", "ing": "ingestion",
    "ppl": "consumer", "cons": "consumer", "top": "usecase", "cloud": "cloud",
}


def _uuid(kind: str, value: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"{kind}:{value.strip().casefold()}"))


def _walk_tiles(value: Any, zone: str) -> Iterable[tuple[dict[str, Any], str]]:
    if isinstance(value, dict):
        if isinstance(value.get("n"), str):
            yield value, zone
        for key, child in value.items():
            yield from _walk_tiles(child, "top" if key == "top" else zone)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_tiles(child, zone)


def _component(tile: dict[str, Any], zone: str) -> dict[str, Any]:
    name = tile["n"].strip()
    return {
        "id": _uuid("component", name),
        "name": name,
        "shortName": tile.get("s", tile.get("mark", "")),
        "category": tile.get("cat", ZONE_CATEGORY.get(zone, "usecase")),
        "icon": tile.get("ic", ""),
        "zone": zone,
        "description": tile.get("long", tile.get("desc", "")),
        "capabilities": list(dict.fromkeys(tile.get("caps", []) + tile.get("caps2", []))),
        "relatedIds": [],
        "dataOut": copy.deepcopy(tile.get("dataOut", {})),
        "cite": copy.deepcopy(tile.get("cite", [])),
        "what": tile.get("what", ""),
        "users": tile.get("users", ""),
        "kpis": copy.deepcopy(tile.get("kpis", [])),
        "teams": copy.deepcopy(tile.get("teams", [])),
    }


def normalize(arch: dict[str, Any] | list[dict[str, Any]], raw_industries: dict[str, dict[str, Any]]) -> dict[str, Any]:
    components: dict[str, dict[str, Any]] = {}
    refs: list[tuple[str, str, str]] = []
    memberships: dict[str, set[str]] = defaultdict(set)

    def add(tile: dict[str, Any], zone: str, industry: str | None = None) -> None:
        name = tile["n"].strip()
        key = name.casefold()
        incoming = _component(tile, zone)
        if key not in components:
            components[key] = incoming
        else:
            current = components[key]
            for field, value in incoming.items():
                if field not in ("id", "name") and not current.get(field) and value:
                    current[field] = value
            current["capabilities"] = list(dict.fromkeys(current["capabilities"] + incoming["capabilities"]))
        if industry:
            memberships[industry].add(components[key]["id"])
        for field, kind in (("rel", "related"), ("feeds", "feeds"), ("comps", "uses")):
            for target in tile.get(field, []) or []:
                if isinstance(target, str):
                    refs.append((name, target, kind))

    bands = arch.get("bands", []) if isinstance(arch, dict) else arch
    for band in bands:
        for tile in band["products"]:
            add(tile, "platform")
    if isinstance(arch, dict):
        for tile, zone in _walk_tiles(arch.get("rails", {}), "cloud"):
            add(tile, zone)
        for tile, zone in _walk_tiles(arch.get("top", {}), "top"):
            add(tile, zone)
        for tile, zone in _walk_tiles(arch.get("cloud", {}), "cloud"):
            add(tile, zone)

    def add_industry_tree(value: Any, zone: str, industry_id: str, inherited_from: str | None = None) -> None:
        if isinstance(value, dict):
            flow_from = value.get("from", inherited_from)
            if isinstance(value.get("n"), str):
                add(value, zone, industry_id)
                if isinstance(flow_from, str):
                    refs.append((flow_from, value["n"], "flow"))
            for key, child in value.items():
                add_industry_tree(child, "top" if key == "top" else zone, industry_id, flow_from)
        elif isinstance(value, list):
            for child in value:
                add_industry_tree(child, zone, industry_id, inherited_from)

    for industry_id, industry in raw_industries.items():
        for zone in ("src", "ing", "ppl", "cons"):
            add_industry_tree(industry.get("rails", {}).get(zone, []), zone, industry_id)
        add_industry_tree(industry.get("top", []), "top", industry_id)

    by_name = {c["name"].casefold(): c for c in components.values()}
    edges: dict[tuple[str, str, str], dict[str, str]] = {}
    for source_name, target_name, kind in refs:
        source, target = by_name.get(source_name.casefold()), by_name.get(target_name.casefold())
        if not source or not target or source["id"] == target["id"]:
            continue
        key = (source["id"], target["id"], kind)
        edges[key] = {"id": _uuid("edge", "|".join(key)), "sourceId": key[0], "targetId": key[1], "kind": kind}
        if kind == "related" and target["id"] not in source["relatedIds"]:
            source["relatedIds"].append(target["id"])

    industries = []
    for industry_id, raw in raw_industries.items():
        industries.append({
            "id": industry_id,
            "label": raw.get("label", industry_id.replace("_", " ").title()),
            "blurb": raw.get("blurb", ""),
            "componentIds": sorted(memberships[industry_id]),
            "medallion": copy.deepcopy(raw.get("medallion", {})),
            "sources": copy.deepcopy(raw.get("sources", {})),
        })
    return {"version": 1, "components": sorted(components.values(), key=lambda c: c["name"].casefold()),
            "edges": sorted(edges.values(), key=lambda e: e["id"]), "industries": industries}
