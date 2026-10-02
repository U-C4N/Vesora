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
