"""Load the authored INDUSTRIES dictionaries from their Python source files.

Security: the batch_*.py files (and common.py) are third-party Python from
amralieg/interactive-databricks-enterprise-architecture. We pin to a specific
commit SHA, refuse to run if the repo is dirty or at a different commit, and
AST-scan every .py file in the industries directory for dangerous constructs
before executing any of it. See converter/README.md for the full security note.
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

# Modules that must never appear in an executed file. The batch files
# legitimately import ``sys`` and ``pathlib`` (for ``sys.path.insert`` to reach
# ``common``); everything else here is dangerous in third-party code.
_DANGEROUS_MODULES = frozenset({
    "os", "subprocess", "socket", "http", "urllib", "requests", "ctypes",
    "pickle", "marshal", "shutil", "tempfile", "multiprocessing", "threading",
    "signal", "pty", "platform", "getpass", "builtins",
    "importlib",  # can dynamically import anything, bypassing the module ban
})

# Builtins that must never be called directly.
_DANGEROUS_CALLS = frozenset({
    "exec", "eval", "compile", "__import__", "open", "exit", "quit",
})

# Dangerous attribute names — any call whose function is an attribute access
# (obj.attr) or subscript (obj["attr"]) ending in one of these is rejected.
# This catches aliases (``import os as x; x.system(...)``), attribute chains
# (``a.b.system(...)``), and dynamic dispatch (``obj["system"](...)``) that
# the module-import ban would otherwise miss.
_DANGEROUS_ATTRS = frozenset({
    "system", "popen", "exec", "eval",
})


def _verify_pinned_commit(directory: Path) -> None:
    """Ensure the cloned repo is at exactly ``PINNED_COMMIT`` — fail closed.

    ``directory`` is ``tools/industries``; the repo root is two levels up.
    If the repo is not a git checkout, has a dirty working tree, or HEAD
    doesn't match the pin, print an error to stderr and exit so we never
    execute untrusted code.
    """
    repo_root = directory.parent.parent  # tools/industries -> repo root
    git_dir = repo_root / ".git"
    if not git_dir.exists():
        print(
            f"ERROR: {repo_root} is not a git checkout — cannot verify commit "
            f"pin {PINNED_COMMIT[:8]}; refusing to execute unpinned code",
            file=sys.stderr,
        )
        sys.exit(1)
    # Reject modified or untracked files — the repo must be clean at the pin.
    status = subprocess.run(
        ["git", "-C", str(repo_root), "status", "--porcelain"],
        capture_output=True, text=True, check=True,
    )
    if status.stdout.strip():
        print(
            f"ERROR: {repo_root} has modified or untracked files — refusing to "
            f"execute code from a dirty repo (expected clean checkout at "
            f"{PINNED_COMMIT[:8]})",
            file=sys.stderr,
        )
        sys.exit(1)
    result = subprocess.run(
        ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
        capture_output=True, text=True, check=True,
    )
    head = result.stdout.strip()
    if head != PINNED_COMMIT:
        print(
            f"ERROR: repo HEAD ({head[:8]}) != pinned commit "
            f"({PINNED_COMMIT[:8]}) — refusing to execute untrusted code. "
            f"Check out {PINNED_COMMIT} deliberately and re-run.",
            file=sys.stderr,
        )
        sys.exit(1)


class _SafetyVisitor(ast.NodeVisitor):
    """Walk an AST and raise ``RuntimeError`` on dangerous constructs.

    Extends the original flat ``ast.walk`` scan with checks for the patterns
    the module-import ban alone misses:

    * ``importlib`` in the dangerous-module ban (dynamic imports).
    * Calls whose function is an attribute access (``x.system(...)``) or
      subscript (``x["system"](...)``) ending in a dangerous name — catches
      aliases and dynamic dispatch.
    * Any reference to ``.modules`` on a bare name (``sys.modules`` under any
      alias) — can smuggle in arbitrary modules even when ``sys`` is allowed.
    * ``getattr(obj, "system")`` / ``getattr(obj, "modules")`` — the
      string-argument equivalent of the above.
    """

    def __init__(self, path: Path) -> None:
        self._path = path

    def _fail(self, msg: str) -> None:
        raise RuntimeError(f"{self._path.name}: {msg}")

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            root = alias.name.split(".")[0]
            if root in _DANGEROUS_MODULES:
                self._fail(f"imports dangerous module '{alias.name}'")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module and node.module.split(".")[0] in _DANGEROUS_MODULES:
            self._fail(f"imports from dangerous module '{node.module}'")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        # Direct call to a dangerous builtin: exec(...), eval(...), __import__(...)
        if isinstance(func, ast.Name) and func.id in _DANGEROUS_CALLS:
            self._fail(f"calls dangerous builtin '{func.id}'")
        # Attribute call ending in a dangerous name: x.system(...),
        # a.b.popen(...), etc. — catches aliases the import ban misses.
        if isinstance(func, ast.Attribute) and func.attr in _DANGEROUS_ATTRS:
            self._fail(f"calls dangerous attribute '{func.attr}'")
        # Subscript call: obj["system"](...) — dynamic dispatch.
        if isinstance(func, ast.Subscript):
            key = func.slice
            # Python 3.9+ stores the slice expression directly (no ast.Index).
            if (
                isinstance(key, ast.Constant)
                and isinstance(key.value, str)
                and key.value in _DANGEROUS_ATTRS
            ):
                self._fail(
                    f"calls dangerous attribute via subscript '{key.value}'"
                )
        # getattr(obj, "system") or getattr(obj, "modules") — string-based
        # dispatch that bypasses the attribute/subscript checks above.
        if (
            isinstance(func, ast.Name)
            and func.id == "getattr"
            and len(node.args) >= 2
        ):
            attr_arg = node.args[1]
            if (
                isinstance(attr_arg, ast.Constant)
                and isinstance(attr_arg.value, str)
                and (attr_arg.value in _DANGEROUS_ATTRS or attr_arg.value == "modules")
            ):
                self._fail(
                    f"uses getattr to access dangerous attribute "
                    f"'{attr_arg.value}'"
                )
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        # Any reference to <name>.modules (sys.modules under any alias) — can
        # be used to smuggle in dangerous modules even when sys is allowed.
        if node.attr == "modules" and isinstance(node.value, ast.Name):
            self._fail("references '.modules' — potential sys.modules abuse")
        self.generic_visit(node)


def _scan_safety(path: Path) -> None:
    """AST-scan a Python file for dangerous constructs before executing it.

    Raises ``RuntimeError`` if the file imports a dangerous module, calls a
    dangerous builtin, or uses attribute/subscript/getattr dispatch to invoke
    system/popen/exec/eval. Also rejects any reference to ``.modules``
    (sys.modules). This is defense-in-depth on top of the commit pin.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    _SafetyVisitor(path).visit(tree)


def parse_industries(directory: Path) -> dict[str, dict[str, Any]]:
    _verify_pinned_commit(directory)
    if not (directory / "common.py").is_file():
        raise FileNotFoundError(f"missing industry schema helper: {directory / 'common.py'}")
    # Scan every .py file in the directory — not just batch_*.py — because
    # common.py and any other helpers are imported and executed too.
    for path in sorted(directory.glob("*.py")):
        _scan_safety(path)  # refuse to execute anything dangerous
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
