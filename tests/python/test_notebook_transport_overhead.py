"""Wire traffic and retry lifecycle stay bounded without weakening notebook sync."""
import copy
from types import SimpleNamespace

import pytest

import vesora as vs

pytest.importorskip("anywidget")


@pytest.fixture
def notebook_host(monkeypatch):
    import vesora.notebook as notebook
    import vesora.transport as transport

    clock = [100.0]
    timers = []

    class Timer:
        def __init__(self, interval, callback):
            self.interval, self.callback = interval, callback
            self.started = self.cancelled = False
            self.daemon = False
            timers.append(self)

        def start(self):
            self.started = True

        def cancel(self):
            self.cancelled = True

        def fire(self):
            # Deliberately allow a canceled callback to execute, as a real timer
            # may already be waiting for the figure lock when cancel() runs.
            self.callback()

    monkeypatch.setattr(notebook.threading, "Timer", Timer)
    monkeypatch.setattr(transport.time, "monotonic", lambda: clock[0])
    fig = vs.figure()
    curves = [fig.plot([0.], [float(index)]).enable_streaming(max_points=3)
              for index in range(3)]
    widget = notebook.make_widget(fig)
    messages = []
    widget._send = lambda message, buffers=None: messages.append((copy.deepcopy(message), buffers))

    def receive(message):
        widget._receive(widget, message, [])

    def packets():
        return [message["content"] for message, _ in messages if message.get("method") == "custom"]

    def hello(view_id, version=3):
        receive({"type": "hello", "viewId": view_id, "transportVersion": version})
        return next(packet for packet in reversed(packets()) if packet.get("viewId") == view_id)

    def ack(packet):
        receive({"type": "ack", "viewId": packet["viewId"],
                 "transferId": packet["transferId"], "revision": packet["revision"]})

    try:
        yield SimpleNamespace(fig=fig, curves=curves, widget=widget, messages=messages,
                              packets=packets, receive=receive, hello=hello, ack=ack,
                              clock=clock, timers=timers, transport=transport)
    finally:
        widget.close()
        fig.close()


def test_binary_revision_avoids_automatic_comms_but_preserves_observers_and_explicit_state(notebook_host):
    host = notebook_host
    host.ack(host.hello("modern"))
    host.messages.clear()
    initial_revision = host.widget.revision
    observed = []

    def observe(change):
        observed.append(change["new"])
        if len(observed) == 1:
            # Explicit state requests from an observer must not be swallowed by
            # the suppression of the trait's preceding automatic notification.
            host.widget.send_state(key="revision")

    host.widget.observe(observe, names="revision")
    for sample in range(100):
        for curve in host.curves:
            curve.append_data(x=[float(sample + 1)], y=[float(sample)])
    assert host.widget.revision == initial_revision + 300
    assert observed == list(range(initial_revision + 1, initial_revision + 301))
    updates = [message for message, _ in host.messages if message.get("method") == "update"]
    assert [message["state"] for message in updates] == [{"revision": initial_revision + 1}]
    assert host.widget._views["modern"].revision == host.widget.revision
    host.widget.send_state(key=["revision", "snapshot", "buffers"])
    state = host.messages[-1][0]["state"]
    assert state["revision"] == host.widget.revision and "snapshot" in state
    assert host.messages[-1][1], "Explicit full state retains binary buffers"
    assert host.widget.get_state(key="revision")["revision"] == host.widget.revision


def test_no_view_sync_and_mixed_v2_v3_queues_remain_independent(notebook_host):
    host = notebook_host
    host.curves[0].append_data(x=[1.], y=[2.])
    state = host.messages[-1][0]["state"]
    assert state["revision"] == host.widget.revision
    assert state["snapshot"] == host.fig.snapshot() and host.messages[-1][1]
    slow = host.hello("legacy", 2)
    fast = host.hello("modern", 3)
    host.ack(fast)
    host.messages.clear()
    host.fig.append_data_batch([(host.curves[0], {"x": [2.], "y": [3.]}),
                                (host.curves[1], {"x": [2.], "y": [4.]})])
    assert all(message.get("method") != "update" for message, _ in host.messages)
    delta = host.packets()[-1]
    assert delta["viewId"] == "modern" and delta["transportVersion"] == 3
    assert delta["type"] == "stream-delta" and len(delta["transactions"][0]["updates"]) == 2
    assert host.widget._views["legacy"].inflight[0] == slow["transferId"]
    host.ack(slow)
    replacement = host.packets()[-1]
    assert replacement["viewId"] == "legacy" and replacement["transportVersion"] == 2
    assert replacement["type"] == "stream-snapshot"
    assert replacement["revision"] == delta["revision"] == host.widget.revision
    for view_id in ("modern", "legacy"):
        host.receive({"type": "dispose-view", "viewId": view_id})
    host.messages.clear()
    host.curves[0].append_data(x=[3.], y=[5.])
    assert host.widget.snapshot == host.fig.snapshot()
    assert host.messages[-1][0]["state"]["revision"] == host.widget.revision
    fresh = host.hello("redisplayed")
    assert fresh["snapshot"] == host.fig.snapshot() and fresh["revision"] == host.widget.revision
    assert len(host.fig._listeners) == 1


def test_retry_reuses_deadline_across_appends_fast_acks_and_lost_ack(notebook_host):
    host = notebook_host
    first = host.hello("first", 2)
    timer = host.widget._transfer_timer
    assert timer.started and timer.interval == 30 and host.widget._transfer_deadline == 130
    assert host.widget._views["first"].retry_deadline() == 130
    for index in range(10):
        host.curves[0].append_data(x=[float(index + 1)], y=[2.])
    assert host.widget._transfer_timer is timer and len(host.timers) == 1
    host.receive({"type": "ack", "viewId": "first", "transferId": "wrong", "revision": 0})
    assert host.widget._transfer_timer is timer
    host.clock[0] = 101
    second = host.hello("second", 3)
    assert host.widget._views["second"].retry_deadline() == 131
    host.ack(first)
    delta = host.packets()[-1]
    assert delta["viewId"] == "first" and delta["type"] == "stream-delta"
    assert host.widget._transfer_timer is timer
    host.ack(delta)
    assert host.widget._transfer_timer is timer
    # Removing the earliest queue can leave an earlier harmless wakeup in place.
    host.receive({"type": "dispose-view", "viewId": "first"})
    assert host.widget._transfer_timer is timer
    host.clock[0] = 130
    timer.fire()
    later = host.widget._transfer_timer
    assert later is not timer and later.interval == 1 and host.widget._transfer_deadline == 131
    assert host.widget._views["second"].inflight[0] == second["transferId"]
    timer.fire()
    assert host.widget._transfer_timer is later
    host.clock[0] = 131
    later.fire()
    retry = host.packets()[-1]
    assert retry["type"] == "stream-snapshot" and retry["transferId"] != second["transferId"]
    current = host.widget._transfer_timer
    assert current is not later and host.widget._transfer_deadline == 161
    host.ack(retry)
    assert current.cancelled and host.widget._transfer_timer is None
    assert host.widget._transfer_deadline is None
    assert host.widget._views["second"].acknowledged == host.widget.revision


def test_binary_revision_suppression_keeps_frozen_frame_ownership_across_reset(notebook_host):
    host = notebook_host
    initial = host.hello("view")
    host.ack(initial)
    held = {"viewId": "view", "revision": initial["revision"], "frameId": 1,
            "mode": "frozen", "snapshotId": "held"}
    host.receive({"type": "frame", **held})
    queue = host.widget._views["view"]
    assert queue.frame["snapshotId"] == "held" and queue.presented_revision is None
    host.curves[0].append_data(x=[1.], y=[2.])
    host.ack(host.packets()[-1])
    assert queue.acknowledged == host.widget.revision
    assert queue.frame["revision"] == initial["revision"]
    host.fig.set_axes(xlim=(0, 10))
    reset = host.packets()[-1]
    assert reset["type"] == "stream-snapshot"
    host.ack(reset)
    assert not queue.record_frame(initial["revision"], 2, "live")
    host.receive({"type": "frame", **held, "frameId": 2})
    assert queue.accepts_events(initial["revision"], 2, "held")
    before = host.fig.snapshot()
    host.receive({"type": "event", **held, "frameId": 2, "event": "viewchange",
                  "payload": {"xDomain": [100, 200]}})
    assert host.fig.snapshot() == before
    host.receive({"type": "frame", "viewId": "view", "revision": host.widget.revision,
                  "frameId": 3, "mode": "live"})
    assert queue.presented_revision == host.widget.revision
    assert not queue.accepts_events(initial["revision"], 2, "held")


def test_earlier_deadline_replaces_timer_and_cancelled_callback_cannot_rearm(notebook_host, monkeypatch):
    host = notebook_host
    host.hello("view")
    old = host.widget._transfer_timer
    monkeypatch.setattr(host.transport, "ACK_TIMEOUT", 5)
    host.widget._send_transfers()
    current = host.widget._transfer_timer
    assert current is not old and old.cancelled and current.interval == 5
    assert host.widget._transfer_deadline == 105
    before = len(host.messages)
    old.fire()
    assert host.widget._transfer_timer is current and len(host.messages) == before
    host.widget.close()
    assert current.cancelled and not host.widget._views and not host.fig._listeners
    assert host.widget._transfer_timer is None and host.widget._transfer_deadline is None
    current.fire()
    assert len(host.messages) == before and host.widget._transfer_timer is None
