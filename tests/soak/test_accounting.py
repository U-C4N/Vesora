"""Fast checks of soak accounting; these do not represent a host soak run."""
import importlib.util
import base64
import json
import struct
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("vesora_soak_workload", Path(__file__).with_name("host_workload.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_histogram_quantiles_are_bounded_and_do_not_claim_exact_percentiles():
    histogram = module.Histogram()
    for value in range(1, 1001):
        histogram.add(value)
    result = histogram.result()
    assert result["count"] == 1000 and result["mean_ms"] == 500.5 and result["max_ms"] == 1000
    assert 500 <= result["p50_upper_ms"] < 500 * 2 ** (1 / 8)
    assert 950 <= result["p95_upper_ms"] < 950 * 2 ** (1 / 8)
    assert len(histogram.buckets) == 256
    assert module.Histogram().result()["p95_upper_ms"] is None


def test_workload_checks_every_retained_sample_without_opening_a_host(tmp_path, monkeypatch):
    monkeypatch.setenv("VESORA_SOAK_SECONDS", "6")
    monkeypatch.setenv("VESORA_SOAK_RETENTION", "10")
    monkeypatch.delenv("VESORA_SOAK_WHEEL", raising=False)
    monkeypatch.delenv("VESORA_INSTALLED_PACKAGE", raising=False)
    workload = module.Workload("qt", tmp_path)
    try:
        workload.verify_sources()
        assert workload.figure._host is None and workload.figure._widget is None
        first = workload.curves[0]
        first.set_data(y=[0.] * 10)
        with pytest.raises(AssertionError):
            workload.verify_sources()
    finally:
        workload.figure.close()


def test_rejects_duration_without_time_for_freeze_resume(tmp_path, monkeypatch):
    monkeypatch.setenv("VESORA_SOAK_SECONDS", "6")
    monkeypatch.setenv("VESORA_SOAK_FREEZE_EVERY", "5")
    monkeypatch.setenv("VESORA_SOAK_FREEZE_HOLD", "2")
    with pytest.raises(ValueError, match="freeze"):
        module.Workload("qt", tmp_path)


def test_displayed_export_rejects_corrupt_interior_value():
    sources, buffers, layers = [], [], []
    for series in range(3):
        data = {}
        for role in ("x", "y"):
            identity = f"{role}{series}"
            values = [float(index) if role == "x" else module.Workload.value(index, series) for index in range(5)]
            sources.append({"id": identity, "dtype": "float64", "shape": [5]})
            buffers.append({"id": identity, "base64": base64.b64encode(struct.pack("<5d", *values)).decode()})
            data[role] = identity
        layers.append({"data": data})
    payload = {"capture": {"source": "displayed", "snapshotId": "held"}, "snapshot": {"sources": sources, "figure": {"layers": layers}}, "buffers": buffers}
    html = lambda: '<script id="vesora-payload">' + json.dumps(payload) + '</script>'
    assert module.validate_displayed_html(html(), "held")["retained_range"] == [0, 4, 5]
    damaged = next(item for item in buffers if item["id"] == "y1")
    values = list(struct.unpack("<5d", base64.b64decode(damaged["base64"])))
    values[1] += 1  # Neither first, middle nor last: sampling those is insufficient.
    damaged["base64"] = base64.b64encode(struct.pack("<5d", *values)).decode()
    with pytest.raises(AssertionError):
        module.validate_displayed_html(html(), "held")
