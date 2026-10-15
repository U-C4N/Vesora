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

    def __init__(self, freeze: Callable[[], tuple[Any, list[bytes], Any]], revision: int, transport_version: int = 2):
        if transport_version not in (2, 3):
            raise ValueError("Unsupported streaming transport version")
        self.freeze = freeze
        self.transport_version = transport_version
        self.revision = revision
        self.last_reset_revision = revision
        self.acknowledged: int | None = None
        self.inflight: tuple[str, int, float] | None = None
        self.pending: list[dict[str, Any]] = []
        self.pending_bytes = 0
        self.pending_records = 0
        self.needs_snapshot = True
        self.frame: dict[str, Any] | None = None
        self.inspection_registration: str | None = None

    def update(self, revision: int, change: dict[str, Any] | None) -> None:
        self.revision = revision
        if change is None:
            self.last_reset_revision = revision
        if self.needs_snapshot:
            return
        updates = change.get("updates", [change]) if change else []
        size = sum(len(item["buffer"]) for update in updates for item in update["channels"])
        if change is None or self.transport_version == 2 and change.get("kind") == "append-batch" or self.pending_records + len(updates) > MAX_PENDING_UPDATES or self.pending_bytes + size > MAX_PENDING_BYTES:
            self.pending.clear()
            self.pending_bytes = 0
            self.pending_records = 0
            self.needs_snapshot = True
        else:
            self.pending.append({**change, "_revision": revision})
            self.pending_bytes += size
            self.pending_records += len(updates)

    def resync(self) -> None:
        self.inflight = None
        self.pending.clear()
        self.pending_bytes = 0
        self.pending_records = 0
        self.needs_snapshot = True

    def acknowledge(self, transfer_id: Any, revision: Any) -> bool:
        if self.inflight is None or (transfer_id, revision) != self.inflight[:2]:
            return False
        self.acknowledged = self.inflight[1]
        self.inflight = None
        return True

    def record_frame(self, revision: Any, frame_id: Any, mode: Any = "live", snapshot_id: Any = None) -> bool:
        """Track presentation separately from accepted-data acknowledgements in v3."""
        if self.transport_version != 3 or any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in (revision, frame_id)):
            return False
        if self.acknowledged is None or revision > self.acknowledged or mode not in ("live", "frozen"):
            return False
        if mode == "frozen" and (not isinstance(snapshot_id, str) or not snapshot_id):
            return False
        if self.frame is not None and frame_id < self.frame["frameId"]:
            return False
        if revision < self.last_reset_revision and not (mode == "frozen" and self.frame is not None and self.frame["revision"] == revision and self.frame.get("snapshotId") == snapshot_id):
            return False
        self.frame = {"revision": revision, "frameId": frame_id, "mode": mode,
                      **({"snapshotId": snapshot_id} if mode == "frozen" else {})}
        return True

    def accepts_events(self, revision: Any, frame_id: Any = None, snapshot_id: Any = None) -> bool:
        # Pointer events identify the completed frame. Later appends may advance
        # Python while that frame remains visible, but resets invalidate it.
        if self.transport_version == 3:
            return self.frame is not None and (self.frame["mode"] == "frozen" or self.frame["revision"] >= self.last_reset_revision) and revision == self.frame["revision"] and frame_id == self.frame["frameId"] and snapshot_id == self.frame.get("snapshotId")
        return revision == self.acknowledged and self.acknowledged is not None and self.acknowledged >= self.last_reset_revision

    def restore_frozen_frame(self, registration: Any, previous: Any) -> bool:
        """Re-register only a snapshot already owned by this stable view session."""
        self.inspection_registration = "unrecognized"
        if self.transport_version != 3 or not isinstance(registration, dict) or not isinstance(previous, dict) or previous.get("mode") != "frozen":
            return False
        revision, frame_id, snapshot_id = (registration.get(key) for key in ("revision", "frameId", "snapshotId"))
        if any(isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 9_007_199_254_740_991 for value in (revision, frame_id)):
            return False
        if revision != previous.get("revision") or revision > self.revision or frame_id < previous.get("frameId", 0) or not isinstance(snapshot_id, str) or snapshot_id != previous.get("snapshotId"):
            return False
        self.frame = {"revision": revision, "frameId": frame_id, "mode": "frozen", "snapshotId": snapshot_id}
        self.inspection_registration = "restored"
        return True

    @property
    def presented_revision(self) -> int | None:
        """Last completed live frame; acceptance alone is not presentation in v3."""
        if self.transport_version == 2:
            return self.acknowledged
        return self.frame["revision"] if self.frame is not None and self.frame["mode"] == "live" else None

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
        header: dict[str, Any] = {"transportVersion": self.transport_version, "transferId": transfer_id, "revision": self.revision}
        if self.transport_version == 3 and self.inspection_registration is not None:
            header["inspectionRegistration"] = self.inspection_registration
            self.inspection_registration = None
        if self.needs_snapshot:
            snapshot, buffers, streams = self.freeze()
            header.update(type="stream-snapshot", snapshot=snapshot, streams=streams)
        else:
            buffers = []
            updates = []
            transactions = []
            for change in self.pending:
                transaction = []
                for update in change.get("updates", [change]):
                    channels = []
                    for item in update["channels"]:
                        channels.append({**{key: value for key, value in item.items() if key != "buffer"}, "bufferIndex": len(buffers)})
                        buffers.append(item["buffer"])
                    transaction.append({"layerId": update["layerId"], "channels": channels, "state": copy.deepcopy(update["state"])})
                updates.extend(transaction)
                transactions.append({"revision": change["_revision"], "updates": transaction})
            header.update(type="stream-delta", baseRevision=self.acknowledged)
            header["transactions" if self.transport_version == 3 else "updates"] = transactions if self.transport_version == 3 else updates
        header["bufferLengths"] = [len(buffer) for buffer in buffers]
        self.pending.clear()
        self.pending_bytes = 0
        self.pending_records = 0
        self.needs_snapshot = False
        self.inflight = (transfer_id, self.revision, time.monotonic())
        return header, buffers


def binary_packet(header: dict[str, Any], buffers: list[bytes]) -> bytes:
    """Length-prefixed UTF-8 JSON followed by the header's binary buffers."""
    metadata = json.dumps(header, allow_nan=False, separators=(",", ":")).encode("utf-8")
    return struct.pack("<I", len(metadata)) + metadata + b"".join(buffers)
