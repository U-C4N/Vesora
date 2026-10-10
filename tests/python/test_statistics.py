"""Statistical facades preserve raw data for the single shared TS engine."""
import base64
import builtins
import copy
import importlib
import json
import math
import struct
from array import array

import pytest

import vesora as vs


def spec(layer):
    return next(item for item in layer.figure.snapshot()["figure"]["layers"] if item["id"] == layer.id)


def data(layer, channel):
    return list(layer.figure._sources[spec(layer)["data"][channel]][1])


def versions(fig):
    return {entry["id"]: entry["version"] for entry in fig.snapshot()["sources"]}


def test_hist_preserves_samples_and_describes_calculation_without_running_it():
    fig = vs.Figure()
    samples = array("f", [2, 0, 2, float("nan"), float("inf")])
    layer = fig.hist(samples, label="raw")
    scene = fig.snapshot()
    assert scene["figure"]["protocolVersion"] == vs.STATISTICS_PROTOCOL_VERSION == 3
    assert spec(layer)["options"] == {"bins": 10, "density": False, "cumulative": False}
    assert set(spec(layer)["data"]) == {"samples"}
    assert scene["sources"][0]["dtype"] == "float32"
    sample_id = spec(layer)["data"]["samples"]
    assert fig._data_bytes(sample_id, 1) == samples.tobytes()
    samples[0] = 90
    assert data(layer, "samples")[0] == 2
    assert fig._host is fig._window is fig._widget is None


@pytest.mark.parametrize("options", [
    {"bins": 0}, {"bins": True}, {"bins": 1.5}, {"bins": "auto"},
    {"bins": [0]}, {"bins": [0, 0, 1]}, {"bins": [0, math.inf]},
    {"bins": [0, 1], "range": [0, 1]}, {"range": [1, 1]},
    {"range": [0, math.inf]}, {"density": 1}, {"cumulative": "yes"},
    {"weights": [1, 1]}, {"unknown": True},
])
def test_hist_invalid_options_are_atomic(options):
    fig = vs.Figure()
    before = fig.snapshot()
    with pytest.raises((TypeError, ValueError)):
        fig.hist([0, 1], **options)
    assert fig.snapshot() == before


def test_hist_updates_raw_samples_and_calculation_options_atomically():
    fig = vs.Figure()
    layer = fig.hist([1, 2, 3], bins=3, range=(0, 4), density=True, cumulative=True)
    initial = spec(layer)
    layer.set_data(samples=array("h", [4, 3, 2, 1]))
    assert data(layer, "samples") == [4, 3, 2, 1]
    assert spec(layer)["options"] == initial["options"]
    assert fig.snapshot()["sources"][0]["dtype"] == "int16"
    assert fig.snapshot()["sources"][0]["version"] == 2
    stable = fig.snapshot()
    for call in (lambda: layer.set_data(samples=[[1]]), lambda: layer.set_data(x=[1]),
                 lambda: layer.set_options(bins=[0, 1]), lambda: layer.set_options(density=3)):
        with pytest.raises((TypeError, ValueError)):
            call()
        assert fig.snapshot() == stable
    layer.set_options(bins=[0, 1, 5], range=None)
    assert spec(layer)["options"] == {"bins": [0, 1, 5], "density": True, "cumulative": True}
    assert fig.snapshot()["sources"] == stable["sources"]
    layer.set_data([])
    assert data(layer, "samples") == []


def test_bar_defaults_expanded_baselines_signed_values_and_width_style():
    fig = vs.Figure()
    layer = fig.bar([2, 4], [3, -2], bottom=1, bar_width=0.5, width=2, color="red")
    assert spec(layer)["kind"] == "bar"
    assert spec(layer)["options"] == {"orientation": "vertical", "barWidth": 0.5}
    assert spec(layer)["style"] == {"width": 2.0, "color": "red"}
    assert data(layer, "base") == [1, 1]
    assert data(layer, "x") == [2, 4]
    assert data(layer, "y") == [3, -2]
    horizontal = vs.Figure().barh([2, 4], [3, -2], left=[1, 2])
    assert spec(horizontal)["options"] == {"orientation": "horizontal", "barWidth": 0.8}
    assert data(horizontal, "x") == [3, -2]
    assert data(horizontal, "y") == [2, 4]
    assert data(horizontal, "base") == [1, 2]


def test_bar_categories_append_and_partial_updates_retain_mapping():
    fig = vs.Figure()
    layer = fig.bar(["B", "A"], array("h", [2, 3]))
    assert fig.snapshot()["figure"]["categories"] == {"x:main": ["B", "A"]}
    assert spec(layer)["categorical"] == {"x": True}
    assert data(layer, "x") == [0, 1]
    x_id = spec(layer)["data"]["x"]
    before = versions(fig)
    layer.set_data(y=[5, 6])
    assert versions(fig)[x_id] == before[x_id]
    layer.set_data(x=["A", "C"])
    assert data(layer, "x") == [1, 2]
    assert fig.snapshot()["figure"]["categories"] == {"x:main": ["B", "A", "C"]}
    stable = fig.snapshot()
    with pytest.raises(ValueError, match="Baseline"):
        layer.set_data(x=["D"], y=[1])
    assert fig.snapshot() == stable
    layer.set_data(x=["D"], y=[1], bottom=0)
    assert data(layer, "base") == [0]
    assert fig.snapshot()["figure"]["categories"]["x:main"] == ["B", "A", "C", "D"]


@pytest.mark.parametrize("mode", ["group", "stack"])
def test_bar_mode_requires_consistent_widths_even_for_hidden_layers(mode):
    fig = vs.Figure().set_bar_mode("overlay")
    fig.bar(["A"], [1], bar_width=0.4)
    second = fig.bar(["A"], [2], bar_width=0.6).set_visible(False)
    stable = fig.snapshot()
    with pytest.raises(ValueError, match="matching"):
        fig.set_bar_mode(mode)
    assert fig.snapshot() == stable
    second.set_options(bar_width=0.4)
    fig.set_bar_mode(mode)
    assert fig.snapshot()["figure"]["barModes"] == {"main": mode}
    stable = fig.snapshot()
    with pytest.raises(ValueError, match="matching"):
        second.set_options(bar_width=0.5)
    assert fig.snapshot() == stable


def test_bar_mode_orientation_and_stacking_baseline_validation():
    fig = vs.Figure().set_bar_mode("overlay")
    layer = fig.bar([1], [2], bottom=1)
    stable = fig.snapshot()
    with pytest.raises(ValueError, match="orientation"):
        fig.barh([1], [2])
    with pytest.raises(ValueError, match="zero"):
        fig.set_bar_mode("stack")
    assert fig.snapshot() == stable
    layer.set_data(base=0)
    fig.set_bar_mode("stack")
    stable = fig.snapshot()
    with pytest.raises(ValueError, match="zero"):
        layer.set_data(bottom=1)
    with pytest.raises(ValueError, match="orientation"):
        layer.set_options(orientation="horizontal")
    assert fig.snapshot() == stable


@pytest.mark.parametrize("options", [{"bottom": [1]}, {"bottom": math.inf}, {"bar_width": 0}, {"bar_width": True}, {"bar_width": math.inf}, {"left": 0}])
def test_invalid_bar_construction_is_atomic(options):
    fig = vs.Figure()
    stable = fig.snapshot()
    with pytest.raises((TypeError, ValueError)):
        fig.bar([1, 2], [3, 4], **options)
    assert fig.snapshot() == stable


def test_boxplot_ragged_groups_preserve_dtype_and_source_order():
    fig = vs.Figure()
    first = array("f", [4, 2, float("nan"), 1])
    second = array("h", [100, -1])
    layer = fig.boxplot([first, second, []], labels=["A", "B", "C"])
    assert spec(layer)["options"] == {"orientation": "vertical", "whis": 1.5, "showfliers": True, "boxWidth": 0.6}
    assert spec(layer)["categorical"] == {"x": True}
    assert set(spec(layer)["data"]) == {"x", "g0", "g1", "g2"}
    assert data(layer, "x") == [0, 1, 2]
    assert data(layer, "g1") == [100, -1]
    descriptors = {entry["id"]: entry for entry in fig.snapshot()["sources"]}
    assert descriptors[spec(layer)["data"]["g0"]]["dtype"] == "float32"
    assert descriptors[spec(layer)["data"]["g1"]]["dtype"] == "int16"
    first[0] = 10
    assert data(layer, "g0")[0] == 4


def test_boxplot_updates_groups_and_labels_atomically_and_releases_old_groups():
    fig = vs.Figure()
    layer = fig.boxplot([[3, 1], [5]], labels=["B", "A"])
    x_id = spec(layer)["data"]["x"]
    layer.set_data(groups=[[9], [8, 7, 6]])
    assert data(layer, "x") == [0, 1]
    assert versions(fig)[x_id] == 1
    assert fig.snapshot()["figure"]["categories"] == {"x:main": ["B", "A"]}
    stable = fig.snapshot()
    with pytest.raises(ValueError):
        layer.set_data(groups=[[1]], labels=["X", "Y"])
    assert fig.snapshot() == stable
    dropped = spec(layer)["data"]["g1"]
    layer.set_data(groups=[[2]])
    assert dropped not in versions(fig)
    assert data(layer, "x") == [2]
    assert fig.snapshot()["figure"]["categories"] == {"x:main": ["B", "A", "1"]}
    layer.set_data(labels=["A"])
    assert data(layer, "x") == [1]
    before = versions(fig)
    layer.set_options(whis=0, showfliers=False, box_width=0.4)
    assert versions(fig) == before
    assert spec(layer)["options"]["whis"] == 0


def test_boxplot_flat_buffer_horizontal_empty_and_default_labels():
    layer = vs.Figure().boxplot(array("d", [3, 2, 1]), orientation="horizontal")
    assert data(layer, "g0") == [3, 2, 1]
    assert spec(layer)["categorical"] == {"y": True}
    assert layer.figure.snapshot()["figure"]["categories"] == {"y:main": ["1"]}
    empty = vs.Figure().boxplot([])
    assert set(spec(empty)["data"]) == {"x", "g0"}
    assert spec(empty)["categorical"] == {"x": True}
    assert empty.figure.snapshot()["figure"]["categories"] == {"x:main": ["1"]}
    assert data(empty, "g0") == []
    buffered = vs.Figure().boxplot(array("d"))
    assert set(spec(buffered)["data"]) == {"x", "g0"}
    assert buffered.figure.snapshot()["figure"]["categories"] == {"x:main": ["1"]}


def test_bar_updates_reject_wrong_baseline_alias_and_overflow_atomically():
    for method, wrong in (("bar", "left"), ("barh", "bottom")):
        fig = vs.Figure()
        layer = getattr(fig, method)([1], [2])
        stable = fig.snapshot()
        with pytest.raises(TypeError, match="bottom"):
            layer.set_data(**{wrong: 1})
        assert fig.snapshot() == stable
        axis = "y" if method == "bar" else "x"
        with pytest.raises(ValueError, match="finite"):
            layer.set_data(**{axis: [1e308], "base": [1e308]})
        assert fig.snapshot() == stable
    fig = vs.Figure()
    with pytest.raises(ValueError, match="finite"):
        fig.bar([1], [1e308], bottom=1e308)
    assert fig.snapshot()["figure"]["layers"] == []


@pytest.mark.parametrize("method", ["bar", "barh"])
@pytest.mark.parametrize("positions", [["A", "A"], [2, 2], [float("nan"), 2], [1, float("inf")], [float("-inf"), 2]])
def test_bar_positions_are_unique_and_finite_on_creation_and_atomic_update(method, positions):
    fig = vs.Figure()
    stable = fig.snapshot()
    with pytest.raises(ValueError, match="finite and unique"):
        getattr(fig, method)(positions, [1, 2])
    assert fig.snapshot() == stable
    initial = ["A", "B"] if isinstance(positions[0], str) else [1, 2]
    layer = getattr(fig, method)(initial, [1, 2])
    stable = fig.snapshot()
    axis = "x" if method == "bar" else "y"
    with pytest.raises(ValueError, match="finite and unique"):
        layer.set_data(**{axis: positions})
    assert fig.snapshot() == stable


@pytest.mark.parametrize("options", [{"whis": -1}, {"whis": True}, {"whis": math.inf}, {"showfliers": 1}, {"box_width": 0}, {"orientation": "diagonal"}, {"labels": ["A"]}, {"labels": ["A", "A"]}, {"notch": True}])
def test_boxplot_bad_options_do_not_publish(options):
    fig = vs.Figure()
    stable = fig.snapshot()
    with pytest.raises((TypeError, ValueError)):
        fig.boxplot([[1], [2]], **options)
    assert fig.snapshot() == stable


def test_categories_preseed_shared_order_and_numeric_mixing_hidden_layers():
    fig = vs.subplots(1, 2, sharex=True)
    fig.panel(0, 1).set_categories("x", ["B", "A"])
    left = fig.panel(0, 0).bar(["A", "C"], [1, 2])
    right = fig.panel(0, 1).scatter(["B", "A"], [3, 4]).set_visible(False)
    assert fig.snapshot()["figure"]["categories"] == {"x:shared": ["B", "A", "C"]}
    assert data(left, "x") == [1, 2]
    assert data(right, "x") == [0, 1]
    stable = fig.snapshot()
    for call in (lambda: fig.scatter([1], [2]), lambda: right.set_data(x=[1, 2]),
                 lambda: fig.set_categories("x", ["A", "B", "C"])):
        with pytest.raises(ValueError):
            call()
        assert fig.snapshot() == stable


def test_categorical_plot_and_scatter_updates_and_empty_arrays():
    fig = vs.Figure()
    layer = fig.plot(["low", "high"], ["A", "B"])
    assert spec(layer)["categorical"] == {"x": True, "y": True}
    layer.set_data(y=["C", "B"])
    assert spec(layer)["categorical"] == {"x": True, "y": True}
    assert data(layer, "y") == [2, 1]
    layer.set_data(x=[], y=[])
    assert spec(layer)["categorical"] == {"x": True, "y": True}
    assert data(layer, "x") == []
    y_only = vs.Figure().plot(["B", "A"])
    assert spec(y_only)["categorical"] == {"y": True}
    y_only.set_data(["A", "B"])
    assert spec(y_only)["categorical"] == {"y": True}


def test_category_failures_never_append_labels_or_promote_protocol():
    fig = vs.Figure()
    stable = fig.snapshot()
    with pytest.raises(ValueError, match="matching"):
        fig.scatter(["A", "B"], [1])
    with pytest.raises(TypeError):
        fig.scatter(["A", 2], [1, 2])
    with pytest.raises(ValueError):
        fig.set_categories("x", ["A", "A"])
    assert fig.snapshot() == stable
    hidden = fig.scatter([1], [2]).set_visible(False)
    stable = fig.snapshot()
    with pytest.raises(ValueError, match="mix"):
        fig.scatter(["A"], [1])
    assert fig.snapshot() == stable
    hidden.remove()
    fig.set_categories("x", ["A"]).set_categories("x", ["A", "B"])
    stable = fig.snapshot()
    with pytest.raises(ValueError, match="append-only"):
        fig.set_categories("x", ["B", "A"])
    assert fig.snapshot() == stable


def test_statistical_scale_rules_apply_to_shared_axes_bookmarks_and_view_events():
    fig = vs.subplots(1, 2, sharey=True)
    fig.set_axes(yscale="log")
    fig.bookmark("log")
    fig.set_axes(yscale="linear")
    fig.panel(0, 1).hist([1, 2])
    stable = fig.snapshot()
    for call in (lambda: fig.set_axes(yscale="log"), lambda: fig.restore_bookmark("log"),
                 lambda: fig._emit("viewchange", {"yScale": "log"})):
        with pytest.raises(ValueError, match="linear"):
            call()
        assert fig.snapshot() == stable
    categorical = vs.Figure().set_categories("x", ["A"])
    with pytest.raises(ValueError, match="linear"):
        categorical.set_axes(xscale="log")
    numeric = vs.Figure().set_axes(xscale="log")
    with pytest.raises(ValueError, match="linear"):
        numeric.hist([1, 2])


def test_protocol_promotion_is_monotonic_and_legacy_scenes_stay_legacy():
    legacy = vs.Figure()
    legacy.plot([1, 2])
    assert legacy.snapshot()["figure"]["protocolVersion"] == 1
    grid = vs.subplots(1, 1)
    assert grid.snapshot()["figure"]["protocolVersion"] == 2
    layer = grid.hist([1, 2])
    note = grid.text(0, 0, "Test")
    assert grid.snapshot()["figure"]["protocolVersion"] == 3
    layer.remove()
    note.remove()
    assert grid.snapshot()["figure"]["protocolVersion"] == 3


@pytest.mark.parametrize("mode", ["group", "stack", "overlay"])
@pytest.mark.parametrize("kind", ["scatter3d", "surface"])
def test_bar_mode_metadata_rejects_3d_layers_without_mutation(mode, kind):
    fig = vs.Figure().set_bar_mode(mode)
    stable = fig.snapshot()
    with pytest.raises(ValueError, match="2D"):
        if kind == "scatter3d":
            fig.scatter3d([1], [2], [3])
        else:
            fig.surface([0, 1], [0, 1], [[1, 2], [3, 4]])
    assert fig.snapshot() == stable


def test_convenience_and_panel_apis_and_closed_handles():
    fig = vs.subplots(2, 2)
    vs.hist([1, 2])
    fig.panel(0, 1).bar(["A"], [1])
    fig.panel(1, 0).barh(["A"], [1])
    layer = fig.panel(1, 1).boxplot([[1]])
    assert [item.get("panelId", "main") for item in fig.snapshot()["figure"]["layers"]] == ["main", "panel-0-1", "panel-1-0", "panel-1-1"]
    fig.close()
    with pytest.raises(RuntimeError, match="closed"):
        layer.set_data(groups=[[2]])
    with pytest.raises(RuntimeError, match="closed"):
        fig.set_categories("x", [])
    for make in (vs.bar, vs.barh):
        fresh = vs.figure()
        assert make(["A"], [1]).figure is fresh
        fresh.close()
    fresh = vs.figure()
    assert vs.boxplot([[1]]).figure is fresh
    fresh.close()


def test_statistical_html_contains_raw_buffers_and_escaped_categories_without_host(tmp_path, monkeypatch):
    exporter = importlib.import_module("vesora.html")
    template = tmp_path / "template.html"
    template.write_text('<script type="application/json">__VESORA_PAYLOAD_JSON__</script>', encoding="utf-8")
    monkeypatch.setattr(exporter, "_TEMPLATE", template)
    fig = vs.subplots(1, 2)
    hist = fig.panel(0, 0).hist([3, 1, float("nan")], density=True, cumulative=True)
    box = fig.panel(0, 1).boxplot([[3, 1]], labels=['Ö </script> &'])
    html = fig.to_html()
    assert html.count("</script>") == 1
    payload = json.loads(html.split(">", 1)[1].rsplit("</script>", 1)[0])
    assert payload["formatVersion"] == 1
    assert payload["snapshot"] == fig.snapshot()
    buffers = {entry["id"]: base64.b64decode(entry["base64"]) for entry in payload["buffers"]}
    assert buffers[spec(hist)["data"]["samples"]] == struct.pack("<3d", 3, 1, float("nan"))
    assert buffers[spec(box)["data"]["g0"]] == struct.pack("<2d", 3, 1)
    assert fig._host is fig._window is fig._widget is None


def test_statistical_facades_do_not_import_numpy(monkeypatch):
    original = builtins.__import__
    def without_numpy(name, *args, **kwargs):
        if name == "numpy" or name.startswith("numpy."):
            raise AssertionError("Unexpected NumPy import")
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", without_numpy)
    fig = vs.subplots(1, 3)
    fig.panel(0, 0).hist(array("f", [1, 2]), bins=2)
    fig.panel(0, 1).bar(["A"], array("h", [2]))
    fig.panel(0, 2).boxplot([array("d", [3, 1]), [2]])
    assert len(fig.snapshot()["figure"]["layers"]) == 3
