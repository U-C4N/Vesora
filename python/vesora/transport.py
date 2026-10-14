"""Bounded, revision-checked binary transfers shared by desktop and notebook."""
from __future__ import annotations

import copy
import json
import struct
import time
import uuid
from typing import Any, Callable

MAX_PENDING_BYTES = 8 * 1024 * 1024
MAX_PENDING_UPDATES = 1024
ACK_TIMEOUT = 30.0


class TransferQueue:
    """One immutable in-flight frame and at most 8 MiB of pending appends."""

    def __init__(self, freeze: Callable[[], tuple[Any, list[bytes], Any]], revision: int):
        self.freeze = freeze
        self.revision = revision
        self.last_reset_revision = revision
        self.acknowledged: int | None = None
        self.inflight: tuple[str, int, float] | None = None
        self.pending: list[dict[str, Any]] = []
        self.pending_bytes = 0
        self.needs_snapshot = True

    def update(self, revision: int, change: dict[str, Any] | None) -> None:
        self.revision = revision
        if change is None:
            self.last_reset_revision = revision
        if self.needs_snapshot:
            return
        size = sum(len(item["buffer"]) for item in change["channels"]) if change else 0
        if change is None or len(self.pending) >= MAX_PENDING_UPDATES or self.pending_bytes + size > MAX_PENDING_BYTES:
            self.pending.clear()
            self.pending_bytes = 0
            self.needs_snapshot = True
        else:
            self.pending.append(change)
            self.pending_bytes += size

    def resync(self) -> None:
        self.inflight = None
        self.pending.clear()
        self.pending_bytes = 0
        self.needs_snapshot = True

    def acknowledge(self, transfer_id: Any, revision: Any) -> bool:
        if self.inflight is None or (transfer_id, revision) != self.inflight[:2]:
            return False
        self.acknowledged = self.inflight[1]
        self.inflight = None
        return True

    def accepts_events(self, revision: Any) -> bool:
        # Pointer events identify the completed frame. Later appends may advance
        # Python while that frame remains visible, but resets invalidate it.
        return revision == self.acknowledged and self.acknowledged is not None and self.acknowledged >= self.last_reset_revision

    def retry_after(self) -> float | None:
        """Delay until a lost ACK must recover, even without another append."""
        return None if self.inflight is None else max(.001, self.inflight[2] + ACK_TIMEOUT - time.monotonic())

    def next(self) -> tuple[dict[str, Any], list[bytes]] | None:
        if self.inflight is not None:
            if time.monotonic() - self.inflight[2] < ACK_TIMEOUT:
                return None
            self.resync()
        if not self.needs_snapshot and not self.pending:
            return None
        transfer_id = uuid.uuid4().hex
        header: dict[str, Any] = {"transportVersion": 2, "transferId": transfer_id, "revision": self.revision}
        if self.needs_snapshot:
            snapshot, buffers, streams = self.freeze()
            header.update(type="stream-snapshot", snapshot=snapshot, streams=streams)
        else:
            buffers = []
            updates = []
            for change in self.pending:
                channels = []
                for item in change["channels"]:
                    channels.append({**{key: value for key, value in item.items() if key != "buffer"}, "bufferIndex": len(buffers)})
                    buffers.append(item["buffer"])
                updates.append({"layerId": change["layerId"], "channels": channels, "state": copy.deepcopy(change["state"])})
            header.update(type="stream-delta", baseRevision=self.acknowledged, updates=updates)
        header["bufferLengths"] = [len(buffer) for buffer in buffers]
        self.pending.clear()
        self.pending_bytes = 0
        self.needs_snapshot = False
        self.inflight = (transfer_id, self.revision, time.monotonic())
        return header, buffers


def binary_packet(header: dict[str, Any], buffers: list[bytes]) -> bytes:
    """Length-prefixed UTF-8 JSON followed by the header's binary buffers."""
    metadata = json.dumps(header, allow_nan=False, separators=(",", ":")).encode("utf-8")
    return struct.pack("<I", len(metadata)) + metadata + b"".join(buffers)
