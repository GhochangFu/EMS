"""Runs the decision 3 guard (`tests/sql_guard.py`) over the real tree and over must-fail fixtures."""

import pytest

from tests.sql_guard import (
    READ_SOURCES,
    WRITE_TARGETS,
    GuardError,
    check_gateway,
    check_statement,
    check_tree,
    source_files,
    sql_constants,
    tokenize,
)

# --- the real tree ---------------------------------------------------------------------


def test_the_allowlists_by_value():
    assert READ_SOURCES == {
        "telemetry.point_values_1h", "telemetry.point_values_1d", "bms.assets", "bms.asset_points",
        "bms.asset_templates", "bms.rtus", "ml.model_runs", "pg_namespace", "pg_roles",
    }  # fmt: skip
    assert WRITE_TARGETS == {"ml.model_runs", "ml.forecasts", "ml.anomaly_scores"}
    assert "bms.alarms" not in READ_SOURCES | WRITE_TARGETS
    assert "bms.work_orders" not in READ_SOURCES | WRITE_TARGETS


def test_the_real_tree_passes_and_the_guard_saw_every_statement():
    files = source_files()
    kinds = check_tree(files)
    assert kinds == {
        "PREFLIGHT_MARKER_SQL": "read",
        "PREFLIGHT_ROLE_SQL": "read",
        "ELIGIBILITY_SQL": "read",
        "HISTORY_SQL": "read",
        "ALREADY_SCORED_SQL": "read",
        "INSERT_MODEL_RUN_SQL": "write",
        "INSERT_FORECASTS_SQL": "write",
    }
    assert check_gateway(files["db/gateway.py"], set(kinds)) >= len(kinds)


def test_no_statement_calls_now():
    for name, text in sql_constants(source_files()["db/sql.py"]).items():
        words = {t.value.lower() for t in tokenize(text) if t.kind == "word"}
        assert not {"now", "current_timestamp", "localtimestamp", "clock_timestamp"} & words, name


# --- must-fail fixtures: the guard's own liveness ----------------------------------------
# Each case names the reason it must fail for, so no case passes by tripping on another rule.

BAD_STATEMENTS = {
    "update": ("UPDATE ml.forecasts SET p50 = 1", "forbidden word"),
    "delete in a cte": ("WITH gone AS (DELETE FROM ml.forecasts) SELECT 1 FROM gone", "forbidden word"),
    "insert into alarms": ("INSERT INTO bms.alarms (id) SELECT 1", "outside the ml write allowlist"),
    "read users": ("SELECT id FROM bms.users", "cannot classify the source 'bms.users'"),
    "comma join to users": (
        "SELECT a.id FROM bms.assets a, bms.users u WHERE u.id = a.id",
        "cannot classify the source 'bms.users'",
    ),
    "on conflict": (
        "INSERT INTO ml.forecasts (asset_id) VALUES (%(a)s) ON CONFLICT DO UPDATE SET p50 = 1",
        "forbidden word",
    ),
    "returning": ("INSERT INTO ml.forecasts (asset_id) VALUES (%(a)s) RETURNING asset_id", "forbidden word"),
    "second statement": (
        "SELECT 1 FROM ml.model_runs; SELECT 2 FROM ml.model_runs",
        "cannot classify the SQL",
    ),
    "raw telemetry": ("SELECT value FROM telemetry.point_values", "cannot classify the source"),
    "subquery source": ("SELECT 1 FROM (SELECT id FROM bms.assets) x", "cannot classify the source '\\('"),
    "quoted identifier": ('SELECT 1 FROM "bms"."users"', "cannot classify the SQL"),
    "dollar quote": ("SELECT $$x$$", "cannot classify the SQL"),
    "relation outside FROM": ("SELECT bms.users.id FROM bms.assets a", "not an allowed relation"),
    "insert in a read": (
        "WITH x AS (INSERT INTO ml.forecasts (asset_id) VALUES (%(a)s)) SELECT 1 FROM x",
        "a read statement holds an INSERT",
    ),
    "two inserts": (
        "INSERT INTO ml.forecasts (a) WITH y AS (INSERT INTO ml.model_runs (id) VALUES (%(i)s)) "
        "SELECT 1 FROM y",
        "more than one INSERT",
    ),
    "set role": ("SET ROLE bms_owner", "forbidden word"),
    "copy": ("COPY ml.forecasts TO STDOUT", "forbidden word"),
}


@pytest.mark.parametrize(("statement", "reason"), BAD_STATEMENTS.values(), ids=BAD_STATEMENTS.keys())
def test_a_bad_statement_fails_for_its_reason(statement, reason):
    with pytest.raises(GuardError, match=reason):
        check_statement(statement)


def test_the_guard_does_not_judge_functions():
    # Stated, not hidden: the guard is about relations and verbs. A server-side
    # function call in a read passes it; preflight's superuser refusal is what keeps
    # pg_read_file and its kind out of the scorer's reach.
    assert check_statement("SELECT pg_sleep(1)") == "read"


def _mutated(path: str, old: str, new: str) -> dict[str, str]:
    files = source_files()
    assert old in files[path], f"the mutation anchor is not in {path}"
    files[path] = files[path].replace(old, new, 1)
    return files


EXECUTE = "cursor.execute(sql.HISTORY_SQL, params)"
BAD_TREES = {
    "f-string passed to execute": (
        "db/gateway.py",
        EXECUTE,
        'cursor.execute(f"SELECT {params}", params)',
        "must pass a sql",
    ),
    "literal passed to execute": (
        "db/gateway.py",
        EXECUTE,
        'cursor.execute("SELECT 1", params)',
        "must pass a sql",
    ),
    "concatenation passed to execute": (
        "db/gateway.py",
        EXECUTE,
        'cursor.execute(sql.HISTORY_SQL + " LIMIT 1", params)',
        "must pass a sql",
    ),
    "unknown constant passed to execute": (
        "db/gateway.py",
        EXECUTE,
        "cursor.execute(sql.SOMETHING_ELSE, params)",
        "must pass a sql",
    ),
    "psycopg.sql composition": (
        "db/gateway.py",
        "from psycopg.rows import dict_row\n",
        "from psycopg.rows import dict_row\nfrom psycopg import sql as composed\n",
        "imports psycopg.sql",
    ),
    "psycopg imported in readiness.py": (
        "readiness.py",
        "from dataclasses import dataclass\n",
        "from dataclasses import dataclass\nimport psycopg\n",
        "only db/gateway.py may import psycopg",
    ),
    "update constant in sql.py": (
        "db/sql.py",
        'HISTORY_SQL = """',
        'BAD_SQL = "UPDATE ml.forecasts SET p50 = 0"\n\nHISTORY_SQL = """',
        "forbidden word",
    ),
    "f-string constant in sql.py": (
        "db/sql.py",
        'HISTORY_SQL = """',
        'BAD_SQL = f"SELECT 1 FROM {__name__}"\n\nHISTORY_SQL = """',
        "only plain string literals",
    ),
    "concatenated constant in sql.py": (
        "db/sql.py",
        'HISTORY_SQL = """',
        'BAD_SQL = "SELECT 1 " + "FROM bms.assets"\n\nHISTORY_SQL = """',
        "only plain string literals",
    ),
    "insert into alarms in sql.py": (
        "db/sql.py",
        "INSERT INTO ml.model_runs",
        "INSERT INTO bms.alarms",
        "outside the ml write allowlist",
    ),
    "raw telemetry in sql.py": (
        "db/sql.py",
        "FROM telemetry.point_values_1h h\nJOIN",
        "FROM telemetry.point_values h\nJOIN",
        "cannot classify the source",
    ),
}


@pytest.mark.parametrize(("path", "old", "new", "reason"), BAD_TREES.values(), ids=BAD_TREES.keys())
def test_a_bad_tree_fails_for_its_reason(path, old, new, reason):
    with pytest.raises(GuardError, match=reason):
        check_tree(_mutated(path, old, new))


def test_psycopg_in_the_scorer_fails():
    files = source_files()
    files["scorer.py"] = files.get("scorer.py", "") + "\nimport psycopg\n"
    with pytest.raises(GuardError, match="only db/gateway.py may import psycopg"):
        check_tree(files)
