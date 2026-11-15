"""The guard ADR 0135 decision 3 demands (plan T3.7).

`bms_fleet` can read and write far more than the scorer needs (DML on all of
`bms.*` and `telemetry.*`), and the owed `bms_ml` role does not exist yet. So
the scorer's SQL itself is the contract: reads of its named inputs, inserts
into `ml.*`, nothing else. This guard holds that, statically, with the syntax
tree and a small tokenizer rather than a file-wide regex:

1. All SQL lives in `db/sql.py`. Only `db/gateway.py` imports psycopg, and no
   module imports another driver. Every database call in the tree is
   `<cursor>.execute(sql.<NAME>, ...)` in `db/gateway.py`: no other execute-like
   attribute anywhere, no `getattr`/`setattr`/`import_module`/`__import__`, no
   assignment to `sql.<NAME>`.
2. Each statement is a read (`SELECT`, or `WITH` as its first word only) or one
   `INSERT INTO`, with no forbidden word (`TABLE` included) and no second
   statement.
3. A write targets one of the three `ml` tables; a read holds no `INSERT`.
4. Every source after `FROM` / `JOIN` (comma lists included) is a CTE of that
   statement, `unnest(`, or one of READ_SOURCES. A CTE may not be named `pg_*`.
   Every dotted name is an allowed relation or `<alias>.<column>`.
5. Every function call is on ALLOWED_FUNCTIONS: a server function can read a
   relation named in a string (`query_to_xml`), signal a channel
   (`pg_notify`), end other sessions or write a sequence without a forbidden word.
6. Anything the reader cannot classify FAILS rather than passes.

The allowlists are asserted by value in `test_sql_guard.py`, so widening one
(`bms.alarms`, `bms.work_orders`) is a visible diff in two files. That file
runs this guard over the real tree and over "must fail" fixtures, so the
guard's own liveness is tested.
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
        "ml.forecasts",  # the ledger reads a run's first horizon bucket (0157 grants SELECT)
        "pg_namespace",  # preflight: the schema-version marker
        "pg_roles",  # preflight: refuse a superuser
    }
)
WRITE_TARGETS = frozenset({"ml.model_runs", "ml.forecasts", "ml.anomaly_scores"})
ALLOWED_FUNCTIONS = frozenset(
    {"obj_description", "has_table_privilege", "unnest", "min", "max", "count", "date_trunc"}
)
FORBIDDEN_WORDS = frozenset(
    {
        "UPDATE", "DELETE", "TRUNCATE", "MERGE", "DROP", "ALTER", "CREATE", "GRANT", "REVOKE",
        "COPY", "CALL", "DO", "SET", "RESET", "LISTEN", "NOTIFY", "LOCK", "VACUUM", "REFRESH",
        "CONFLICT", "RETURNING", "EXECUTE", "PREPARE", "DECLARE", "IMPORT", "SECURITY", "TABLE",
    }
)  # fmt: skip
# Words that may stand before "(" without being a function call.
PAREN_KEYWORDS = frozenset(
    {"VALUES", "IN", "AND", "OR", "NOT", "AS", "ON", "WHERE", "SELECT", "FROM", "JOIN"}
)
CLAUSE_WORDS = frozenset(
    {
        "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL", "CROSS", "NATURAL", "LATERAL",
        "ON", "USING", "GROUP", "ORDER", "LIMIT", "OFFSET", "HAVING", "WINDOW", "UNION", "EXCEPT",
        "INTERSECT", "FETCH", "FOR",
    }
)  # fmt: skip
DB_ATTRIBUTES = frozenset(
    {
        "execute",
        "executemany",
        "stream",
        "copy",
        "pgconn",
        "exec_",
        "exec_params",
        "send_query",
        "send_query_params",
    }
)
OTHER_DRIVERS = ("psycopg2", "asyncpg", "pg8000", "sqlalchemy")
DYNAMIC_NAMES = frozenset({"__import__", "import_module", "exec", "eval", "setattr"})


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
    """CTE names. WITH is allowed only as the statement's first word, so every CTE is
    visible to the whole statement and cannot shadow a relation in a narrower scope."""
    if any(_word(token, "WITH") for token in tokens[1:]):
        raise GuardError("WITH is allowed only as the first word of a statement")
    names = set()
    for i in range(1, len(tokens) - 2):
        previous, name, as_, paren = tokens[i - 1], tokens[i], tokens[i + 1], tokens[i + 2]
        opens_cte = _word(previous, "WITH") or (previous.value == "," and tokens[i - 2].value == ")")
        if opens_cte and name.kind == "word" and _word(as_, "AS") and paren.value == "(":
            if name.value.lower().startswith("pg_") or "." in name.value:
                raise GuardError(f"a CTE may not be named {name.value!r}")
            names.add(name.value.lower())
    return names


def _check_sources(tokens: list[Token], start: int, ctes: set[str]) -> set[str]:
    """Check one FROM/JOIN source list; return the aliases it declares."""
    aliases: set[str] = set()
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
            if "." in tokens[index].value:
                raise GuardError(f"cannot classify the alias {tokens[index].value!r}")
            aliases.add(tokens[index].value.lower())
            index += 1
        if index < len(tokens) and tokens[index].value == "(":
            index = _skip_parens(tokens, index)  # column list
        if index < len(tokens) and tokens[index].value == ",":
            index += 1
            continue
        return aliases


def _check_calls(tokens: list[Token], kind: str) -> None:
    for index, token in enumerate(tokens[:-1]):
        if token.kind != "word" or tokens[index + 1].value != "(":
            continue
        if token.value.upper() in PAREN_KEYWORDS:
            continue
        if index > 0 and _word(tokens[index - 1], "AS"):
            continue  # an alias's column list
        if kind == "write" and index == 2:
            continue  # INSERT INTO <target> (columns)
        if token.value.lower() not in ALLOWED_FUNCTIONS:
            raise GuardError(f"the function {token.value!r} is not on the allowlist")


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
    aliases: set[str] = set()
    for index, token in enumerate(tokens):
        if _word(token, "FROM", "JOIN"):
            aliases |= _check_sources(tokens, index + 1, ctes)
    for token in tokens:
        if token.kind == "word" and "." in token.value:
            name = token.value.lower()
            prefix, _, rest = name.partition(".")
            if name in READ_SOURCES | WRITE_TARGETS:
                continue
            if (prefix in aliases or prefix in ctes) and "." not in rest:
                continue
            raise GuardError(f"{token.value!r} is not an allowed relation or an alias's column")
    _check_calls(tokens, kind)
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


def _imported_modules(tree: ast.AST) -> list[str]:
    modules: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules += [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            modules += [node.module or ""] + [f"{node.module}.{alias.name}" for alias in node.names]
    return modules


def check_calls(files: dict[str, str], constants: set[str]) -> int:
    """The call-shape half of the guard, over every module. Returns the count of executes."""
    executes = 0
    for path, source in files.items():
        tree = ast.parse(source)
        modules = _imported_modules(tree)
        if path != "db/gateway.py" and any(m == "psycopg" or m.startswith("psycopg.") for m in modules):
            raise GuardError(f"only db/gateway.py may import psycopg, not {path}")
        if any(m == d or m.startswith(d + ".") for m in modules for d in OTHER_DRIVERS):
            raise GuardError(f"{path} imports another database driver")
        if any(m.startswith("psycopg.sql") for m in modules):
            raise GuardError(f"{path} imports psycopg.sql: statements may not be composed")
        allowed: set[int] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and node.id in DYNAMIC_NAMES | (
                {"getattr"} if path.startswith("db/") else set()
            ):
                raise GuardError(f"{path} line {node.lineno}: {node.id} is not allowed here")
            if isinstance(node, ast.Attribute) and node.attr in DYNAMIC_NAMES:
                raise GuardError(f"{path} line {node.lineno}: {node.attr} is not allowed")
            if isinstance(node, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for target in targets:
                    if (
                        isinstance(target, ast.Attribute)
                        and isinstance(target.value, ast.Name)
                        and target.value.id == "sql"
                    ):
                        raise GuardError(f"{path} line {node.lineno}: sql.{target.attr} may not be assigned")
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
                continue
            if node.func.attr == "copy" and not node.args and not node.keywords:
                allowed.add(id(node.func))  # a numpy or dict copy, not COPY
            elif path == "db/gateway.py" and node.func.attr == "execute":
                first = node.args[0] if node.args else None
                if not (
                    isinstance(first, ast.Attribute)
                    and isinstance(first.value, ast.Name)
                    and first.value.id == "sql"
                    and first.attr in constants
                ):
                    raise GuardError(f"{path} line {node.lineno}: execute must pass a sql.<NAME> constant")
                allowed.add(id(node.func))
                executes += 1
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr in DB_ATTRIBUTES and id(node) not in allowed:
                raise GuardError(f"{path} line {node.lineno}: .{node.attr} is not an allowed database call")
    gateway_modules = _imported_modules(ast.parse(files["db/gateway.py"]))
    if "bms_ml.db.sql" not in gateway_modules:
        raise GuardError("gateway.py must import its statements as `from bms_ml.db import sql`")
    return executes


def source_files() -> dict[str, str]:
    return {path.relative_to(SRC).as_posix(): path.read_text("utf-8") for path in sorted(SRC.rglob("*.py"))}


def check_tree(files: dict[str, str]) -> dict[str, str]:
    """The whole guard over a {relative path: source} map. Returns statement name -> kind."""
    constants = sql_constants(files["db/sql.py"])
    kinds = {name: check_statement(text) for name, text in constants.items()}
    check_calls(files, set(constants))
    return kinds
