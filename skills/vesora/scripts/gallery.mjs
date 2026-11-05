

/** A synthetic gallery; values describe no real experiment or detected anomaly. */
export function makeFigure(core) {
  const fig = core.subplots({rows: 5, cols: 2, width: 1200, height: 1800, title: 'Vesora 1.0 — ten analysis families'});
  const panel = index => fig.panel(Math.floor(index / 2), index % 2);
  panel(0).setTitle('Empirical distribution').ecdf([2, 1, 2, 4, 7], {label: 'ECDF', color: '#3569c8'});
  panel(0).ccdf([2, 1, 2, 4, 7], {label: 'CCDF', color: '#d36a55'});
  panel(1).setTitle('Supplied time × frequency').spectrogram([0, 1, 2], [10, 20, 30], [[1, 2, 1], [2, 5, 2], [1, 3, 4]], {maxRows: 16});
  panel(2).setTitle('Events').eventTimeline([{start: 0, end: 2, lane: 'Device A', label: 'Acquire', id: 'a'}, {start: 1, end: 3, lane: 'Device B', label: 'Acquire', id: 'b'}, {start: 2, lane: 'Device A', label: 'Checkpoint', id: 'c'}]);
  panel(3).setTitle('Supplied measurement bounds').errorbar([0, 1, 2], [2, 3, 2], {yLower: [1.5, 2.8, 1.7], yUpper: [2.4, 3.5, 2.3]});
  panel(4).setTitle('Scalar contours').contourf([0, 1, 2], [0, 1, 2], [[0, 1, 0], [1, 3, 1], [0, 1, 0]], {levels: [0.5, 1.5, 2.5]});
  panel(4).contour([0, 1, 2], [0, 1, 2], [[0, 1, 0], [1, 3, 1], [0, 1, 0]], {levels: [0.5, 1.5, 2.5], color: '#24323a'});
  panel(5).setTitle('Vector field').quiver([0, 1, 0, 1], [0, 0, 1, 1], [1, 0.5, -0.5, -1], [0.5, 1, 1, 0.5]);
  panel(6).setTitle('Alternatives').parallelCoordinates({temperature: [10, 20, 15], pressure: [2, 5, 3], cost: [8, 4, 6]}, {axes: [{key: 'temperature'}, {key: 'pressure'}, {key: 'cost'}]});
  panel(7).setTitle('Minimize both objectives').paretoFront([1, 2, 3, 4], [4, 2, 3, 1], {objectives: ['min', 'min'], showAll: true});
  panel(8).setTitle('Ordered trajectory').phasePortrait([0, 1, 0, -1, 0], [1, 0, -1, 0, 1], {time: [0, 1, 2, 3, 4], direction: true});
  panel(9).setTitle('Composition, total = 1').ternary([0.6, 0.2, 0.3], [0.2, 0.6, 0.3], [0.2, 0.2, 0.4], {sum: 1, labels: ['A', 'B', 'C']});
  return fig;
}
