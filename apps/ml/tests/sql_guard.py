"""The guard ADR 0135 decision 3 demands (plan T3.7).

`bms_fleet` can read and write far more than the scorer needs, and the owed
`bms_ml` role does not exist yet. So the scorer's SQL itself is the contract:
reads of its named inputs, inserts into `ml.*`, nothing else. This test holds
that, statically, with the syntax tree and a small tokenizer rather than a
file-wide regex:

1. All SQL lives in `db/sql.py`, and only `db/gateway.py` imports psycopg.
   Every `execute` / `executemany` / `stream` in the gateway passes `sql.<NAME>`.
2. Each statement is a read (`SELECT` / `WITH`) or an `INSERT INTO`, with no
   forbidden word and no second statement.
3. A write targets one of the three `ml` tables; a read holds no `INSERT`.
4. Every source after `FROM` / `JOIN` (comma lists included) is a CTE of that
   statement, `unnest(`, or one of READ_SOURCES. Anything the reader cannot
   classify FAILS rather than passes.
5. The allowlists are asserted by value in `test_sql_guard.py`, so widening
   one (`bms.alarms`, `bms.work_orders`) is a visible diff in two files.

This module is the guard; `test_sql_guard.py` runs it over the real tree and
over "must fail" fixtures, so the guard's own liveness is tested.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "bms_ml"

READ_SOURCES = frozenset(
    {
        "telemetry.point_values_1h",
        "telemetry.point_values_1d",
        "bms.assets",
        "bms.asset_points",
        "bms.asset_templates",
        "bms.rtus",  # Amendment 2 ruling 3: the real-data rule needs ingest_enabled
        "ml.model_runs",  # Amendment 2 ruling 3: the already-scored check (plan R12)
        "pg_namespace",  # preflight: the schema-version marker
        "pg_roles",  # preflight: refuse a superuser
    }
)
WRITE_TARGETS = frozenset({"ml.model_runs", "ml.forecasts", "ml.anomaly_scores"})
FORBIDDEN_WORDS = frozenset(
    {
        "UPDATE", "DELETE", "TRUNCATE", "MERGE", "DROP", "ALTER", "CREATE", "GRANT", "REVOKE",
        "COPY", "CALL", "DO", "SET", "RESET", "LISTEN", "NOTIFY", "LOCK", "VACUUM", "REFRESH",
        "CONFLICT", "RETURNING", "EXECUTE", "PREPARE", "DECLARE", "IMPORT", "SECURITY",
    }
)  # fmt: skip
SCHEMAS = frozenset({"bms", "telemetry", "ml", "public", "pg_catalog", "information_schema", "pg_toast"})
CLAUSE_WORDS = frozenset(
    {
        "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL", "CROSS", "NATURAL", "LATERAL",
        "ON", "USING", "GROUP", "ORDER", "LIMIT", "OFFSET", "HAVING", "WINDOW", "UNION", "EXCEPT",
        "INTERSECT", "FETCH", "FOR",
    }
)  # fmt: skip


class GuardError(AssertionError):
    pass


@dataclass(frozen=True)
class Token:
    kind: str
    value: str


_TOKEN = re.compile(
    r"""
    (?P<ws>\s+)
   |(?P<comment>--[^\n]*|/\*.*?\*/)
   |(?P<string>'(?:[^']|'')*')
   |(?P<param>%\([A-Za-z_][A-Za-z0-9_]*\)s)
   |(?P<word>[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)
   |(?P<number>[0-9]+(?:\.[0-9]+)?)
   |(?P<op>::|->>|->|<=|>=|<>|!=|[-+*/<>=(),\[\]|])
    """,
    re.VERBOSE | re.DOTALL,
)


def tokenize(statement: str) -> list[Token]:
    """Words, strings (content dropped), params and operators. Comments and space are dropped.
    A quoted identifier, a dollar quote, a `;` or any other character is unclassifiable: it fails."""
    tokens: list[Token] = []
    position = 0
    while position < len(statement):
        match = _TOKEN.match(statement, position)
        if match is None:
            raise GuardError(f"cannot classify the SQL at {statement[position : position + 20]!r}")
        kind = match.lastgroup or ""
        if kind == "string":
            tokens.append(Token("string", "''"))
        elif kind not in ("ws", "comment"):
            tokens.append(Token(kind, match.group()))
        position = match.end()
    return tokens


def _word(token: Token, *values: str) -> bool:
    return token.kind == "word" and token.value.upper() in values


def _skip_parens(tokens: list[Token], start: int) -> int:
    """Index after the `)` matching the `(` at `start`."""
    depth = 0
    for index in range(start, len(tokens)):
        if tokens[index].value == "(":
            depth += 1
        elif tokens[index].value == ")":
            depth -= 1
            if depth == 0:
                return index + 1
    raise GuardError("unbalanced parentheses")


def _ctes(tokens: list[Token]) -> set[str]:
    names = set()
    for i in range(1, len(tokens) - 2):
        previous, name, as_, paren = tokens[i - 1], tokens[i], tokens[i + 1], tokens[i + 2]
        opens_cte = _word(previous, "WITH") or (previous.value == "," and tokens[i - 2].value == ")")
        if opens_cte and name.kind == "word" and _word(as_, "AS") and paren.value == "(":
            names.add(name.value.lower())
    return names


def _check_sources(tokens: list[Token], start: int, ctes: set[str]) -> None:
    index = start
    while True:
        if index >= len(tokens):
            raise GuardError("a FROM or JOIN with no source")
        token = tokens[index]
        name = token.value.lower()
        if (
            token.kind == "word"
            and name == "unnest"
            and index + 1 < len(tokens)
            and tokens[index + 1].value == "("
        ):
            index = _skip_parens(tokens, index + 1)
        elif token.kind == "word" and (name in READ_SOURCES or name in ctes):
            index += 1
        else:
            raise GuardError(f"cannot classify the source {token.value!r} after FROM or JOIN")
        if index < len(tokens) and _word(tokens[index], "AS"):
            index += 1
        if (
            index < len(tokens)
            and tokens[index].kind == "word"
            and tokens[index].value.upper() not in CLAUSE_WORDS
        ):
            index += 1  # alias
        if index < len(tokens) and tokens[index].value == "(":
            index = _skip_parens(tokens, index)  # column list
        if index < len(tokens) and tokens[index].value == ",":
            index += 1
            continue
        return


def check_statement(statement: str) -> str:
    """'read' or 'write', or GuardError."""
    tokens = tokenize(statement)
    if not tokens:
        raise GuardError("an empty statement")
    words = [token.value.upper() for token in tokens if token.kind == "word"]
    forbidden = sorted(FORBIDDEN_WORDS.intersection(words))
    if forbidden:
        raise GuardError(f"forbidden word(s) {forbidden}")
    if _word(tokens[0], "SELECT", "WITH"):
        kind = "read"
        if "INSERT" in words:
            raise GuardError("a read statement holds an INSERT")
    elif _word(tokens[0], "INSERT") and len(tokens) > 2 and _word(tokens[1], "INTO"):
        kind = "write"
        if words.count("INSERT") != 1:
            raise GuardError("more than one INSERT")
        if tokens[2].value.lower() not in WRITE_TARGETS:
            raise GuardError(f"INSERT INTO {tokens[2].value!r} is outside the ml write allowlist")
    else:
        raise GuardError(f"a statement must start with SELECT, WITH or INSERT INTO, not {tokens[0].value!r}")
    ctes = _ctes(tokens)
    for index, token in enumerate(tokens):
        if _word(token, "FROM", "JOIN"):
            _check_sources(tokens, index + 1, ctes)
        if token.kind == "word" and "." in token.value:
            schema = token.value.split(".", 1)[0].lower()
            name = token.value.lower()
            if schema in SCHEMAS and name not in READ_SOURCES | WRITE_TARGETS:
                raise GuardError(f"{token.value!r} is not an allowed relation")
    return kind


def sql_constants(source: str) -> dict[str, str]:
    """The `*_SQL` constants of sql.py. Anything but a docstring or a plain string
    literal assigned at module level fails."""
    constants: dict[str, str] = {}
    for index, node in enumerate(ast.parse(source).body):
        if index == 0 and isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue
        if not (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            raise GuardError(f"sql.py line {node.lineno}: only plain string literals may live here")
        name = node.targets[0].id
        if not name.endswith("_SQL"):
            raise GuardError(f"sql.py line {node.lineno}: {name} does not end in _SQL")
        constants[name] = node.value.value
    return constants


def check_gateway(source: str, constants: set[str]) -> int:
    """Every execute-like call passes `sql.<NAME>` from bms_ml.db. Returns the count of such calls."""
    tree = ast.parse(source)
    aliases = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "bms_ml.db":
            aliases.update(alias.asname or alias.name for alias in node.names if alias.name == "sql")
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [node.module or ""] if isinstance(node, ast.ImportFrom) else [a.name for a in node.names]
            imported = (
                [f"{node.module}.{a.name}" for a in node.names] if isinstance(node, ast.ImportFrom) else []
            )
            if any(n.startswith("psycopg.sql") for n in names + imported):
                raise GuardError("gateway.py imports psycopg.sql: statements may not be composed")
    if aliases != {"sql"}:
        raise GuardError("gateway.py must import its statements as `from bms_ml.db import sql`")
    calls = 0
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        if node.func.attr == "copy" and node.args:
            raise GuardError(f"gateway.py line {node.lineno}: COPY is not allowed")
        if node.func.attr not in ("execute", "executemany", "stream"):
            continue
        calls += 1
        first = node.args[0] if node.args else None
        if not (
            isinstance(first, ast.Attribute)
            and isinstance(first.value, ast.Name)
            and first.value.id == "sql"
            and first.attr in constants
        ):
            raise GuardError(
                f"gateway.py line {node.lineno}: {node.func.attr} must pass a sql.<NAME> constant"
            )
    return calls


def psycopg_importers(files: dict[str, str]) -> set[str]:
    importers = set()
    for name, source in files.items():
        for node in ast.walk(ast.parse(source)):
            modules = []
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                modules = [node.module or ""]
            if any(module == "psycopg" or module.startswith("psycopg.") for module in modules):
                importers.add(name)
    return importers


def source_files() -> dict[str, str]:
    return {path.relative_to(SRC).as_posix(): path.read_text("utf-8") for path in sorted(SRC.rglob("*.py"))}


def check_tree(files: dict[str, str]) -> dict[str, str]:
    """The whole guard over a {relative path: source} map. Returns statement name -> kind."""
    importers = psycopg_importers(files)
    if importers - {"db/gateway.py"}:
        raise GuardError(
            f"only db/gateway.py may import psycopg, not {sorted(importers - {'db/gateway.py'})}"
        )
    constants = sql_constants(files["db/sql.py"])
    kinds = {name: check_statement(text) for name, text in constants.items()}
    check_gateway(files["db/gateway.py"], set(constants))
    return kinds
