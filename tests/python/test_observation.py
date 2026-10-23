"""Protocol-8 meaning and accepted observations bind one owned numeric capture."""
import base64
import copy
import importlib
import json
import re
import struct
from array import array
from pathlib import Path

import pytest

import vesora as vs
from vesora.observation import validate_figure_metadata, validate_observation, validate_source_semantics


@pytest.fixture
def template(tmp_path, monkeypatch):
    module = importlib.import_module("vesora.html")
    path = tmp_path / "standalone.html"
    path.write_text('<!doctype html><script id="vesora-payload" type="application/json">__VESORA_PAYLOAD_JSON__</script>', encoding="utf-8")
    monkeypatch.setattr(module, "_TEMPLATE", path)
    return module


def decode(document):
    return json.loads(re.search(r'<script[^>]*>(.*?)</script>', document, re.S).group(1))


def accepted(fig):
    snapshot = fig.snapshot()
    snapshot["figure"]["protocolVersion"] = 8
    record = {"schemaVersion": 1, "source": "accepted", "capturedAt": "2026-10-23T10:00:00.000Z",
              "sourceVersions": [{"id": item["id"], "version": item["version"]} for item in snapshot["sources"]],
              "streams": [], "representation": {"status": "not-evaluated"}}
    snapshot["figure"]["observation"] = record
    return snapshot, record


def test_semantics_patch_clone_and_monotonic_protocol():
    fig = vs.Figure()
    line = fig.plot([0, 1], [273, 274])
    declaration = {"x": {"quantity": "time", "unit": "s"}, "y": {"name": "Temperature", "unit": "K",
        "origin": {"datasetId": "experiment-17", "field": "temperature"},
        "transforms": [{"execution": "external", "name": "calibration", "parameters": {"gain": 1.2, "__proto__": "inert", "enabled": True, "missing": None}}]}}
    assert line.set_semantics(declaration) is line
    declaration["y"]["transforms"][0]["parameters"]["gain"] = 999
    result = line.get_semantics()
    assert result["y"]["transforms"][0]["parameters"]["gain"] == 1.2
    result["x"]["unit"] = "hours"
    assert line.get_semantics()["x"]["unit"] == "s"
    assert fig.snapshot()["figure"]["protocolVersion"] == 8
    line.set_semantics({"y": {"unit": "degC"}})
    assert line.get_semantics() == {"x": {"quantity": "time", "unit": "s"}, "y": {"unit": "degC"}}
    line.set_semantics({"y": None})
    assert list(line.get_semantics()) == ["x"]
    line.set_semantics({"x": None})
    assert "semantics" not in fig.snapshot()["figure"]
    assert fig.snapshot()["figure"]["protocolVersion"] == 8


@pytest.mark.parametrize("patch", [
    {"unknown": {"unit": "s"}}, {"y": {}}, {"y": {"unit": None}}, {"y": {"unit": " "}},
    {"y": {"unit": "x" * 257}}, {"y": {"name": "🌌" * 129}}, {"y": {"label": "unsupported"}},
    {"y": {"origin": {"field": "missing dataset"}}},
    {"y": {"transforms": [{"execution": "javascript", "name": "alert"}]}},
    {"y": {"transforms": [{"execution": "external", "name": "f", "parameters": {"x": float("nan")}}]}},
    {"y": {"transforms": [{"execution": "external", "name": "f", "parameters": {"x": [1]}}]}},
    {"y": {"transforms": [{"execution": "external", "name": "f"}] * 17}},
])
def test_invalid_patches_preserve_scene_bytes_and_publication(patch):
    fig = vs.Figure()
    layer = fig.plot([0, 1], [10, 20])
    before = fig.snapshot()
    data = [fig._data_bytes(item["id"], item["version"]) for item in before["sources"]]
    published = []
    fig._listeners.append(lambda: published.append(True))
    with pytest.raises(ValueError):
        layer.set_semantics({"x": {"unit": "s"}, **patch})
    assert fig.snapshot() == before
    assert [fig._data_bytes(item["id"], item["version"]) for item in before["sources"]] == data
    assert published == []


def test_nonjson_cycles_subclasses_and_parameter_bounds_reject():
    cyclic = {}
    cyclic["transforms"] = [cyclic]
    class Custom(dict):
        pass
    invalid = [cyclic, Custom(unit="s"), {"transforms": [{"execution": "external", "name": "f", "parameters": {"x": lambda: 1}}]},
               {"transforms": [{"execution": "external", "name": "f", "parameters": {str(i): i for i in range(33)}}]},
               {"transforms": [{"execution": "external", "name": "f", "parameters": {"a" * 65: 1}}]},
               {"transforms": [{"execution": "external", "name": "f", "parameters": {"x": "a" * 1025}}]},
               {"transforms": [{"execution": "external", "name": "f", "parameters": {"x": 10**400}}]}]
    for declaration in invalid:
        with pytest.raises(ValueError):
            validate_source_semantics(declaration)
    assert validate_source_semantics({"name": "🌌" * 128})["name"] == "🌌" * 128


def test_shared_source_conflict_rejected_and_last_reference_cleanup():
    fig = vs.Figure()
    layer = fig.plot([0, 1], [10, 20])
    old_y = layer._spec()["data"]["y"]
    layer._spec()["data"]["y"] = layer._spec()["data"]["x"]
    fig._sources.pop(old_y)
    before = fig.snapshot()
    with pytest.raises(ValueError, match="Aliased"):
        layer.set_semantics({"x": {"unit": "s"}, "y": {"unit": "K"}})
    assert fig.snapshot() == before
    boolean = {"transforms": [{"execution": "external", "name": "calibration", "parameters": {"value": True}}]}
    numeric = {"transforms": [{"execution": "external", "name": "calibration", "parameters": {"value": 1}}]}
    with pytest.raises(ValueError, match="Aliased"):
        layer.set_semantics({"x": boolean, "y": numeric})
    assert fig.snapshot() == before
    equivalent = copy.deepcopy(numeric)
    equivalent["transforms"][0]["parameters"]["value"] = 1.0
    layer.set_semantics({"x": numeric, "y": equivalent})
    layer.set_semantics({"x": {"unit": "s"}, "y": {"unit": "s"}})
    peer = fig.plot([0, 1], [5, 6])
    old_peer_x = peer._spec()["data"]["x"]
    peer._spec()["data"]["x"] = layer._spec()["data"]["x"]
    fig._sources.pop(old_peer_x)
    layer.remove()
    assert peer.get_semantics() == {"x": {"unit": "s"}}
    peer.remove()
    assert "semantics" not in fig.snapshot()["figure"]


def test_streaming_updates_preserve_semantics_and_capture_retained_window(template):
    fig = vs.Figure()
    line = fig.plot(array("f", [0, 1, 2]), array("f", [10, 11, 12])).enable_streaming(max_points=3)
    line.set_semantics({"x": {"unit": "s"}, "y": {"unit": "K"}})
    line.append_data(x=array("f", [3, 4]), y=array("f", [13, 14]))
    before = fig.snapshot()
    envelope = decode(fig.to_html(observation=True))
    record = envelope["snapshot"]["figure"]["observation"]
    assert record["source"] == "accepted"
    assert record["representation"] == {"status": "not-evaluated"}
    assert record["capturedAt"] == envelope["capture"]["capturedAt"]
    assert record["sourceVersions"] == [{"id": source["id"], "version": source["version"]} for source in before["sources"]]
    assert record["streams"] == [{"layerId": line.id, "streamId": fig._streams[line.id]["streamId"], "revision": 1, "sequenceStart": 2, "sequenceEndExclusive": 5}]
    assert "revision" not in record and "id" not in record
    assert fig.snapshot() == before and fig.get_observation() is None
    x_id = line._spec()["data"]["x"]
    x_bytes = next(item["base64"] for item in envelope["buffers"] if item["id"] == x_id)
    assert base64.b64decode(x_bytes) == struct.pack("<3f", 2, 3, 4)
    assert fig._host is fig._window is fig._widget is None
    line.set_data(array("f", [20, 21]), array("f", [30, 31]))
    assert line.get_semantics() == {"x": {"unit": "s"}, "y": {"unit": "K"}}
    assert record["streams"][0]["sequenceEndExclusive"] == 5


def test_capture_metadata_and_bytes_detach_before_serialization(template, monkeypatch):
    fig = vs.Figure()
    line = fig.plot([0, 1], [10, 11]).enable_streaming(max_points=2)
    line.set_semantics({"y": {"unit": "K"}})
    original = template.make_html
    def serialize(snapshot, buffers, *, captured_at):
        line.append_data(x=[2, 3], y=[12, 13])
        line.set_semantics({"y": {"unit": "degC"}})
        return original(snapshot, buffers, captured_at=captured_at)
    monkeypatch.setattr(template, "make_html", serialize)
    envelope = decode(fig.to_html(observation=True))
    source_id = line._spec()["data"]["y"]
    assert envelope["snapshot"]["figure"]["semantics"]["sources"][source_id]["unit"] == "K"
    assert envelope["snapshot"]["figure"]["observation"]["streams"][0]["sequenceEndExclusive"] == 2
    assert base64.b64decode(next(item["base64"] for item in envelope["buffers"] if item["id"] == source_id)) == struct.pack("<2d", 10, 11)


def test_default_export_legacy_and_opt_in_are_separate(template, tmp_path):
    fig = vs.Figure()
    fig.plot([1, 2])
    before = fig.snapshot()
    ordinary = decode(fig.to_html())
    assert ordinary["snapshot"] == before
    observed = decode(fig.to_html(observation=True))
    assert observed["snapshot"]["figure"]["protocolVersion"] == 8
    assert fig.snapshot() == before
    path = fig.save_html(tmp_path / "observation.html", observation=True)
    assert decode(path.read_text())["snapshot"]["figure"]["observation"]["source"] == "accepted"
    with pytest.raises(TypeError):
        fig.to_html(observation="displayed")


def test_semantic_html_text_is_inert_and_snapshot_without_record_retains_semantics(template):
    fig = vs.Figure()
    text = '</script><script>alert("x")</script>&\u2028\u2029 İ 🌌'
    line = fig.plot([1, 2]).set_semantics({"y": {"name": text, "origin": {"datasetId": "remote", "reference": "https://example.invalid/never-fetch"}}})
    html = fig.to_html(observation=True)
    assert text not in html
    assert html.count("<script") == 1
    assert decode(html)["snapshot"]["figure"]["semantics"]["sources"][line._spec()["data"]["y"]]["name"] == text
    assert "observation" not in decode(fig.to_html())["snapshot"]["figure"]


def test_semantics_of_removed_statistics_channels_are_pruned():
    fig = vs.Figure()
    box = fig.boxplot([[1, 2], [3, 4]])
    box.set_semantics({"g0": {"unit": "s"}, "g1": {"unit": "K"}})
    removed = box._spec()["data"]["g1"]
    box.set_data([[5, 6]])
    assert removed not in fig.snapshot()["figure"]["semantics"]["sources"]
    assert box.get_semantics() == {"g0": {"unit": "s"}}


@pytest.mark.parametrize("mutation", [
    lambda s, r: s["figure"].update(protocolVersion=7),
    lambda s, r: r.update(schemaVersion=True),
    lambda s, r: r["sourceVersions"].pop(),
    lambda s, r: r["sourceVersions"].append(copy.deepcopy(r["sourceVersions"][0])),
    lambda s, r: r["sourceVersions"][0].update(id="unknown"),
    lambda s, r: r["sourceVersions"][0].update(version=True),
    lambda s, r: r["sourceVersions"][0].update(version=999),
    lambda s, r: r.update(capturedAt="2026-02-30T00:00:00.000Z"),
    lambda s, r: r.update(capturedAt="2026-10-23T00:00:00+00:00"),
    lambda s, r: r.update(representation={"status": "rendered", "frameId": 1, "layers": []}),
    lambda s, r: r.update(extra=True),
])
def test_record_reference_and_schema_validation_is_pure(mutation):
    fig = vs.Figure()
    fig.plot([0, 1], [2, 3])
    snapshot, record = accepted(fig)
    mutation(snapshot, record)
    before = copy.deepcopy(snapshot)
    with pytest.raises(ValueError):
        validate_figure_metadata(snapshot["figure"], snapshot["sources"])
    assert snapshot == before


def test_record_stream_and_representation_reference_validation():
    fig = vs.Figure()
    line = fig.plot([0, 1], [2, 3])
    snapshot, record = accepted(fig)
    record["source"] = "displayed"
    record["streams"] = [{"layerId": line.id, "streamId": "stream-a", "revision": 0, "sequenceStart": 4, "sequenceEndExclusive": 6}]
    record["representation"] = {"status": "rendered", "frameId": 1, "layers": [{"layerId": line.id, "kind": "line", "total": 2, "visible": 2, "rendered": 2, "exact": True, "method": "all"}]}
    assert validate_observation(record, snapshot["figure"], snapshot["sources"]) == record
    for change in [lambda r: r["streams"][0].update(sequenceEndExclusive=7),
                   lambda r: r["streams"][0].update(revision=True),
                   lambda r: r["streams"][0].update(layerId="missing"),
                   lambda r: r["streams"].append(copy.deepcopy(r["streams"][0])),
                   lambda r: r["representation"]["layers"][0].update(panelId="missing"),
                   lambda r: r["representation"]["layers"][0].update(rendered=True),
                   lambda r: r["representation"]["layers"].append(copy.deepcopy(r["representation"]["layers"][0]))]:
        candidate = copy.deepcopy(record)
        change(candidate)
        with pytest.raises(ValueError):
            validate_observation(candidate, snapshot["figure"], snapshot["sources"])


def test_attached_record_detaches_invalidates_and_is_not_reexported(template):
    # No Python snapshot importer exists. Exercise the defensive attached-record
    # lifecycle directly without adding a second, incomplete scene import API.
    fig = vs.Figure()
    line = fig.plot([1, 2])
    snapshot, record = accepted(fig)
    fig._spec = snapshot["figure"]
    cloned = fig.get_observation()
    cloned["sourceVersions"].clear()
    assert fig.get_observation() == record
    assert "observation" not in decode(fig.to_html())["snapshot"]["figure"]
    with pytest.raises(ValueError):
        line.set_semantics({"y": {"unit": None}})
    assert fig.get_observation() == record
    line.set_visible(False)
    assert fig.get_observation() is None


def test_shared_temperature_fixture_retains_semantics_versions_and_float32_bytes(template):
    fixture = json.loads((Path(__file__).parents[1] / "fixtures" / "observation-v1" / "temperature.json").read_text(encoding="utf-8"))
    fig = vs.Figure()
    line = fig.plot(array("f", fixture["x"]), array("f", fixture["y"])).enable_streaming(max_points=fixture["maxPoints"])
    line.set_semantics(fixture["channelSemantics"])
    line.append_data(**{channel: array("f", values) for channel, values in fixture["append"].items()})
    envelope = decode(fig.to_html(observation=True))
    snapshot = envelope["snapshot"]
    validate_figure_metadata(snapshot["figure"], snapshot["sources"])
    assert vs.OBSERVATION_PROTOCOL_VERSION == snapshot["figure"]["protocolVersion"] == 8
    descriptors = {item["id"]: item for item in snapshot["sources"]}
    buffers = {item["id"]: base64.b64decode(item["base64"]) for item in envelope["buffers"]}
    for channel, source_id in snapshot["figure"]["layers"][0]["data"].items():
        assert descriptors[source_id]["dtype"] == fixture["dtype"]
        assert struct.unpack("<3f", buffers[source_id]) == tuple(fixture["expected"][channel])
        assert snapshot["figure"]["semantics"]["sources"][source_id] == fixture["channelSemantics"][channel]
    stream = snapshot["figure"]["observation"]["streams"][0]
    assert {key: stream[key] for key in ("sequenceStart", "sequenceEndExclusive", "revision")} == {key: fixture["expected"][key] for key in ("sequenceStart", "sequenceEndExclusive", "revision")}


def test_multiplot_capture_and_explicit_slice_semantics_do_not_inherit(template):
    fig = vs.subplots(1, 2, kinds=[["3d", "2d"]])
    surface = fig.panel(0, 0).surface([[1, 2], [3, 4]])
    section = fig.panel(0, 1).slice(surface, axis="x", index=0)
    surface.set_semantics({"z": {"unit": "K"}})
    assert section.get_semantics() == {}
    section.set_semantics({"y": {"unit": "degC"}})
    surface.set_data(z=[[5, 6], [7, 8]])
    assert section.get_semantics() == {"y": {"unit": "degC"}}
    assert decode(fig.to_html(observation=True))["snapshot"]["figure"]["observation"]["representation"] == {"status": "not-evaluated"}


def test_validator_utc_unicode_and_empty_semantics_parity():
    fig = vs.Figure()
    line = fig.plot([1, 2])
    snapshot, record = accepted(fig)
    snapshot["figure"]["semantics"] = {"schemaVersion": 1.0, "sources": {}}
    record["capturedAt"] = "0000-02-29T00:00:00.000Z"
    validate_figure_metadata(snapshot["figure"], snapshot["sources"])
    assert validate_source_semantics({"unit": "\u0085"}) == {"unit": "\u0085"}
    with pytest.raises(ValueError):
        validate_source_semantics({"unit": "\ufeff"})
    record["capturedAt"] = "1900-02-29T00:00:00.000Z"
    with pytest.raises(ValueError):
        validate_figure_metadata(snapshot["figure"], snapshot["sources"])
    record["capturedAt"] = "٢٠٢٦-10-23T10:00:00.000Z"
    with pytest.raises(ValueError):
        validate_figure_metadata(snapshot["figure"], snapshot["sources"])
    record["capturedAt"] = "2026-10-23T10:00:00.000Z"
    snapshot["figure"]["semantics"]["sources"][line._spec()["data"]["x"]] = {}
    with pytest.raises(ValueError):
        validate_figure_metadata(snapshot["figure"], snapshot["sources"])


def test_surface_representation_triangle_count_may_exceed_source_count():
    fig = vs.Figure(kind="3d")
    surface = fig.surface([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
    snapshot, record = accepted(fig)
    record["source"] = "displayed"
    record["representation"] = {"status": "rendered", "frameId": 0, "layers": [{"layerId": surface.id, "kind": "surface", "total": 9, "visible": 9, "rendered": 16, "exact": True, "method": "surface triangles", "totalTriangles": 16, "omittedTriangles": 0}]}
    validate_figure_metadata(snapshot["figure"], snapshot["sources"])


@pytest.mark.parametrize("layer_kind,valid", [("line", ["line"]), ("line3d", ["line"]), ("scatter", ["points", "density"]),
    ("scatter3d", ["points"]), ("heatmap", ["grid"]), ("surface", ["surface"]), ("hist", ["hist"]), ("bar", ["bar"]), ("boxplot", ["boxplot"]), ("band", ["band"])])
def test_rendered_record_kind_matches_its_scene_layer(layer_kind, valid):
    fig = vs.Figure()
    line = fig.plot([1, 2])
    snapshot, record = accepted(fig)
    # The metadata validator checks reference compatibility. Scene shape validity
    # remains the separate scene importer's responsibility.
    snapshot["figure"]["layers"][0]["kind"] = layer_kind
    record["source"] = "displayed"
    record["representation"] = {"status": "rendered", "frameId": 1, "layers": [{"layerId": line.id, "kind": valid[0], "total": 2, "visible": 2, "rendered": 2, "exact": True, "method": "test"}]}
    for kind in ["points", "density", "line", "grid", "surface", "hist", "bar", "boxplot", "band"]:
        record["representation"]["layers"][0]["kind"] = kind
        if kind in valid:
            validate_figure_metadata(snapshot["figure"], snapshot["sources"])
        else:
            with pytest.raises(ValueError, match="kind"):
                validate_figure_metadata(snapshot["figure"], snapshot["sources"])
