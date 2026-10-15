"""Optional anywidget host: the notebook receives spec + binary buffers over comms."""
from __future__ import annotations
from pathlib import Path
import asyncio
import base64
import threading
import time
import uuid
from typing import Any
from .transport import TransferQueue


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
            self._views: dict[str, TransferQueue] = {}
            self._transfer_timer: threading.Timer | None = None
            self._transfer_deadline: float | None = None
            self._binary_revision_update = False
            self.on_msg(self._receive)
            figure._listeners.append(self._update)
            self._update()

        def _should_send_property(self, key: str, value: Any) -> bool:
            # Binary packets already carry the accepted revision. Keep the trait
            # and its local observers current without an unused automatic comm.
            # Explicit send_state/get_state calls bypass this automatic-sync hook.
            if key == "revision" and getattr(self, "_binary_revision_update", False):
                return False
            return super()._should_send_property(key, value)

        def _update(self) -> None:
            with figure._lock:
                if self._views:
                    previous = self._binary_revision_update
                    self._binary_revision_update = True
                    try:
                        self.revision += 1
                    finally:
                        self._binary_revision_update = previous
                    for queue in self._views.values():
                        queue.update(self.revision, figure._last_change)
                    self._send_transfers()
                    return
                snapshot = figure.snapshot()
                buffers = [figure._data_bytes(source["id"], source["version"]) for source in snapshot["sources"]]
                with self.hold_sync():
                    self.buffers = buffers
                    self.snapshot = snapshot
                    self.revision += 1

        def _send_transfers(self) -> None:
            with figure._lock:
                if self._vesora_closed:
                    return
                for view_id, queue in tuple(self._views.items()):
                    transfer = queue.next()
                    if transfer is not None:
                        header, buffers = transfer
                        self.send({**header, "viewId": view_id}, buffers=buffers)
                deadlines = [deadline for queue in self._views.values()
                             if (deadline := queue.retry_deadline()) is not None]
                deadline = min(deadlines) if deadlines else None
                # An earlier scheduled wakeup is also safe: it will recheck the
                # queues. Do not restart a thread for every append or fast-view ACK.
                if (deadline is not None and self._transfer_timer is not None
                        and self._transfer_deadline is not None
                        and self._transfer_deadline <= deadline):
                    return
                if self._transfer_timer is not None:
                    self._transfer_timer.cancel()
                self._transfer_timer = None
                self._transfer_deadline = None
                if deadline is not None:
                    def retry() -> None:
                        with figure._lock:
                            # cancel() cannot stop a callback already waiting on
                            # this lock. Such a callback must not clear a new timer.
                            if self._transfer_timer is not timer:
                                return
                            self._transfer_timer = None
                            self._transfer_deadline = None
                            self._send_transfers()
                    timer = threading.Timer(max(.001, deadline - time.monotonic()), retry)
                    timer.daemon = True
                    self._transfer_timer = timer
                    self._transfer_deadline = deadline
                    timer.start()

        @staticmethod
        def _finish_export(future: asyncio.Future[bytes], payload: bytes | None = None,
                           error: Exception | None = None) -> None:
            # Modern notebook kernels can dispatch comm messages on a different
            # thread from the cell's asyncio loop. Wake that loop explicitly.
            def finish() -> None:
                if not future.done():
                    if error is not None:
                        future.set_exception(error)
                    else:
                        future.set_result(payload)
            future.get_loop().call_soon_threadsafe(finish)

        def _receive(self, widget: Any, content: Any, buffers: Any) -> None:
            with figure._lock:
                self._receive_locked(widget, content, buffers)

        def _receive_locked(self, widget: Any, content: Any, buffers: Any) -> None:
            if not isinstance(content, dict):
                return
            kind, view_id = content.get("type"), content.get("viewId")
            if kind == "hello" and content.get("transportVersion") in (2, 3) and isinstance(view_id, str):
                supported = content.get("supportedTransportVersions", [])
                version = 3 if isinstance(supported, list) and 3 in supported else content["transportVersion"]
                previous = self._views.get(view_id)
                queue = TransferQueue(figure._frozen_transfer, self.revision, version)
                if "heldFrame" in content:
                    queue.restore_frozen_frame(content["heldFrame"], previous.frame if previous else None)
                self._views[view_id] = queue
                self._send_transfers()
            elif kind == "dispose-view":
                self._views.pop(view_id, None)
                self._send_transfers()
            elif kind in ("ack", "resync") and view_id in self._views:
                queue = self._views[view_id]
                if kind == "resync":
                    queue.resync()
                else:
                    queue.acknowledge(content.get("transferId"), content.get("revision"))
                self._send_transfers()
            elif kind == "frame" and view_id in self._views:
                self._views[view_id].record_frame(content.get("revision"), content.get("frameId"), content.get("mode"), content.get("snapshotId"))
            elif kind == "event":
                queue = self._views.get(view_id)
                if queue and queue.transport_version == 3 and content.get("event") in ("viewchange", "selection", "click", "slicechange"):
                    if not queue.accepts_events(content.get("revision"), content.get("frameId"), content.get("snapshotId")):
                        return
                    if queue.frame and queue.frame["mode"] == "frozen" and content.get("event") in ("viewchange", "selection", "slicechange"):
                        return
                else:
                    current_frame = queue is not None and queue.accepts_events(content.get("revision"))
                    if content.get("event") in ("viewchange", "selection", "click", "slicechange", "error") and content.get("revision") != self.revision and not current_frame:
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
                    self._finish_export(future, payload=payload)
                except Exception as exc:
                    self._finish_export(future, error=exc)

        async def export_png(self, *, timeout: float, width: int | None = None,
                             height: int | None = None, scale: float | None = None) -> bytes:
            if timeout <= 0:
                raise ValueError("timeout must be positive")
            from .export import png_options
            options = png_options(width=width, height=height, scale=scale)
            if self._vesora_closed:
                raise RuntimeError("Notebook widget is closed")
            request_id = uuid.uuid4().hex
            future = asyncio.get_running_loop().create_future()
            self._export_requests[request_id] = future
            message = {"type": "export", "requestId": request_id}
            if options:
                message["options"] = options
            if self._views or figure._streams:
                snapshot, buffers, _ = figure._frozen_transfer()
                message.update(type="stream-export", snapshot=snapshot,
                               bufferLengths=[len(part) for part in buffers])
                if self._views:
                    message["viewId"] = next(iter(self._views))
                self.send(message, buffers=buffers)
            else:
                self.send(message)
            try:
                return await asyncio.wait_for(future, timeout)
            finally:
                self._export_requests.pop(request_id, None)

        def close(self) -> None:
            with figure._lock:
                if not getattr(self, "_vesora_closed", True):
                    self._vesora_closed = True
                    if self._update in figure._listeners:
                        figure._listeners.remove(self._update)
                    for future in tuple(self._export_requests.values()):
                        if not future.done():
                            self._finish_export(future, error=RuntimeError("Widget closed during export"))
                    self._export_requests.clear()
                    self._views.clear()
                    if self._transfer_timer is not None:
                        self._transfer_timer.cancel()
                        self._transfer_timer = None
                    self._transfer_deadline = None
            super().close()

    return VesoraWidget()
