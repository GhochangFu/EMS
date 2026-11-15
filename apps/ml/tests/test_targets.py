import pytest

from bms_ml.targets import DEFAULT_TARGETS, MAX_TARGETS, Target, TargetError, parse_targets


def test_default_targets_are_the_amendment_2_list():
    assert DEFAULT_TARGETS == (
        Target("facility", "cold_room", "cold_room_temp_c"),
        Target("electrical", "energy_meter", "kw"),
    )


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_empty_means_the_default(raw):
    assert parse_targets(raw) == DEFAULT_TARGETS


def test_parses_a_list_and_trims_spaces_around_entries():
    assert parse_targets(" facility/cold_room/cold_room_temp_c , water/pump/flow_m3h ") == (
        Target("facility", "cold_room", "cold_room_temp_c"),
        Target("water", "pump", "flow_m3h"),
    )


@pytest.mark.parametrize(
    "raw",
    [
        "facility/cold_room",  # two parts
        "facility/cold_room/temp/extra",  # four parts
        "Facility/cold_room/temp",  # upper case
        "facility/cold-room/temp",  # hyphen
        "facility/cold room/temp",  # space inside a part
        "facility//temp",  # empty part
        "facility/cold_room/" + "x" * 65,  # part longer than 64
        "facility/cold_room/temp,",  # trailing empty entry
        "facility/cold_room/temp;drop",  # punctuation
    ],
)
def test_refuses_a_malformed_entry(raw):
    with pytest.raises(TargetError) as err:
        parse_targets(raw)
    assert "ML_FORECAST_TARGETS" in str(err.value)


def test_refuses_a_duplicate():
    with pytest.raises(TargetError, match="duplicate"):
        parse_targets("water/pump/flow,water/pump/flow")


def test_count_cap():
    ok = ",".join(f"water/pump/p{i}" for i in range(MAX_TARGETS))
    assert len(parse_targets(ok)) == MAX_TARGETS
    with pytest.raises(TargetError, match="at most"):
        parse_targets(ok + ",water/pump/one_more")


def test_error_never_echoes_the_value():
    with pytest.raises(TargetError) as err:
        parse_targets("SECRET_LOOKING/value")
    assert "SECRET_LOOKING" not in str(err.value)
