"""Runs the decision 3 guard (`tests/sql_guard.py`) over the real tree and over must-fail fixtures."""

import pytest

from tests.sql_guard import (
    ALLOWED_FUNCTIONS,
    READ_SOURCES,
    WRITE_TARGETS,
    GuardError,
    check_calls,
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
        "bms.asset_templates", "bms.rtus", "ml.model_runs", "ml.forecasts", "pg_namespace", "pg_roles",
        "ml.anomaly_scores",  # E1.2 plan R10: the anomaly ledger reads a run's scored bucket
    }  # fmt: skip
    assert WRITE_TARGETS == {"ml.model_runs", "ml.forecasts", "ml.anomaly_scores"}
    assert ALLOWED_FUNCTIONS == {
        "obj_description", "has_table_privilege", "unnest", "min", "max", "count", "date_trunc",
        "string_to_array",  # E1.2 plan R10: contributing points into a varchar(128)[] column
    }  # fmt: skip
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
        "ANOMALY_ALREADY_SCORED_SQL": "read",
        "INSERT_MODEL_RUN_SQL": "write",
        "INSERT_FORECASTS_SQL": "write",
        "INSERT_ANOMALY_SCORES_SQL": "write",
    }
    assert check_calls(files, set(kinds)) >= len(kinds)


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
    # The security review's bypasses of the first guard, each of which passed it.
    "a relation named in a string": (
        "SELECT query_to_xml('SELECT password_hash FROM bms.users', true, false, '') FROM pg_roles",
        "function 'query_to_xml'",
    ),
    "notify through a function": ("SELECT pg_notify('bms_alarms', '{}')", "function 'pg_notify'"),
    "end other sessions": (
        "SELECT pg_terminate_backend(1) FROM pg_roles",
        "function 'pg_terminate_backend'",
    ),
    "write a sequence": (
        "INSERT INTO ml.model_runs (id) VALUES (nextval('bms.some_seq'))",
        "function 'nextval'",
    ),
    "large object": (
        "INSERT INTO ml.model_runs (id) VALUES (lo_from_bytea(0, ''))",
        "function 'lo_from_bytea'",
    ),
    "TABLE read": ("SELECT ARRAY(TABLE pg_stat_activity)", "forbidden word"),
    "unknown schema": (
        "SELECT _timescaledb_catalog.hypertable.id FROM pg_roles r",
        "not an allowed relation or an alias's column",
    ),
    "a CTE shadowing a catalog in a subquery": (
        "SELECT 1 FROM pg_roles r WHERE 1 IN (WITH pg_authid AS (SELECT 1) SELECT 1 FROM pg_authid)",
        "WITH is allowed only as the first word",
    ),
    "a pg_ CTE": ("WITH pg_authid AS (SELECT 1) SELECT 1 FROM pg_authid", "may not be named 'pg_authid'"),
    "an unknown function": ("SELECT pg_sleep(1)", "function 'pg_sleep'"),
    # E1.2a: the anomaly write is insert-only, and the two new allowlist names open nothing else.
    "update an anomaly score": ("UPDATE ml.anomaly_scores SET score = 0", "forbidden word"),
    "delete an anomaly score": ("DELETE FROM ml.anomaly_scores", "forbidden word"),
    "an anomaly-shaped insert into alarms": (
        "INSERT INTO bms.alarms (organization_id, asset_id) SELECT a.organization_id, v.asset_id "
        "FROM unnest(%(asset_ids)s::uuid[]) AS v(asset_id) JOIN bms.assets a ON a.id = v.asset_id",
        "outside the ml write allowlist",
    ),
    "a ledger joined to work orders": (
        "SELECT 1 FROM ml.anomaly_scores s JOIN bms.work_orders w ON w.asset_id = s.asset_id",
        "cannot classify the source 'bms.work_orders'",
    ),
    "string_to_array over a relation name": (
        "SELECT string_to_array(x, ',') FROM bms.work_orders",
        "cannot classify the source 'bms.work_orders'",
    ),
}


@pytest.mark.parametrize(("statement", "reason"), BAD_STATEMENTS.values(), ids=BAD_STATEMENTS.keys())
def test_a_bad_statement_fails_for_its_reason(statement, reason):
    with pytest.raises(GuardError, match=reason):
        check_statement(statement)


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
    "the anomaly insert retargeted to alarms": (
        "db/sql.py",
        "INSERT INTO ml.anomaly_scores",
        "INSERT INTO bms.alarms",
        "outside the ml write allowlist",
    ),
    "the anomaly ledger reading work orders": (
        "db/sql.py",
        "FROM ml.anomaly_scores s",
        "FROM bms.work_orders s",
        "cannot classify the source 'bms.work_orders'",
    ),
    "raw telemetry in sql.py": (
        "db/sql.py",
        "FROM telemetry.point_values_1h h\nJOIN",
        "FROM telemetry.point_values h\nJOIN",
        "cannot classify the source",
    ),
    # The security review's call-shape bypasses of the first guard.
    "getattr in the gateway": (
        "db/gateway.py",
        EXECUTE,
        'getattr(cursor, "execute")("DELETE FROM bms.alarms")',
        "getattr is not allowed",
    ),
    "a bound-method alias": (
        "db/gateway.py",
        EXECUTE,
        'run = cursor.execute\n            run("DELETE FROM bms.alarms")',
        r"\.execute is not an allowed database call",
    ),
    "the raw libpq connection": (
        "db/gateway.py",
        EXECUTE,
        'self._conn.pgconn.exec_(b"DELETE FROM bms.alarms")',
        r"\.(pgconn|exec_) is not an allowed database call",
    ),
    "execute outside the gateway": (
        "scorer.py",
        "def package_versions",
        'def _x(db):\n    db._conn.execute("UPDATE bms.assets SET name = 1")\n\n\ndef package_versions',
        r"\.execute is not an allowed database call",
    ),
    "another driver": (
        "readiness.py",
        "from dataclasses import dataclass\n",
        "from dataclasses import dataclass\nimport psycopg2\n",
        "another database driver",
    ),
    "a dynamic import": (
        "scorer.py",
        "def package_versions",
        'def _x():\n    import importlib\n    importlib.import_module("psycopg")\n\n\ndef package_versions',
        "import_module is not allowed",
    ),
    "a statement reassigned": (
        "db/gateway.py",
        "EXPECTED_ML_SCHEMA_VERSION = 1\n",
        'EXPECTED_ML_SCHEMA_VERSION = 1\nsql.HISTORY_SQL = "DELETE FROM bms.alarms"\n',
        "may not be assigned",
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
