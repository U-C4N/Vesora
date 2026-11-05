"""Protocol-9 source ownership, atomicity and complete observation membership."""
import copy
import importlib
import json
import re
from array import array

import pytest
import vesora as vs


def spec(layer):
    return next(item for item in layer.figure.snapshot()["figure"]["layers"] if item["id"] == layer.id)


def values(layer, channel):
    return list(layer.figure._sources[spec(layer)["data"][channel]][1])


@pytest.mark.parametrize("method,args,options,kind", [
    ("ecdf", ([3, 1, 1],), {}, "ecdf"),
    ("ccdf", ([3, 1, 1],), {}, "ecdf"),
    ("spectrogram", ([0, 1], [10, 20], [[1, 2], [3, 4]]), {"max_rows": 2}, "spectrogram"),
    ("event_timeline", ([{"start": 0, "end": 1, "lane": "A", "id": "e"}],), {}, "eventTimeline"),
    ("errorbar", ([0, 1], [2, 3]), {"y_lower": [1, 2], "y_upper": [3, 4]}, "errorbar"),
    ("contour", ([0, 1], [0, 1], [[0, 1], [2, 3]]), {"levels": 2}, "contour"),
    ("contourf", ([0, 1], [0, 1], [[0, 1], [2, 3]]), {"levels": [1, 2]}, "contour"),
    ("quiver", ([0, 1], [0, 1], [1, 0], [0, 1]), {}, "quiver"),
    ("parallel_coordinates", ({"a": [1, 2], "b": [4, 3]},), {}, "parallelCoordinates"),
    ("pareto_front", ([1, 2], [2, 1]), {}, "paretoFront"),
    ("phase_portrait", ([1, 0, -1], [0, 1, 0]), {"time": [0, 1, 2]}, "phasePortrait"),
    ("hysteresis", ([1, 0, -1], [0, 1, 0]), {}, "phasePortrait"),
    ("ternary", ([2, 3], [3, 2], [5, 5]), {"normalize": True}, "ternary"),
])
def test_figure_panel_and_module_entrypoints_preserve_sources(method, args, options, kind):
    for owner in (vs.Figure(), vs.subplots(1, 1).panel(0, 0)):
        layer = getattr(owner, method)(*args, **options)
        assert spec(layer)["kind"] == kind
        assert layer.figure.snapshot()["figure"]["protocolVersion"] == 9
        assert layer.figure._host is None
        assert callable(getattr(vs, method))
        layer.figure.close()


def test_advanced_updates_are_atomic_owned_and_keep_semantics():
    fig = vs.Figure()
    source = array("f", [1, 2, 2])
    layer = fig.ecdf(source)
    layer.set_semantics({"samples": {"unit": "ms", "origin": {"datasetId": "trial-1"}}})
    source[0] = 99
    assert values(layer, "samples") == [1, 2, 2]
    assert fig.snapshot()["sources"][0]["dtype"] == "float32"
    layer.set_data(samples=[4, 3, 4])
    layer.set_options(complementary=True)
    assert spec(layer)["options"] == {"complementary": True}
    assert layer.get_semantics()["samples"]["unit"] == "ms"
    before = fig.snapshot()
    for action in (lambda: layer.set_data(samples=[[1]]), lambda: layer.set_options(complementary=1), lambda: layer.set_data(unknown=[1])):
        with pytest.raises((TypeError, ValueError)):
            action()
        assert fig.snapshot() == before
    fig.close()


@pytest.mark.parametrize("action", [
    lambda fig: fig.spectrogram([0, 1, 3], [1, 2], [[1, 2], [3, 4], [5, 6]]),
    lambda fig: fig.spectrogram([0], [1, 2], [[-1, 2]], value_scale="db"),
    lambda fig: fig.errorbar([0], [1]),
    lambda fig: fig.errorbar([0], [1], y_lower=[2], y_upper=[3]),
    lambda fig: fig.contour([0], [0, 1], [[1], [2]]),
    lambda fig: fig.event_timeline([{"start": 2, "end": 1}]),
    lambda fig: fig.parallel_coordinates({"a": [1], "b": [1, 2]}),
    lambda fig: fig.pareto_front([1], [2], objectives=["min"]),
    lambda fig: fig.phase_portrait([0, 1], [2, 3], time=[0, 0]),
    lambda fig: fig.ternary([1], [1], [1]),
])
def test_invalid_creation_does_not_change_scene(action):
    fig = vs.Figure()
    before = fig.snapshot()
    with pytest.raises((TypeError, ValueError)):
        action(fig)
    assert fig.snapshot() == before
    fig.close()


def test_projected_panels_reject_cartesian_mix_and_preserve_projection_on_failure():
    fig = vs.Figure()
    fig.parallel_coordinates({"a": [1, 2], "b": [3, 4]})
    before = fig.snapshot()
    assert before["figure"]["view"]["kind"] == "2d"
    assert before["figure"]["view"]["projection"] == "parallel"
    with pytest.raises(ValueError):
        fig.scatter([1, 2], [3, 4])
    assert fig.snapshot() == before
    with pytest.raises(ValueError):
        fig.set_axes(xscale="log")
    assert fig.snapshot() == before
    fig.close()


def test_spectrogram_eviction_snapshot_and_schema2(tmp_path, monkeypatch):
    module = importlib.import_module("vesora.html")
    template = tmp_path / "standalone.html"
    template.write_text('<script>__VESORA_PAYLOAD_JSON__</script>', encoding="utf8")
    monkeypatch.setattr(module, "_TEMPLATE", template)
    fig = vs.Figure()
    layer = fig.spectrogram([0, 1, 2], [10, 20], [[0, 1], [2, 3], [4, 5]], max_rows=2)
    snapshot, frozen_buffers, _ = fig._frozen_transfer()
    assert spec(layer)["options"]["sequenceStart"] == 1
    layer.append_rows([3, 4], [[6, 7], [8, 9]])
    assert values(layer, "y") == [3, 4]
    assert values(layer, "z") == [6, 7, 8, 9]
    assert spec(layer)["options"]["sequenceStart"] == 3
    assert spec(layer)["options"]["sequenceEnd"] == 5
    assert snapshot["figure"]["layers"][0]["options"]["sequenceEnd"] == 3
    assert frozen_buffers != fig._frozen_transfer()[1]
    before = fig.snapshot()
    for time, rows in (([6], [[1, 2]]), ([4], [[1, 2]]), ([5], [[1]])):
        with pytest.raises((TypeError, ValueError)):
            layer.append_rows(time, rows)
        assert fig.snapshot() == before
    payload = json.loads(re.search(r"<script>(.*)</script>", fig.to_html(observation=True)).group(1))
    observation = payload["snapshot"]["figure"]["observation"]
    assert observation["schemaVersion"] == 2
    assert observation["streams"][0]["shape"] == [2, 2]
    assert observation["streams"][0]["retainedAxis"] == 0
    assert observation["streams"][0]["sequenceStart"] == 3
    fig.close()


def test_spectrogram_float32_and_capacity_changes_start_an_atomic_new_epoch():
    fig = vs.Figure()
    layer = fig.spectrogram(array("f", [0,1]), [10,20], array("f", [1,2,3,4]), max_rows=3)
    layer.append_rows(array("f", [2]), array("f", [5,6]))
    assert fig._sources[spec(layer)["data"]["z"]][0]["dtype"] == "float32"
    old_epoch = fig._streams[layer.id]["streamId"]
    before = fig.snapshot()
    with pytest.raises(TypeError, match="dtypes"):
        layer.append_rows([3], [[7,8]])
    assert fig.snapshot() == before
    layer.set_options(max_rows=1)
    assert values(layer,"y") == [2]
    assert values(layer,"z") == [5,6]
    assert spec(layer)["options"]["sequenceStart"] == 0
    assert spec(layer)["options"]["sequenceEnd"] == 1
    assert fig._streams[layer.id]["streamId"] != old_epoch
    assert fig._streams[layer.id]["maxPoints"] == 1
    before = fig.snapshot()
    for action in (lambda: layer.set_options(sequenceStart=50), lambda: fig.set_axes(yscale="log")):
        with pytest.raises(ValueError):
            action()
        assert fig.snapshot() == before
    fig.close()


def test_schema2_rejects_forged_same_length_intervals_and_bool_grid_dimensions():
    from vesora.observation import make_accepted_observation, validate_observation
    fig = vs.Figure(); fig.spectrogram([0,1],[10,20],[[1,2],[3,4]])
    snapshot = fig.snapshot()
    observation = make_accepted_observation(snapshot["figure"],snapshot["sources"],fig._streams,"2026-11-05T00:00:00.000Z")
    for mutate in (lambda record: record["streams"][0].update(sequenceStart=10,sequenceEndExclusive=12),
                   lambda record: record["streams"][0].update(retainedAxis=False),
                   lambda record: record["streams"][0].update(shape=[True,2])):
        bad = copy.deepcopy(observation); mutate(bad)
        with pytest.raises(ValueError):
            validate_observation(bad,snapshot["figure"],snapshot["sources"])
    old = copy.deepcopy(snapshot["figure"]); old["protocolVersion"] = 8
    with pytest.raises(ValueError,match="protocol 9"):
        validate_observation(observation,old,snapshot["sources"])
    fig.close()


def test_run_comparison_event_alignment_and_gap_lineage():
    runs = [{"id": "a", "x": [10, 11, 12, 13], "y": [1, 2, 3, 4], "eventOffset": 10, "unit": "K"},
            {"id": "b", "x": [20, 22, 23], "y": [2, 6, float("nan")], "eventOffset": 20, "unit": "K"}]
    exact = vs.create_run_comparison(runs)
    assert exact["rows"][1]["values"]["b"] is None
    result = vs.create_run_comparison(runs, alignment="linear", max_gap=2)
    assert result["rows"][1]["deltas"]["b"] == 2
    assert result["rows"][1]["samples"]["b"] == {"value": 4, "sourceIndices": [0, 1], "interpolated": True}
    assert result["rows"][3]["values"]["b"] is None
    runs[0]["y"][0] = 999
    assert result["runs"][0]["y"][0] == 1
    bad = copy.deepcopy(runs); bad[1]["unit"] = "C"
    with pytest.raises(ValueError, match="units differ"):
        vs.create_run_comparison(bad)


def test_run_comparison_ratios_preserve_missing_zero_and_overflow_boundaries():
    result = vs.create_run_comparison([{"id":"reference","x":[0,1,2,3,4],"y":[0,2,float("nan"),1e-308,-2]},
                                       {"id":"candidate","x":[0,1,2,3,4],"y":[1,6,3,1e308,4]}])
    assert [row["ratios"]["candidate"] for row in result["rows"]] == [None,3,None,None,-2]
    assert [row["deltas"]["candidate"] for row in result["rows"]] == [1,4,None,1e308,6]
    assert result["rows"][1]["ratios"]["reference"] == 1


def test_query_ecdf_nearest_rank_threshold_ties_and_empty_inputs():
    values = [3,1,2,2,float("nan"),float("inf")]
    assert vs.query_ecdf(values,probability=.5) == {"count":4,"omitted":2,"quantile":2,"sourceIndices":[2,3],"sourceCount":2,"truncated":False,"sourceKind":"quantile-ties"}
    assert vs.query_ecdf(values,probability=0)["quantile"] == 1
    assert vs.query_ecdf(values,probability=1)["quantile"] == 3
    both = vs.query_ecdf(values,probability=.5,threshold=1)
    assert both["quantile"] == 2
    assert both["sourceIndices"] == [1]
    assert both["probability"] == .25
    assert both["exceedanceCount"] == 3
    assert vs.query_ecdf([],probability=.5,threshold=2)["quantile"] is None
    assert vs.query_ecdf([],threshold=2)["probability"] is None
    assert vs.query_ecdf([1,2])["sourceKind"] == "none"
    assert values[:4] == [3,1,2,2]


def test_query_ecdf_caps_only_preview_and_rejects_unsupported_queries():
    result = vs.query_ecdf([2]*12005,probability=.5)
    assert result["sourceCount"] == 12005
    assert len(result["sourceIndices"]) == 10000
    assert result["truncated"] is True
    for options in ({"probability":-1},{"probability":1.1},{"probability":True},{"threshold":float("inf")},{"threshold":None},{"unknown":True}):
        with pytest.raises((ValueError,TypeError)):
            vs.query_ecdf([1,2],**options)


def test_observation_selection_is_complete_paged_serializable_and_epoch_fenced():
    fig = vs.Figure()
    count = 12005
    layer = fig.scatter(range(count), range(count))
    ids = [f"row-{i}" for i in range(count)]
    group = fig.link_observations(dataset_id="trial", row_ids=ids, members=[layer])
    ids[0] = "mutated"
    group.set_predicate({"layerId": layer.id, "ranges": {"x": [0, count]}})
    first = group.query(limit=10000)
    second = group.query(offset=first["nextOffset"], revision=first["revision"])
    assert first["total"] == count
    assert first["ids"][0] == "row-0"
    assert second["ids"] == [f"row-{i}" for i in range(10000, 11000)]
    assert fig.snapshot()["figure"]["observationGroups"][0]["selectedIds"][-1] == "row-12004"
    before = fig.snapshot()
    with pytest.raises(ValueError, match="remove the observation group"):
        layer.set_data([1], [2])
    assert fig.snapshot() == before
    group.select_ids([])
    assert group.query()["total"] == 0
    with pytest.raises(RuntimeError, match="STALE"):
        group.query(revision=first["revision"])
    group.clear()
    assert group.query()["active"] is False
    group.dispose()
    layer.set_data([1], [2])
    group.dispose()
    fig.close()


def test_python_live_ecdf_events_recover_full_tied_membership_beyond_preview():
    fig = vs.Figure(); count = 12005
    layer = fig.ecdf([1]*count+[2])
    controller = fig.link_observations(dataset_id="ties",row_ids=[f"r{i}" for i in range(count+1)],members=[layer])
    fig._emit("selection",{"kind":"points","layerId":layer.id,"indices":list(range(10000)),"count":count,"truncated":True,
                           "bounds":{"x":[.99,1.01],"y":[0,1]},"sourceKind":"sample","mode":"live"})
    assert controller.query()["total"] == count
    controller.clear()
    fig._emit("selection",{"kind":"points","layerId":layer.id,"indices":[0],"count":1,"truncated":False,"mode":"frozen"})
    assert controller.query()["active"] is False
    controller.dispose(); fig.close()
