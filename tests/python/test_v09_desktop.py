"""Real Qt protocol 7, shared viewer and frozen-ingestion contract."""
import json
import os

import pytest

import vesora as vs

pytestmark = pytest.mark.skipif(os.environ.get("VESORA_TEST_QT") != "1", reason="Set VESORA_TEST_QT=1 for real Qt")


def test_qt_shared_viewer_mixed_scene_freezes_display_while_accepting_data(tmp_path):
    pytest.importorskip("PySide6")
    from test_linked_desktop import javascript, wait_for

    fig = vs.subplots(1, 3, kinds=[["3d", "2d", "2d"]], title="Protocol 7 Qt", width=1100, height=500)
    surface = fig.panel(0, 0).surface([[1., 2.], [3., 4.]], values=[[10., 20.], [30., 40.]], shading="smooth", wireframe=True)
    fig.panel(0, 0).plot3d([0., 1.], [0., 1.], [0., 1.])
    section = fig.panel(0, 1).slice(surface, axis="x", index=0)
    line = fig.panel(0, 2).plot([0., 1.], [2., 3.]).enable_streaming(max_points=3)
    try:
        fig.savefig(tmp_path / "mixed-initial.png", timeout=60)
        wait_for(lambda: fig._host.ready.is_set())
        page = fig._window._vesora_view.page()
        state = lambda: javascript(page, "JSON.stringify(window.vesoraFigure.getInspectionState())")
        assert javascript(page, "document.querySelectorAll('[data-vesora-viewer]').length") == 1
        assert javascript(page, "document.querySelector('.vv-camera').hidden") is False
        # A live slice edit must update Python's canonical scene before exports.
        javascript(page, "(()=>{const s=document.querySelector('.vv-slices input');s.value='1';s.dispatchEvent(new Event('input'));return true;})()")
        wait_for(lambda: fig.snapshot()["figure"]["slices"][0]["index"] == 1)
        wait_for(lambda: fig._host.ready.is_set())
        javascript(page, "window.vesoraFigure.freezeInspection(); true")
        frozen = json.loads(state())
        assert frozen["mode"] == "frozen" and frozen["snapshotBytes"] > 0
        line.append_data(x=[2., 3.], y=[4., 5.])
        wait_for(lambda: all(queue.acknowledged == fig._host._revision for queue in fig._host._views.values()))
        held = json.loads(state())
        assert held["acceptedRevision"] > frozen["acceptedRevision"]
        assert held["displayedRevision"] == frozen["displayedRevision"]
        assert held["snapshotId"] == frozen["snapshotId"]
        javascript(page, "(()=>{const s=document.querySelector('.vv-slices input');s.value='0';s.dispatchEvent(new Event('input'));return true;})()")
        assert fig.snapshot()["figure"]["slices"][0]["index"] == 1
        assert list(fig._layer_arrays(section._spec())["y"]) == [2., 4.]
        fig.savefig(tmp_path / "accepted-while-frozen.png", timeout=60)
        assert json.loads(state())["mode"] == "frozen"
        javascript(page, "void window.vesoraFigure.resumeLive(); true")
        wait_for(lambda: fig._host.ready.is_set())
        resumed = json.loads(state())
        assert resumed["mode"] == "live" and resumed["snapshotBytes"] == 0
        assert resumed["displayedRevision"] == resumed["acceptedRevision"]
        assert list(fig._layer_arrays(line._spec())["x"]) == [1., 2., 3.]
    finally:
        fig.close()
        vs.process_events()


def test_qt_static_accepted_export_and_frozen_ownership_survive_reconnect(tmp_path):
    import asyncio
    pytest.importorskip("PySide6")
    from test_linked_desktop import javascript, wait_for

    fig = vs.figure(title="Frozen reconnect", width=800, height=500)
    layer = fig.scatter([0., 1.], [1., 2.])
    clicks = []
    fig.on("click", clicks.append)
    try:
        original = fig.savefig(tmp_path / "original.png", timeout=60).read_bytes()
        host, page = fig._host, fig._window._vesora_view.page()
        frozen = json.loads(javascript(page, "JSON.stringify(window.vesoraFigure.freezeInspection())"))
        wait_for(lambda: bool(host._held_frames))
        layer.set_data(y=[8., 2.])
        wait_for(lambda: all(queue.acknowledged == host._revision for queue in host._views.values()))
        assert not host.ready.is_set()
        accepted = fig.savefig(tmp_path / "accepted-static.png", timeout=20).read_bytes()
        assert accepted != original
        assert javascript(page, "window.vesoraFigure.getInspectionState().mode") == "frozen"
        previous = next(iter(host._views))
        asyncio.run_coroutine_threadsafe(previous.close(), host._loop).result(timeout=5)
        wait_for(lambda: previous not in host._views and bool(host._views))
        wait_for(lambda: all(queue.acknowledged == host._revision and queue.frame and queue.frame.get("snapshotId") == frozen["snapshotId"] for queue in host._views.values()))
        javascript(page, "window.vesoraFigure.emit('click',{kind:'point',x:0,y:1}); true")
        wait_for(lambda: bool(clicks))
        assert clicks[-1]["y"] == 1
        javascript(page, "void window.vesoraFigure.resumeLive(); true")
        wait_for(lambda: host.ready.is_set())
        assert not host._held_frames
        assert javascript(page, "window.vesoraFigure.getInspectionState().snapshotBytes") == 0
    finally:
        fig.close()
        vs.process_events()
