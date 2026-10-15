from types import SimpleNamespace

import pytest

from vesora.notebook import _install_comm_route_compatibility


class Comm:
    def __init__(self, chosen='old', active=('current',)):
        self.chosen = chosen
        self.active = list(active)
        self.calls = []
        self.kernel = SimpleNamespace(shell_channel_thread=SimpleNamespace(
            _manager=SimpleNamespace(list_subshell=lambda: list(self.active))))

    def _reply_subshell_for(self, data, incoming):
        self.calls.append((data, incoming))
        return self.chosen


def message(kind='ack'):
    return {'method': 'custom', 'content': {'type': kind}}


def test_closed_cached_subshell_falls_back_to_valid_incoming_for_protocol_messages():
    comm = Comm()
    restore = _install_comm_route_compatibility(comm)
    for kind in ('hello', 'dispose-view', 'ack', 'resync', 'frame', 'event', 'export', 'export-error'):
        packet = message(kind)
        assert comm._reply_subshell_for(packet, 'current') == 'current'
        assert comm.calls[-1] == (packet, 'current')
    assert comm.chosen == 'old', 'Compatibility must not mutate the kernel routing cache'
    restore()
    assert '_reply_subshell_for' not in vars(comm)
    assert comm._reply_subshell_for(message(), 'current') == 'old'


def test_live_cached_subshell_and_invalid_incoming_are_preserved():
    comm = Comm(active=('old', 'current'))
    _install_comm_route_compatibility(comm)
    assert comm._reply_subshell_for(message(), 'current') == 'old'
    comm.active.remove('old')
    assert comm._reply_subshell_for(message(), 'also-deleted') == 'old'
    assert comm._reply_subshell_for(message(), None) is None
    comm.chosen = None
    assert comm._reply_subshell_for(message(), 'current') is None


def test_other_custom_messages_widget_state_and_malformed_packets_keep_original_route():
    comm = Comm()
    _install_comm_route_compatibility(comm)
    for packet in (None, [], {}, {'method': 'update', 'content': {'type': 'ack'}},
                   {'method': 'custom', 'content': []}, message('unrelated-rpc'), message([])):
        assert comm._reply_subshell_for(packet, 'current') == 'old'


def test_routing_installation_is_per_comm_and_does_not_overwrite_later_hooks():
    first, second = Comm(), Comm()
    restore = _install_comm_route_compatibility(first)
    assert first._reply_subshell_for(message(), 'current') == 'current'
    assert second._reply_subshell_for(message(), 'current') == 'old'
    later = lambda data, incoming: 'later'
    first._reply_subshell_for = later
    restore()
    assert first._reply_subshell_for is later


def test_existing_instance_hook_is_restored_idempotently():
    comm = Comm()
    original = lambda data, incoming: 'old'
    comm._reply_subshell_for = original
    restore = _install_comm_route_compatibility(comm)
    assert comm._reply_subshell_for(message(), 'current') == 'current'
    restore(); restore()
    assert comm._reply_subshell_for is original


def test_legacy_kernel_without_routing_or_subshell_manager_is_unchanged():
    for comm in (SimpleNamespace(), SimpleNamespace(_reply_subshell_for=lambda data, incoming: incoming)):
        before = dict(vars(comm))
        _install_comm_route_compatibility(comm)()
        assert vars(comm) == before


def test_feature_detection_does_not_initialize_a_lazy_subshell_manager():
    class Thread:
        _manager = None

        @property
        def manager(self):
            raise AssertionError('Feature detection must not initialize kernel resources')

    comm = Comm()
    comm.kernel.shell_channel_thread = Thread()
    _install_comm_route_compatibility(comm)()
    assert '_reply_subshell_for' not in vars(comm)


def test_widget_close_restores_its_routing_hook_once(monkeypatch):
    pytest.importorskip('anywidget')
    import vesora as vs
    import vesora.notebook as notebook
    restored = []
    monkeypatch.setattr(notebook, '_install_comm_route_compatibility', lambda comm: lambda: restored.append(comm))
    figure = vs.figure()
    widget = notebook.make_widget(figure)
    comm = widget.comm
    try:
        widget.close(); widget.close()
        assert restored == [comm]
    finally:
        figure.close()
