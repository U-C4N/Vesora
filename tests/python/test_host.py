import asyncio
import base64
import struct
from array import array

import pytest

import vesora as vs
from vesora import host as host_module

aiohttp = pytest.importorskip("aiohttp")


@pytest.fixture
def live_host(tmp_path, monkeypatch):
    # Transport tests use inert assets; the browser tests verify the real engine.
    for name in ("index.js", "host.js", "viewer.html"):
        (tmp_path / name).write_text("test asset", encoding="utf-8")
    monkeypatch.setattr(host_module, "ASSETS", tmp_path)
    fig = vs.Figure()
    layer = fig.scatter(array("d", [1., 2.]), array("f", [3., 4.]))
    host = host_module.LocalHost(fig).start()
    yield host, fig, layer
    host.close()
    fig.close()


def test_http_auth_binary_versions_and_shutdown(live_host):
    host, fig, layer = live_host
    async def scenario():
        async with aiohttp.ClientSession() as client:
            async with client.get(f"{host.origin}/snapshot") as response:
                assert response.status == 403
            async with client.get(f"{host.origin}/snapshot?token={host.token}", headers={"Origin": "https://example.com"}) as response:
                assert response.status == 403
            async with client.get(f"{host.origin}/snapshot?token={host.token}", headers={"Host": "attacker.example"}) as response:
                assert response.status == 403
            async with client.get(f"{host.origin}/snapshot?token={host.token}") as response:
                assert response.status == 200
                snapshot = await response.json()
            source = snapshot["sources"][0]
            url = f"{host.origin}/data/{source['id']}?token={host.token}&version=1"
            async with client.get(url) as response:
                assert response.status == 200
                assert struct.unpack("<2d", await response.read()) == (1, 2)
            layer.set_data([5., 6.], [7., 8.])
            async with client.get(url) as response:
                assert response.status == 409
    asyncio.run(scenario())


def test_websocket_update_readiness_events_and_png(live_host):
    host, fig, layer = live_host
    events = []
    fig.on("selection", events.append)
    async def scenario():
        async with aiohttp.ClientSession() as client:
            async with client.ws_connect(f"{host.origin}/ws?token={host.token}", origin=host.origin) as socket:
                message = await socket.receive_json(timeout=3)
                assert message["type"] == "snapshot"
                assert not host.ready.is_set()
                with pytest.raises(RuntimeError, match="not ready"):
                    host.export()
                await socket.send_json({"type": "ready", "revision": message["revision"]})
                for _ in range(50):
                    if host.ready.is_set():
                        break
                    await asyncio.sleep(.01)
                assert host.ready.is_set()
                layer.set_style(size=9)
                message = await socket.receive_json(timeout=3)
                assert message["snapshot"]["figure"]["layers"][0]["style"]["size"] == 9
                assert not host.ready.is_set()
                await socket.send_json({"type": "ready", "revision": message["revision"]})
                for _ in range(50):
                    if host.ready.is_set():
                        break
                    await asyncio.sleep(.01)
                assert host.ready.is_set()
                await socket.send_json({"type": "event", "event": "selection", "payload": {"kind": "density", "count": 10}})
                future = host.export()
                export = await socket.receive_json(timeout=3)
                png = b"\x89PNG\r\n\x1a\n" + b"transport fixture"
                await socket.send_json({"type": "export", "requestId": export["requestId"], "dataUrl": "data:image/png;base64," + base64.b64encode(png).decode()})
                result = await asyncio.wait_for(asyncio.wrap_future(future), 3)
                assert result == png
                assert events == [{"kind": "density", "count": 10}]
                pending = host.export()
                await socket.receive_json(timeout=3)
            with pytest.raises(RuntimeError, match="disconnected"):
                await asyncio.wait_for(asyncio.wrap_future(pending), 3)
    asyncio.run(scenario())


def test_invalid_export_response_is_an_error(live_host):
    host, fig, layer = live_host
    host.ready.set()
    future = host.export()
    request_id = next(iter(host._exports))
    host._receive({"type": "export", "requestId": request_id, "dataUrl": "data:image/jpeg;base64,eA=="})
    with pytest.raises(ValueError, match="PNG"):
        future.result(timeout=1)


def test_publish_invalidates_ready_and_ignores_obsolete_responses(live_host):
    host, fig, layer = live_host
    host._receive({"type": "ready", "revision": 0})
    assert host.ready.is_set()
    layer.set_data(y=[5., 6.])
    assert not host.ready.is_set()
    host._receive({"type": "ready", "revision": 0})
    assert not host.ready.is_set()
    host._receive({"type": "event", "event": "error", "revision": 0, "payload": {"message": "obsolete"}})
    assert host.render_error is None
    host._receive({"type": "event", "event": "error", "revision": 1, "payload": {"message": "current render failed"}})
    with pytest.raises(RuntimeError, match="current render failed"):
        host.export()
    layer.set_data(y=[7., 8.])
    assert host.render_error is None
    host._receive({"type": "ready", "revision": 2})
    assert host.ready.is_set()
