"""Real Qt binary streaming, retained identity and invocation-time PNG."""
import json
import os
import struct
import time
import platform
import math
from array import array

import pytest

import vesora as vs

pytestmark = pytest.mark.skipif(os.environ.get("VESORA_TEST_QT") != "1",
                              reason="Set VESORA_TEST_QT=1 to exercise QtWebEngine")


def test_qt_binary_append_keeps_window_identity_and_exports(tmp_path, monkeypatch):
    pytest.importorskip("PySide6")
    from vesora import host as transport
    from test_linked_desktop import javascript, wait_for

    packets = []
    encode = transport.binary_packet
    def record(header, buffers):
        packets.append((header["type"], [len(value) for value in buffers]))
        return encode(header, buffers)
    monkeypatch.setattr(transport, "binary_packet", record)
    fig = vs.figure(title="Bounded live telemetry", width=800, height=520)
    layer = fig.plot([0., 1.], [2., 3.], color="#3569c8").enable_streaming(max_points=4)
    try:
        initial = fig.savefig(tmp_path / "stream-initial.png", width=800, height=500, scale=1, timeout=45)
        assert struct.unpack(">II", initial.read_bytes()[16:24]) == (800, 500)
        page = fig._window._vesora_view.page()
        wait_for(lambda: fig._host.ready.is_set())
        initial_id = json.loads(javascript(page, f"JSON.stringify(window.vesoraFigure.getStreamingState({json.dumps(layer.id)}))"))["streamId"]
        for at in range(2, 20):
            layer.append_data(x=[float(at)], y=[float(at + 2)])
        wait_for(lambda: fig._host.ready.is_set())
        result = json.loads(javascript(page, f"JSON.stringify((()=>{{const f=window.vesoraFigure,l=f.spec.layers.find(l=>l.id==={json.dumps(layer.id)});return {{state:f.getStreamingState(l.id),x:Array.from(f.registry.get(l.data.x).values)}};}})())"))
        assert result["x"] == [16, 17, 18, 19]
        assert result["state"]["streamId"] == initial_id == fig._streams[layer.id]["streamId"]
        assert result["state"]["nextSequence"] == 20
        assert sum(kind == "stream-snapshot" for kind, _ in packets) == 1, "Valid appends must use deltas without resync"
        assert any(kind == "stream-delta" and all(length == 8 for length in sizes) for kind, sizes in packets)
        output = fig.savefig(tmp_path / "stream-latest.png", width=800, height=500, scale=2, timeout=45)
        assert struct.unpack(">II", output.read_bytes()[16:24]) == (1600, 1000)
        assert any(kind == "stream-export" for kind, _ in packets)
    finally:
        fig.close()
        vs.process_events()


def test_qt_streaming_latency_three_curves_100k_retention(tmp_path):
    pytest.importorskip("PySide6")
    from test_linked_desktop import wait_for, javascript
    fig = vs.figure(title="Live telemetry latency", width=900, height=520)
    count, samples, batch_size, requested_hz = 100_000, 100, 100, 20
    def value(index, series):
        return (series + 1) * .15 + 3 * math.exp(-index / 2000) + .08 * math.sin(index * .07 + series)
    curves = [fig.plot(array("d", range(count)), array("d", (value(index, series) for index in range(count))),
                       label=f"Channel {series}").enable_streaming(max_points=count) for series in range(3)]
    try:
        fig.savefig(tmp_path / "qt-benchmark-initial.png", timeout=60)
        wait_for(lambda: fig._host.ready.is_set())
        timings, pending = [None] * samples, []
        def collect():
            with fig._host._state_lock:
                acknowledged = max((queue.acknowledged or -1 for queue in fig._host._views.values()), default=-1)
            completed = time.perf_counter()
            for index, begin, revision in pending:
                if timings[index] is None and revision <= acknowledged:
                    timings[index] = (completed - begin) * 1000
        start = time.perf_counter()
        for sample in range(samples):
            target = start + sample / requested_hz
            while time.perf_counter() < target:
                vs.process_events()
                collect()
                time.sleep(.001)
            begin = time.perf_counter()
            indexes = range(count + sample * batch_size, count + (sample + 1) * batch_size)
            for series, curve in enumerate(curves):
                curve.append_data(x=array("d", indexes), y=array("d", (value(index, series) for index in indexes)))
            pending.append((sample, begin, fig._host._revision))
            vs.process_events()
            collect()
        producer_duration = time.perf_counter() - start
        deadline = time.perf_counter() + 30
        while any(value is None for value in timings):
            assert time.perf_counter() < deadline, "Qt streaming ACK deadline exceeded"
            vs.process_events()
            collect()
            time.sleep(.001)
        duration = time.perf_counter() - start
        renderer = javascript(fig._window._vesora_view.page(), "(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);})()")
        ordered = sorted(timings)
        report = {"scenario": "Python append to final renderer ACK", "platform": platform.platform(), "python": platform.python_version(),
                  "renderer": renderer, "series": 3, "retention_per_series": count, "batch_rows_per_series": batch_size,
                  "samples": samples, "requested_hz": requested_hz, "observed_hz": samples / duration,
                  "producer_duration_seconds": producer_duration,
                  "duration_seconds": duration, "p50_ms": ordered[49], "p95_ms": ordered[94], "max_ms": ordered[-1],
                  "latency_ms": timings, "retained_source_bytes": sum(source[0]["byteLength"] for source in fig._sources.values()),
                  "scope": "Includes Python validation, binary transport, JS append, worker planning, GPU draw and ACK; excludes initial construction and PNG."}
        destination = tmp_path / "qt-streaming-benchmark.json"
        destination.write_text(json.dumps(report, indent=2), encoding="utf-8")
        assert all(state["retained"] == count and state["nextSequence"] == count + samples * batch_size for state in fig._streams.values())
        print(f"Qt streaming p50={report['p50_ms']:.2f}ms p95={report['p95_ms']:.2f}ms; evidence: {destination}")
    finally:
        fig.close()
        vs.process_events()
