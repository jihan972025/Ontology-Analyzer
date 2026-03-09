import asyncio
import json
import logging
import os
import re
import shutil
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ontology", tags=["ontology"])


class AnalyzeRequest(BaseModel):
    path: str
    files: Optional[list[str]] = None
    scanVuln: bool = False


class OntologyNode(BaseModel):
    id: str
    label: str
    type: str  # class, method, file, function, module, interface
    file: str
    line: Optional[int] = None
    cluster: int = 0
    size: int = 1
    fanIn: int = 0
    fanOut: int = 0
    lines: int = 0
    dead: bool = False
    vulnCount: int = 0


class OntologyEdge(BaseModel):
    source: str
    target: str
    type: str  # calls, imports, extends, implements, references
    order: Optional[int] = None  # call sequence order within a method (0-based)
    circular: bool = False


class Vulnerability(BaseModel):
    rule: str        # e.g. "sql-injection", "hardcoded-credential"
    severity: str    # "critical", "high", "medium", "low"
    message: str     # Human-readable description
    line: int        # Line number in file
    file: str        # Relative file path
    nodeId: str      # Enclosing node ID


class Suggestion(BaseModel):
    id: str              # e.g. "high-fan-in:method:Foo.bar"
    category: str        # complexity, dead_code, circular, large_function, hub, vulnerability, inheritance, wide_interface
    priority: str        # high, medium, low
    title: str           # Short title
    description: str     # Detailed explanation with actionable advice
    nodeIds: list[str]   # Affected node IDs (clickable in frontend)
    file: str | None = None  # Primary file affected


# ---------------------------------------------------------------------------
# Java parser
# ---------------------------------------------------------------------------

_JAVA_CLASS_RE = re.compile(
    r"\b(?:public\s+|abstract\s+|final\s+)*(?:class|interface|enum)\s+(\w+)"
    r"(?:\s+extends\s+(\w+))?"
    r"(?:\s+implements\s+([\w,\s]+))?"
)
_JAVA_METHOD_RE = re.compile(
    r"(?:(?:public|protected|private|static|final|abstract|synchronized|native)\s+)*"
    r"[\w<>\[\],]+(?:\s+[\w<>\[\],]+)*\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+\w[\w.,\s]*?)?\s*\{"
)
_JAVA_CALL_RE = re.compile(r"\b(\w+)\s*\(")
_JAVA_IMPORT_RE = re.compile(r"import\s+(?:static\s+)?([\w.]+)\s*;")


def _parse_java(filepath: str, nodes: dict, edges: list, file_label: str):
    """Parse a .java file and extract classes, methods, and call relationships."""
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception:
        return

    content = _strip_comments(content)

    # Create file node (same as _parse_generic)
    file_id = f"file:{file_label}"
    nodes[file_id] = OntologyNode(
        id=file_id, label=file_label, type="file", file=file_label
    )

    # Extract imports
    for m in _JAVA_IMPORT_RE.finditer(content):
        imp = m.group(1)
        short = imp.split(".")[-1]
        imp_id = f"class:{short}"
        if imp_id not in nodes:
            nodes[imp_id] = OntologyNode(
                id=imp_id, label=short, type="class", file="(external)", cluster=0
            )

    # --- Build class ranges: (class_name, start_offset, end_offset) ---
    # Each class body spans from its opening '{' to the matching '}'.
    class_ranges: list[tuple[str, int, int]] = []

    for m in _JAVA_CLASS_RE.finditer(content):
        cls_name = m.group(1)
        cls_id = f"class:{cls_name}"
        line_no = content[: m.start()].count("\n") + 1
        nodes[cls_id] = OntologyNode(
            id=cls_id, label=cls_name, type="class", file=file_label, line=line_no
        )

        if m.group(2):  # extends
            parent = m.group(2)
            parent_id = f"class:{parent}"
            if parent_id not in nodes:
                nodes[parent_id] = OntologyNode(
                    id=parent_id, label=parent, type="class", file="(external)"
                )
            edges.append(OntologyEdge(source=cls_id, target=parent_id, type="extends"))

        if m.group(3):  # implements
            for iface in m.group(3).split(","):
                iface = iface.strip()
                if iface:
                    iface_id = f"class:{iface}"
                    if iface_id not in nodes:
                        nodes[iface_id] = OntologyNode(
                            id=iface_id,
                            label=iface,
                            type="interface",
                            file="(external)",
                        )
                    edges.append(
                        OntologyEdge(
                            source=cls_id, target=iface_id, type="implements"
                        )
                    )

        # Find class body range via brace matching
        brace_pos = content.find("{", m.end())
        if brace_pos != -1:
            brace_count = 0
            body_end = len(content)
            for i in range(brace_pos, len(content)):
                if content[i] == "{":
                    brace_count += 1
                elif content[i] == "}":
                    brace_count -= 1
                    if brace_count == 0:
                        body_end = i
                        break
            class_ranges.append((cls_name, brace_pos, body_end))

    # Sort by start offset so inner (nested) classes come after outer ones.
    # For a method offset, the innermost (last matching) range is the correct owner.
    class_ranges.sort(key=lambda r: r[1])

    def _find_owner_class(offset: int) -> str | None:
        """Find the innermost class that contains the given character offset."""
        owner = None
        for cls_name, cls_start, cls_end in class_ranges:
            if cls_start <= offset <= cls_end:
                owner = cls_name  # keep going; later (inner) match overrides
        return owner

    # --- Extract methods with correct class ownership ---
    for m in _JAVA_METHOD_RE.finditer(content):
        method_name = m.group(1)
        if method_name in ("if", "for", "while", "switch", "catch", "return"):
            continue
        line_no = content[: m.start()].count("\n") + 1
        owner = _find_owner_class(m.start()) or file_label
        method_id = f"method:{owner}.{method_name}"
        nodes[method_id] = OntologyNode(
            id=method_id,
            label=f"{owner}.{method_name}()",
            type="method",
            file=file_label,
            line=line_no,
        )
        if owner != file_label:
            edges.append(
                OntologyEdge(
                    source=f"class:{owner}", target=method_id, type="calls"
                )
            )

        # Find method calls inside this method body (with call order)
        brace_count = 0
        body_start = m.end() - 1
        body_end = body_start
        for i in range(body_start, len(content)):
            if content[i] == "{":
                brace_count += 1
            elif content[i] == "}":
                brace_count -= 1
                if brace_count == 0:
                    body_end = i
                    break
        body = content[body_start:body_end]
        nodes[method_id].lines = body.count("\n") + 1
        call_order = 0
        for call in _JAVA_CALL_RE.finditer(body):
            callee = call.group(1)
            if callee in (
                "if", "for", "while", "switch", "catch", "return",
                "new", "super", "this", "System", "String", "Integer",
                "Boolean", "Long", "Double", "Float", "Math",
                "println", "print", "printf", "format", "toString",
                "equals", "hashCode", "valueOf", "size", "length",
                "get", "set", "add", "remove", "put", "contains",
                "isEmpty", "clear", "iterator", "next", "hasNext",
                "append", "delete", "replace", "substring", "trim",
                "split", "join", "charAt", "indexOf", "lastIndexOf",
                "startsWith", "endsWith", "toLowerCase", "toUpperCase",
                "parseInt", "parseDouble", "parseLong", "parseFloat",
            ):
                continue
            # Try to match to a known method in same class
            callee_id = f"method:{owner}.{callee}"
            if callee_id != method_id:
                # Create placeholder node for callee if it doesn't exist yet
                if callee_id not in nodes:
                    nodes[callee_id] = OntologyNode(
                        id=callee_id,
                        label=f"{owner}.{callee}()",
                        type="method",
                        file=file_label,
                    )
                edges.append(
                    OntologyEdge(source=method_id, target=callee_id, type="calls", order=call_order)
                )
                call_order += 1


# ---------------------------------------------------------------------------
# Generic file parsers (Python, TypeScript/JS, C/C++, Go, etc.)
# ---------------------------------------------------------------------------

_PY_IMPORT_RE = re.compile(
    r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))", re.MULTILINE
)
_PY_CLASS_RE = re.compile(r"^\s*class\s+(\w+)(?:\s*\(([^)]*)\))?", re.MULTILINE)
_PY_FUNC_RE = re.compile(r"^\s*def\s+(\w+)", re.MULTILINE)
_CALL_RE = re.compile(r"\b(\w+)\s*\(")

_TS_IMPORT_RE = re.compile(
    r"""(?:import\s+(?:(?:\{[^}]*\}|\w+|\*\s+as\s+\w+)(?:\s*,\s*(?:\{[^}]*\}|\w+|\*\s+as\s+\w+))*\s+from\s+)?['\"]([^'\"]+)['\"]|require\s*\(\s*['\"]([^'\"]+)['\"]\s*\))"""
)
_TS_CLASS_RE = re.compile(r"\bclass\s+(\w+)", re.MULTILINE)
_TS_FUNC_RE = re.compile(
    r"(?:export\s+)?(?:async\s+)?function\s+(\w+)", re.MULTILINE
)
# Arrow functions: const/let/var name = (...) => { or const name = async (...) => {
# Also handles: generics <T>(...), destructured params ({a, b}), multiline params
_TS_ARROW_RE = re.compile(
    r"(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:<[^>]*>\s*)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*(?::\s*[^=]+?)?\s*=>",
    re.MULTILINE,
)

_GO_IMPORT_RE = re.compile(r'"([\w./]+)"')
_GO_FUNC_RE = re.compile(r"^func\s+(?:\([^)]*\)\s+)?(\w+)", re.MULTILINE)

_C_INCLUDE_RE = re.compile(r'#include\s+[<"]([^>"]+)[>"]')
_C_FUNC_RE = re.compile(
    r"^[\w*]+\s+(\w+)\s*\([^)]*\)\s*\{", re.MULTILINE
)

# Common keywords / builtins to skip when detecting calls
_CALL_SKIP = frozenset({
    "if", "for", "while", "switch", "catch", "return", "throw", "typeof",
    "new", "super", "this", "self", "cls",
    "print", "println", "printf", "format", "str", "int", "float", "bool",
    "list", "dict", "set", "tuple", "len", "range", "enumerate", "zip", "map",
    "filter", "sorted", "reversed", "isinstance", "issubclass", "hasattr",
    "getattr", "setattr", "delattr", "type", "object", "property",
    "staticmethod", "classmethod", "super", "vars", "dir", "id", "hash",
    "repr", "abs", "round", "min", "max", "sum", "any", "all", "open",
    "String", "Number", "Boolean", "Array", "Object", "Map", "Set",
    "Promise", "Date", "RegExp", "Error", "JSON", "Math", "console",
    "setTimeout", "setInterval", "clearTimeout", "clearInterval",
    "parseInt", "parseFloat", "isNaN", "isFinite",
    "require", "import", "export", "module", "define",
    "describe", "it", "test", "expect", "beforeEach", "afterEach",
    "useState", "useEffect", "useRef", "useMemo", "useCallback",
    "useContext", "useReducer", "useImperativeHandle", "forwardRef",
    "createElement", "createContext", "memo", "lazy",
})


_COMMENT_LINE_RE = re.compile(r"//[^\n]*")
_COMMENT_BLOCK_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
_PY_COMMENT_RE = re.compile(r"#[^\n]*")


def _strip_comments(content: str) -> str:
    """Remove single-line (//) and block (/* */) comments while preserving line count.
    Replaces comment text with spaces so line numbers stay correct."""
    def _replace_keep_lines(m: re.Match) -> str:
        text = m.group(0)
        return re.sub(r"[^\n]", " ", text)
    content = _COMMENT_BLOCK_RE.sub(_replace_keep_lines, content)
    content = _COMMENT_LINE_RE.sub(_replace_keep_lines, content)
    return content


def _strip_py_comments(content: str) -> str:
    """Remove Python # comments while preserving line count."""
    def _replace_keep_lines(m: re.Match) -> str:
        return re.sub(r"[^\n]", " ", m.group(0))
    return _PY_COMMENT_RE.sub(_replace_keep_lines, content)


def _extract_brace_body(content: str, open_pos: int) -> str:
    """Extract body between matching braces starting at open_pos (must be '{')."""
    brace_count = 0
    for i in range(open_pos, len(content)):
        if content[i] == "{":
            brace_count += 1
        elif content[i] == "}":
            brace_count -= 1
            if brace_count == 0:
                return content[open_pos:i]
    return content[open_pos:]


def _extract_py_body(content: str, match_start: int) -> str:
    """Extract Python function body using indentation.
    match_start is the char offset of the 'def' keyword in content."""
    # Find the start of the line containing 'def'
    line_start = content.rfind("\n", 0, match_start)
    line_start = line_start + 1 if line_start != -1 else 0
    def_line = content[line_start:content.find("\n", match_start)]
    base_indent = len(def_line) - len(def_line.lstrip())

    # Find the end of the def line (after the colon)
    colon_pos = content.find(":", match_start)
    if colon_pos == -1:
        return ""
    body_start = content.find("\n", colon_pos)
    if body_start == -1:
        return ""
    body_start += 1  # skip the newline

    # Collect body lines (indented deeper than base)
    body_lines: list[str] = []
    pos = body_start
    while pos < len(content):
        next_nl = content.find("\n", pos)
        if next_nl == -1:
            line = content[pos:]
            next_nl = len(content)
        else:
            line = content[pos:next_nl]

        stripped = line.strip()
        if not stripped:  # blank lines are part of body
            body_lines.append(line)
            pos = next_nl + 1
            continue
        line_indent = len(line) - len(line.lstrip())
        if line_indent <= base_indent:
            break  # back to same or outer indent level → body ended
        body_lines.append(line)
        pos = next_nl + 1
    return "\n".join(body_lines)


def _extract_calls_from_body(
    body: str,
    caller_id: str,
    file_label: str,
    known_fn_names: set[str],
    nodes: dict,
    edges: list,
    node_type: str = "function",
):
    """Scan body text for function calls and create call edges.
    Only creates edges to functions that exist in known_fn_names (same file)."""
    call_order = 0
    seen_callees: set[str] = set()
    for call_m in _CALL_RE.finditer(body):
        callee_name = call_m.group(1)
        if callee_name in _CALL_SKIP:
            continue
        if callee_name not in known_fn_names:
            continue
        callee_id = f"{node_type}:{file_label}.{callee_name}"
        if callee_id == caller_id:
            continue  # skip self-recursion for clarity
        # Create placeholder node if not yet known
        if callee_id not in nodes:
            nodes[callee_id] = OntologyNode(
                id=callee_id, label=callee_name, type=node_type,
                file=file_label,
            )
        edge_key = (caller_id, callee_id)
        if edge_key not in seen_callees:
            seen_callees.add(edge_key)
            edges.append(OntologyEdge(
                source=caller_id, target=callee_id,
                type="calls", order=call_order,
            ))
            call_order += 1


def _parse_generic(filepath: str, nodes: dict, edges: list, file_label: str):
    """Parse Python, TS/JS, Go, C/C++ files for basic relationships
    including function-to-function call extraction."""
    ext = os.path.splitext(filepath)[1].lower()
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except Exception:
        return

    # Strip comments to prevent false positives
    # (e.g. "function" or "def" in comments being detected as declarations)
    if ext in (".py",):
        content = _strip_py_comments(content)
    else:
        content = _strip_comments(content)

    file_id = f"file:{file_label}"
    nodes[file_id] = OntologyNode(
        id=file_id, label=file_label, type="file", file=file_label
    )

    if ext in (".py",):
        # --- imports ---
        for m in _PY_IMPORT_RE.finditer(content):
            mod = m.group(1) or m.group(2)
            short = mod.split(".")[-1]
            mod_id = f"module:{short}"
            if mod_id not in nodes:
                nodes[mod_id] = OntologyNode(
                    id=mod_id, label=short, type="module", file="(external)"
                )
            edges.append(OntologyEdge(source=file_id, target=mod_id, type="imports"))

        # --- classes (with inheritance) ---
        for m in _PY_CLASS_RE.finditer(content):
            cls_name = m.group(1)
            cls_id = f"class:{cls_name}"
            line_no = content[: m.start()].count("\n") + 1
            nodes[cls_id] = OntologyNode(
                id=cls_id, label=cls_name, type="class", file=file_label, line=line_no
            )
            edges.append(OntologyEdge(source=file_id, target=cls_id, type="references"))

            # Parse base classes: class Foo(Bar, Baz, metaclass=ABCMeta)
            bases_str = m.group(2)
            if bases_str:
                for base_raw in bases_str.split(","):
                    base = base_raw.strip()
                    # Skip keyword args like metaclass=..., ABC, object
                    if not base or "=" in base or base in ("object",):
                        continue
                    # Handle dotted names: module.ClassName → take last part
                    base_short = base.split(".")[-1].strip()
                    if not base_short or not base_short[0].isupper():
                        continue  # skip non-class names (e.g. lowercase mixins are rare)
                    parent_id = f"class:{base_short}"
                    if parent_id not in nodes:
                        nodes[parent_id] = OntologyNode(
                            id=parent_id, label=base_short, type="class",
                            file="(external)",
                        )
                    edges.append(OntologyEdge(
                        source=cls_id, target=parent_id, type="extends"
                    ))

        # --- functions / methods: collect first, then extract calls ---
        func_defs: list[tuple[str, str, int]] = []  # (fn_id, fn_name, match_start)
        fn_name_set: set[str] = set()

        for m in _PY_FUNC_RE.finditer(content):
            fn_name = m.group(1)
            line_no = content[: m.start()].count("\n") + 1
            fn_id = f"function:{file_label}.{fn_name}"
            nodes[fn_id] = OntologyNode(
                id=fn_id, label=fn_name, type="function", file=file_label, line=line_no
            )
            edges.append(OntologyEdge(source=file_id, target=fn_id, type="references"))
            func_defs.append((fn_id, fn_name, m.start()))
            fn_name_set.add(fn_name)

        # Extract calls from each function body
        for fn_id, fn_name, match_start in func_defs:
            body = _extract_py_body(content, match_start)
            nodes[fn_id].lines = body.count("\n") + 1 if body.strip() else 0
            _extract_calls_from_body(
                body, fn_id, file_label, fn_name_set, nodes, edges, "function"
            )

    elif ext in (".ts", ".tsx", ".js", ".jsx", ".mjs"):
        # --- imports ---
        for m in _TS_IMPORT_RE.finditer(content):
            mod = m.group(1) or m.group(2)
            short = mod.split("/")[-1]
            mod_id = f"module:{short}"
            if mod_id not in nodes:
                nodes[mod_id] = OntologyNode(
                    id=mod_id, label=short, type="module", file="(external)"
                )
            edges.append(OntologyEdge(source=file_id, target=mod_id, type="imports"))

        # --- classes ---
        for m in _TS_CLASS_RE.finditer(content):
            cls_id = f"class:{m.group(1)}"
            line_no = content[: m.start()].count("\n") + 1
            nodes[cls_id] = OntologyNode(
                id=cls_id, label=m.group(1), type="class", file=file_label, line=line_no
            )
            edges.append(OntologyEdge(source=file_id, target=cls_id, type="references"))

        # --- functions (named + arrow): collect first, then extract calls ---
        func_defs: list[tuple[str, str, re.Match]] = []  # (fn_id, fn_name, match)
        fn_name_set: set[str] = set()

        # Named functions
        for m in _TS_FUNC_RE.finditer(content):
            fn_name = m.group(1)
            fn_id = f"function:{file_label}.{fn_name}"
            line_no = content[: m.start()].count("\n") + 1
            nodes[fn_id] = OntologyNode(
                id=fn_id, label=fn_name, type="function", file=file_label, line=line_no
            )
            edges.append(OntologyEdge(source=file_id, target=fn_id, type="references"))
            func_defs.append((fn_id, fn_name, m))
            fn_name_set.add(fn_name)

        # Arrow functions
        for m in _TS_ARROW_RE.finditer(content):
            fn_name = m.group(1)
            if fn_name in fn_name_set:
                continue  # already found as named function
            fn_id = f"function:{file_label}.{fn_name}"
            line_no = content[: m.start()].count("\n") + 1
            nodes[fn_id] = OntologyNode(
                id=fn_id, label=fn_name, type="function", file=file_label, line=line_no
            )
            edges.append(OntologyEdge(source=file_id, target=fn_id, type="references"))
            func_defs.append((fn_id, fn_name, m))
            fn_name_set.add(fn_name)

        # Extract calls from each function body
        for fn_id, fn_name, match in func_defs:
            # Find the opening brace after the match
            search_start = match.end()
            brace_pos = content.find("{", search_start)
            if brace_pos == -1 or (brace_pos - search_start) > 200:
                continue  # no brace found nearby
            body = _extract_brace_body(content, brace_pos)
            nodes[fn_id].lines = body.count("\n") + 1 if body.strip() else 0
            _extract_calls_from_body(
                body, fn_id, file_label, fn_name_set, nodes, edges, "function"
            )

    elif ext in (".go",):
        # --- imports ---
        for m in _GO_IMPORT_RE.finditer(content):
            mod = m.group(1).split("/")[-1]
            mod_id = f"module:{mod}"
            if mod_id not in nodes:
                nodes[mod_id] = OntologyNode(
                    id=mod_id, label=mod, type="module", file="(external)"
                )
            edges.append(OntologyEdge(source=file_id, target=mod_id, type="imports"))

        # --- functions: collect first, then extract calls ---
        func_defs: list[tuple[str, str, re.Match]] = []
        fn_name_set: set[str] = set()

        for m in _GO_FUNC_RE.finditer(content):
            fn_name = m.group(1)
            fn_id = f"function:{file_label}.{fn_name}"
            line_no = content[: m.start()].count("\n") + 1
            nodes[fn_id] = OntologyNode(
                id=fn_id, label=fn_name, type="function", file=file_label, line=line_no
            )
            edges.append(OntologyEdge(source=file_id, target=fn_id, type="references"))
            func_defs.append((fn_id, fn_name, m))
            fn_name_set.add(fn_name)

        for fn_id, fn_name, match in func_defs:
            brace_pos = content.find("{", match.end())
            if brace_pos == -1 or (brace_pos - match.end()) > 100:
                continue
            body = _extract_brace_body(content, brace_pos)
            nodes[fn_id].lines = body.count("\n") + 1 if body.strip() else 0
            _extract_calls_from_body(
                body, fn_id, file_label, fn_name_set, nodes, edges, "function"
            )

    elif ext in (".c", ".cpp", ".cc", ".h", ".hpp"):
        # --- includes ---
        for m in _C_INCLUDE_RE.finditer(content):
            inc = m.group(1).split("/")[-1]
            mod_id = f"module:{inc}"
            if mod_id not in nodes:
                nodes[mod_id] = OntologyNode(
                    id=mod_id, label=inc, type="module", file="(external)"
                )
            edges.append(OntologyEdge(source=file_id, target=mod_id, type="imports"))

        # --- functions: collect first, then extract calls ---
        func_defs: list[tuple[str, str, re.Match]] = []
        fn_name_set: set[str] = set()

        for m in _C_FUNC_RE.finditer(content):
            fn_name = m.group(1)
            if fn_name in ("if", "for", "while", "switch", "return", "main"):
                continue
            fn_id = f"function:{file_label}.{fn_name}"
            line_no = content[: m.start()].count("\n") + 1
            nodes[fn_id] = OntologyNode(
                id=fn_id, label=fn_name, type="function", file=file_label, line=line_no
            )
            edges.append(OntologyEdge(source=file_id, target=fn_id, type="references"))
            func_defs.append((fn_id, fn_name, m))
            fn_name_set.add(fn_name)

        for fn_id, fn_name, match in func_defs:
            # C functions end with '{' in the regex, so brace is at match.end()-1
            brace_pos = match.end() - 1
            body = _extract_brace_body(content, brace_pos)
            nodes[fn_id].lines = body.count("\n") + 1 if body.strip() else 0
            _extract_calls_from_body(
                body, fn_id, file_label, fn_name_set, nodes, edges, "function"
            )


# ---------------------------------------------------------------------------
# Community detection (simple label propagation)
# ---------------------------------------------------------------------------

def _detect_communities(nodes: dict, edges: list) -> None:
    """Assign cluster IDs via deterministic label propagation.
    Uses fixed seed and stable tie-breaking for reproducible results."""
    node_ids = sorted(nodes.keys())  # sorted for determinism
    if not node_ids:
        return
    label_map = {nid: i for i, nid in enumerate(node_ids)}

    # Build adjacency (sorted neighbors for determinism)
    adj: dict[str, list[str]] = {nid: [] for nid in node_ids}
    for e in edges:
        if e.source in adj and e.target in adj:
            adj[e.source].append(e.target)
            adj[e.target].append(e.source)
    for nid in adj:
        adj[nid] = sorted(set(adj[nid]))  # deduplicate and sort

    # Iterate label propagation with fixed seed
    import random
    rng = random.Random(42)  # fixed seed, isolated from global state
    for _ in range(10):
        order = list(node_ids)
        rng.shuffle(order)
        for nid in order:
            neighbors = adj.get(nid, [])
            if not neighbors:
                continue
            # Most common label among neighbors, with smallest label as tie-breaker
            counts: dict[int, int] = {}
            for nb in neighbors:
                lbl = label_map[nb]
                counts[lbl] = counts.get(lbl, 0) + 1
            max_count = max(counts.values())
            best = min(lbl for lbl, cnt in counts.items() if cnt == max_count)
            label_map[nid] = best

    # Remap to consecutive cluster indices
    unique_labels = sorted(set(label_map.values()))
    remap = {old: new for new, old in enumerate(unique_labels)}
    for nid in node_ids:
        nodes[nid].cluster = remap[label_map[nid]]


# ---------------------------------------------------------------------------
# Circular dependency detection (DFS back-edge detection)
# ---------------------------------------------------------------------------

def _detect_cycles(nodes: dict, edges: list) -> int:
    """Mark edges that participate in cycles. Returns count of circular edges."""
    adj: dict[str, list[tuple[str, int]]] = {nid: [] for nid in nodes}
    for i, e in enumerate(edges):
        if e.source in adj:
            adj[e.source].append((e.target, i))

    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {nid: WHITE for nid in nodes}
    circular_indices: set[int] = set()

    def dfs(u: str):
        color[u] = GRAY
        for v, ei in adj.get(u, []):
            if v not in color:
                continue
            if color[v] == GRAY:
                circular_indices.add(ei)
            elif color[v] == WHITE:
                dfs(v)
        color[u] = BLACK

    # Increase recursion limit for large graphs
    import sys
    old_limit = sys.getrecursionlimit()
    sys.setrecursionlimit(max(old_limit, len(nodes) + 1000))
    try:
        for nid in nodes:
            if color.get(nid, WHITE) == WHITE:
                dfs(nid)
    finally:
        sys.setrecursionlimit(old_limit)

    for ei in circular_indices:
        edges[ei].circular = True
    return len(circular_indices)


# ---------------------------------------------------------------------------
# Dead code detection
# ---------------------------------------------------------------------------

_ENTRY_POINT_NAMES = frozenset({
    # Python
    "main", "__init__", "__new__", "__del__", "__call__",
    "__enter__", "__exit__", "__aenter__", "__aexit__",
    "__str__", "__repr__", "__len__", "__iter__", "__next__",
    "__getitem__", "__setitem__", "__delitem__", "__contains__",
    "__eq__", "__ne__", "__lt__", "__le__", "__gt__", "__ge__",
    "__hash__", "__bool__", "__add__", "__sub__", "__mul__",
    "__getattr__", "__setattr__", "__delattr__",
    "__get__", "__set__", "__delete__",
    "__init_subclass__", "__class_getitem__",
    "setUp", "tearDown", "setUpClass", "tearDownClass",
    # Java / JUnit
    "toString", "equals", "hashCode", "compareTo", "clone",
    "run", "call", "accept", "apply", "get",
    # Go
    "init", "Init",
    # C / C++
    "main",
})

_ENTRY_POINT_PREFIXES = (
    # Python: test methods, event handlers, dunder
    "test_", "test",
    # General: event handlers, callbacks, lifecycle
    "on_", "on",
    "handle_", "handle",
    "setup_", "setup",
    "teardown_", "teardown",
    # Web frameworks: Flask/Django/FastAPI route handlers
    "get_", "post_", "put_", "delete_", "patch_",
    # React / JS lifecycle & hooks
    "use",
    # Java: Spring/Servlet lifecycle
    "do",
)

_ENTRY_POINT_SUFFIXES = (
    # Java: Spring/Servlet patterns
    "Handler", "Listener", "Callback", "Controller",
    "Servlet", "Filter", "Interceptor",
    # Python: Django/Flask
    "_view", "_handler", "_callback",
    "_task", "_job", "_command",
)

_ENTRY_POINT_DECORATORS_RE = re.compile(
    r"@(?:app\.|router\.|blueprint\.)?(?:route|get|post|put|delete|patch|"
    r"api_view|action|task|job|celery|"
    r"pytest\.fixture|fixture|"
    r"abstractmethod|overload|override|"
    r"staticmethod|classmethod|property|"
    r"click\.command|command|"
    r"subscriber|listener|handler|hook|signal|event|"
    r"Test|test|before_|after_|setup|teardown)",
    re.IGNORECASE,
)


def _is_entry_point(node_id: str, node_label: str, file_content_cache: dict[str, str], node_file: str, node_line: int | None) -> bool:
    """Check if a function/method is likely an entry point and should NOT be marked dead."""
    # Extract the bare function name from label (e.g. "MyClass.myMethod()" → "myMethod")
    name = node_label.rstrip("()")
    if "." in name:
        name = name.split(".")[-1]

    # 1. Exact name match
    if name in _ENTRY_POINT_NAMES:
        return True

    # 2. Prefix match
    for prefix in _ENTRY_POINT_PREFIXES:
        if name.startswith(prefix):
            return True

    # 3. Suffix match
    for suffix in _ENTRY_POINT_SUFFIXES:
        if name.endswith(suffix):
            return True

    # 4. Dunder methods (Python __xxx__)
    if name.startswith("__") and name.endswith("__"):
        return True

    # 5. Check for decorator in source (if available)
    if node_line and node_file and node_file != "(external)":
        content = file_content_cache.get(node_file)
        if content:
            lines = content.split("\n")
            # Check lines above the def/function declaration for decorators
            start = max(0, node_line - 4)  # check up to 3 lines above
            end = node_line  # line numbers are 1-based, so node_line-1 is the def line
            above = "\n".join(lines[start:end])
            if _ENTRY_POINT_DECORATORS_RE.search(above):
                return True

    return False


def _detect_dead_code(nodes: dict, edges: list, file_content_cache: dict[str, str] | None = None) -> int:
    """Mark method/function nodes with zero incoming call/reference edges as dead.
    Excludes entry points (main, __init__, test_*, handlers, decorated, etc.)."""
    if file_content_cache is None:
        file_content_cache = {}

    # Collect nodes that are actually called by other functions/methods.
    # Exclude structural "ownership" edges that don't represent real usage:
    #   - file → function/method (references): every function has this
    #   - class → method (calls): Java parser emits this for class membership
    # A function is "used" only if called by another function or method.
    targets: set[str] = set()
    for e in edges:
        src_node = nodes.get(e.source)
        if not src_node:
            continue
        if e.type == "calls":
            # Only count calls FROM functions/methods (not from classes)
            if src_node.type in ("method", "function"):
                targets.add(e.target)
        elif e.type == "references":
            if src_node.type in ("method", "function"):
                targets.add(e.target)

    count = 0
    for nid, node in nodes.items():
        if node.type in ("method", "function") and nid not in targets:
            if _is_entry_point(nid, node.label, file_content_cache, node.file, node.line):
                continue  # entry point → not dead
            node.dead = True
            count += 1
    return count


# ---------------------------------------------------------------------------
# Improvement suggestion generation
# ---------------------------------------------------------------------------

def _generate_suggestions(
    nodes: dict[str, OntologyNode],
    edges: list[OntologyEdge],
    vulnerabilities: list[Vulnerability],
) -> list[Suggestion]:
    """Analyze the graph and generate actionable code improvement suggestions."""
    suggestions: list[Suggestion] = []
    _priority_order = {"high": 0, "medium": 1, "low": 2}

    # ---- Rule 1 & 2: High fan-in / fan-out (complexity) ----
    for nid, node in nodes.items():
        if node.type not in ("method", "function", "class"):
            continue
        # High fan-in → too many callers, god object risk
        if node.fanIn >= 8:
            pri = "high" if node.fanIn >= 12 else "medium"
            suggestions.append(Suggestion(
                id=f"high-fan-in:{nid}",
                category="complexity",
                priority=pri,
                title=f"High fan-in ({node.fanIn}) on {node.label}",
                description=(
                    f"{node.label} is referenced by {node.fanIn} other nodes. "
                    f"This indicates a central dependency — changes here will ripple widely. "
                    f"Consider splitting responsibilities or introducing an abstraction layer."
                ),
                nodeIds=[nid],
                file=node.file if node.file != "(external)" else None,
            ))
        # High fan-out → too many dependencies
        if node.fanOut >= 8:
            pri = "high" if node.fanOut >= 12 else "medium"
            suggestions.append(Suggestion(
                id=f"high-fan-out:{nid}",
                category="complexity",
                priority=pri,
                title=f"High fan-out ({node.fanOut}) on {node.label}",
                description=(
                    f"{node.label} depends on {node.fanOut} other nodes. "
                    f"Excessive outgoing dependencies make this hard to test and maintain. "
                    f"Consider breaking it into smaller, focused functions."
                ),
                nodeIds=[nid],
                file=node.file if node.file != "(external)" else None,
            ))

    # ---- Rule 3: Dead code (grouped by file) ----
    dead_by_file: dict[str, list[OntologyNode]] = {}
    for nid, node in nodes.items():
        if node.dead and node.type in ("method", "function"):
            dead_by_file.setdefault(node.file, []).append(node)
    for file, dead_nodes in sorted(dead_by_file.items()):
        names = ", ".join(n.label for n in dead_nodes[:5])
        extra = f" and {len(dead_nodes) - 5} more" if len(dead_nodes) > 5 else ""
        suggestions.append(Suggestion(
            id=f"dead-code:{file}",
            category="dead_code",
            priority="low",
            title=f"{len(dead_nodes)} dead function{'s' if len(dead_nodes) > 1 else ''} in {file.split('/')[-1]}",
            description=(
                f"Unreachable functions: {names}{extra}. "
                f"These are never called by other functions in the analyzed codebase. "
                f"Verify they are truly unused and consider removing them to reduce maintenance burden."
            ),
            nodeIds=[n.id for n in dead_nodes],
            file=file if file != "(external)" else None,
        ))

    # ---- Rule 4: Circular dependencies ----
    circular_nodes: set[str] = set()
    for e in edges:
        if e.circular:
            circular_nodes.add(e.source)
            circular_nodes.add(e.target)
    if circular_nodes:
        # Build connected components among circular nodes
        circ_adj: dict[str, set[str]] = {n: set() for n in circular_nodes}
        for e in edges:
            if e.circular:
                circ_adj[e.source].add(e.target)
                circ_adj[e.target].add(e.source)
        visited: set[str] = set()
        cycle_groups: list[list[str]] = []
        for start in sorted(circular_nodes):
            if start in visited:
                continue
            group: list[str] = []
            stack = [start]
            while stack:
                n = stack.pop()
                if n in visited:
                    continue
                visited.add(n)
                group.append(n)
                for nb in sorted(circ_adj.get(n, set())):
                    if nb not in visited:
                        stack.append(nb)
            cycle_groups.append(sorted(group))

        for i, group in enumerate(cycle_groups):
            labels = ", ".join(nodes[nid].label for nid in group[:5] if nid in nodes)
            extra = f" and {len(group) - 5} more" if len(group) > 5 else ""
            suggestions.append(Suggestion(
                id=f"circular:{i}",
                category="circular",
                priority="high",
                title=f"Circular dependency ({len(group)} nodes)",
                description=(
                    f"Cycle involves: {labels}{extra}. "
                    f"Circular dependencies make the code hard to test, refactor, and reason about. "
                    f"Consider dependency inversion, extracting shared interfaces, or reorganizing modules."
                ),
                nodeIds=group,
                file=None,
            ))

    # ---- Rule 5: Large functions ----
    for nid, node in nodes.items():
        if node.type not in ("method", "function"):
            continue
        if node.lines >= 40:
            pri = "high" if node.lines >= 80 else "medium"
            suggestions.append(Suggestion(
                id=f"large-function:{nid}",
                category="large_function",
                priority=pri,
                title=f"{node.label} has {node.lines} lines",
                description=(
                    f"Long functions are harder to understand, test, and maintain. "
                    f"Consider applying Extract Method refactoring to break it into "
                    f"smaller, well-named helper functions with single responsibilities."
                ),
                nodeIds=[nid],
                file=node.file if node.file != "(external)" else None,
            ))

    # ---- Rule 6: Hub nodes (high total connections) ----
    for nid, node in nodes.items():
        if node.type not in ("method", "function", "class"):
            continue
        total = node.fanIn + node.fanOut
        # Skip if already reported as high fan-in or high fan-out individually
        if total >= 15 and node.fanIn < 8 and node.fanOut < 8:
            pri = "high" if total >= 20 else "medium"
            suggestions.append(Suggestion(
                id=f"hub:{nid}",
                category="hub",
                priority=pri,
                title=f"{node.label} is a hub ({total} connections)",
                description=(
                    f"This node has {node.fanIn} incoming and {node.fanOut} outgoing connections. "
                    f"Hub nodes are coupling hotspots — changes here affect many parts of the system. "
                    f"Consider splitting into smaller modules or introducing a mediator pattern."
                ),
                nodeIds=[nid],
                file=node.file if node.file != "(external)" else None,
            ))

    # ---- Rule 7: Security vulnerabilities by severity ----
    vuln_by_severity: dict[str, list[Vulnerability]] = {}
    for v in vulnerabilities:
        vuln_by_severity.setdefault(v.severity, []).append(v)
    severity_order = ["critical", "high", "medium", "low"]
    for severity in severity_order:
        group = vuln_by_severity.get(severity, [])
        if not group:
            continue
        pri = "high" if severity in ("critical", "high") else ("medium" if severity == "medium" else "low")
        files = sorted(set(v.file for v in group))
        file_list = ", ".join(files[:3])
        extra = f" and {len(files) - 3} more files" if len(files) > 3 else ""
        suggestions.append(Suggestion(
            id=f"vulnerability:{severity}",
            category="vulnerability",
            priority=pri,
            title=f"{len(group)} {severity} security issue{'s' if len(group) > 1 else ''}",
            description=(
                f"Found in: {file_list}{extra}. "
                f"Address {severity}-severity vulnerabilities promptly to prevent potential exploits. "
                f"Review each finding and apply recommended fixes."
            ),
            nodeIds=sorted(set(v.nodeId for v in group)),
            file=None,
        ))

    # ---- Rule 8: Deep inheritance chains ----
    # Build extends graph: child → parent
    extends_map: dict[str, str] = {}
    for e in edges:
        if e.type == "extends":
            extends_map[e.source] = e.target

    def _chain_depth(nid: str, visited: set[str] | None = None) -> list[str]:
        chain = [nid]
        if visited is None:
            visited = set()
        current = nid
        while current in extends_map:
            parent = extends_map[current]
            if parent in visited:
                break  # avoid infinite loop
            visited.add(parent)
            chain.append(parent)
            current = parent
        return chain

    for nid in sorted(nodes.keys()):
        node = nodes[nid]
        if node.type != "class":
            continue
        chain = _chain_depth(nid)
        if len(chain) >= 4:  # depth >= 3 means 4+ nodes in chain
            labels = " -> ".join(
                nodes[c].label if c in nodes else c for c in chain
            )
            suggestions.append(Suggestion(
                id=f"deep-inheritance:{nid}",
                category="inheritance",
                priority="medium",
                title=f"Deep inheritance ({len(chain) - 1} levels): {node.label}",
                description=(
                    f"Inheritance chain: {labels}. "
                    f"Deep hierarchies increase coupling and reduce flexibility. "
                    f"Consider 'Composition over Inheritance' — delegate behaviors to contained objects instead."
                ),
                nodeIds=[c for c in chain if c in nodes],
                file=node.file if node.file != "(external)" else None,
            ))

    # ---- Rule 9: Wide interface (class with too many methods) ----
    # Count methods per class: edges where class → method via "calls" (Java parser)
    class_methods: dict[str, list[str]] = {}
    for e in edges:
        if e.type == "calls" and e.source in nodes and e.target in nodes:
            src = nodes[e.source]
            tgt = nodes[e.target]
            if src.type == "class" and tgt.type == "method":
                class_methods.setdefault(e.source, []).append(e.target)
    for cls_id, method_ids in sorted(class_methods.items()):
        count = len(method_ids)
        if count >= 10:
            cls = nodes[cls_id]
            pri = "high" if count >= 15 else "medium"
            suggestions.append(Suggestion(
                id=f"wide-interface:{cls_id}",
                category="wide_interface",
                priority=pri,
                title=f"{cls.label} has {count} methods",
                description=(
                    f"Classes with many methods may violate the Interface Segregation Principle. "
                    f"Consider splitting into smaller, focused interfaces or extracting helper classes "
                    f"to improve cohesion and testability."
                ),
                nodeIds=[cls_id] + method_ids[:5],
                file=cls.file if cls.file != "(external)" else None,
            ))

    # Sort: priority (high first), then category
    suggestions.sort(key=lambda s: (_priority_order.get(s.priority, 9), s.category, s.id))
    return suggestions


# ---------------------------------------------------------------------------
# Security vulnerability detection (Semgrep AST-based SAST)
# ---------------------------------------------------------------------------

_SEMGREP_SEVERITY_MAP = {
    "ERROR": "critical",
    "WARNING": "high",
    "INFO": "medium",
}


def _find_semgrep() -> str:
    """Locate the semgrep binary. Returns the path or raises RuntimeError."""
    import sys

    # 1. Check bundled semgrep (production: resources/semgrep/semgrep.exe)
    if getattr(sys, 'frozen', False):
        # PyInstaller frozen exe — look for sibling semgrep directory
        backend_dir = os.path.dirname(sys.executable)
        bundled = os.path.join(backend_dir, "..", "semgrep", "semgrep.exe")
        bundled = os.path.normpath(bundled)
        if os.path.isfile(bundled):
            return bundled

    # 2. Check PATH
    found = shutil.which("semgrep")
    if found:
        return found

    # 3. Windows: check common pip install locations
    if os.name == "nt":
        candidates = []
        # User-level pip install
        local = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Python")
        if os.path.isdir(local):
            for d in os.listdir(local):
                candidates.append(os.path.join(local, d, "Scripts", "semgrep.exe"))
        # Also check the python that might be on PATH
        py = shutil.which("python") or shutil.which("python3")
        if py:
            candidates.append(os.path.join(os.path.dirname(py), "Scripts", "semgrep.exe"))
        # HOME\AppData\Roaming\Python
        roaming = os.path.join(os.environ.get("APPDATA", ""), "Python")
        if os.path.isdir(roaming):
            for d in os.listdir(roaming):
                candidates.append(os.path.join(roaming, d, "Scripts", "semgrep.exe"))
        for c in candidates:
            if os.path.isfile(c):
                return c

    raise RuntimeError(
        "Semgrep is not installed. "
        "Install it with: pip install semgrep\n"
        "Then restart the application."
    )


def _get_rules_file() -> str:
    """Return absolute path to bundled Semgrep rules YAML."""
    rules_file = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "security",
        "semgrep-rules.yml",
    )
    if not os.path.isfile(rules_file):
        raise RuntimeError(f"Semgrep rules file not found: {rules_file}")
    return rules_file


def _run_semgrep_sync(scan_path: str, timeout: float = 60,
                      file_targets: list[str] | None = None) -> dict:
    """Run semgrep synchronously (called via asyncio.to_thread).

    If *file_targets* is given, scan only those files instead of the
    whole *scan_path* directory.
    """
    import subprocess as sp
    import signal

    semgrep_bin = _find_semgrep()
    rules_file = _get_rules_file()

    cmd = [
        semgrep_bin, "scan",
        "--config", rules_file,
        "--json",
        "--timeout", "10",
        "--exclude", "node_modules",
        "--exclude", ".git",
        "--exclude", "__pycache__",
        "--exclude", "venv",
        "--exclude", ".venv",
        "--exclude", "dist",
        "--exclude", "build",
        "--exclude", "target",
        "--exclude", ".claude",
    ]

    if file_targets:
        cmd.extend(file_targets)
    else:
        cmd.append(scan_path)

    logger.info("Semgrep binary: %s", semgrep_bin)
    logger.info("Semgrep rules:  %s", rules_file)
    logger.info("Semgrep scan:   %s (%d file targets)",
                scan_path, len(file_targets) if file_targets else 0)

    # On Windows, create a new process group so we can kill the entire
    # tree (semgrep spawns child processes like semgrep-core).
    kwargs: dict = {}
    if os.name == "nt":
        kwargs["creationflags"] = sp.CREATE_NEW_PROCESS_GROUP

    proc = None
    try:
        proc = sp.Popen(
            cmd,
            stdout=sp.PIPE,
            stderr=sp.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            **kwargs,
        )
        out, err = proc.communicate(timeout=timeout)
    except FileNotFoundError:
        raise RuntimeError(
            "Semgrep is not installed. "
            "Install it with: pip install semgrep\n"
            "Then restart the application."
        )
    except sp.TimeoutExpired:
        if proc is not None:
            try:
                if os.name == "nt":
                    sp.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                           capture_output=True, timeout=10)
                else:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                proc.kill()
            proc.wait(timeout=5)
        raise RuntimeError(f"Semgrep scan timed out after {timeout}s")

    out = out or ""
    err = (err or "").strip()
    rc = proc.returncode

    logger.info(
        "Semgrep finished: exit=%d, stdout=%d bytes, stderr=%d bytes",
        rc, len(out), len(err),
    )

    if err:
        logger.debug("Semgrep stderr: %s", err[:500])

    # Semgrep exits with 0 (no findings) or 1 (findings found) — both OK
    if rc not in (0, 1):
        detail = (err or out)[:500]
        raise RuntimeError(
            f"Semgrep scan failed (exit code {rc}): {detail}"
        )

    if not out.strip():
        raise RuntimeError("Semgrep returned empty output")

    try:
        data = json.loads(out)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse Semgrep JSON: {e}")

    num_results = len(data.get("results", []))
    num_errors = len(data.get("errors", []))
    logger.info("Semgrep results: %d findings, %d rule errors", num_results, num_errors)

    return data


async def _run_semgrep(scan_path: str, timeout: float = 60,
                       file_targets: list[str] | None = None) -> dict:
    """Run semgrep scan asynchronously and return parsed JSON output."""
    return await asyncio.to_thread(_run_semgrep_sync, scan_path, timeout, file_targets)


def _parse_semgrep_results(
    semgrep_output: dict,
    scan_root: str,
    nodes: dict,
) -> list[Vulnerability]:
    """Convert Semgrep JSON results to Vulnerability objects."""
    results = semgrep_output.get("results", [])

    # Build lookup: file -> nodes sorted by line desc (to find enclosing node)
    file_nodes: dict[str, list] = {}
    for node in nodes.values():
        if node.file and node.file != "(external)" and node.line:
            file_nodes.setdefault(node.file, []).append(node)
    for fn_list in file_nodes.values():
        fn_list.sort(key=lambda n: n.line or 0, reverse=True)

    vulnerabilities: list[Vulnerability] = []

    for finding in results:
        check_id = finding.get("check_id", "unknown")
        # Extract short rule name from dotted check_id
        # e.g. "python.lang.security.audit.eval-detected" -> "eval-detected"
        rule_name = check_id.rsplit(".", 1)[-1] if "." in check_id else check_id

        abs_path = finding.get("path", "")
        rel_path = os.path.relpath(abs_path, scan_root).replace("\\", "/")

        line_no = finding.get("start", {}).get("line", 0)

        extra = finding.get("extra", {})
        message = extra.get("message", "")
        raw_severity = extra.get("severity", "INFO")
        severity = _SEMGREP_SEVERITY_MAP.get(raw_severity, "medium")

        # Find enclosing node
        node_id = f"file:{rel_path}"
        for n in file_nodes.get(rel_path, []):
            if n.line and n.line <= line_no:
                node_id = n.id
                break

        vulnerabilities.append(Vulnerability(
            rule=rule_name,
            severity=severity,
            message=message,
            line=line_no,
            file=rel_path,
            nodeId=node_id,
        ))

    # Update vulnCount on nodes
    for v in vulnerabilities:
        if v.nodeId in nodes:
            nodes[v.nodeId].vulnCount += 1

    return vulnerabilities


# ---------------------------------------------------------------------------
# Compute node sizes based on degree
# ---------------------------------------------------------------------------

def _compute_sizes(nodes: dict, edges: list) -> None:
    in_deg: dict[str, int] = {nid: 0 for nid in nodes}
    out_deg: dict[str, int] = {nid: 0 for nid in nodes}
    for e in edges:
        if e.source in out_deg:
            out_deg[e.source] += 1
        if e.target in in_deg:
            in_deg[e.target] += 1
    for nid in nodes:
        nodes[nid].fanIn = in_deg[nid]
        nodes[nid].fanOut = out_deg[nid]
        nodes[nid].size = max(1, in_deg[nid] + out_deg[nid])


# ---------------------------------------------------------------------------
# Scan directory and build graph
# ---------------------------------------------------------------------------

SUPPORTED_EXTENSIONS = {
    ".java", ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs",
    ".go", ".c", ".cpp", ".cc", ".h", ".hpp",
}

MAX_FILES = 500
MAX_FILE_SIZE = 512 * 1024  # 512 KB


async def _scan_and_parse(root: str, file_list: list[str] | None = None,
                          scan_vuln: bool = False):
    nodes: dict[str, OntologyNode] = {}
    edges: list[OntologyEdge] = []
    parsed_files: list[str] = []  # Track files for targeted Semgrep scan
    file_content_cache: dict[str, str] = {}  # rel_path → file content (for dead-code decorator check)
    file_count = 0

    def _read_and_cache(filepath: str, rel: str) -> None:
        """Read file content and cache it for later dead-code analysis."""
        try:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                file_content_cache[rel] = f.read()
        except Exception:
            pass

    if file_list:
        # Analyze only the specified files
        for filepath in file_list:
            filepath = filepath.replace("\\", "/")
            ext = os.path.splitext(filepath)[1].lower()
            if ext not in SUPPORTED_EXTENSIONS:
                continue
            if not os.path.isfile(filepath):
                continue
            if os.path.getsize(filepath) > MAX_FILE_SIZE:
                continue
            file_count += 1
            if file_count > MAX_FILES:
                break
            parsed_files.append(filepath)
            rel = os.path.relpath(filepath, root).replace("\\", "/")
            _read_and_cache(filepath, rel)
            if ext == ".java":
                _parse_java(filepath, nodes, edges, rel)
            else:
                _parse_generic(filepath, nodes, edges, rel)
    else:
        for dirpath, dirnames, filenames in os.walk(root):
            # Skip hidden and common non-source dirs
            dirnames[:] = [
                d for d in dirnames
                if not d.startswith(".")
                and d not in ("node_modules", "__pycache__", "venv", ".venv", "build",
                              "dist", "target", "bin", "obj", ".git", ".idea")
            ]
            for fname in filenames:
                ext = os.path.splitext(fname)[1].lower()
                if ext not in SUPPORTED_EXTENSIONS:
                    continue
                filepath = os.path.join(dirpath, fname)
                if os.path.getsize(filepath) > MAX_FILE_SIZE:
                    continue
                file_count += 1
                if file_count > MAX_FILES:
                    break

                parsed_files.append(filepath)
                rel = os.path.relpath(filepath, root).replace("\\", "/")
                _read_and_cache(filepath, rel)

                if ext == ".java":
                    _parse_java(filepath, nodes, edges, rel)
                else:
                    _parse_generic(filepath, nodes, edges, rel)

            if file_count > MAX_FILES:
                break

    # Deduplicate edges
    seen = set()
    unique_edges = []
    for e in edges:
        key = (e.source, e.target, e.type)
        if key not in seen:
            seen.add(key)
            # Only keep edges where both endpoints exist
            if e.source in nodes and e.target in nodes:
                unique_edges.append(e)

    _compute_sizes(nodes, unique_edges)
    _detect_communities(nodes, unique_edges)
    _detect_cycles(nodes, unique_edges)
    _detect_dead_code(nodes, unique_edges, file_content_cache)

    # Semgrep scan — only when scan_vuln is True.
    vulnerabilities: list[Vulnerability] = []
    vuln_error: str | None = None
    if scan_vuln:
        try:
            semgrep_output = await _run_semgrep(root, file_targets=parsed_files or None)
            vulnerabilities = _parse_semgrep_results(semgrep_output, root, nodes)
            logger.info("Vulnerability scan complete: %d issues found", len(vulnerabilities))
        except Exception as e:
            vuln_error = str(e)
            logger.warning("Semgrep scan failed (%s): %s", type(e).__name__, vuln_error)
    else:
        logger.info("Vulnerability scan skipped (scanVuln=false)")

    # Generate improvement suggestions based on all analysis results
    suggestions = _generate_suggestions(nodes, unique_edges, vulnerabilities)
    logger.info("Generated %d improvement suggestions", len(suggestions))

    return list(nodes.values()), unique_edges, vulnerabilities, vuln_error, suggestions


# ---------------------------------------------------------------------------
# API endpoint
# ---------------------------------------------------------------------------

@router.post("/analyze")
async def analyze_ontology(req: AnalyzeRequest):
    folder = req.path
    if not os.path.isdir(folder):
        raise HTTPException(status_code=400, detail=f"Not a directory: {folder}")
    nodes, edges, vulnerabilities, vuln_error, suggestions = await _scan_and_parse(
        folder, req.files, scan_vuln=req.scanVuln,
    )
    result = {
        "nodes": [n.model_dump() for n in nodes],
        "edges": [e.model_dump() for e in edges],
        "vulnerabilities": [v.model_dump() for v in vulnerabilities],
        "suggestions": [s.model_dump() for s in suggestions],
    }
    if vuln_error:
        result["vulnError"] = vuln_error
    return result


@router.post("/analyze-stream")
async def analyze_ontology_stream(req: AnalyzeRequest):
    """Streaming version of /analyze that sends NDJSON progress events."""
    from starlette.responses import StreamingResponse

    folder = req.path
    if not os.path.isdir(folder):
        raise HTTPException(status_code=400, detail=f"Not a directory: {folder}")

    _SKIP = frozenset((
        "node_modules", "__pycache__", "venv", ".venv", "build",
        "dist", "target", "bin", "obj", ".git", ".idea",
    ))

    def _collect(root, flist):
        result, count = [], 0
        if flist:
            for fp in flist:
                fp = fp.replace("\\", "/")
                ext = os.path.splitext(fp)[1].lower()
                if ext not in SUPPORTED_EXTENSIONS or not os.path.isfile(fp):
                    continue
                if os.path.getsize(fp) > MAX_FILE_SIZE:
                    continue
                count += 1
                if count > MAX_FILES:
                    break
                result.append((fp, ext, os.path.relpath(fp, root).replace("\\", "/")))
        else:
            for dp, dns, fns in os.walk(root):
                dns[:] = [d for d in dns if not d.startswith(".") and d not in _SKIP]
                for fn in fns:
                    ext = os.path.splitext(fn)[1].lower()
                    if ext not in SUPPORTED_EXTENSIONS:
                        continue
                    fp = os.path.join(dp, fn)
                    if os.path.getsize(fp) > MAX_FILE_SIZE:
                        continue
                    count += 1
                    if count > MAX_FILES:
                        break
                    result.append((fp, ext, os.path.relpath(fp, root).replace("\\", "/")))
                if count > MAX_FILES:
                    break
        return result

    def _parse_batch(batch, nodes, edges, cache):
        for fp, ext, rel in batch:
            try:
                with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                    cache[rel] = f.read()
            except Exception:
                pass
            try:
                if ext == ".java":
                    _parse_java(fp, nodes, edges, rel)
                else:
                    _parse_generic(fp, nodes, edges, rel)
            except Exception:
                logger.warning("Skipping file due to parse error: %s", fp)

    def _graph_analysis(nodes, edges, cache):
        seen, unique = set(), []
        for e in edges:
            key = (e.source, e.target, e.type)
            if key not in seen:
                seen.add(key)
                if e.source in nodes and e.target in nodes:
                    unique.append(e)
        _compute_sizes(nodes, unique)
        _detect_communities(nodes, unique)
        _detect_cycles(nodes, unique)
        _detect_dead_code(nodes, unique, cache)
        return unique

    async def generate():
        def _emit(typ, **kw):
            return json.dumps({"type": typ, **kw}) + "\n"

        yield _emit("progress", percent=5, message="Collecting files...")
        collected = await asyncio.to_thread(_collect, folder, req.files)
        total = len(collected)
        yield _emit("progress", percent=10, message=f"Found {total} files")

        nodes: dict[str, OntologyNode] = {}
        edges: list[OntologyEdge] = []
        parsed_files: list[str] = []
        cache: dict[str, str] = {}

        if total > 0:
            bs = max(1, total // 15)
            for i in range(0, total, bs):
                batch = collected[i:i + bs]
                await asyncio.to_thread(_parse_batch, batch, nodes, edges, cache)
                parsed_files.extend(fp for fp, _, _ in batch)
                done = min(i + bs, total)
                yield _emit("progress", percent=10 + int((done / total) * 60),
                            message=f"Parsing files ({done}/{total})...")

        yield _emit("progress", percent=75, message="Analyzing graph structure...")
        unique_edges = await asyncio.to_thread(_graph_analysis, nodes, edges, cache)
        yield _emit("progress", percent=85, message="Graph analysis complete")

        vulns: list[Vulnerability] = []
        vuln_error = None
        if req.scanVuln:
            yield _emit("progress", percent=88, message="Scanning vulnerabilities...")
            try:
                so = await _run_semgrep(folder, file_targets=parsed_files or None)
                vulns = _parse_semgrep_results(so, folder, nodes)
            except Exception as e:
                vuln_error = str(e)

        suggestions = _generate_suggestions(nodes, unique_edges, vulns)
        yield _emit("progress", percent=100, message="Complete")

        result: dict = {
            "type": "result",
            "data": {
                "nodes": [n.model_dump() for n in nodes.values()],
                "edges": [e.model_dump() for e in unique_edges],
                "vulnerabilities": [v.model_dump() for v in vulns],
                "suggestions": [s.model_dump() for s in suggestions],
            },
        }
        if vuln_error:
            result["data"]["vulnError"] = vuln_error
        yield json.dumps(result) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


class CodePreviewRequest(BaseModel):
    file: str
    line: int
    context: int = 5


@router.post("/code-preview")
async def code_preview(req: CodePreviewRequest):
    """Return a code snippet around a given line number."""
    if not os.path.isfile(req.file):
        raise HTTPException(status_code=404, detail="File not found")
    try:
        with open(req.file, "r", encoding="utf-8", errors="ignore") as f:
            all_lines = f.readlines()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    start = max(0, req.line - 1 - req.context)
    end = min(len(all_lines), req.line + req.context)
    snippet = "".join(all_lines[start:end])
    return {"code": snippet, "startLine": start + 1, "endLine": end}


@router.post("/list-files")
async def list_files(req: AnalyzeRequest):
    """List supported source files in a directory."""
    folder = req.path
    if not os.path.isdir(folder):
        raise HTTPException(status_code=400, detail=f"Not a directory: {folder}")

    if req.files:
        # Return only the specified files
        files = []
        for fp in req.files:
            fp = fp.replace("\\", "/")
            ext = os.path.splitext(fp)[1].lower()
            if ext not in SUPPORTED_EXTENSIONS:
                continue
            if not os.path.isfile(fp):
                continue
            rel = os.path.relpath(fp, folder).replace("\\", "/")
            files.append({"path": rel, "ext": ext})
        return {"files": files}

    files = []
    count = 0
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = [
            d for d in dirnames
            if not d.startswith(".")
            and d not in ("node_modules", "__pycache__", "venv", ".venv", "build",
                          "dist", "target", "bin", "obj", ".git", ".idea")
        ]
        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext not in SUPPORTED_EXTENSIONS:
                continue
            filepath = os.path.join(dirpath, fname)
            rel = os.path.relpath(filepath, folder).replace("\\", "/")
            files.append({"path": rel, "ext": ext})
            count += 1
            if count >= MAX_FILES:
                break
        if count >= MAX_FILES:
            break
    return {"files": files}
