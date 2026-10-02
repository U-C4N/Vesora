"""Authenticated loopback transport. No rendering or plot algorithms live here."""
from __future__ import annotations

import asyncio
import base64
from concurrent.futures import Future
from pathlib import Path
import secrets
import threading
import uuid
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .figure import Figure

ASSETS = Path(__file__).parent / "_assets"


class LocalHost:
    def __init__(self, figure: Figure):
        self.figure = figure
        self.token = secrets.token_urlsafe(32)
        self.port = 0
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._runner: Any = None
        self._sockets: set[Any] = set()
        self._started = threading.Event()
        self.ready = threading.Event()
        self._state_lock = threading.RLock()
        self._revision = 0
        self.render_error: RuntimeError | None = None
        self._error: BaseException | None = None
        self._exports: dict[str, Future[bytes]] = {}
        self._exports_lock = threading.Lock()
        self._closed = False

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    @property
    def url(self) -> str:
        return f"{self.origin}/viewer?token={self.token}"

    def start(self) -> LocalHost:
        if self._thread is not None:
            return self
        if not (ASSETS / "index.js").is_file() or not (ASSETS / "viewer.html").is_file():
            raise RuntimeError("Vesora viewer assets are missing. Build the JavaScript package before running from source.")
        self._thread = threading.Thread(target=self._run, name="vesora-host", daemon=True)
        self._thread.start()
        if not self._started.wait(15):
            raise TimeoutError("Timed out starting the Vesora local host")
        if self._error:
            raise RuntimeError(f"Cannot start the Vesora host: {self._error}") from self._error
        self.figure._listeners.append(self.publish)
        return self

    def _run(self) -> None:
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._setup())
            self._started.set()
            self._loop.run_forever()
        except BaseException as exc:
            self._error = exc
            self._started.set()
        finally:
            pending = asyncio.all_tasks(self._loop)
            for task in pending:
                task.cancel()
            if pending:
                self._loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            self._loop.close()

    async def _setup(self) -> None:
        from aiohttp import web

        @web.middleware
        async def access(request: Any, handler: Any) -> Any:
            if request.host != f"127.0.0.1:{self.port}":
                raise web.HTTPForbidden(text="Invalid host")
            origin = request.headers.get("Origin")
            if origin is not None and origin != self.origin:
                raise web.HTTPForbidden(text="Invalid origin")
            if request.path in ("/snapshot", "/ws", "/viewer") or request.path.startswith("/data/"):
                if not secrets.compare_digest(request.query.get("token", ""), self.token):
                    raise web.HTTPForbidden(text="Invalid session token")
            response = await handler(request)
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
            return response

        app = web.Application(middlewares=[access], client_max_size=64 * 1024 * 1024)
        app.router.add_get("/snapshot", self._snapshot)
        app.router.add_get("/data/{data_id}", self._data)
        app.router.add_get("/ws", self._websocket)
        app.router.add_get("/viewer", self._viewer)
        app.router.add_get("/host.js", self._host_js)
        app.router.add_static("/assets/", ASSETS, show_index=False, follow_symlinks=False)
        self._runner = web.AppRunner(app, access_log=None)
        await self._runner.setup()
        site = web.TCPSite(self._runner, "127.0.0.1", 0)
        await site.start()
        self.port = site._server.sockets[0].getsockname()[1]

    async def _snapshot(self, request: Any) -> Any:
        from aiohttp import web
        return web.json_response(self.figure.snapshot())

    async def _data(self, request: Any) -> Any:
        from aiohttp import web
        try:
            version = int(request.query["version"])
        except (KeyError, ValueError):
            raise web.HTTPBadRequest(text="A numeric version is required") from None
        try:
            payload = self.figure._data_bytes(request.match_info["data_id"], version)
        except KeyError:
            raise web.HTTPNotFound(text="Unknown dataset") from None
        except ValueError as exc:
            raise web.HTTPConflict(text=str(exc)) from None
        return web.Response(body=payload, content_type="application/octet-stream")

    async def _viewer(self, request: Any) -> Any:
        from aiohttp import web
        return web.FileResponse(ASSETS / "viewer.html")

    async def _host_js(self, request: Any) -> Any:
        from aiohttp import web
        return web.FileResponse(ASSETS / "host.js")

    async def _websocket(self, request: Any) -> Any:
        from aiohttp import web, WSMsgType
        socket = web.WebSocketResponse(heartbeat=20, max_msg_size=64 * 1024 * 1024)
        await socket.prepare(request)
        self._sockets.add(socket)
        try:
            with self._state_lock:
                message = {"type": "snapshot", "snapshot": self.figure.snapshot(), "revision": self._revision}
            await socket.send_json(message)
            async for message in socket:
                if message.type == WSMsgType.TEXT:
                    try:
                        self._receive(message.json())
                    except (ValueError, TypeError, KeyError) as exc:
                        await socket.send_json({"type": "error", "message": str(exc)})
                elif message.type == WSMsgType.ERROR:
                    break
        finally:
            self._sockets.discard(socket)
            if not self._sockets:
                self.ready.clear()
                self._fail_exports("Viewer disconnected during export")
        return socket

    def _receive(self, message: dict[str, Any]) -> None:
        if not isinstance(message, dict):
            raise ValueError("Protocol message must be an object")
        kind = message.get("type")
        if kind == "ready":
            with self._state_lock:
                if message.get("revision") == self._revision:
                    self.render_error = None
                    self.ready.set()
        elif kind == "event":
            if message.get("event") == "error":
                with self._state_lock:
                    if message.get("revision") != self._revision:
                        return
                    payload = message.get("payload")
                    detail = payload.get("message", "Viewer rendering failed") if isinstance(payload, dict) else str(payload)
                    self.render_error = RuntimeError(str(detail))
                    self.ready.clear()
                self._fail_exports(str(self.render_error))
            self.figure._emit(str(message.get("event", "")), message.get("payload"))
        elif kind in ("export", "export-error"):
            request_id = str(message.get("requestId", ""))
            with self._exports_lock:
                future = self._exports.pop(request_id, None)
            if future is None or future.done():
                return
            if kind == "export-error":
                future.set_exception(RuntimeError(str(message.get("message", "PNG export failed"))))
                return
            try:
                data_url = message["dataUrl"]
                prefix = "data:image/png;base64,"
                if not isinstance(data_url, str) or not data_url.startswith(prefix):
                    raise ValueError("Viewer did not return a PNG data URL")
                payload = base64.b64decode(data_url[len(prefix):], validate=True)
                if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ValueError("Viewer returned invalid PNG bytes")
                future.set_result(payload)
            except Exception as exc:
                future.set_exception(exc)

    async def _broadcast(self, message: dict[str, Any]) -> None:
        for socket in tuple(self._sockets):
            if not socket.closed:
                try:
                    await socket.send_json(message)
                except (ConnectionError, RuntimeError):
                    self._sockets.discard(socket)

    def publish(self) -> None:
        if self._loop is not None and not self._closed:
            with self._state_lock:
                self._revision += 1
                self.ready.clear()
                self.render_error = None
                message = {"type": "snapshot", "snapshot": self.figure.snapshot(), "revision": self._revision}
                asyncio.run_coroutine_threadsafe(self._broadcast(message), self._loop)

    def export(self) -> Future[bytes]:
        if self.render_error is not None:
            raise self.render_error
        if self._closed or self._loop is None or not self.ready.is_set():
            raise RuntimeError("Viewer is not ready for export")
        request_id = uuid.uuid4().hex
        future: Future[bytes] = Future()
        with self._exports_lock:
            self._exports[request_id] = future
        def remove(_: Future[bytes]) -> None:
            with self._exports_lock:
                self._exports.pop(request_id, None)
        future.add_done_callback(remove)
        asyncio.run_coroutine_threadsafe(self._broadcast({"type": "export", "requestId": request_id}), self._loop)
        return future

    def _fail_exports(self, reason: str) -> None:
        with self._exports_lock:
            futures, self._exports = list(self._exports.values()), {}
        for future in futures:
            if not future.done():
                future.set_exception(RuntimeError(reason))

    async def _shutdown(self) -> None:
        for socket in tuple(self._sockets):
            await socket.close()
        await self._runner.cleanup()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self.publish in self.figure._listeners:
            self.figure._listeners.remove(self.publish)
        self._fail_exports("Figure closed during export")
        if self._loop and self._loop.is_running():
            if threading.current_thread() is self._thread:
                async def finish() -> None:
                    await self._shutdown()
                    self._loop.stop()
                self._loop.create_task(finish())
            else:
                try:
                    asyncio.run_coroutine_threadsafe(self._shutdown(), self._loop).result(timeout=5)
                finally:
                    self._loop.call_soon_threadsafe(self._loop.stop)
                    self._thread.join(timeout=5)
