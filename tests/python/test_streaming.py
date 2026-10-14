from array import array
import copy
import json
import math
import struct

import pytest

import vesora as vs
from vesora.numeric import ChunkedNumericData
from vesora.transport import TransferQueue, MAX_PENDING_BYTES, MAX_PENDING_UPDATES, binary_packet


def values(layer, channel="x"):
    return list(layer.figure._layer_arrays(layer._spec())[channel])


def test_bounded_append_dtype_ownership_and_epoch_reset():
    fig = vs.figure()
    layer = fig.plot(array("f", [0, 1]), array("f", [10, 11]))
    layer.enable_streaming(max_points=3)
    original = copy.deepcopy(fig._streams[layer.id])
    incoming = array("f", [2, 3, 4, 5])
    layer.append_data(x=incoming, y=array("f", [12, 13, 14, 15]))
    incoming[3] = -999
    assert values(layer) == [3, 4, 5]
    state = fig._streams[layer.id]
    assert state == {**original, "nextSequence": 6, "retained": 3, "evicted": 3, "revision": 1}
    assert all(item[0]["dtype"] == "float32" for item in fig._sources.values())
    assert "stream" not in json.dumps(fig.snapshot())
    layer.set_data(array("f", [6]), array("f", [16]))
    assert fig._streams[layer.id]["streamId"] != original["streamId"]
    assert fig._streams[layer.id]["maxPoints"] == 3
    layer.disable_streaming()
    assert values(layer) == [6]
    with pytest.raises(RuntimeError, match="enable_streaming"):
        layer.append_data(x=array("f", [7]), y=array("f", [17]))
    fig.close()


def test_append_validation_is_atomic_and_empty_is_noop():
    fig = vs.figure()
    layer = fig.scatter([0., 1.], [2., 3.], color=[5., 6.]).enable_streaming(max_points=4)
    before, buffers, states = fig._frozen_transfer()
    for channels in ({"x": [2.], "y": [4.]},
                     {"x": [2.], "y": [4., 5.], "color": [6.]},
                     {"x": array("f", [2]), "y": [4.], "color": [6.]}):
        with pytest.raises((TypeError, ValueError)):
            layer.append_data(**channels)
        assert fig._frozen_transfer() == (before, buffers, states)
    layer.append_data(x=[], y=[], color=[])
    assert fig._frozen_transfer() == (before, buffers, states)
    layer.append_data(x=[math.nan], y=[math.inf], color=[math.nan])
    assert math.isnan(values(layer)[-1])
    fig.close()


def test_append_does_not_materialize_or_scan_retained_history(monkeypatch):
    fig = vs.figure()
    layer = fig.plot(list(range(1000)), list(range(1000))).enable_streaming(max_points=1000)
    def forbidden(*args, **kwargs):
        raise AssertionError("append scanned/materialized history")
    with monkeypatch.context() as patch:
        patch.setattr(ChunkedNumericData, "__iter__", forbidden)
        patch.setattr(ChunkedNumericData, "tobytes", forbidden)
        layer.append_data(x=[1000.], y=[1000.])
    assert values(layer) == list(range(1, 1001))
    fig.close()


def test_x_hover_append_checks_boundary_and_time_bounds():
    fig = vs.figure()
    layer = fig.plot([0., 1.], [2., 3.]).enable_streaming(max_points=2)
    fig.set_hover_mode("x")
    before = fig._frozen_transfer()
    with pytest.raises(ValueError, match="strictly increasing"):
        layer.append_data(x=[1.], y=[4.])
    assert fig._frozen_transfer() == before
    layer.append_data(x=[2., 3.], y=[4., 5.])
    fig.set_axes(xscale="time")
    with pytest.raises(ValueError, match="Date range"):
        layer.append_data(x=[9e15], y=[4.])
    fig.close()


@pytest.mark.parametrize("limit", [True, 0, -1, 1.5, 2**32, 2**53])
def test_invalid_retention(limit):
    fig = vs.figure()
    with pytest.raises(ValueError, match="max_points"):
        fig.plot([1], [2]).enable_streaming(max_points=limit)
    fig.close()


def test_only_numeric_line_scatter_can_stream():
    for factory in (lambda f: f.plot(["A"], [2]), lambda f: f.bar([1], [2]),
                    lambda f: f.fill_between([1], [0], [2]), lambda f: f.scatter3d([1], [2], [3])):
        fig = vs.figure()
        with pytest.raises(ValueError, match="numeric 2D"):
            factory(fig).enable_streaming(max_points=2)
        fig.close()


def test_transfer_queue_pins_snapshot_and_resyncs_on_overflow():
    fig = vs.figure()
    layer = fig.plot([0.], [1.]).enable_streaming(max_points=3)
    queue = TransferQueue(fig._frozen_transfer, 0)
    first_header, first_buffers = queue.next()
    assert struct.unpack("<d", first_buffers[0]) == (0.,)
    revision = 0
    def publish():
        nonlocal revision
        revision += 1
        queue.update(revision, fig._last_change)
    fig._listeners.append(publish)
    layer.append_data(x=[1.], y=[2.])
    assert queue.next() is None
    assert first_header["snapshot"]["sources"][0]["shape"] == [1]
    assert struct.unpack("<d", first_buffers[0]) == (0.,)
    assert not queue.acknowledge("wrong", 0)
    assert queue.acknowledge(first_header["transferId"], 0)
    assert queue.accepts_events(0), "A completed frame remains usable during later appends"
    header, buffers = queue.next()
    assert header["type"] == "stream-delta" and header["baseRevision"] == 0
    assert header["updates"][0]["channels"][0]["baseVersion"] == first_header["snapshot"]["sources"][0]["version"]
    assert struct.unpack("<d", buffers[0]) == (1.,)
    queue.update(2, {"kind": "append", "channels": [{"buffer": b"x" * (MAX_PENDING_BYTES + 1)}]})
    assert queue.pending_bytes == 0 and queue.needs_snapshot
    queue.acknowledge(header["transferId"], 1)
    assert queue.next()[0]["type"] == "stream-snapshot"
    queue.update(3, None)
    assert not queue.accepts_events(1), "An explicit data/view reset invalidates stale frame events"
    packet = binary_packet(header, buffers)
    length, = struct.unpack("<I", packet[:4])
    assert json.loads(packet[4:4+length])["revision"] == 1
    assert packet[4+length:] == b"".join(buffers)
    fig.close()


def test_widget_close_redisplay_reconnects_once(monkeypatch):
    pytest.importorskip("anywidget")
    import IPython.display
    monkeypatch.setattr(IPython.display, "display", lambda *args, **kwargs: None)
    fig = vs.figure()
    layer = fig.plot([0], [1])
    first = fig.show(host="notebook")
    first.close()
    second = fig.show(host="notebook")
    assert first is not second and not second._vesora_closed
    assert len(fig._listeners) == 1
    layer.set_data([2], [3])
    assert second.snapshot == fig.snapshot()
    assert fig.show(host="notebook") is second
    fig.close()
    assert not fig._listeners


def test_tiny_append_metadata_is_bounded_and_falls_back_to_latest_snapshot():
    fig = vs.figure()
    layer = fig.plot(array("b", [0]), array("b", [1])).enable_streaming(max_points=4)
    queue = TransferQueue(fig._frozen_transfer, 0)
    header, _ = queue.next()
    queue.acknowledge(header["transferId"], header["revision"])
    revision = 0
    def publish():
        nonlocal revision
        revision += 1
        queue.update(revision, fig._last_change)
    fig._listeners.append(publish)
    try:
        for index in range(MAX_PENDING_UPDATES):
            layer.append_data(x=array("b", [1]), y=array("b", [2]))
        assert len(queue.pending) == MAX_PENDING_UPDATES
        assert queue.pending_bytes == 2 * MAX_PENDING_UPDATES
        layer.append_data(x=array("b", [3]), y=array("b", [4]))
        assert not queue.pending and queue.pending_bytes == 0 and queue.needs_snapshot
        latest, buffers = queue.next()
        assert latest["type"] == "stream-snapshot" and latest["revision"] == revision
        assert buffers[0] == bytes([1, 1, 1, 3])
        assert latest["streams"][layer.id]["nextSequence"] == MAX_PENDING_UPDATES + 2
    finally:
        fig.close()


def test_notebook_stream_views_have_independent_binary_ack_queues():
    pytest.importorskip("anywidget")
    from vesora.notebook import make_widget
    fig = vs.figure()
    layer = fig.plot(list(range(1024)), list(range(1024))).enable_streaming(max_points=1024)
    widget = make_widget(fig)
    messages = []
    widget.send = lambda message, buffers=None: messages.append((message, buffers))
    try:
        for view_id in ("fast", "slow"):
            widget._receive(widget, {"type": "hello", "viewId": view_id, "transportVersion": 2}, [])
        initial_fast, initial_slow = messages
        assert [item[0]["viewId"] for item in messages] == ["fast", "slow"]
        layer.append_data(x=[1024.], y=[1024.])
        assert len(messages) == 2
        widget._receive(widget, {"type": "ack", "viewId": "fast", "transferId": initial_fast[0]["transferId"],
                                 "revision": initial_fast[0]["revision"]}, [])
        delta, buffers = messages[-1]
        assert delta["type"] == "stream-delta" and delta["viewId"] == "fast"
        assert sum(map(len, buffers)) == 16
        assert widget._views["slow"].inflight[0] == initial_slow[0]["transferId"]
        widget._receive(widget, {"type": "resync", "viewId": "slow"}, [])
        latest, buffers = messages[-1]
        assert latest["type"] == "stream-snapshot" and latest["viewId"] == "slow"
        assert struct.unpack("<1024d", buffers[0])[0] == 1
        assert struct.unpack("<1024d", initial_fast[1][0])[0] == 0
    finally:
        widget.close()
        fig.close()


def test_host_producer_coalesces_callbacks_when_event_loop_is_stalled():
    from vesora.host import LocalHost
    class StalledLoop:
        def __init__(self):
            self.callbacks = []
        def call_soon_threadsafe(self, callback):
            self.callbacks.append(callback)
    fig = vs.figure()
    layer = fig.plot([0.], [1.]).enable_streaming(max_points=8)
    host, loop = LocalHost(fig), StalledLoop()
    host._loop = loop
    socket = object()
    host._sockets.add(socket)
    host._views[socket] = TransferQueue(fig._frozen_transfer, 0)
    header, _ = host._views[socket].next()
    host._views[socket].acknowledge(header["transferId"], header["revision"])
    fig._listeners.append(host.publish)
    try:
        for index in range(1000):
            layer.append_data(x=[float(index)], y=[float(index + 1)])
        assert len(loop.callbacks) == 1
        assert host._legacy_snapshot is None
        assert host._views[socket].pending_bytes == 1000 * 16
        assert host._outbound_scheduled and host._outbound_dirty
    finally:
        fig._listeners.remove(host.publish)
        host._loop = None
        fig.close()
