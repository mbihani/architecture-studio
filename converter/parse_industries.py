"""Load the authored INDUSTRIES dictionaries from their Python source files.

Security: the batch_*.py files are third-party Python from
amralieg/interactive-databricks-enterprise-architecture. We pin to a specific
commit SHA and AST-scan each file for dangerous constructs before executing
it. See converter/README.md for the full security note.
"""

from __future__ import annotations

import ast
import importlib.util
import subprocess
import sys
from pathlib import Path
from typing import Any


# Pin the upstream repo to a specific commit so a compromised or changed
# batch_*.py file can never silently execute. Update this deliberately.
PINNED_COMMIT = "8a5d798efc352fe72b4eb81bfb1a7349dbdd4c76"

# Modules that must never appear in an executed batch file. The batch files
# legitimately import ``sys`` and ``pathlib`` (for ``sys.path.insert`` to reach
# ``common``); everything else here is dangerous in third-party code.
_DANGEROUS_MODULES = frozenset({
    "os", "subprocess", "socket", "http", "urllib", "requests", "ctypes",
    "pickle", "marshal", "shutil", "tempfile", "multiprocessing", "threading",
    "signal", "pty", "platform", "getpass", "builtins",
})

# Builtins that must never be called directly in a batch file.
_DANGEROUS_CALLS = frozenset({
    "exec", "eval", "compile", "__import__", "open", "exit", "quit",
})


def _verify_pinned_commit(directory: Path) -> None:
    """Ensure the cloned repo is at exactly ``PINNED_COMMIT``.

    ``directory`` is ``tools/industries``; the repo root is two levels up.
    If HEAD doesn't match the pin, attempt a ``git checkout`` to the pinned
    commit; if that fails, raise so we never execute unpinned code.
    """
    repo_root = directory.parent.parent  # tools/industries -> repo root
    git_dir = repo_root / ".git"
    if not git_dir.exists():
        print(f"WARNING: {repo_root} is not a git checkout — cannot verify commit pin")
        return
    result = subprocess.run(
        ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    )
    head = result.stdout.strip()
    if head == PINNED_COMMIT:
        return
    print(
        f"WARNING: repo HEAD ({head[:8]}) != pinned commit ({PINNED_COMMIT[:8]}); "
        f"checking out pinned commit"
    )
    subprocess.run(
        ["git", "-C", str(repo_root), "checkout", PINNED_COMMIT],
        capture_output=True, text=True, check=True,
    )


def _scan_safety(path: Path) -> None:
    """AST-scan a batch file for dangerous imports/calls before executing it.

    Raises ``RuntimeError`` if the file imports a dangerous module or calls
    a dangerous builtin. This is defense-in-depth on top of the commit pin.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in _DANGEROUS_MODULES:
                    raise RuntimeError(
                        f"{path.name}: imports dangerous module '{alias.name}'"
                    )
        elif isinstance(node, ast.ImportFrom):
            if node.module and node.module.split(".")[0] in _DANGEROUS_MODULES:
                raise RuntimeError(
                    f"{path.name}: imports from dangerous module '{node.module}'"
                )
        elif isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in _DANGEROUS_CALLS:
                raise RuntimeError(
                    f"{path.name}: calls dangerous builtin '{func.id}'"
                )


def parse_industries(directory: Path) -> dict[str, dict[str, Any]]:
    _verify_pinned_commit(directory)
    if not (directory / "common.py").is_file():
        raise FileNotFoundError(f"missing industry schema helper: {directory / 'common.py'}")
    result: dict[str, dict[str, Any]] = {}
    sys.path.insert(0, str(directory))
    try:
        for path in sorted(directory.glob("batch_*.py")):
            _scan_safety(path)  # refuse to execute anything dangerous
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
