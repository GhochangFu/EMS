import pytest

from bms_ml.config import ConfigError, config_hash, load_config
from bms_ml.targets import DEFAULT_TARGETS, Target

DSN = "postgres://bms_fleet:pa55-w0rd-value@db.internal:5432/bms"


def env(**overrides: str) -> dict[str, str]:
    base = {"DATABASE_URL_FLEET": DSN}
    base.update(overrides)
    return base


def test_defaults():
    config = load_config(env())
    assert config.database_url_fleet == DSN
    assert config.interval_seconds == 3600
    assert config.cycle_timeout_seconds == 900
    assert config.forecast_horizon_hours == 48
    assert config.context_hours == 2016
    assert config.forecast_targets == DEFAULT_TARGETS
    assert config.model_dir == "/opt/bms-ml/model"
    assert config.torch_threads is None
    assert config.health_port == 4200
    assert config.log_level == "info"


def test_reads_every_variable():
    config = load_config(
        env(
            ML_INTERVAL_SECONDS="900",
            ML_CYCLE_TIMEOUT_SECONDS="840",
            ML_FORECAST_HORIZON_HOURS="64",
            ML_CONTEXT_HOURS="336",
            ML_FORECAST_TARGETS="water/pump/flow",
            ML_MODEL_DIR="/tmp/model",
            ML_TORCH_THREADS="2",
            ML_HEALTH_PORT="1024",
            LOG_LEVEL="DEBUG",
        )
    )
    assert config.interval_seconds == 900
    assert config.cycle_timeout_seconds == 840
    assert config.forecast_horizon_hours == 64
    assert config.context_hours == 336
    assert config.forecast_targets == (Target("water", "pump", "flow"),)
    assert config.model_dir == "/tmp/model"
    assert config.torch_threads == 2
    assert config.health_port == 1024
    assert config.log_level == "debug"


def test_database_url_fleet_is_required_with_no_fallback():
    with pytest.raises(ConfigError, match="DATABASE_URL_FLEET"):
        load_config({"DATABASE_URL": DSN})
    with pytest.raises(ConfigError, match="DATABASE_URL_FLEET"):
        load_config({"DATABASE_URL_FLEET": "   "})


BOUNDS = [
    ("ML_INTERVAL_SECONDS", "899"),
    ("ML_INTERVAL_SECONDS", "1000"),  # not a multiple of 900
    ("ML_INTERVAL_SECONDS", "4500"),  # a multiple of 900 that does not divide a day
    ("ML_INTERVAL_SECONDS", "86401"),
    ("ML_CYCLE_TIMEOUT_SECONDS", "59"),
    ("ML_CYCLE_TIMEOUT_SECONDS", "3541"),  # interval - 60 is the ceiling
    ("ML_FORECAST_HORIZON_HOURS", "0"),
    ("ML_FORECAST_HORIZON_HOURS", "65"),
    ("ML_CONTEXT_HOURS", "335"),
    ("ML_CONTEXT_HOURS", "2049"),
    ("ML_TORCH_THREADS", "0"),
    ("ML_TORCH_THREADS", "65"),
    ("ML_HEALTH_PORT", "1023"),
    ("ML_HEALTH_PORT", "65536"),
    ("ML_HEALTH_PORT", "not-a-number"),
    ("ML_CONTEXT_HOURS", "2016.5"),
    ("LOG_LEVEL", "verbose"),
    ("ML_FORECAST_TARGETS", "bad"),
]


@pytest.mark.parametrize(("name", "value"), BOUNDS)
def test_each_bound_refuses_naming_the_variable_never_the_value(name, value):
    with pytest.raises(ConfigError) as err:
        load_config(env(**{name: value}))
    message = str(err.value)
    assert name in message
    assert value not in message.replace(name, "")


def test_bounds_accept_their_edges():
    load_config(env(ML_INTERVAL_SECONDS="86400", ML_CYCLE_TIMEOUT_SECONDS="86340"))
    load_config(env(ML_CYCLE_TIMEOUT_SECONDS="60"))
    load_config(env(ML_FORECAST_HORIZON_HOURS="1", ML_CONTEXT_HOURS="2048", ML_TORCH_THREADS="64"))
    load_config(env(ML_HEALTH_PORT="65535"))


def test_repr_and_str_do_not_carry_the_dsn():
    config = load_config(env())
    for text in (repr(config), str(config), f"{config}", f"{config!r}"):
        assert "pa55-w0rd-value" not in text
        assert "db.internal" not in text
        assert "<redacted>" in text


def test_a_dsn_error_does_not_echo_the_dsn():
    with pytest.raises(ConfigError) as err:
        load_config({"DATABASE_URL_FLEET": DSN, "ML_INTERVAL_SECONDS": "1"})
    assert "pa55-w0rd-value" not in str(err.value)


HASH_INPUTS = dict(
    model_name="fake",
    model_version="1",
    thresholds={"a": 1, "b": 0.8},
    quantiles=(0.1, 0.5, 0.9),
    package_versions={"bms-ml": "0.1.0", "numpy": "2.5.4"},
)


def test_config_hash_is_hex_sha256_and_stable_across_key_order():
    config = load_config(env())
    first = config_hash(config, **HASH_INPUTS)
    assert len(first) == 64 and all(c in "0123456789abcdef" for c in first)
    reordered = dict(HASH_INPUTS)
    reordered["thresholds"] = {"b": 0.8, "a": 1}
    reordered["package_versions"] = {"numpy": "2.5.4", "bms-ml": "0.1.0"}
    assert config_hash(config, **reordered) == first


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("model_name", "other"),
        ("model_version", "2"),
        ("thresholds", {"a": 2, "b": 0.8}),
        ("quantiles", (0.1, 0.5, 0.95)),
        ("package_versions", {"bms-ml": "0.1.1", "numpy": "2.5.4"}),
    ],
)
def test_config_hash_changes_with_each_input(field, value):
    config = load_config(env())
    changed = dict(HASH_INPUTS)
    changed[field] = value
    assert config_hash(config, **changed) != config_hash(config, **HASH_INPUTS)


@pytest.mark.parametrize(
    "override",
    [
        {"ML_FORECAST_HORIZON_HOURS": "24"},
        {"ML_CONTEXT_HOURS": "1000"},
        {"ML_FORECAST_TARGETS": "water/pump/flow"},
    ],
)
def test_config_hash_changes_with_the_config(override):
    base = config_hash(load_config(env()), **HASH_INPUTS)
    assert config_hash(load_config(env(**override)), **HASH_INPUTS) != base


def test_config_hash_ignores_the_dsn_and_the_schedule():
    base = config_hash(load_config(env()), **HASH_INPUTS)
    other = load_config(
        {"DATABASE_URL_FLEET": "postgres://x@y/z", "ML_INTERVAL_SECONDS": "7200", "ML_HEALTH_PORT": "5000"}
    )
    assert config_hash(other, **HASH_INPUTS) == base
