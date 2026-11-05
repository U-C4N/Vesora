import {makeFigure as makeGallery} from '../../skills/vesora/scripts/gallery.mjs';

export const workspaceNames = ['gallery', 'signal', 'comparison', 'cohort'];
export const datasetNames = ['sensor', 'service'];
const color = ['#68d8c0', '#d2b3ff', '#ffb67c'];

/** Shared browser/React examples. Every dataset is synthetic and bounded. */
export function createWorkspace(core, kind = 'gallery', dataset = 'sensor') {
  if (!workspaceNames.includes(kind) || !datasetNames.includes(dataset)) throw new Error('Unknown synthetic workspace/dataset');
  if (kind === 'gallery') return {kind, dataset, figure: makeGallery(core), summary: 'All ten analysis families · synthetic values · dedicated projection panels', timeMax: 31, dispose() {this.figure.close();}};
  if (kind === 'signal') return signalWorkspace(core, dataset);
  if (kind === 'comparison') return comparisonWorkspace(core, dataset);
  return cohortWorkspace(core, dataset);
}

function signalWorkspace(core, dataset) {
  const figure = core.subplots({rows: 2, cols: 2, width: 1320, height: 850, title: 'Event inspection · synthetic signal'});
  const wave = figure.panel(0, 0).setTitle('Retained waveform · 32 samples');
  const spectral = figure.panel(0, 1).setTitle('Supplied spectrum · time on vertical axis');
  const events = figure.panel(1, 0).setTitle('Acquisition events');
  const distribution = figure.panel(1, 1).setTitle('Current retained distribution');
  let next = 32, retained = Array.from({length: 32}, (_, i) => sample(i, dataset));
  const frequency = [10, 20, 30, 40, 50, 60];
  const rows = time => frequency.map((_, i) => 0.1 + Math.abs(Math.sin(time * 0.12 + i * 0.4)) + (time % 17 === 0 && i === 3 ? 2 : 0));
  const line = wave.plot(retained.map(row => row.time), retained.map(row => row.value), {color: color[0], label: 'Synthetic response'}).enableStreaming({maxPoints: 32});
  line.setSemantics({x: {quantity: 'time', unit: 's'}, y: {quantity: 'response', unit: dataset === 'sensor' ? 'V' : 'ms'}});
  wave.setView({xLabel: 'Time (s)', yLabel: dataset === 'sensor' ? 'Voltage (V)' : 'Latency (ms)'});
  const spectrum = spectral.spectrogram(retained.map(row => row.time), frequency, retained.map(row => rows(row.time)), {maxRows: 32, colorbarLabel: 'Supplied power'});
  spectral.setView({xLabel: 'Frequency (Hz)', yLabel: 'Time (s)'});
  events.eventTimeline([{start: 8, end: 14, lane: 'Acquisition', label: 'Phase A'}, {start: 17, lane: 'Checkpoint', label: 'Synthetic event'}, {start: 24, end: 30, lane: 'Acquisition', label: 'Phase B'}], {color: color[2]});
  events.setView({xLabel: 'Time (s)'});
  const ecdf = distribution.ecdf(retained.map(row => row.value), {label: 'Retained values', color: color[1]});
  distribution.setView({xLabel: dataset === 'sensor' ? 'Voltage (V)' : 'Latency (ms)', yLabel: 'P(X ≤ x)'});
  const workspace = {
    kind: 'signal', dataset, figure, timeMax: 31,
    summary: 'Waveform, supplied spectrum and events share one time-window control. Each live source retains at most 32 time rows.',
    setWindow(end, width = 12) {wave.setView({xDomain: [end - width, end]}); spectral.setView({yDomain: [end - width, end]}); events.setView({xDomain: [end - width, end]});},
    async append() {
      const batch = Array.from({length: 8}, () => sample(next++, dataset));
      await figure.appendDataBatch([{layer: line, data: {x: batch.map(row => row.time), y: batch.map(row => row.value)}}], {waitFor: 'accepted'});
      await spectrum.appendRows(batch.map(row => row.time), batch.map(row => rows(row.time)), {waitFor: 'accepted'});
      retained = [...retained, ...batch].slice(-32); ecdf.setData({samples: retained.map(row => row.value)});
      workspace.timeMax = next - 1; workspace.setWindow(workspace.timeMax);
      if (figure.getInspectionState().mode !== 'frozen') await figure.ready();
      return {timeMax: workspace.timeMax, retained: retained.length};
    },
    dispose() {figure.close();},
  };
  workspace.setWindow(31); return workspace;
}

function sample(time, dataset) {return {time, value: (dataset === 'sensor' ? 2 : 35) + Math.sin(time * .4) * (dataset === 'sensor' ? .6 : 8) + (time % 17 === 0 ? dataset === 'sensor' ? 1.4 : 25 : 0)};}

function comparisonWorkspace(core, dataset) {
  const unit = dataset === 'sensor' ? 'V' : 'ms';
  const x = Array.from({length: 41}, (_, i) => i), base = x.map(t => (dataset === 'sensor' ? 2 : 35) + Math.sin(t * .2) * (dataset === 'sensor' ? 1 : 8));
  const comparison = core.createRunComparison([
    {id: 'before', label: 'Reference', x, y: base, unit, xUnit: 's'},
    {id: 'after', label: 'Candidate', x: x.map(t => t + 7), y: base.map((value, i) => value + (i >= 20 ? dataset === 'sensor' ? .35 : 6 : dataset === 'sensor' ? .05 : 1)), unit, xUnit: 's'},
  ], {alignment: 'exact', eventOffsets: {before: 20, after: 27}});
  const figure = core.subplots({rows: 3, cols: 1, width: 1320, height: 950, title: 'Run comparison · event-aligned synthetic runs'});
  for (const [index, run] of comparison.runs.entries()) figure.panel(0, 0).plot(run.x, run.y, {label: run.label, color: color[index]});
  figure.panel(0, 0).setTitle('Both runs aligned to their declared event').setView({xLabel: 'Seconds relative to event', yLabel: unit});
  figure.panel(1, 0).setTitle('Candidate − reference · original matched samples').plot(comparison.rows.map(row => row.x), comparison.rows.map(row => row.deltas.after ?? NaN), {color: color[2], label: 'Delta'});
  figure.panel(1, 0).axhline(0, {color: '#80909e'});
  figure.panel(2, 0).setTitle('Declared event alignment').eventTimeline([{start: 0, lane: 'Reference', label: 't = 20 s'}, {start: 0, lane: 'Candidate', label: 't = 27 s'}]);
  return {kind: 'comparison', dataset, figure, comparison, timeMax: 20, summary: 'Exact alignment; reference event 20 s, candidate event 27 s. No interpolation or unit conversion. Delta preserves source lineage.', setWindow(end, width = 12) {for (let row = 0; row < 3; row++) figure.panel(row, 0).setView({xDomain: [end - width, end]});}, dispose() {figure.close();}};
}

function cohortWorkspace(core, dataset) {
  const shift = dataset === 'service' ? 11 : 0;
  const rows = Array.from({length: 64}, (_, i) => ({id: `sample-${String(i).padStart(3, '0')}`, group: dataset === 'service' ? i % 3 === 0 ? 'West' : 'East' : i % 3 === 0 ? 'Batch A' : 'Batch B', latency: 10 + ((i * 17 + shift) % 90), cost: 1 + ((i * 7 + shift) % 31), quality: .65 + ((i * 3 + shift) % 30) / 100}));
  const figure = core.subplots({rows: 2, cols: 2, width: 1320, height: 850, title: 'Cohort explorer · stable observation IDs'});
  const scatter = figure.panel(0, 0).setTitle('Drag a region · cost versus latency').scatter(rows.map(row => row.cost), rows.map(row => row.latency), {color: color[0], size: 7});
  const ecdf = figure.panel(0, 1).setTitle('Latency ECDF · same original rows').ecdf(rows.map(row => row.latency), {color: color[1]});
  const parallel = figure.panel(1, 0).setTitle('Cost, latency, quality').parallelCoordinates({cost: rows.map(row => row.cost), latency: rows.map(row => row.latency), quality: rows.map(row => row.quality)});
  const pareto = figure.panel(1, 1).setTitle('Minimize cost and latency').paretoFront(rows.map(row => row.cost), rows.map(row => row.latency), {objectives: ['min', 'min'], showAll: true});
  const link = core.linkObservations(figure, {datasetId: `synthetic-${dataset}`, rowIds: rows.map(row => row.id), members: [scatter, ecdf, parallel, pareto].map(layer => ({layer}))});
  return {kind: 'cohort', dataset, figure, controller: link, timeMax: 31, summary: 'Stable IDs link four views and a paginated table. A selection preview is never treated as the full cohort.', queryRows(offset = 0) {const page = link.query({offset, limit: 12}); return {...page, rows: page.ids.map(id => rows.find(row => row.id === id))};}, selectHigh() {link.selectIds(rows.filter(row => row.latency >= 75).map(row => row.id));}, clear() {link.clear();}, dispose() {link.dispose(); figure.close();}};
}
