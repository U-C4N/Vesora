"""Protocol 7 data and mixed-panel contracts match the shared renderer."""
from array import array
import copy
import math

import pytest

import vesora as vs


def test_mixed_panels_keep_dimensions_bookmarks_and_scalar_surface_data():
    fig = vs.subplots(1, 2, kinds=[["3d", "2d"]])
    surface = fig.panel(0, 0).surface([[1., 2.], [3., 4.]], values=[[9., 8.], [7., 6.]], shading="smooth", wireframe=True)
    fig.panel(0, 0).plot3d([0., 1.], [0., 1.], [0., 1.])
    fig.panel(0, 1).plot([0., 1.], [2., 3.])
    fig.panel(0, 0).set_axes(box_aspect=(2, 1, 3))
    fig.bookmark("both")
    scene = fig.snapshot()["figure"]
    assert scene["protocolVersion"] == 7
    assert scene["view"]["kind"] == "3d" and scene["panels"][1]["view"]["kind"] == "2d"
    assert scene["view"]["boxAspect"] == [2, 1, 3]
    assert scene["bookmarks"][0]["panelViews"]["panel-0-1"]["kind"] == "2d"
    assert fig._layer_arrays(surface._spec())["color"].shape == (2, 2)
    before = fig._frozen_transfer()
    with pytest.raises(ValueError, match="dimensionality"):
        fig.panel(0, 1).plot3d([0], [0], [0])
    with pytest.raises(ValueError, match="shape"):
        surface.set_data(values=[1., 2.])
    assert fig._frozen_transfer() == before
    fig.close()


def test_surface_slices_are_exact_owned_and_update_atomically():
    fig = vs.subplots(1, 3, kinds=[["3d", "2d", "2d"]])
    raw = array("f", [1, 2, 3, 4, 5, 6])
    grid = memoryview(raw).cast("B").cast("f", shape=[2, 3])
    surface = fig.panel(0, 0).surface([0., 1., 2.], [10., 20.], grid)
    column = fig.panel(0, 1).slice(surface, axis="x", index=1)
    row = fig.panel(0, 2).slice(surface, axis="y", index=0)
    assert isinstance(column, vs.SurfaceSlice)
    assert list(fig._layer_arrays(column._spec())["x"]) == [10., 20.]
    assert list(fig._layer_arrays(column._spec())["y"]) == [2., 5.]
    assert fig._layer_arrays(column._spec())["y"].dtype.name == "float32"
    raw[1] = 99
    assert list(fig._layer_arrays(column._spec())["y"]) == [2., 5.]
    observed = []
    fig._listeners.append(lambda: observed.append(fig._frozen_transfer()))
    surface.set_data(z=[[7., math.nan, 9.], [10., 11., 12.]])
    assert len(observed) == 1
    assert math.isnan(list(fig._layer_arrays(column._spec())["y"])[0])
    assert list(fig._layer_arrays(row._spec())["y"])[0] == 7.
    column.set_index(2)
    assert list(fig._layer_arrays(column._spec())["y"]) == [9., 12.]
    stable = fig._frozen_transfer()
    for operation in (lambda: surface.set_data(x=[0., 1., 2.]), lambda: surface.set_data(z=[[1., 2.], [3., 4.]]),
                      lambda: column.set_data([1.], [2.]), lambda: column.enable_streaming(max_points=3),
                      lambda: column.set_index(3), surface.remove):
        with pytest.raises((ValueError, RuntimeError)):
            operation()
        assert fig._frozen_transfer() == stable
    column.remove()
    row.remove()
    assert "slices" not in fig.snapshot()["figure"]
    surface.remove()
    fig.close()


@pytest.mark.parametrize("kinds", [[["3d"]], [["2d", "invalid"]], ["3d", "2d"]])
def test_invalid_mixed_grid_is_rejected(kinds):
    with pytest.raises(ValueError):
        vs.subplots(1, 2, kinds=kinds)


def test_3d_grid_cannot_share_axes_or_apply_surface_styles_to_lines():
    with pytest.raises(ValueError, match="Shared axes"):
        vs.subplots(1, 2, kinds=[["2d", "3d"]], sharex=True)
    fig = vs.figure()
    line = fig.plot3d([1, 2], [3, 4], [5, 6])
    assert fig.snapshot()["figure"]["protocolVersion"] == 7
    before = copy.deepcopy(fig.snapshot())
    with pytest.raises(ValueError, match="surface-only"):
        line.set_style(shading="smooth")
    with pytest.raises(ValueError, match="positive"):
        fig.set_axes(box_aspect=(0, 1, 1))
    assert fig.snapshot() == before
    fig.close()


def test_camera_equal_aspect_focus_and_fit_are_atomic_and_panel_local():
    fig = vs.subplots(1, 2, kinds=[["2d", "3d"]])
    panel = fig.panel(0, 1)
    panel.plot3d([1., 10.], [2., 20.], [3., 30.])
    other = copy.deepcopy(fig.snapshot()["figure"]["view"])
    assert panel.set_equal_aspect() is panel
    panel.set_axes(xscale="log")
    panel.focus_selection({"x": [1., 5.], "y": [2., 6.], "z": [3., 7.]})
    view = fig.snapshot()["figure"]["panels"][1]["view"]
    assert view["equalAspect"] and view["xDomain"] == [1., 5.]
    assert view["camera"]["distance"] == 3 and view["pan3d"] == [0, 0]
    before = fig.snapshot()
    for operation in (lambda: panel.focus_selection({"x": [0., 5.], "y": [2., 6.], "z": [3., 7.]}),
                      lambda: panel.focus_selection({"x": [1., 5.], "y": [2., 6.], "z": [7., 3.]}),
                      lambda: panel.set_equal_aspect(1), lambda: fig.set_equal_aspect(),
                      lambda: fig.focus_selection({"x": [1., 5.], "y": [2., 6.], "z": [3., 7.]})):
        with pytest.raises(ValueError):
            operation()
        assert fig.snapshot() == before
    fig.bookmark("focused")
    panel.fit_to_data()
    fitted = fig.snapshot()["figure"]["panels"][1]["view"]
    assert all(axis + "Domain" not in fitted for axis in "xyz")
    assert fitted["equalAspect"] and fitted["camera"] == view["camera"]
    assert fig.snapshot()["figure"]["view"] == other
    fig.restore_bookmark("focused")
    assert fig.snapshot()["figure"]["panels"][1]["view"]["xDomain"] == [1., 5.]
    fig.close()
