import asyncio
import base64

import pytest

import vesora as vs

pytest.importorskip("anywidget")


def test_widget_sync_and_async_export():
    from vesora.notebook import make_widget
    from vesora.host import ASSETS
    if not (ASSETS / "notebook.js").is_file():
        pytest.skip("Build notebook assets before this integration test")
    fig = vs.Figure()
    layer = fig.plot([1., 2.], [3., 4.])
    widget = make_widget(fig)
    try:
        assert widget.snapshot == fig.snapshot()
        assert len(widget.buffers) == 2
        layer.set_data(y=[5., 6.])
        assert widget.snapshot == fig.snapshot()
        assert widget.snapshot["sources"][1]["version"] == 2
        messages = []
        widget.send = messages.append
        async def export():
            request = asyncio.create_task(widget.export_png(timeout=1))
            await asyncio.sleep(0)
            png = b"\x89PNG\r\n\x1a\nnotebook fixture"
            widget._receive(widget, {"type": "export", "requestId": messages[0]["requestId"], "dataUrl": "data:image/png;base64," + base64.b64encode(png).decode()}, [])
            assert await request == png
        asyncio.run(export())
    finally:
        widget.close()
        fig.close()


def test_widget_revision_protects_bookmark_restore_and_preserves_selection():
    from vesora.notebook import make_widget
    fig = vs.Figure()
    fig.plot([1, 2], [3, 4])
    widget = make_widget(fig)
    try:
        assert widget.revision == 1
        fig.bookmark("Overview")
        fig.set_axes(xlim=(1.2, 1.8))
        stale = widget.revision
        fig.restore_bookmark("Overview")
        current = widget.revision
        assert current > stale
        for revision in (stale, None):
            widget._receive(widget, {"type": "event", "event": "viewchange", "revision": revision,
                                     "payload": {"xDomain": [1.2, 1.8]}}, [])
        assert "xDomain" not in fig.snapshot()["figure"]["view"]
        widget._receive(widget, {"type": "event", "event": "viewchange", "revision": current,
                                 "payload": {"xDomain": [1.1, 1.9], "pan3d": [0.1, 0.2]}}, [])
        assert fig.snapshot()["figure"]["view"]["xDomain"] == [1.1, 1.9]
        assert widget.revision == current
        widget._receive(widget, {"type": "event", "event": "viewchange", "revision": current,
                                 "payload": {"xDomain": None, "pan3d": [0, 0]}}, [])
        assert "xDomain" not in fig.snapshot()["figure"]["view"]
        errors, selections = [], []
        fig.on("error", errors.append)
        fig.on("selection", selections.append)
        widget._receive(widget, {"type": "event", "event": "error", "revision": stale,
                                 "payload": {"message": "obsolete"}}, [])
        widget._receive(widget, {"type": "event", "event": "selection", "payload": {"count": 1}}, [])
        assert errors == [] and selections == [{"count": 1}]
    finally:
        widget.close()
        fig.close()
