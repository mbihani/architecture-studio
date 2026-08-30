"""Extract the ARCH JavaScript literal from Amr's app/index.html.

The ARCH object is a hand-authored JavaScript literal (unquoted keys, trailing
commas, line and block comments, the odd bareword) sitting at ~line 2666. We lift
it with a small, self-contained Python scanner that:

  1. isolates the balanced object literal (string- and comment-aware), and
  2. converts it to strict JSON (quotes bareword keys, drops trailing commas
     and comments) so ``json.loads`` can parse it.

No Node dependency, no eval — the converter runs anywhere CPython does.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator


MARKER = "const ARCH = {"

# Fields the ARCH band cards use (the platform products). Some band cards live
# inside nested rows/panels/cols/sides, so we recurse to find every card with a
# name; we keep only the fields ARCH models per product.
PRODUCT_FIELDS = ("n", "s", "ic", "long", "caps", "caps2", "rel", "st")


def _extract_literal(source: str, marker: str = MARKER) -> str:
    """Return the balanced JS object literal that begins at ``marker``.

    The scanner tracks single/double/backtick strings, ``//`` line comments and
    ``/* */`` block comments so braces inside strings or comments never break
    the depth count. (ARCH has no template literals in code — the four backticks
    all sit inside block comments — but the scanner handles them regardless.)
    """
    start = source.index(marker) + marker.index("{")
    depth = 0
    quote: str | None = None
    escaped = False
    line_comment = False
    block_comment = False
    i = start
    n = len(source)
    while i < n:
        char = source[i]
        nxt = source[i + 1] if i + 1 < n else ""
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
        elif char in "\"'`":
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
    raise ValueError("ARCH object literal is not balanced — no closing brace")


def _strip_comments(literal: str) -> str:
    """Remove ``//`` and ``/* */`` comments outside of strings."""
    out: list[str] = []
    quote: str | None = None
    escaped = False
    i = 0
    n = len(literal)
    while i < n:
        char = literal[i]
        nxt = literal[i + 1] if i + 1 < n else ""
        if quote:
            out.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
        elif char in "\"'`":
            quote = char
            out.append(char)
        elif char == "/" and nxt == "/":
            # Skip to end of line.
            i += 1
            while i < n and literal[i] != "\n":
                i += 1
            continue
        elif char == "/" and nxt == "*":
            # Skip to closing */.
            i += 2
            while i < n - 1 and not (literal[i] == "*" and literal[i + 1] == "/"):
                i += 1
            i += 1
        else:
            out.append(char)
        i += 1
    return "".join(out)


def _to_json(literal: str) -> str:
    """Best-effort convert a JS object literal to strict JSON.

    ARCH uses three non-JSON things: bareword (unquoted) keys, trailing
    commas, and the occasional single-quoted string. A blind regex pass gets
    fooled by apostrophes inside double-quoted strings (e.g. ``"vendors'
    platforms"``), so we scan char-by-char and only rewrite tokens outside
    double-quoted strings. Comments must already be stripped by
    ``_strip_comments`` before this runs.
    """
    src = _strip_comments(literal)
    out: list[str] = []
    i = 0
    n = len(src)
    prev_significant = ""  # last non-space char we emitted (for key detection)

    while i < n:
        char = src[i]

        # Double-quoted string: copy verbatim (already valid JSON). Single
        # quotes do not appear as string delimiters in ARCH, only as apostrophes
        # inside double-quoted text, so we never treat ' as a delimiter.
        if char == '"':
            out.append(char)
            i += 1
            while i < n:
                ch = src[i]
                out.append(ch)
                if ch == "\\" and i + 1 < n:
                    out.append(src[i + 1])
                    i += 2
                    continue
                if ch == '"':
                    break
                i += 1
            i += 1
            prev_significant = '"'
            continue

        # Trailing comma: drop a comma that is followed by only whitespace and
        # then '}' or ']'.
        if char == ",":
            j = i + 1
            while j < n and src[j] in " \t\r\n":
                j += 1
            if j < n and src[j] in "}]":
                i += 1  # skip the comma
                continue
            out.append(char)
            i += 1
            prev_significant = ","
            continue

        # Bareword key: an identifier followed (after optional space) by ':'
        # that appears where a key is expected — right after '{' or ','.
        if char.isalpha() or char == "_":
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] == "_"):
                j += 1
            k = j
            while k < n and src[k] in " \t\r\n":
                k += 1
            if k < n and src[k] == ":" and prev_significant in ("{", ","):
                out.append('"')
                out.append(src[i:j])
                out.append('"')
                i = j  # leave the ':' for the next iteration
                prev_significant = '"'
                continue
            out.append(src[i:j])
            i = j
            prev_significant = src[i - 1]
            continue

        out.append(char)
        if not char.isspace():
            prev_significant = char
        i += 1

    return "".join(out)


def _evaluate(literal: str) -> dict[str, Any]:
    return json.loads(_to_json(literal))


def _iter_products(value: Any) -> Iterator[dict[str, Any]]:
    """Yield every card with a ``n`` field anywhere in a band's body.

    ARCH nests products in rows (``rows[].items``), sometimes inside panels
    (``head``, ``cols``, ``side``) and ``rlbl``/``foot`` siblings. We recurse
    through the whole band except its top-level ``name``/``sub``/``tone`` labels
    and keep the product fields ARCH models.
    """
    if isinstance(value, dict):
        if isinstance(value.get("n"), str):
            yield {k: value[k] for k in PRODUCT_FIELDS if k in value}
        for child in value.values():
            yield from _iter_products(child)
    elif isinstance(value, list):
        for child in value:
            yield from _iter_products(child)


def _bands(arch: dict[str, Any]) -> list[dict[str, Any]]:
    bands: list[dict[str, Any]] = []
    for band in arch.get("bands", []):
        body = {k: v for k, v in band.items() if k != "name"}
        products = list(_iter_products(body))
        bands.append(
            {
                "id": band.get("id", "platform"),
                "name": band.get("name", band.get("id", "Platform")),
                "products": products,
            }
        )
    return bands


def _rails(arch: dict[str, Any]) -> dict[str, Any]:
    """Return ARCH.rails as {zone: {id, name, groups}}."""
    rails: dict[str, Any] = {}
    for zone, rail in arch.get("rails", {}).items():
        rails[zone] = {
            "id": rail.get("id", zone),
            "name": rail.get("name", zone),
            "groups": rail.get("groups", []),
        }
    return rails


def _top(arch: dict[str, Any]) -> dict[str, Any]:
    """Return ARCH.top as a {sections} structure mirroring an industry top band."""
    top = arch.get("top", {})
    return {
        "name": top.get("name", "Top"),
        "ic": top.get("ic", ""),
        "sections": top.get("secs", []),
    }


def _cloud(arch: dict[str, Any]) -> dict[str, Any]:
    """Return ARCH.cloud: vendor-neutral extras + the active provider's rails."""
    cloud = arch.get("cloud", {})
    return {
        "name": cloud.get("name", "Cloud Services & Integrations"),
        "ic": cloud.get("ic", ""),
        "provider": cloud.get("provider", ""),
        "extras": cloud.get("extras", []),
        "providers": cloud.get("providers", {}),
    }


def parse_arch(path: Path) -> dict[str, Any]:
    """Parse ARCH from ``app/index.html`` into bands, rails, top and cloud."""
    arch = _evaluate(_extract_literal(path.read_text(encoding="utf-8")))
    return {
        "meta": arch.get("meta", {}),
        "bands": _bands(arch),
        "rails": _rails(arch),
        "top": _top(arch),
        "cloud": _cloud(arch),
    }
