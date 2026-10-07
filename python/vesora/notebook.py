"""Optional anywidget host: the notebook receives spec + binary buffers over comms."""
from __future__ import annotations
from pathlib import Path
import asyncio
import base64
import uuid
from typing import Any


def make_widget(figure: Any) -> Any:
    try:
        import anywidget
        import traitlets
    except ImportError as exc:
        raise RuntimeError("Notebook support requires pip install 'vesora[notebook]'") from exc
    asset = Path(__file__).parent / "_assets" / "notebook.js"
    if not asset.is_file():
        raise RuntimeError("The bundled notebook.js asset is missing; build the JavaScript packages")

    class VesoraWidget(anywidget.AnyWidget):
        _esm = asset
        snapshot = traitlets.Dict().tag(sync=True)
        buffers = traitlets.List(traitlets.Bytes()).tag(sync=True)
        revision = traitlets.Int(0).tag(sync=True)

        def __init__(self) -> None:
            super().__init__()
            self._vesora_closed = False
            self._export_requests: dict[str, asyncio.Future[bytes]] = {}
            self.on_msg(self._receive)
            figure._listeners.append(self._update)
            self._update()

        def _update(self) -> None:
            with figure._lock:
                snapshot = figure.snapshot()
                buffers = [figure._data_bytes(source["id"], source["version"]) for source in snapshot["sources"]]
                with self.hold_sync():
                    self.buffers = buffers
                    self.snapshot = snapshot
                    self.revision += 1

        def _receive(self, widget: Any, content: Any, buffers: Any) -> None:
            if isinstance(content, dict) and content.get("type") == "event":
                if content.get("event") in ("viewchange", "error") and content.get("revision") != self.revision:
                    return
                figure._emit(str(content.get("event", "")), content.get("payload"))
            elif isinstance(content, dict) and content.get("type") in ("export", "export-error"):
                future = self._export_requests.pop(str(content.get("requestId", "")), None)
                if future is None or future.done():
                    return
                try:
                    if content["type"] == "export-error":
                        raise RuntimeError(content.get("message", "PNG export failed"))
                    prefix = "data:image/png;base64,"
                    data_url = content.get("dataUrl", "")
                    if not isinstance(data_url, str) or not data_url.startswith(prefix):
                        raise ValueError("Widget did not return a PNG data URL")
                    payload = base64.b64decode(data_url[len(prefix):], validate=True)
                    if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
                        raise ValueError("Widget returned invalid PNG bytes")
                    future.set_result(payload)
                except Exception as exc:
                    future.set_exception(exc)

        async def export_png(self, *, timeout: float) -> bytes:
            if timeout <= 0:
                raise ValueError("timeout must be positive")
            if self._vesora_closed:
                raise RuntimeError("Notebook widget is closed")
            request_id = uuid.uuid4().hex
            future = asyncio.get_running_loop().create_future()
            self._export_requests[request_id] = future
            self.send({"type": "export", "requestId": request_id})
            try:
                return await asyncio.wait_for(future, timeout)
            finally:
                self._export_requests.pop(request_id, None)

        def close(self) -> None:
            if not getattr(self, "_vesora_closed", True):
                self._vesora_closed = True
                if self._update in figure._listeners:
                    figure._listeners.remove(self._update)
                for future in self._export_requests.values():
                    if not future.done():
                        future.set_exception(RuntimeError("Widget closed during export"))
                self._export_requests.clear()
            super().close()

    return VesoraWidget()
