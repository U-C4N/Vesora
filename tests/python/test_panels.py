"""Panel scenes preserve shared-axis, annotation and host revision semantics."""
import copy
import importlib
import json

import pytest

import vesora as vs


def views(fig):
    scene = fig.snapshot()["figure"]
    return {"main": scene["view"], **{p["id"]: p["view"] for p in scene.get("panels", []) if p["id"] != "main"}}


def test_grid_panels_route_layers_and_share_one_figure():
    fig = vs.subplots(2, 2, title="Experiment", width=1000, height=700)
    main, secondary = fig.panel(0, 0), fig.panel(1, 1)
    assert main.figure is secondary.figure is fig
    main.set_title("Signal").plot([1, 2], [3, 4])
    layer = secondary.set_title("Residual").scatter([1, 2], [5, 6])
    fig.panel(0, 1).heatmap([[1, 2], [3, 4]])
    vs.plot([4, 5])  # Top-level convenience calls still target the main panel.
    scene = fig.snapshot()["figure"]
    assert scene["protocolVersion"] == 2
    assert scene["layout"] == {"rows": 2, "cols": 2, "shareX": False, "shareY": False}
    assert [panel["id"] for panel in scene["panels"]] == ["main", "panel-0-1", "panel-1-0", "panel-1-1"]
    assert "view" not in scene["panels"][0]
    assert scene["title"] == "Experiment" and scene["panels"][0]["title"] == "Signal"
    assert [entry.get("panelId", "main") for entry in scene["layers"]] == ["main", "panel-1-1", "panel-0-1", "main"]
    layer.set_data(y=[7, 8]).set_style(color="#123456")
    before = fig.snapshot()
    owned = set(before["figure"]["layers"][1]["data"].values())
    layer.remove()
    assert not owned.intersection(source["id"] for source in fig.snapshot()["sources"])
    assert len(fig.snapshot()["figure"]["layers"]) == 3


@pytest.mark.parametrize("rows,cols", [(0, 1), (1, -1), (1.5, 1), (True, 1)])
def test_grid_dimensions_are_positive_integers(rows, cols):
    with pytest.raises(ValueError, match="positive integers"):
        vs.subplots(rows, cols)


def test_grid_options_panel_bounds_and_3d_reject_without_mutation():
    with pytest.raises(TypeError, match="booleans"):
        vs.subplots(1, 2, sharex="yes")
    with pytest.raises(ValueError, match="2D"):
        vs.subplots(1, 2, kind="3d")
    fig = vs.subplots(1, 2)
    before = fig.snapshot()
    with pytest.raises(IndexError):
        fig.panel(1, 0)
    with pytest.raises(TypeError):
        fig.panel(0, True)
    with pytest.raises(ValueError, match="2D"):
        fig.scatter3d([1], [2], [3])
    assert fig.snapshot() == before
    fig.close()
    with pytest.raises(RuntimeError, match="closed"):
        fig.panel(0, 0)


def test_linked_axis_scales_and_domains_preserve_independent_labels():
    fig = vs.subplots(1, 2, sharex=True)
    left, right = fig.panel(0, 0), fig.panel(0, 1)
    left.set_axes(xlim=(1, 10), xlabel="time", ylim=(-2, 2), ylabel="signal")
    right.set_axes(xscale="log", xlabel="seconds", ylim=(10, 20), ylabel="residual")
    current = views(fig)
    assert all(view["xScale"] == "log" and view["xDomain"] == [1, 10] for view in current.values())
    assert current["main"]["xLabel"] == "time" and current["panel-0-1"]["xLabel"] == "seconds"
    assert current["main"]["yDomain"] == [-2, 2] and current["panel-0-1"]["yDomain"] == [10, 20]
    stable = fig.snapshot()
    with pytest.raises(ValueError, match="positive"):
        right.set_axes(xlim=(-1, 10), ylabel="must not commit")
    assert fig.snapshot() == stable
    right.set_axes(xlim=None)
    assert all("xDomain" not in view for view in views(fig).values())


def test_grid_bookmarks_restore_all_views_without_restoring_annotations_or_data():
    fig = vs.subplots(1, 2, sharey=True)
    right = fig.panel(0, 1)
    layer = right.plot([1, 2], [3, 4])
    marker = right.axhline(4, color="red")
    initial = views(fig)
    fig.bookmark("Overview")
    fig.set_axes(xlim=(1, 2), xlabel="Left")
    right.set_axes(xlim=(4, 8), ylim=(2, 6), xlabel="Right")
    focus = views(fig)
    fig.bookmark("Focus")
    marker.update(y=5)
    layer.set_data(y=[8, 9])
    sources, annotations = fig.snapshot()["sources"], fig.snapshot()["figure"]["annotations"]
    fig.restore_bookmark("Overview")
    assert views(fig) == initial
    assert fig.snapshot()["sources"] == sources
    assert fig.snapshot()["figure"]["annotations"] == annotations
    fig.restore_bookmark("Focus")
    assert views(fig) == focus
    bookmark = fig.snapshot()["figure"]["bookmarks"][1]
    assert set(bookmark["panelViews"]) == {"panel-0-1"}
    right.set_axes(xlabel="Changed")
    assert bookmark["panelViews"]["panel-0-1"]["xLabel"] == "Right"
    single = vs.subplots(1, 1).bookmark("One")
    assert single.snapshot()["figure"]["bookmarks"][0]["panelViews"] == {}


def test_annotations_are_atomic_mutable_and_do_not_create_numeric_sources():
    fig = vs.subplots(1, 2)
    right = fig.panel(0, 1)
    note = right.text(2, 3, "Peak", font_size=14, color="blue")
    horizontal = right.axhline(4, width=2, opacity=0.4)
    vertical = fig.axvline(2)
    assert note.update(x=5, text="Updated", font_size=16) is note
    annotations = fig.snapshot()["figure"]["annotations"]
    assert annotations[0] == {"id": note.id, "kind": "text", "panelId": "panel-0-1", "x": 5, "y": 3,
                              "text": "Updated", "style": {"color": "blue", "fontSize": 16}}
    assert "panelId" not in annotations[2]
    assert fig.snapshot()["sources"] == []
    before = fig.snapshot()
    for options in ({"y": float("nan")}, {"opacity": 2}, {"font_size": 0}, {"width": True}, {"opacity": "0.5"},
                    {"panelId": "main"}, {"style": {"color": "red"}}):
        with pytest.raises((TypeError, ValueError)):
            note.update(**options)
        assert fig.snapshot() == before
    with pytest.raises(TypeError, match="Unknown"):
        horizontal.update(x=2)
    horizontal.remove()
    with pytest.raises(RuntimeError, match="removed"):
        horizontal.update(y=8)
    vertical.remove()
    assert len(fig.snapshot()["figure"]["annotations"]) == 1
    fig.close()
    with pytest.raises(RuntimeError, match="closed"):
        note.remove()


def test_removing_last_annotation_retains_protocol_and_invalidates_handle():
    fig = vs.figure()
    note = fig.text(1, 2, "Note")
    note.remove()
    assert "annotations" not in fig.snapshot()["figure"]
    assert fig.snapshot()["figure"]["protocolVersion"] == 2
    with pytest.raises(RuntimeError, match="removed"):
        note.remove()


def test_legacy_protocol_and_3d_remain_compatible():
    fig = vs.figure()
    fig.panel(0, 0).plot([1, 2])
    fig.bookmark("Overview")
    scene = fig.snapshot()["figure"]
    assert scene["protocolVersion"] == vs.PROTOCOL_VERSION == 1
    assert not {"layout", "panels", "annotations"}.intersection(scene)
    assert "panelViews" not in scene["bookmarks"][0]
    fig.text(0, 1, "Label")
    assert fig.snapshot()["figure"]["protocolVersion"] == vs.EXTENDED_PROTOCOL_VERSION == 2
    with pytest.raises(ValueError, match="2D"):
        fig.scatter3d([1], [2], [3])
    three = vs.figure()
    three.scatter3d([1], [2], [3])
    before = three.snapshot()
    with pytest.raises(ValueError, match="2D"):
        three.axhline(1)
    assert three.snapshot() == before and before["figure"]["protocolVersion"] == 1


def test_grid_viewchange_is_atomic_preserves_labels_and_does_not_publish():
    fig = vs.subplots(1, 2, sharex=True)
    fig.set_axes(xlabel="left")
    fig.panel(0, 1).set_axes(xlabel="right")
    published = []
    fig._listeners.append(lambda: published.append(True))
    fig._emit("viewchange", {"panelId": "panel-0-1", "xDomain": [1, 3],
                             "panelViews": {"panel-0-1": {"xDomain": [1, 3], "yDomain": [2, 4]}}})
    assert published == []
    current = views(fig)
    assert all(view["xDomain"] == [1, 3] for view in current.values())
    assert current["main"]["xLabel"] == "left" and current["panel-0-1"]["xLabel"] == "right"
    before = fig.snapshot()
    with pytest.raises(ValueError):
        fig._accept_view({"xDomain": [10, 20], "panelViews": {"panel-0-1": {"yDomain": [5, 2]}}})
    assert fig.snapshot() == before
    fig._accept_view({"panelId": "panel-0-1", "xDomain": None, "panelViews": {"panel-0-1": {"xDomain": None, "yDomain": None}}})
    assert all("xDomain" not in view for view in views(fig).values())
    assert "yDomain" not in views(fig)["panel-0-1"]


@pytest.mark.parametrize("transport", ["desktop", "notebook"])
def test_grid_hosts_ignore_stale_views_and_keep_panel_selection_identity(transport):
    fig = vs.subplots(1, 2, sharex=True)
    fig.bookmark("Overview")
    if transport == "notebook":
        pytest.importorskip("anywidget")
        from vesora.notebook import make_widget
        host = make_widget(fig)
        revision = lambda: host.revision
        receive = lambda message: host._receive(host, message, [])
    else:
        from vesora.host import LocalHost
        host = LocalHost(fig)
        host._revision = 1
        revision = lambda: host._revision
        receive = host._receive
    try:
        current = revision()
        payload = {"panelId": "panel-0-1", "xDomain": [1, 2], "panelViews": {"panel-0-1": {"xDomain": [1, 2]}}}
        for stale in (None, current - 1):
            receive({"type": "event", "event": "viewchange", "revision": stale, "payload": payload})
        assert all("xDomain" not in view for view in views(fig).values())
        receive({"type": "event", "event": "viewchange", "revision": current, "payload": payload})
        assert all(view["xDomain"] == [1, 2] for view in views(fig).values())
        selections = []
        fig.on("selection", selections.append)
        receive({"type": "event", "event": "selection", "payload": {"panelId": "panel-0-1", "count": 1}})
        assert selections == [{"panelId": "panel-0-1", "count": 1}]
    finally:
        host.close()
        fig.close()


def test_panel_html_export_preserves_scene_and_escapes_annotation_text(tmp_path, monkeypatch):
    exporter = importlib.import_module("vesora.html")
    template = tmp_path / "template.html"
    template.write_text("__VESORA_PAYLOAD_JSON__", encoding="utf-8")
    monkeypatch.setattr(exporter, "_TEMPLATE", template)
    fig = vs.subplots(1, 2, sharex=True)
    text = '</script><script>alert("x")</script> & İ'
    fig.panel(0, 1).set_title(text).text(1, 2, text)
    fig.panel(0, 1).plot([1, 2], [3, 4])
    fig.bookmark("Overview")
    original = copy.deepcopy(fig.snapshot())
    html = fig.to_html()
    assert text not in html
    assert json.loads(html)["snapshot"] == original
    assert fig._host is fig._widget is fig._window is None
