"""Protocol 6 quality features and transport contracts, without a GUI renderer."""
from array import array
import asyncio
import base64
from concurrent.futures import Future
import copy
import importlib
import math
from types import SimpleNamespace

import pytest

import vesora as vs
from vesora.export import png_options
from test_figure import source_data


def scene(fig):
    return fig.snapshot()["figure"]


def test_band_channels_defaults_dtype_ownership_and_top_level_panel_handles():
    fig = vs.figure()
    lower = array("f", [1, 2, 3])
    band = vs.fill_between([0, 1, 2], lower, memoryview(array("d", [2, 3, 4])), label="Interval")
    lower[0] = 99
    spec = scene(fig)
    assert band.figure is fig
    assert spec["protocolVersion"] == vs.QUALITY_PROTOCOL_VERSION == 6
    assert spec["layers"][0]["kind"] == "band"
    assert set(spec["layers"][0]["data"]) == {"x", "lower", "upper"}
    assert spec["layers"][0]["style"] == {"label": "Interval", "opacity": .18}
    assert source_data(fig, "lower")[0]["dtype"] == "float32"
    assert source_data(fig, "lower")[2] == [1, 2, 3]
    panels = vs.subplots(1, 2)
    panels.panel(0, 1).fill_between([0, 1], [1, 2], [2, 3], opacity=.25)
    assert scene(panels)["layers"][0]["panelId"] == "panel-0-1"
    for xs, lows, highs in (([], [], []), ([0], [1], [1]), ([0, 1], [math.nan, math.inf], [0, -math.inf])):
        vs.figure().fill_between(xs, lows, highs)


@pytest.mark.parametrize("args", [
    ([1, 1], [0, 0], [1, 1]), ([1, 0], [0, 0], [1, 1]),
    ([0, math.nan], [0, 0], [1, 1]), ([0, math.inf], [0, 0], [1, 1]),
    ([0, 1], [0], [1, 1]), ([0, 1], [0, 2], [1, 1]),
    ([[0, 1]], [0, 0], [1, 1]), (["a", "b"], [0, 0], [1, 1]),
])
def test_invalid_band_creation_is_atomic(args):
    fig = vs.figure()
    before = fig.snapshot()
    with pytest.raises((TypeError, ValueError)):
        fig.fill_between(*args)
    assert fig.snapshot() == before


def test_band_updates_publish_once_preserve_source_ids_and_reject_partial_corruption():
    fig = vs.figure()
    band = fig.fill_between([0, 1, 2], [1, 2, 3], [2, 3, 4])
    published = []
    fig._listeners.append(lambda: published.append(fig.snapshot()))
    before = fig.snapshot()
    for change in (lambda: band.set_data(lower=[2, 4, 3]), lambda: band.set_data(x=[0, 2, 1]),
                   lambda: band.set_data([0, 1], [0, 0], [1]), lambda: band.set_data(y=[1, 2, 3]),
                   lambda: band.set_style(width=2)):
        with pytest.raises((TypeError, ValueError)):
            change()
        assert fig.snapshot() == before and published == []
    original = {name: source_data(fig, name)[0] for name in ("x", "lower", "upper")}
    band.set_data(lower=[.5, 1.5, 2.5])
    assert len(published) == 1
    for name in original:
        descriptor = source_data(fig, name)[0]
        assert descriptor["id"] == original[name]["id"]
        assert descriptor["version"] == original[name]["version"] + (name == "lower")
    band.set_data([2, 3], [1, 2], [2, 3])
    assert len(published) == 2 and source_data(fig, "x")[2] == [2, 3]


@pytest.mark.parametrize("style", [{"width": 2}, {"values": [0, 1]}, {"representation": "density"}, {"colorbar_label": "units"}])
def test_band_style_is_intentionally_narrow(style):
    with pytest.raises((TypeError, ValueError)):
        vs.figure().fill_between([0, 1], [1, 2], [2, 3], **style)


def test_band_axis_contract_and_time_range_changes_are_atomic():
    fig = vs.figure()
    band = fig.fill_between([1, 2], [1, 2], [2, 3])
    fig.set_axes(xscale="time", yscale="log")
    before = fig.snapshot()
    for change in (lambda: fig.set_axes(yscale="time"), lambda: fig.set_axis_format("y", {"kind": "date"}),
                   lambda: band.set_data(x=[1, 8.64e15 + 1]), lambda: fig.set_categories("x", ["a", "b"]),
                   lambda: fig.plot(["a", "b"], [1, 2])):
        with pytest.raises(ValueError):
            change()
        assert fig.snapshot() == before
    for xscale in ("linear", "log", "time"):
        for yscale in ("linear", "log"):
            fig.set_axes(xscale=xscale, yscale=yscale)
    with pytest.raises(ValueError):
        vs.figure(kind="3d").fill_between([0, 1], [0, 0], [1, 1])


def test_shared_hover_validates_visible_line_updates_visibility_and_categories_atomically():
    fig = vs.figure()
    line = fig.plot([0, 1, 2], [1, math.nan, 3])
    assert fig.set_hover_mode("x") is fig
    assert scene(fig)["hoverMode"] == "x" and scene(fig)["protocolVersion"] == 6
    before = fig.snapshot()
    for change in (lambda: line.set_data(x=[0, 2, 1]), lambda: fig.plot([1, 0], [0, 1]),
                   lambda: fig.set_hover_mode("invalid")):
        with pytest.raises(ValueError):
            change()
        assert fig.snapshot() == before
    fig.set_hover_mode("nearest")
    line.set_data(x=[0, 2, 1]).set_visible(False)
    fig.set_hover_mode("x")
    before = fig.snapshot()
    with pytest.raises(ValueError):
        line.set_visible(True)
    assert fig.snapshot() == before
    categorical = vs.figure()
    categorical.plot(["a", "b"], [1, 2])
    before = categorical.snapshot()
    with pytest.raises(ValueError):
        categorical.set_hover_mode("x")
    assert categorical.snapshot() == before


def test_optional_typography_and_colorbar_labels_upgrade_only_when_used():
    from vesora.presentation import LIGHT_THEME
    legacy = vs.figure(theme="light")
    assert scene(legacy)["theme"] == LIGHT_THEME and scene(legacy)["protocolVersion"] == 5
    tokens = {"titleFontSize": 18, "labelFontSize": 14, "tickFontSize": 12, "legendFontSize": 13}
    fig = vs.figure(theme=tokens)
    assert scene(fig)["protocolVersion"] == 6
    assert all(scene(fig)["theme"][key] == value for key, value in tokens.items())
    before = fig.snapshot()
    for value in (True, 0, 33, math.nan, "12"):
        with pytest.raises(ValueError):
            fig.set_theme({"tickFontSize": value})
        assert fig.snapshot() == before
    legacy.set_theme({"legendFontSize": 14})
    assert scene(legacy)["protocolVersion"] == 6
    colorbar = vs.figure()
    heatmap = colorbar.heatmap([[1, 2]], colorbar_label="Temperature (°C)")
    assert scene(colorbar)["layers"][0]["style"]["colorbarLabel"] == "Temperature (°C)"
    assert scene(colorbar)["protocolVersion"] == 6
    heatmap.set_style(colorbar_label="Kelvin")
    assert scene(colorbar)["layers"][0]["style"]["colorbarLabel"] == "Kelvin"
    old = vs.figure()
    old.plot([1, 2])
    assert scene(old)["protocolVersion"] == 1


@pytest.mark.parametrize("options", [
    {"width": 800}, {"height": 600}, {"width": 199, "height": 600},
    {"width": 800, "height": 179}, {"width": 800.5, "height": 600},
    {"width": True, "height": 600}, {"width": 2**53, "height": 600}, {"width": 10**500, "height": 600},
    {"scale": 0}, {"scale": -1}, {"scale": True}, {"scale": math.nan}, {"scale": math.inf}, {"scale": 10**500},
    {"width": 8000, "height": 5000, "scale": 1},
    {"width": 200, "height": 180, "scale": .001},
])
def test_export_options_reject_invalid_sizes_before_host_start(options):
    fig = vs.figure()
    with pytest.raises(ValueError):
        fig.savefig("unused.png", **options)
    assert fig._host is fig._window is fig._widget is None


def test_export_option_defaults_positive_fractional_scale_rounding_and_area_limit():
    assert png_options() == {}
    assert png_options(scale=.5) == {"scale": .5}
    assert png_options(width=800, height=600) == {"width": 800, "height": 600}
    assert png_options(width=200, height=180, scale=.005)["scale"] == .005
    assert png_options(width=5000, height=6400, scale=1)["height"] == 6400
    with pytest.raises(ValueError, match="pixel limit"):
        png_options(width=5000, height=6400, scale=1.0001)


def test_sync_savefig_and_qt_forward_only_explicit_options(tmp_path, monkeypatch):
    qt = importlib.import_module("vesora.qt")
    fig = vs.figure()
    calls = []
    def export(**options):
        calls.append(options)
        future = Future()
        future.set_result(b"PNG fixture")
        return future
    fig._host = SimpleNamespace(ready=SimpleNamespace(is_set=lambda: True), export=export)
    monkeypatch.setattr(qt, "_ensure_window", lambda *_args, **_kwargs: None)
    fig.savefig(tmp_path / "explicit.png", width=800, height=600, scale=2)
    fig.savefig(tmp_path / "default.png")
    assert calls == [{"width": 800, "height": 600, "scale": 2}, {}]
    assert (tmp_path / "explicit.png").read_bytes() == b"PNG fixture"
    fig._host = None


def test_local_host_export_message_options_and_noarg_compatibility(monkeypatch):
    host_module = importlib.import_module("vesora.host")
    host = host_module.LocalHost(vs.figure())
    messages = []
    async def broadcast(message):
        messages.append(message)
    host._broadcast = broadcast
    host._loop = object()
    host.ready.set()
    monkeypatch.setattr(host_module.asyncio, "run_coroutine_threadsafe", lambda coro, _loop: asyncio.run(coro))
    explicit = host.export(width=1000, height=600, scale=1.5)
    legacy = host.export()
    assert messages[0]["options"] == {"width": 1000, "height": 600, "scale": 1.5}
    assert set(messages[1]) == {"type", "requestId"}
    assert len(host._exports) == 2
    explicit.cancel()
    legacy.cancel()
    host._loop = None


def test_async_notebook_export_transports_sizes_and_keeps_snapshot(tmp_path):
    pytest.importorskip("anywidget")
    from vesora.notebook import make_widget
    fig = vs.figure()
    fig.fill_between([0, 1], [1, 2], [2, 3])
    fig.set_hover_mode("x")
    widget = make_widget(fig)
    fig._widget = widget
    original = copy.deepcopy(widget.snapshot)
    messages = []
    widget.send = messages.append
    async def run():
        request = asyncio.create_task(fig.savefig_async(tmp_path / "notebook.png", timeout=1, width=900, height=600, scale=2))
        await asyncio.sleep(0)
        message = messages[-1]
        assert message["options"] == {"width": 900, "height": 600, "scale": 2}
        png = b"\x89PNG\r\n\x1a\nquality fixture"
        widget._receive(widget, {"type": "export", "requestId": message["requestId"], "dataUrl": "data:image/png;base64," + base64.b64encode(png).decode()}, [])
        assert (await request).read_bytes() == png
        assert widget.snapshot == original and len(widget.buffers) == 3
    try:
        asyncio.run(run())
    finally:
        fig.close()
