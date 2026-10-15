"""Atomic acceptance and versioned presentation are independent contracts."""
import copy

import pytest

import vesora as vs
from vesora.host import LocalHost
from vesora.transport import TransferQueue, MAX_PENDING_UPDATES


def test_multi_series_append_commits_once_or_rejects_every_series():
    fig = vs.figure()
    a = fig.plot([0.], [1.]).enable_streaming(max_points=2)
    b = fig.plot([0.], [2.]).enable_streaming(max_points=2)
    observed = []
    fig._listeners.append(lambda: observed.append((copy.deepcopy(fig._last_change), fig._frozen_transfer())))
    before = fig._frozen_transfer()
    with pytest.raises(ValueError, match="matching lengths"):
        fig.append_data_batch([(a, {"x": [1.], "y": [3.]}), (b, {"x": [1.], "y": [4., 5.]})])
    assert fig._frozen_transfer() == before and not observed
    assert fig.append_data_batch([(a, {"x": [1., 2.], "y": [3., 4.]}), (b, {"x": [1., 2.], "y": [5., 6.]})]) is fig
    assert len(observed) == 1 and observed[0][0]["kind"] == "append-batch"
    assert [update["state"]["nextSequence"] for update in observed[0][0]["updates"]] == [3, 3]
    assert list(fig._layer_arrays(a._spec())["x"]) == [1., 2.]
    assert list(fig._layer_arrays(b._spec())["y"]) == [5., 6.]
    stable = fig._frozen_transfer()
    with pytest.raises(ValueError, match="at most once"):
        fig.append_data_batch([(a, {"x": [3.], "y": [7.]}), (a, {"x": [4.], "y": [8.]})])
    assert fig._frozen_transfer() == stable
    fig.append_data_batch([(a, {"x": [], "y": []}), (b, {"x": [], "y": []})])
    assert len(observed) == 1
    fig.close()


def test_v3_preserves_transaction_boundaries_and_v2_resyncs_atomic_batches():
    fig = vs.figure()
    a = fig.plot([0.], [1.]).enable_streaming(max_points=3)
    b = fig.plot([0.], [2.]).enable_streaming(max_points=3)
    modern, legacy = TransferQueue(fig._frozen_transfer, 0, 3), TransferQueue(fig._frozen_transfer, 0, 2)
    for queue in (modern, legacy):
        header, _ = queue.next()
        assert queue.acknowledge(header["transferId"], 0)
    revision = 0
    def publish():
        nonlocal revision
        revision += 1
        for queue in (modern, legacy):
            queue.update(revision, fig._last_change)
    fig._listeners.append(publish)
    fig.append_data_batch([(a, {"x": [1.], "y": [3.]}), (b, {"x": [1.], "y": [4.]})])
    a.append_data(x=[2.], y=[5.])
    header, buffers = modern.next()
    assert header["transportVersion"] == 3
    assert [transaction["revision"] for transaction in header["transactions"]] == [1, 2]
    assert [len(transaction["updates"]) for transaction in header["transactions"]] == [2, 1]
    assert sum(map(len, buffers)) == 48
    assert legacy.next()[0]["type"] == "stream-snapshot"
    fig.close()


def test_listener_failure_does_not_report_a_committed_append_as_rejected(caplog):
    fig = vs.figure()
    line = fig.plot([0.], [1.]).enable_streaming(max_points=3)
    observed = []
    def broken():
        raise RuntimeError("observer failed")
    fig._listeners.extend([broken, lambda: observed.append(fig._streams[line.id]["nextSequence"])])
    assert line.append_data(x=[1.], y=[2.]) is line
    assert "change listener failed" in caplog.text
    assert observed == [2] and list(fig._layer_arrays(line._spec())["x"]) == [0., 1.]
    fig.close()


def test_qt_static_export_uses_accepted_snapshot_without_waiting_for_live_frame(monkeypatch, tmp_path):
    from concurrent.futures import Future
    import threading
    from types import SimpleNamespace
    import vesora.qt as qt

    fig = vs.figure()
    line = fig.plot([0., 1.], [2., 3.])
    expected = fig._frozen_transfer()
    exports = []
    def export(**options):
        exports.append(options["_frozen"])
        result = Future()
        result.set_result(b"\x89PNG\r\n\x1a\n")
        return result
    host = SimpleNamespace(ready=threading.Event(), _views={"binary-view": object()}, export=export)
    def ensure_window(figure, *, visible):
        figure._host = host
        line.set_data(y=[8., 9.])
    monkeypatch.setattr(qt, "_ensure_window", ensure_window)
    monkeypatch.setattr(qt, "process_events", lambda: pytest.fail("Accepted export must not wait for a frozen live frame"))
    try:
        fig.savefig(tmp_path / "accepted.png")
        assert exports == [expected]
        assert fig._frozen_transfer() != expected
    finally:
        fig._host = None
        fig.close()


def test_v3_accepted_ack_does_not_claim_rendering_or_accept_unowned_events():
    fig = vs.figure()
    layer = fig.plot([0.], [1.]).enable_streaming(max_points=3)
    host = LocalHost(fig)
    socket = object()
    queue = TransferQueue(fig._frozen_transfer, 0, 3)
    host._views[socket] = queue
    header, _ = queue.next()
    host._receive({"type": "ack", "transferId": header["transferId"], "revision": 0}, socket)
    assert not host.ready.is_set()
    assert queue.presented_revision is None and queue.acknowledged == 0
    assert not queue.accepts_events(0, 1)
    host._receive({"type": "frame", "revision": 0, "frameId": 1, "mode": "live"}, socket)
    assert host.ready.is_set() and queue.accepts_events(0, 1)
    assert queue.presented_revision == 0
    host._receive({"type": "frame", "revision": 0, "frameId": 1, "mode": "frozen", "snapshotId": "held"}, socket)
    assert queue.accepts_events(0, 1, "held") and not queue.accepts_events(0, 1, "other")
    assert queue.presented_revision is None
    before = fig.snapshot()
    host._receive({"type": "event", "event": "viewchange", "revision": 0, "frameId": 1, "snapshotId": "held", "payload": {"xDomain": [100, 200]}}, socket)
    assert fig.snapshot() == before
    # A later source reset must not allow an arbitrary old live frame to reappear.
    queue.update(1, None)
    reset, _ = queue.next()
    queue.acknowledge(reset["transferId"], 1)
    assert not queue.record_frame(0, 2, "live")
    assert queue.record_frame(0, 2, "frozen", "held")
    assert not queue.record_frame(0, 3, "frozen", "unregistered")
    assert queue.record_frame(1, 3, "live")
    assert not queue.accepts_events(0, 2, "held")
    fig.close()


def test_live_frame_events_are_stale_after_reset_but_not_after_append():
    fig = vs.figure()
    queue = TransferQueue(fig._frozen_transfer, 0, 3)
    header, _ = queue.next()
    queue.acknowledge(header["transferId"], 0)
    assert queue.record_frame(0, 1, "live")
    queue.update(1, {"kind": "append", "layerId": "layer", "channels": [], "state": {}})
    assert queue.accepts_events(0, 1)
    queue.update(2, None)
    assert not queue.accepts_events(0, 1)
    fig.close()


def test_v3_counts_each_batch_member_against_pending_metadata_budget():
    fig = vs.figure()
    queue = TransferQueue(fig._frozen_transfer, 0, 3)
    header, _ = queue.next()
    queue.acknowledge(header["transferId"], 0)
    update = {"kind": "append", "layerId": "layer", "channels": [{"buffer": b"x"}], "state": {}}
    queue.update(1, {"kind": "append-batch", "updates": [update] * MAX_PENDING_UPDATES})
    assert queue.pending_records == MAX_PENDING_UPDATES
    queue.update(2, update)
    assert queue.needs_snapshot and queue.pending_records == 0 and queue.pending_bytes == 0
    fig.close()


def test_notebook_negotiates_v3_and_advances_without_render_ack():
    pytest.importorskip("anywidget")
    from vesora.notebook import make_widget
    fig = vs.figure()
    layer = fig.plot([0.], [1.]).enable_streaming(max_points=3)
    widget = make_widget(fig)
    sent = []
    widget.send = lambda message, buffers=None: sent.append((message, buffers))
    try:
        widget._receive(widget, {"type": "hello", "viewId": "modern", "transportVersion": 2, "supportedTransportVersions": [2, 3]}, [])
        initial = sent[-1][0]
        assert initial["transportVersion"] == 3
        widget._receive(widget, {"type": "ack", "viewId": "modern", "transferId": initial["transferId"], "revision": initial["revision"]}, [])
        layer.append_data(x=[1.], y=[2.])
        assert sent[-1][0]["type"] == "stream-delta"
        assert widget._views["modern"].frame is None
    finally:
        widget.close()
        fig.close()


def test_reconnect_restores_only_the_same_views_registered_frozen_frame():
    fig = vs.figure()
    host = LocalHost(fig)
    first, second, stranger = object(), object(), object()
    hello = {"type": "hello", "transportVersion": 2, "supportedTransportVersions": [2, 3], "viewId": "stable-view"}
    host._receive(hello, first)
    queue = host._views[first]
    header, _ = queue.next()
    host._receive({"type": "ack", "transferId": header["transferId"], "revision": 0}, first)
    host._receive({"type": "frame", "revision": 0, "frameId": 2, "mode": "frozen", "snapshotId": "held"}, first)
    host._views.pop(first)
    host._view_ids.pop(first)
    host._revision = 3
    held = {"revision": 0, "frameId": 4, "snapshotId": "held"}
    host._receive({**hello, "heldFrame": held}, second)
    resumed = host._views[second]
    header, _ = resumed.next()
    assert header["inspectionRegistration"] == "restored"
    host._receive({"type": "ack", "transferId": header["transferId"], "revision": 3}, second)
    host._receive({"type": "frame", **held, "mode": "frozen"}, second)
    assert resumed.accepts_events(0, 4, "held")
    clicked = []
    fig.on("click", clicked.append)
    host._receive({"type": "event", "event": "click", **held, "payload": {"x": 1}}, second)
    assert clicked == [{"x": 1}]
    host._receive({**hello, "viewId": "different-view", "heldFrame": held}, stranger)
    assert host._views[stranger].next()[0]["inspectionRegistration"] == "unrecognized"
    assert host._views[stranger].frame is None
    host._receive({"type": "frame", "revision": 3, "frameId": 5, "mode": "live"}, second)
    assert "stable-view" not in host._held_frames
    host.close()
    fig.close()


@pytest.mark.parametrize("registration", [
    {"revision": 1, "frameId": 4, "snapshotId": "held"},
    {"revision": 0, "frameId": 1, "snapshotId": "held"},
    {"revision": 0, "frameId": 4, "snapshotId": "other"},
    {"revision": 0, "frameId": True, "snapshotId": "held"},
])
def test_reconnect_rejects_mismatched_or_regressing_snapshot_claims(registration):
    queue = TransferQueue(lambda: ({}, [], {}), 3, 3)
    previous = {"revision": 0, "frameId": 2, "mode": "frozen", "snapshotId": "held"}
    assert not queue.restore_frozen_frame(registration, previous)
    assert queue.frame is None


def test_disconnected_frozen_view_ownership_metadata_is_bounded():
    from vesora.host import MAX_HELD_VIEW_SESSIONS
    fig = vs.figure()
    host = LocalHost(fig)
    for index in range(MAX_HELD_VIEW_SESSIONS + 3):
        socket = object()
        host._receive({"type": "hello", "transportVersion": 3, "viewId": f"view-{index}"}, socket)
        queue = host._views[socket]
        header, _ = queue.next()
        queue.acknowledge(header["transferId"], 0)
        host._receive({"type": "frame", "revision": 0, "frameId": 1, "mode": "frozen", "snapshotId": f"snapshot-{index}"}, socket)
        host._views.pop(socket)
        host._view_ids.pop(socket)
    assert len(host._held_frames) == MAX_HELD_VIEW_SESSIONS
    assert "view-0" not in host._held_frames
    host.close()
    assert not host._held_frames
    fig.close()
