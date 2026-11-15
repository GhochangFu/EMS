"""Unit half of the gateway: the preflight decisions. The SQL itself runs in tests/integration."""

import pytest

from bms_ml.db.gateway import EXPECTED_ML_SCHEMA_VERSION, PreflightError, check_role, parse_marker


def test_expected_version_is_one():
    assert EXPECTED_ML_SCHEMA_VERSION == 1


def test_marker_absent_schema():
    with pytest.raises(PreflightError, match="schema ml is absent"):
        parse_marker(None)


@pytest.mark.parametrize(
    "marker", [None, "", "bms-ml-schema-version=", "bms-ml-schema-version=x", "version=1"]
)
def test_marker_missing_or_malformed(marker):
    with pytest.raises(PreflightError, match="marker"):
        parse_marker({"marker": marker})


def test_marker_below_expected_names_the_versions():
    with pytest.raises(PreflightError, match="version 0, below the expected 1"):
        parse_marker({"marker": "bms-ml-schema-version=0"})


@pytest.mark.parametrize(
    ("marker", "version"), [("bms-ml-schema-version=1", 1), ("bms-ml-schema-version=7", 7)]
)
def test_marker_at_or_above_expected_passes(marker, version):
    # Additive, forward-only migrations keep an older scorer valid on a newer schema (plan R2).
    assert parse_marker({"marker": marker}) == version


FLEET = {
    "role_name": "bms_fleet",
    "is_superuser": False,
    "can_insert_runs": True,
    "can_insert_forecasts": True,
    "can_update_forecasts": False,
}


def test_bms_fleet_passes():
    assert check_role(dict(FLEET)) == "bms_fleet"


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"is_superuser": True}, "superuser"),
        ({"can_insert_runs": False}, "cannot insert"),
        ({"can_insert_forecasts": False}, "cannot insert"),
        ({"can_update_forecasts": True}, "can update ml.forecasts"),
    ],
)
def test_a_role_outside_the_contract_is_refused(change, message):
    with pytest.raises(PreflightError, match=message):
        check_role({**FLEET, **change})


def test_no_role_row_is_refused():
    with pytest.raises(PreflightError):
        check_role(None)
