"""The integration gate (plan T3.10), with the repo's asymmetric rule (AGENTS.md §4.6).

ML_TEST_DATABASE_URL_SUPERUSER and ML_TEST_DATABASE_URL_FLEET unset: skip
locally, FAIL under CI, because a green CI run that skipped the database suite
asserts nothing. Set: a claim that the database exists, so a failed connection
fails everywhere. Both must point at a database named exactly `bms_ml_test`:
the fixture deletes and plants rows, so it refuses any other database.

Local recipe (apps/ml/README.md): a TimescaleDB with `bms_ml_test`, then
`pnpm --filter @bms/db roles`, `pnpm db:migrate`, `pnpm db:seed` against it.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import psycopg
import pytest

from tests.integration.fixture import REQUIRED_DATABASE, Planted, plant

SUPERUSER_VAR = "ML_TEST_DATABASE_URL_SUPERUSER"
FLEET_VAR = "ML_TEST_DATABASE_URL_FLEET"


@pytest.fixture(scope="session")
def database_urls() -> tuple[str, str]:
    superuser = os.environ.get(SUPERUSER_VAR, "").strip()
    fleet = os.environ.get(FLEET_VAR, "").strip()
    if not (superuser and fleet):
        if os.environ.get("CI"):
            pytest.fail(
                f"{SUPERUSER_VAR} and {FLEET_VAR} must be set under CI: "
                "a green run that skipped the database suite asserts nothing",
                pytrace=False,
            )
        pytest.skip(f"{SUPERUSER_VAR} / {FLEET_VAR} unset: the integration suite is skipped locally")
    for url in (superuser, fleet):
        with psycopg.connect(url, connect_timeout=10) as conn:
            name = conn.execute("SELECT current_database()").fetchone()[0]
        if name != REQUIRED_DATABASE:
            pytest.fail(f"the integration suite runs only against {REQUIRED_DATABASE!r}", pytrace=False)
    return superuser, fleet


@pytest.fixture(scope="session")
def fleet_url(database_urls: tuple[str, str]) -> str:
    return database_urls[1]


@pytest.fixture(scope="session")
def superuser(database_urls: tuple[str, str]) -> Iterator[psycopg.Connection]:
    with psycopg.connect(database_urls[0], autocommit=True) as conn:
        yield conn


@pytest.fixture(scope="session")
def planted(superuser: psycopg.Connection) -> Planted:
    return plant(superuser)
