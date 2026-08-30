"""Extract the ARCH JavaScript literal from Amr's app/index.html."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


MARKER = "const ARCH = {"
PRODUCT_FIELDS = ("n", "s", "ic", "long", "caps", "caps2", "rel", "st")


def _object_literal(source: str, marker: str = MARKER) -> str:
    """Return a balanced JS object literal, respecting strings and comments."""
    start = source.index(marker) + marker.index("{")
    depth = 0
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False
    i = start
    while i < len(source):
        char = source[i]
        nxt = source[i + 1] if i + 1 < len(source) else ""
        if line_comment:
            line_comment = char != "\n"
        elif block_comment:
            if char == "*" and nxt == "/":
                block_comment = False
                i += 1
        elif quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
        elif char in "'\"`":
            quote = char
        elif char == "/" and nxt == "/":
            line_comment = True
            i += 1
        elif char == "/" and nxt == "*":
            block_comment = True
            i += 1
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start : i + 1]
        i += 1
    raise ValueError("ARCH object is not balanced")


def _evaluate_js(literal: str) -> dict[str, Any]:
    script = (
        "const vm=require('node:vm'),fs=require('node:fs');"
        "const s=fs.readFileSync(0,'utf8');"
        "process.stdout.write(JSON.stringify(vm.runInNewContext('('+s+')',"
        "Object.create(null),{timeout:5000})));"
    )
    result = subprocess.run(
        ["node", "-e", script], input=literal, text=True, capture_output=True, check=True
    )
    return json.loads(result.stdout)


def _products(value: Any):
    if isinstance(value, dict):
        if isinstance(value.get("n"), str):
            yield {key: value[key] for key in PRODUCT_FIELDS if key in value}
        for child in value.values():
            yield from _products(child)
    elif isinstance(value, list):
        for child in value:
            yield from _products(child)


def parse_arch(path: Path) -> list[dict[str, Any]]:
    arch = _evaluate_js(_object_literal(path.read_text(encoding="utf-8")))
    bands = []
    for band in arch.get("bands", []):
        products = list(_products({k: v for k, v in band.items() if k != "name"}))
        bands.append(
            {
                "id": band.get("id", "platform"),
                "name": band.get("name", band.get("id", "Platform")),
                "products": products,
            }
        )
    return bands
