"""Aligned source contracts and state retention for the shared linked engine."""
import base64
import importlib
import json
import math

import pytest

import vesora as vs
from vesora.host import LocalHost


def linked_figure(n=4):
    fig = vs.subplots(1, 3)
    values = list(range(n))
    a = fig.panel(0, 0).scatter(values, values)
    b = fig.panel(0, 1).scatter(values, [value * 2 for value in values])
    h = fig.panel(0, 2).hist(values, bins=2)
    link = fig.link_selection(scatter=[a, b], histogram=h)
    return fig, a, b, h, link


def payload(fig, a, link, *, sequence=1, count=2, active=True):
    total = fig._layer_arrays(a._spec())["x"].size
    result = {"kind": "linked", "linkId": link.id, "generation": 1, "sequence": sequence,
              "layerId": a.id, "panelId": a._spec().get("panelId", "main"),
              "count": count if active else 0, "total": total,
              "fraction": count / total if total and active else 0,
              "indices": list(range(min(count, 10_000))) if active else [],
              "truncated": active and count > 10_000, "active": active}
    if active:
        result["bounds"] = {"x": [0, 1], "y": [0, 1]}
    return result


def test_link_snapshot_clear_remove_and_members_are_atomic():
    fig, a, b, h, link = linked_figure()
    state = fig.snapshot()
    assert state["figure"]["protocolVersion"] == vs.LINKED_PROTOCOL_VERSION == 4
    assert state["figure"]["selectionLink"] == {"id": link.id, "scatter": [a.id, b.id],
                                                "histogram": h.id, "generation": 1, "sequence": 0}
    published = []
    fig._listeners.append(lambda: published.append(fig.snapshot()))
    for mutate in (lambda: a.set_data(y=[2, 3, 4, 5]), lambda: b.set_data([1], [2]),
                   lambda: h.set_data([2, 3, 4, 5]), lambda: h.set_options(bins=3),
                   lambda: fig.link_selection(scatter=[a, b], histogram=h)):
        with pytest.raises(ValueError):
            mutate()
        assert fig.snapshot() == state
    assert published == []
    a.set_visible(False)
    b.set_style(opacity=.4)
    assert fig.snapshot()["figure"]["selectionLink"] == state["figure"]["selectionLink"]
    assert link.clear() is link
    assert fig.snapshot()["figure"]["selectionLink"]["sequence"] == 1
    assert "selection" not in fig.snapshot()["figure"]["selectionLink"]
    link.remove()
    assert "selectionLink" not in fig.snapshot()["figure"]
    h.set_options(bins=3)
    a.set_data(y=[2, 3, 4, 5])
    with pytest.raises(RuntimeError, match="removed"):
        link.clear()
    again = fig.link_selection(scatter=[a, b], histogram=h)
    assert again.id != link.id
    assert fig.snapshot()["figure"]["selectionLink"]["sequence"] == 0


@pytest.mark.parametrize("member", [0, 1, 2])
def test_removing_a_member_unlinks_and_releases_remaining_members(member):
    fig, a, b, h, link = linked_figure()
    [a, b, h][member].remove()
    assert "selectionLink" not in fig.snapshot()["figure"]
    with pytest.raises(RuntimeError, match="removed"):
        link.remove()
    remaining = b if member == 0 else a
    remaining.set_data(y=[4, 3, 2, 1])


@pytest.mark.parametrize("invalid", ["same", "length", "categorical", "line", "panel", "density", "cumulative", "foreign", "removed", "arity"])
def test_link_rejects_incompatible_workflows_without_mutation(invalid):
    fig, a, b, h, link = linked_figure()
    link.remove()
    scatter = [a, b]
    if invalid == "same":
        scatter = [a, a]
    elif invalid == "length":
        b.set_data([0, 1], [2, 3])
    elif invalid == "categorical":
        # A separate figure avoids permanently established numeric axis modes.
        fig = vs.subplots(1, 3)
        a = fig.panel(0, 0).scatter(["A", "B"], [1, 2])
        b = fig.panel(0, 1).scatter([0, 1], [2, 3])
        h = fig.panel(0, 2).hist([1, 2])
        scatter = [a, b]
    elif invalid == "line":
        scatter[1] = fig.panel(0, 1).plot([0, 1, 2, 3])
    elif invalid == "panel":
        scatter[1] = fig.panel(0, 0).scatter([0, 1, 2, 3], [0, 1, 2, 3])
    elif invalid in ("density", "cumulative"):
        h.set_options(**{invalid: True})
    elif invalid == "foreign":
        scatter[1] = vs.figure().scatter([0, 1, 2, 3], [0, 1, 2, 3])
    elif invalid == "removed":
        b.remove()
    else:
        scatter = [a]
    before = fig.snapshot()
    with pytest.raises((ValueError, RuntimeError)):
        fig.link_selection(scatter=scatter, histogram=h)
    assert fig.snapshot() == before


def test_browser_selection_updates_snapshot_before_callback_without_echo():
    fig, a, b, h, link = linked_figure()
    emitted, published = [], []
    fig.on("selection", lambda event: emitted.append((event, fig.snapshot())))
    fig._listeners.append(lambda: published.append(True))
    event = payload(fig, a, link)
    event["bounds"] = {"x": [1, 1], "y": [1, 1]}
    fig._emit("selection", event)
    assert emitted[0][1]["figure"]["selectionLink"]["selection"] == {"originLayerId": a.id, "bounds": event["bounds"]}
    assert published == []
    # A cohort changes no source data, versions, options or base bin edges.
    stable = fig.snapshot()
    for stale in (event, {**event, "sequence": 0}, {**event, "generation": 2, "sequence": 5}, {**event, "linkId": "other", "sequence": 5}):
        fig._emit("selection", stale)
    assert fig.snapshot() == stable
    assert len(emitted) == 1
    link.clear()
    clear_sequence = fig.snapshot()["figure"]["selectionLink"]["sequence"]
    fig._emit("selection", {**event, "sequence": clear_sequence - 1})
    assert "selection" not in fig.snapshot()["figure"]["selectionLink"]
    cleared = payload(fig, b, link, sequence=clear_sequence, active=False)
    fig._emit("selection", cleared)
    fig._emit("selection", cleared)
    assert len(emitted) == 2
    assert fig.snapshot()["figure"]["selectionLink"]["sequence"] == clear_sequence


def test_last_javascript_safe_sequence_is_accepted_but_clear_cannot_overflow():
    fig, a, b, h, link = linked_figure()
    received, published = [], []
    fig.on("selection", received.append)
    fig._listeners.append(lambda: published.append(True))
    event = payload(fig, a, link, sequence=2**53 - 1)
    fig._emit("selection", event)
    assert received == [event]
    retained = fig.snapshot()
    assert retained["figure"]["selectionLink"]["sequence"] == 2**53 - 1
    assert "selection" in retained["figure"]["selectionLink"]
    with pytest.raises(ValueError, match="safe integer"):
        link.clear()
    assert fig.snapshot() == retained
    assert published == []


@pytest.mark.parametrize("change", [
    {"layerId": "absent"}, {"panelId": "absent"}, {"active": 1}, {"sequence": True},
    {"sequence": 2**53},
    {"bounds": {"x": [1, 0], "y": [0, 1]}}, {"bounds": {"x": [0, math.inf], "y": [0, 1]}},
    {"count": 5}, {"fraction": .9}, {"indices": [0, 0]}, {"truncated": True},
])
def test_invalid_selection_is_atomic(change):
    fig, a, b, h, link = linked_figure()
    before = fig.snapshot()
    received = []
    fig.on("selection", received.append)
    with pytest.raises(ValueError):
        fig._emit("selection", {**payload(fig, a, link), **change})
    assert fig.snapshot() == before
    assert received == []


def test_truncated_event_preserves_exact_count_but_only_retains_predicate():
    fig, a, b, h, link = linked_figure(10_001)
    received = []
    fig.on("selection", received.append)
    event = payload(fig, a, link, count=10_001)
    fig._emit("selection", event)
    assert received[0]["count"] == 10_001
    assert len(received[0]["indices"]) == 10_000
    scene_link = fig.snapshot()["figure"]["selectionLink"]
    assert "indices" not in scene_link and "count" not in scene_link
    assert scene_link["selection"]["bounds"] == event["bounds"]


def test_export_retains_cohort_predicate_and_all_unreduced_source_bytes(tmp_path, monkeypatch):
    exporter = importlib.import_module("vesora.html")
    template = tmp_path / "standalone.html"
    template.write_text('__VESORA_PAYLOAD_JSON__', encoding="utf-8")
    monkeypatch.setattr(exporter, "_TEMPLATE", template)
    fig, a, b, h, link = linked_figure()
    before = fig.snapshot()
    fig._emit("selection", payload(fig, b, link))
    document = json.loads(fig.to_html())
    assert document["snapshot"] == fig.snapshot()
    assert document["snapshot"]["sources"] == before["sources"]
    assert document["snapshot"]["figure"]["selectionLink"]["selection"]["originLayerId"] == b.id
    assert len(document["buffers"]) == 5
    for source, data in zip(document["snapshot"]["sources"], document["buffers"]):
        assert data["id"] == source["id"]
        assert base64.b64decode(data["base64"]) == fig._data_bytes(source["id"], source["version"])
    assert fig._host is fig._window is fig._widget is None


def test_desktop_ignores_obsolete_selection_revisions_and_preserves_current_state():
    fig, a, b, h, link = linked_figure()
    host = LocalHost(fig)
    host._revision = 3
    received = []
    fig.on("selection", received.append)
    event = payload(fig, a, link)
    for stale in (2, None):
        host._receive({"type": "event", "event": "selection", "revision": stale, "payload": event})
    assert received == [] and "selection" not in fig.snapshot()["figure"]["selectionLink"]
    host._receive({"type": "event", "event": "selection", "revision": 3, "payload": event})
    assert received == [event]
    assert host._revision == 3
    assert fig.snapshot()["figure"]["selectionLink"]["selection"]["originLayerId"] == a.id
    # An unlink followed by relinking also rejects a late old-link event.
    link.remove()
    next_link = fig.link_selection(scatter=[a, b], histogram=h)
    host._receive({"type": "event", "event": "selection", "revision": 3, "payload": {**event, "sequence": 8}})
    assert fig.snapshot()["figure"]["selectionLink"]["id"] == next_link.id
    assert "selection" not in fig.snapshot()["figure"]["selectionLink"]


def test_notebook_ignores_obsolete_linked_selection_revisions():
    pytest.importorskip("anywidget")
    from vesora.notebook import make_widget
    from vesora.host import ASSETS
    if not (ASSETS / "notebook.js").is_file():
        pytest.skip("Build notebook assets before this integration test")
    fig, a, b, h, link = linked_figure()
    widget = make_widget(fig)
    received = []
    fig.on("selection", received.append)
    try:
        event = payload(fig, a, link)
        revision = widget.revision
        for stale in (revision - 1, None):
            widget._receive(widget, {"type": "event", "event": "selection", "revision": stale, "payload": event}, [])
        assert received == []
        widget._receive(widget, {"type": "event", "event": "selection", "revision": revision, "payload": event}, [])
        assert received == [event] and widget.revision == revision
        assert fig.snapshot()["figure"]["selectionLink"]["selection"]["originLayerId"] == a.id
        a.set_style(size=4)
        assert widget.snapshot == fig.snapshot()
        assert widget.revision > revision
    finally:
        widget.close()
        fig.close()
