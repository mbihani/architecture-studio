"""Load the authored INDUSTRIES dictionaries from their Python source files."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any


def parse_industries(directory: Path) -> dict[str, dict[str, Any]]:
    if not (directory / "common.py").is_file():
        raise FileNotFoundError(f"missing industry schema helper: {directory / 'common.py'}")
    result: dict[str, dict[str, Any]] = {}
    sys.path.insert(0, str(directory))
    try:
        for path in sorted(directory.glob("batch_*.py")):
            name = f"amr_industries_{path.stem}"
            spec = importlib.util.spec_from_file_location(name, path)
            if spec is None or spec.loader is None:
                raise ImportError(f"cannot load {path}")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            for key, value in vars(module).items():
                if key.startswith("INDUSTRIES_BATCH") and isinstance(value, dict):
                    result.update(value)
    finally:
        sys.path.pop(0)
    if not result:
        raise ValueError(f"no INDUSTRIES_BATCH dictionaries found in {directory}")
    return result
