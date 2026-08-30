"""Normalize Amr's platform + industry data into ArchitectureDoc v1.

The source has no IDs and no explicit edges — components are linked only by
name. We:

  * assign one stable UUID5 per unique component (deduped by name across
    every industry and the platform), so the same product named in two
    industries maps to one component;
  * build an edge table from the name-based references in the source —
    ``rel`` -> related, ``from`` -> flow, ``feeds`` -> feeds, ``comps`` -> uses;
  * build an industry index listing each industry's component IDs, medallion
    and source citations.

The platform contributes three families of components: the band products
(``ARCH.bands``), the generic rails/top/cloud (``ARCH.rails/top/cloud``) — all
of which an industry overlay *replaces*, so they live on the platform page
rather than every industry page.
"""

from __future__ import annotations

import copy
import uuid
from collections import defaultdict
from typing import Any


# A fixed namespace makes the UUIDs reproducible across runs and machines.
NAMESPACE = uuid.UUID("bd67c26d-02f8-5f6e-89c4-f76a0212bb09")

ZONE_CATEGORY = {
    "platform": "platform",
    "src": "source",
    "ing": "ingestion",
    "ppl": "consumer",
    "cons": "consumer",
    "top": "usecase",
    "cloud": "cloud",
}


def _uuid(kind: str, value: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"{kind}:{value.strip().casefold()}"))


def _merge_component(current: dict[str, Any], incoming: dict[str, Any]) -> None:
    """Fold a second sighting of a component into the first.

    Different industries (or the platform vs an industry) describe the same
    product with different fields; keep the richest non-empty value of each
    field and union the capability lists.
    """
    for field, value in incoming.items():
        if field in ("id", "name"):
            continue
        if field == "capabilities":
            current["capabilities"] = list(
                dict.fromkeys(current["capabilities"] + value)
            )
        elif not current.get(field) and value:
            current[field] = value


def _component(tile: dict[str, Any], zone: str) -> dict[str, Any]:
    name = tile["n"].strip()
    return {
        "id": _uuid("component", name),
        "name": name,
        "shortName": tile.get("s", tile.get("mark", "")),
        "category": ZONE_CATEGORY.get(zone, "usecase"),
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


class Normalizer:
    def __init__(self) -> None:
        self.components: dict[str, dict[str, Any]] = {}  # casefold name -> component
        self.refs: list[tuple[str, str, str]] = []  # (source name, target name, kind)
        self.memberships: dict[str, set[str]] = defaultdict(set)

    # -- component + reference collection --------------------------------

    def _add(self, tile: dict[str, Any], zone: str, industry_id: str | None) -> None:
        name = tile["n"].strip()
        key = name.casefold()
        incoming = _component(tile, zone)
        if key not in self.components:
            self.components[key] = incoming
        else:
            _merge_component(self.components[key], incoming)
        if industry_id:
            self.memberships[industry_id].add(self.components[key]["id"])
        for field, kind in (("rel", "related"), ("feeds", "feeds"), ("comps", "uses")):
            for target in tile.get(field, []) or []:
                if isinstance(target, str):
                    self.refs.append((name, target, kind))

    def _add_group(self, group: dict[str, Any], zone: str, industry_id: str | None) -> None:
        """A rail group: a labeled box of tiles, optionally carrying ``from``."""
        flow_from = group.get("from")
        for tile in group.get("tiles", []) or []:
            if isinstance(tile.get("n"), str):
                self._add(tile, zone, industry_id)
                if isinstance(flow_from, str):
                    # 'from' names the upstream rail this group pulls from
                    # (e.g. Cloud ETL -> ingest). Model it as a flow edge.
                    self.refs.append((flow_from, tile["n"], "flow"))

    # -- platform (ARCH) -------------------------------------------------

    def add_platform(self, arch: dict[str, Any]) -> None:
        # Bands: the Databricks products, nested inside rows/panels/cols.
        for band in arch["bands"]:
            for product in band["products"]:
                self._add(product, "platform", None)

        # Generic rails (src/ing/ppl/cons) — replaced per industry, but they
        # are the platform's own default content so they live on the platform.
        for zone, rail in arch.get("rails", {}).items():
            for group in rail.get("groups", []):
                self._add_group(group, zone, None)

        # Top band: Genie agents + business use cases.
        for section in arch.get("top", {}).get("sections", []):
            for tile in section.get("tiles", []) or []:
                if isinstance(tile.get("n"), str):
                    self._add(tile, "top", None)

        # Cloud: vendor-neutral extras + the active provider's integration
        # tiles (fed/ingest/bi/identity/...). The same role exists across
        # providers with different names; we seed the active one.
        cloud = arch.get("cloud", {})
        for tile in cloud.get("extras", []) or []:
            if isinstance(tile.get("n"), str):
                self._add(tile, "cloud", None)
        provider = cloud.get("providers", {}).get(cloud.get("provider", ""), {})
        for _role, tiles in provider.items():
            if not isinstance(tiles, list):
                continue
            for tile in tiles:
                if isinstance(tile, dict) and isinstance(tile.get("n"), str):
                    self._add(tile, "cloud", None)

    # -- industries ------------------------------------------------------

    def add_industry(self, industry_id: str, industry: dict[str, Any]) -> None:
        rails = industry.get("rails", {})
        for zone in ("src", "ing", "ppl", "cons"):
            for group in rails.get(zone, []) or []:
                self._add_group(group, zone, industry_id)
        # Top band: apps + use cases.
        for section in industry.get("top", []) or []:
            for tile in section.get("tiles", []) or []:
                if isinstance(tile.get("n"), str):
                    self._add(tile, "top", industry_id)

    # -- edges -----------------------------------------------------------

    def _edges(self) -> list[dict[str, Any]]:
        by_name = {c["name"].casefold(): c for c in self.components.values()}
        edges: dict[tuple[str, str, str], dict[str, str]] = {}
        for source_name, target_name, kind in self.refs:
            source = by_name.get(source_name.casefold())
            target = by_name.get(target_name.casefold())
            if not source or not target or source["id"] == target["id"]:
                continue
            key = (source["id"], target["id"], kind)
            if key not in edges:
                edges[key] = {
                    "id": _uuid("edge", "|".join(key)),
                    "sourceId": key[0],
                    "targetId": key[1],
                    "kind": kind,
                }
                if kind == "related" and target["id"] not in source["relatedIds"]:
                    source["relatedIds"].append(target["id"])
        return sorted(edges.values(), key=lambda e: e["id"])

    # -- output ----------------------------------------------------------

    def build(self, raw_industries: dict[str, dict[str, Any]]) -> dict[str, Any]:
        edges = self._edges()
        industries = []
        for industry_id, raw in raw_industries.items():
            industries.append(
                {
                    "id": industry_id,
                    "label": raw.get("label", industry_id.replace("_", " ").title()),
                    "blurb": raw.get("blurb", ""),
                    "componentIds": sorted(self.memberships[industry_id]),
                    "medallion": copy.deepcopy(raw.get("medallion", {})),
                    "sources": copy.deepcopy(raw.get("sources", {})),
                }
            )
        components = sorted(self.components.values(), key=lambda c: c["name"].casefold())
        return {
            "version": 1,
            "components": components,
            "edges": edges,
            "industries": industries,
        }


def normalize(arch: dict[str, Any], raw_industries: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Normalize parsed ARCH + industries into ArchitectureDoc v1."""
    norm = Normalizer()
    norm.add_platform(arch)
    for industry_id, industry in raw_industries.items():
        norm.add_industry(industry_id, industry)
    return norm.build(raw_industries)
