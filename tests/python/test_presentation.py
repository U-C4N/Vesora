"""Python presentation scenes stay compatible with the shared browser engine."""
import copy
import importlib
import json
import os
from array import array
from datetime import datetime

import pytest

import vesora as vs


def scene(fig):
    return fig.snapshot()["figure"]


def panel_view(fig, panel_id):
    value = scene(fig)
    if panel_id == "main":
        return value["view"]
    return next(panel["view"] for panel in value["panels"] if panel["id"] == panel_id)


def test_theme_constructor_presets_custom_tokens_and_caller_isolation():
    legacy = vs.figure()
    assert "theme" not in scene(legacy) and scene(legacy)["protocolVersion"] == 1
    dark = vs.figure(theme="dark")
    assert scene(dark)["protocolVersion"] == vs.PRESENTATION_PROTOCOL_VERSION == 5
    assert scene(dark)["theme"]["background"] == "#0f172a"
    assert len(scene(dark)["theme"]) == 12
    tokens = {"background": "#ABC", "palette": ["red", "#123"]}
    custom = vs.subplots(1, 2, theme=tokens)
    tokens["palette"][0] = "black"
    assert scene(custom)["theme"]["background"] == "#aabbcc"
    assert scene(custom)["theme"]["palette"] == ["#ef4444", "#112233"]
    assert scene(custom)["theme"]["fontSize"] == 12
    snapshot = custom.snapshot()
    snapshot["figure"]["theme"]["palette"].clear()
    assert scene(custom)["theme"]["palette"] == ["#ef4444", "#112233"]
    assert custom.set_theme("light") is custom
    assert scene(custom)["theme"]["background"] == "#ffffff"


@pytest.mark.parametrize("theme", [
    "unknown", None, [], {"unknown": "x"}, {"background": "transparent"},
    {"background": None}, {"fontFamily": ""}, {"fontFamily": "a\nb"},
    {"fontFamily": "a" * 201}, {"fontSize": True}, {"fontSize": float("nan")},
    {"fontSize": 7}, {"fontSize": 33}, {"palette": []}, {"palette": ["blue"] * 33},
    {"palette": "blue"}, {"palette": [2]},
])
def test_invalid_theme_does_not_change_or_publish_the_scene(theme):
    fig = vs.figure()
    fig.plot([1, 2])
    before = fig.snapshot()
    changes = []
    fig._listeners.append(lambda: changes.append(True))
    with pytest.raises((TypeError, ValueError)):
        fig.set_theme(theme)
    assert fig.snapshot() == before and changes == []


def test_time_scale_epoch_milliseconds_and_shared_axis_format():
    fig = vs.subplots(1, 2, sharex=True)
    ticks = array("d", [1_792_195_200_000, 1_792_281_600_000])
    fig.plot(ticks, [1, 2])
    right = fig.panel(0, 1)
    right.plot(ticks, [3, 4])
    options = {"kind": "date", "locale": "tr-TR", "timeZone": "Europe/Istanbul",
               "options": {"month": "short", "day": "numeric"}}
    right.set_axes(xscale="time", xlim=(ticks[0], ticks[1]), xlabel="Gün")
    assert right.set_axis_format("x", options) is right
    options["options"]["day"] = "2-digit"
    for panel in ("main", right.id):
        view = panel_view(fig, panel)
        assert view["xScale"] == "time" and view["xDomain"] == list(ticks)
        assert view["xFormat"]["options"]["day"] == "numeric"
    assert panel_view(fig, "main")["xLabel"] == ""
    assert panel_view(fig, right.id)["xLabel"] == "Gün"
    fig.bookmark("Overview")
    right.set_axes(xlim=(ticks[0] + 1000, ticks[1] - 1000))
    fig.restore_bookmark("Overview")
    assert panel_view(fig, right.id)["xDomain"] == list(ticks)
    right.set_axis_format("x", None)
    assert all("xFormat" not in panel_view(fig, panel) for panel in ("main", right.id))
    assert scene(fig)["protocolVersion"] == 5


def test_declarative_formatting_serialization_currency_normalization_and_default_timezone():
    fig = vs.figure()
    fig.set_axis_format("y", {"kind": "currency", "currency": "try", "locale": "tr-TR",
                              "options": {"maximumFractionDigits": 2, "currencyDisplay": "symbol"}})
    fig.set_axes(xformat={"kind": "date"}, xscale="time")
    value = json.loads(json.dumps(fig.snapshot(), allow_nan=False))["figure"]
    assert value["view"]["yFormat"]["currency"] == "TRY"
    assert value["view"]["xFormat"] == {"kind": "date"}
    assert value["protocolVersion"] == 5
    fig.set_axis_format("y", {"kind": "percent", "options": {"maximumFractionDigits": 1}})
    assert scene(fig)["view"]["yFormat"]["kind"] == "percent"
    fig.set_axis_format("y", {"kind": "number", "options": {"notation": "compact", "useGrouping": False}})


@pytest.mark.parametrize("format", [
    "currency", [], {}, {"kind": "scientific"}, {"kind": "number", "fn": "format"},
    {"kind": "number", "options": {"notation": None}},
    {"kind": "number", "timeZone": "UTC"}, {"kind": "date", "currency": "USD"},
    {"kind": "currency"}, {"kind": "currency", "currency": "US"},
    {"kind": "currency", "currency": "€€€"}, {"kind": "number", "locale": "en_US"},
    {"kind": "number", "locale": "en-abc"}, {"kind": "number", "locale": "en-u-nu-latn-u-ca-gregory"},
    {"kind": "number", "locale": "de-1901-1901"}, {"kind": "date", "timeZone": "Europe/Imaginary"},
    {"kind": "date", "timeZone": "+03:00"}, {"kind": "date", "timeZone": None},
    {"kind": "number", "options": None}, {"kind": "number", "options": {"style": "percent"}},
    {"kind": "number", "options": {"maximumFractionDigits": 21}},
    {"kind": "number", "options": {"minimumIntegerDigits": 0}},
    {"kind": "number", "options": {"minimumFractionDigits": 3, "maximumFractionDigits": 2}},
    {"kind": "number", "options": {"notation": "other"}},
    {"kind": "number", "options": {"useGrouping": 1}},
    {"kind": "number", "options": {"maximumFractionDigits": True}},
    {"kind": "number", "options": {"maximumSignificantDigits": float("inf")}},
    {"kind": "date", "options": {"year": "other"}}, {"kind": "date", "options": {"hour12": "false"}},
    {"kind": "date", "options": {"fractionalSecondDigits": 0}},
    {"kind": "date", "options": {"dateStyle": "short", "day": "numeric"}},
    {"kind": "date", "options": {"calendar": "bad_calendar"}},
])
def test_invalid_axis_formats_are_atomic(format):
    fig = vs.subplots(1, 2, sharey=True)
    before = fig.snapshot()
    changes = []
    fig._listeners.append(lambda: changes.append(True))
    with pytest.raises((TypeError, ValueError)):
        fig.panel(0, 1).set_axes(yformat=format, ylabel="Do not commit")
    assert fig.snapshot() == before and changes == []


def test_time_scale_and_format_failures_preserve_prior_views_and_protocol():
    for fig, options in ((vs.figure(), {"zscale": "time"}),
                         (vs.figure(kind="3d"), {"xscale": "time"}),
                         (vs.figure(), {"xscale": "invalid"}),
                         (vs.figure(), {"xscale": "time", "xlim": (0, 8.64e15 + 1)}),
                         (vs.figure(), {"xscale": "time", "xlim": (5, 2)})):
        before = fig.snapshot()
        with pytest.raises(ValueError):
            fig.set_axes(**options)
        assert fig.snapshot() == before
    fig = vs.figure().set_categories("x", ["A"])
    before = fig.snapshot()
    with pytest.raises(ValueError, match="linear"):
        fig.set_axes(xscale="time")
    assert fig.snapshot() == before
    for axis, panel in (("z", "main"), ("x", "missing")):
        with pytest.raises(ValueError):
            fig.set_axis_format(axis, {"kind": "number"}, panel_id=panel)
        assert fig.snapshot() == before
    time = vs.figure().set_axes(xscale="time")
    before = time.snapshot()
    with pytest.raises(ValueError, match="2D"):
        time.scatter3d([1], [2], [3])
    assert time.snapshot() == before


def test_time_bar_positions_and_statistical_value_restrictions():
    fig = vs.figure().set_axes(xscale="time")
    layer = fig.bar([1_792_195_200_000, 1_792_281_600_000], [10, 20], bar_width=43_200_000)
    layer.set_data(y=[15, 25])
    before = fig.snapshot()
    with pytest.raises(ValueError, match="linear"):
        fig.set_axes(yscale="time")
    assert fig.snapshot() == before
    horizontal = vs.figure().set_axes(yscale="time")
    horizontal.barh([1_792_195_200_000], [2], bar_width=43_200_000)
    for method, values in (("hist", [1, 2]), ("boxplot", [[1, 2]])):
        empty = vs.figure().set_axes(xscale="time")
        before = empty.snapshot()
        with pytest.raises(ValueError, match="linear"):
            getattr(empty, method)(values)
        assert empty.snapshot() == before
    empty = vs.figure().set_axes(xscale="time")
    before = empty.snapshot()
    with pytest.raises((TypeError, ValueError)):
        empty.plot([datetime(2026, 10, 12)], [1])
    assert empty.snapshot() == before


@pytest.mark.parametrize("kind", ["line", "scatter", "bar", "heatmap"])
def test_time_coordinates_reject_date_overflow_on_scale_creation_and_updates(kind):
    fig = vs.figure()
    method = fig.plot if kind == "line" else getattr(fig, kind)
    layer = method([0, 86_400_000], [0, 1], [[1, 2], [3, 4]]) if kind == "heatmap" else method([0, 86_400_000], [1, 2])
    fig.set_axes(xscale="time")
    before = fig.snapshot()
    with pytest.raises(ValueError, match="Date range"):
        layer.set_data(x=[0, 8.64e15 + 1])
    assert fig.snapshot() == before
    empty = vs.figure().set_axes(xscale="time")
    before = empty.snapshot()
    with pytest.raises(ValueError, match="Date range"):
        if kind == "heatmap":
            getattr(empty, kind)([0, 8.64e15 + 1], [0, 1], [[1, 2], [3, 4]])
        else:
            (empty.plot if kind == "line" else getattr(empty, kind))([0, 8.64e15 + 1], [1, 2])
    assert empty.snapshot() == before
    ordinary = vs.figure()
    if kind == "heatmap":
        getattr(ordinary, kind)([0, 8.64e15 + 1], [0, 1], [[1, 2], [3, 4]])
    else:
        (ordinary.plot if kind == "line" else getattr(ordinary, kind))([0, 8.64e15 + 1], [1, 2])
    before = ordinary.snapshot()
    with pytest.raises(ValueError, match="Date range"):
        ordinary.set_axes(xscale="time", xlabel="Must not change")
    assert ordinary.snapshot() == before


def test_time_missing_values_keep_existing_gap_and_omission_semantics():
    fig = vs.figure().set_axes(xscale="time")
    line = fig.plot([0, float("nan"), float("inf"), 86_400_000], [1, 2, 3, 4])
    line.set_data(x=[0, float("-inf"), float("nan"), 172_800_000])
    assert scene(fig)["protocolVersion"] == 5


def test_date_format_on_linear_axis_validates_existing_sources_new_data_and_domain():
    fig = vs.figure()
    layer = fig.plot([0, 86_400_000], [1, 2])
    fig.set_axis_format("x", {"kind": "date", "timeZone": "UTC"})
    before = fig.snapshot()
    for mutate in (lambda: layer.set_data(x=[0, 8.64e15 + 1]),
                   lambda: fig.set_axes(xlim=(0, 8.64e15 + 1)),
                   lambda: fig.scatter([0, 8.64e15 + 1], [1, 2])):
        with pytest.raises(ValueError, match="Date range"):
            mutate()
        assert fig.snapshot() == before
    numeric = vs.figure()
    numeric.plot([0, 8.64e15 + 1], [1, 2])
    before = numeric.snapshot()
    with pytest.raises(ValueError, match="Date range"):
        numeric.set_axis_format("x", {"kind": "date"})
    assert numeric.snapshot() == before
    numeric.set_axis_format("x", {"kind": "number"})


def test_legacy_protocols_remain_legacy_and_linked_cohort_is_not_reset_by_presentation():
    first = vs.figure()
    first.plot([1, 2])
    grid = vs.subplots(1, 2)
    stats = vs.figure()
    stats.hist([1, 2])
    linked = vs.subplots(1, 3)
    a = linked.panel(0, 0).scatter([0, 1], [2, 3])
    b = linked.panel(0, 1).scatter([4, 5], [2, 3])
    h = linked.panel(0, 2).hist([2, 3], bins=[0, 4])
    linked.link_selection(scatter=[a, b], histogram=h)
    link = copy.deepcopy(scene(linked)["selectionLink"])
    assert [scene(fig)["protocolVersion"] for fig in (first, grid, stats, linked)] == [1, 2, 3, 4]
    for fig in (first, grid, stats, linked):
        fig.set_theme("dark")
        assert scene(fig)["protocolVersion"] == 5
    assert scene(linked)["selectionLink"] == link


def test_html_serialization_preserves_presentation_and_source_data_without_opening_host(tmp_path, monkeypatch):
    exporter = importlib.import_module("vesora.html")
    template = tmp_path / "template.html"
    template.write_text("__VESORA_PAYLOAD_JSON__", encoding="utf-8")
    monkeypatch.setattr(exporter, "_TEMPLATE", template)
    fig = vs.figure(theme={"fontFamily": "</script>Font & İ"})
    fig.plot(array("d", [0, 86_400_000]), array("d", [1, 2]))
    fig.set_axes(xscale="time")
    fig.set_axis_format("x", {"kind": "date", "timeZone": "UTC"})
    expected = fig.snapshot()
    html = fig.to_html()
    assert "</script>Font" not in html
    assert json.loads(html)["snapshot"] == expected
    assert len(json.loads(html)["buffers"]) == 2
    assert fig._host is fig._widget is fig._window is None


def test_view_events_preserve_formats_and_ignore_stale_clicks():
    from vesora.host import LocalHost
    fig = vs.figure(theme="dark").set_axes(xscale="time")
    fig.set_axis_format("x", {"kind": "date", "timeZone": "UTC"})
    host = LocalHost(fig)
    host._revision = 3
    events = []
    fig.on("click", events.append)
    host._receive({"type": "event", "event": "click", "revision": 2, "payload": {"index": 0}})
    host._receive({"type": "event", "event": "click", "revision": 3, "payload": {"index": 1}})
    assert events == [{"index": 1}]
    host._receive({"type": "event", "event": "viewchange", "revision": 3, "payload": {"xDomain": [0, 86_400_000]}})
    assert scene(fig)["view"]["xFormat"] == {"kind": "date", "timeZone": "UTC"}
    assert scene(fig)["view"]["xDomain"] == [0, 86_400_000]


def test_notebook_transport_keeps_presentation_buffers_and_guards_click_revision():
    pytest.importorskip("anywidget")
    from vesora.host import ASSETS
    from vesora.notebook import make_widget
    if not (ASSETS / "notebook.js").is_file():
        pytest.skip("Build notebook assets before this transport test")
    fig = vs.figure(theme="dark").set_axes(xscale="time")
    fig.plot(array("d", [0, 86_400_000]), [1, 2])
    fig.set_axis_format("x", {"kind": "date", "timeZone": "UTC"})
    widget = make_widget(fig)
    try:
        assert widget.snapshot == fig.snapshot() and len(widget.buffers) == 2
        old = widget.revision
        fig.set_theme("light")
        assert widget.snapshot == fig.snapshot() and widget.revision > old
        clicks = []
        fig.on("click", clicks.append)
        widget._receive(widget, {"type": "event", "event": "click", "revision": old, "payload": {"index": 0}}, [])
        widget._receive(widget, {"type": "event", "event": "click", "revision": widget.revision, "payload": {"index": 1}}, [])
        assert clicks == [{"index": 1}]
    finally:
        widget.close()
        fig.close()


@pytest.mark.skipif(os.environ.get("VESORA_TEST_QT") != "1", reason="Set VESORA_TEST_QT=1 for the real hidden Qt viewer")
def test_real_qt_theme_time_currency_png_and_live_theme_update(tmp_path):
    pytest.importorskip("PySide6")
    from PySide6.QtGui import QImage
    from test_linked_desktop import javascript
    fig = vs.figure(theme="dark", title="Presentation host", width=800, height=520)
    fig.plot([0, 86_400_000], [1, 2], color="#38bdf8")
    fig.set_axes(xscale="time", xlim=(0, 86_400_000), ylim=(0, 3))
    fig.set_axis_format("x", {"kind": "date", "locale": "en-US", "timeZone": "UTC",
                              "options": {"year": "numeric", "month": "short", "day": "numeric"}})
    fig.set_axis_format("y", {"kind": "currency", "currency": "USD", "locale": "en-US",
                              "options": {"currencyDisplay": "code", "maximumFractionDigits": 0}})
    try:
        dark_path = fig.savefig(tmp_path / "presentation-dark.png", timeout=45)
        image = QImage(str(dark_path))
        assert image.pixelColor(10, 10).name() == "#0f172a"
        page = fig._window._vesora_view.page()
        javascript(page, """(() => {
            window.__vesoraPresentationText = [];
            const original = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
                window.__vesoraPresentationText.push(String(text));
                return original.call(this, text, ...args);
            };
            return true;
        })()""")
        fig.set_theme("light")
        light_path = fig.savefig(tmp_path / "presentation-light.png", timeout=45)
        assert QImage(str(light_path)).pixelColor(10, 10).name() == "#ffffff"
        labels = json.loads(javascript(page, "JSON.stringify(window.__vesoraPresentationText)"))
        assert any("1970" in label for label in labels)
        assert any("USD" in label for label in labels)
        serialized = json.loads(javascript(page, "JSON.stringify(window.vesoraFigure.snapshot())"))
        assert serialized["figure"]["theme"] == scene(fig)["theme"]
        assert serialized["figure"]["view"]["xFormat"] == scene(fig)["view"]["xFormat"]
    finally:
        fig.close()
        vs.process_events()
