"""Opt-in real Qt soak; default producer duration is two hours."""
import asyncio
import base64
import importlib.util
import json
import os
import time
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(os.environ.get("VESORA_SOAK_QT") != "1", reason="Set VESORA_SOAK_QT=1 for the real Qt soak")


def test_real_qt_two_hour_atomic_freeze_reconnect_soak(tmp_path):
    pytest.importorskip("PySide6")
    from test_linked_desktop import javascript, wait_for
    location = Path(__file__).resolve().parents[1] / "soak" / "host_workload.py"
    spec = importlib.util.spec_from_file_location("vesora_soak_workload", location)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    output = Path(os.environ.get("VESORA_SOAK_OUTPUT", tmp_path / "qt-soak"))
    workload = helper.Workload("qt", output)
    fig, vs = workload.figure, helper.vs
    cycles, renderer_samples, failure = [], [], None
    report = {"status": "failed", "host": "qt", "evidence": workload.evidence}
    host = None
    try:
        fig.savefig(output / "initial.png", width=1000, height=500, scale=1, timeout=60)
        host = fig._host
        wait_for(lambda: host.ready.is_set(), timeout=60)
        page = fig._window._vesora_view.page()
        javascript(page, """(() => {
          const f=window.vesoraFigure;window.__vesoraSoak={frames:0,atomicErrors:[]};
          f.on('frame',s=>{const states=Object.values(s.displayedStreams);window.__vesoraSoak.frames++;
            if(states.length!==3||states.some(v=>v.nextSequence!==states[0].nextSequence||v.retained!==states[0].retained))
              window.__vesoraSoak.atomicErrors.push({frameId:s.frameId,states});});return true;
        })()""")
        read = lambda expression: json.loads(javascript(page, f"JSON.stringify({expression})"))
        renderer = javascript(page, "(()=>{const g=document.querySelector('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER);})()")
        from PySide6.QtWebEngineCore import qWebEngineVersion, qWebEngineChromiumVersion
        workload.evidence.update(renderer=renderer, qt_webengine=qWebEngineVersion(), embedded_chromium=qWebEngineChromiumVersion())
        workload.begin()
        next_freeze, next_probe, next_renderer_sample = workload.freeze_every, 0, 0
        active = None
        stopped_deadline = None
        while True:
            vs.process_events()
            producing = workload.tick()
            elapsed = workload.elapsed
            if not producing and stopped_deadline is None:
                stopped_deadline = time.perf_counter() + 90
            if active is None and producing and elapsed >= next_freeze and elapsed + workload.freeze_hold < workload.duration - 1:
                held = read("window.vesoraFigure.freezeInspection()")
                active = {"started_seconds": elapsed, "held": held, "sequence_at_freeze": workload.next_sequence,
                          "reconnect": "awaiting_frozen_registration" if not cycles else "not_requested"}
                javascript(page, """(() => {
                  window.__vesoraSoakExport={pending:true};
                  void (async()=>{try {const {toHTML}=await import(new URL('/assets/index.js',location.href).href),f=window.vesoraFigure;
                    const html=toHTML(f,{source:'displayed'}),blob=await f.savefig({source:'displayed',width:1000,height:500,scale:1});
                    const png=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
                    window.__vesoraSoakExport={pending:false,html,png};
                  }catch(error){window.__vesoraSoakExport={pending:false,error:String(error)};}})();return true;
                })()""")
                next_freeze = elapsed + workload.freeze_every
            if elapsed >= next_probe:
                next_probe = elapsed + .1
                if active is not None:
                    if active["reconnect"] == "awaiting_frozen_registration" and any(frame.get("snapshotId") == active["held"]["snapshotId"] for frame in tuple(host._held_frames.values())):
                        # Registration is a real asynchronous frame message. Keep
                        # producing until it arrives before dropping the socket.
                        sockets = tuple(host._views)
                        assert len(sockets) == 1
                        active["previous_socket"] = sockets[0]
                        active["reconnect_future"] = asyncio.run_coroutine_threadsafe(sockets[0].close(), host._loop)
                        active["reconnect"] = "pending"
                    if active.get("reconnect") == "pending" and active["previous_socket"] not in host._views and host._views:
                        queues = workload.queues()
                        if all(q["frame"] and q["frame"].get("snapshotId") == active["held"]["snapshotId"] for q in queues):
                            active["reconnect_future"].result(timeout=1)
                            active.pop("previous_socket");active.pop("reconnect_future")
                            active["reconnect"] = "restored_frozen_ownership"
                    if "export" not in active and not read("window.__vesoraSoakExport.pending"):
                        exported = read("window.__vesoraSoakExport")
                        assert "error" not in exported, exported.get("error")
                        index = len(cycles)
                        html_path, png_path = output / f"frozen-{index:03}.html", output / f"frozen-{index:03}.png"
                        html_path.write_text(exported["html"], encoding="utf-8")
                        png_path.write_bytes(base64.b64decode(exported["png"].split(",", 1)[1], validate=True))
                        active["export"] = helper.validate_displayed_html(exported["html"], active["held"]["snapshotId"])
                        active["png"] = helper.validate_png(png_path)
                        javascript(page, "window.__vesoraSoakExport={pending:false};true")
                    if elapsed - active["started_seconds"] >= workload.freeze_hold and "export" in active and active["reconnect"] not in ("pending", "awaiting_frozen_registration"):
                        assert workload.next_sequence > active["sequence_at_freeze"], "Producer did not continue while inspection was frozen"
                        active["accepted_rows_while_frozen"] = workload.next_sequence - active["sequence_at_freeze"]
                        javascript(page, "void window.vesoraFigure.resumeLive();true")
                        active["resumed_seconds"] = elapsed
                        cycles.append(active);active = None
                    elif elapsed - active["started_seconds"] > max(60, workload.freeze_hold + 30):
                        raise AssertionError("Frozen export/reconnection did not complete within its deadline")
                if elapsed >= next_renderer_sample:
                    stats = read("window.vesoraFigure.diagnostics()")
                    renderer_samples.append({"elapsed_seconds": elapsed, "stats": stats})
                    assert stats["snapshotBytes"] <= stats["maxSnapshotBytes"]
                    assert not stats["contextLost"]
                    assert not read("window.__vesoraSoak.atomicErrors")
                    next_renderer_sample = elapsed + 5
            if not producing and active is None and workload.drained():
                break
            assert stopped_deadline is None or time.perf_counter() < stopped_deadline, "Final transport/frame drain timed out"
            time.sleep(.005)
        assert cycles, "Soak must execute at least one completed frozen-inspection cycle"
        javascript(page, "window.__vesoraSoakFinalHTML=undefined;void import(new URL('/assets/index.js',location.href).href).then(m=>{window.__vesoraSoakFinalHTML=m.toHTML(window.vesoraFigure,{source:'displayed'});});true")
        wait_for(lambda: javascript(page, "typeof window.__vesoraSoakFinalHTML==='string'"), timeout=30)
        final_html = javascript(page, "window.__vesoraSoakFinalHTML")
        final_export = helper.validate_displayed_html(final_html)
        assert final_export["retained_range"] == [workload.next_sequence - workload.retention, workload.next_sequence - 1, workload.retention]
        (output / "final-displayed.html").write_text(final_html, encoding="utf-8")
        final = read("window.vesoraFigure.diagnostics()")
        assert final["snapshotBytes"] == 0 and final["pendingExports"] == 0 and final["pendingAppends"] == 0
        assert not read("window.__vesoraSoak.atomicErrors")
        assert not host._exports and not host._held_frames
        report = workload.finish()
        report.update(cycles=cycles, renderer_samples=renderer_samples, final_renderer=final,
                      final_export=final_export,frame_atomicity=read("window.__vesoraSoak"), reconnect="real WebSocket disconnected once while frozen")
    except BaseException as error:
        failure = error
        report.update(status="failed", error=repr(error), actual_total_seconds=workload.elapsed, samples=workload.samples,
                      cycles=[{k: v for k, v in item.items() if k not in ("previous_socket", "reconnect_future")} for item in cycles])
    finally:
        fig.close();vs.process_events()
        cleanup = {"source_count": len(fig._sources), "listener_count": len(fig._listeners),
                   "host_views": len(host._views) if host else 0, "host_exports": len(host._exports) if host else 0,
                   "host_thread_alive": bool(host and host._thread and host._thread.is_alive())}
        report["cleanup"] = cleanup
        if any(cleanup.values()):
            report["status"] = "failed"
            failure = failure or AssertionError(f"Resources remained after Qt close: {cleanup}")
        (output / "qt-soak.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Qt soak actual duration {workload.elapsed:.2f}s; evidence: {output / 'qt-soak.json'}")
    if failure is not None:
        raise failure
