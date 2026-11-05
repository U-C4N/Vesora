# Comparison and cohort workflows

## Event-aligned runs

```js
import {createRunComparison} from '@vesora/core/runtime';
const comparison = createRunComparison([
  {id: 'before', x: [19, 20, 21], y: [1, 2, 3], unit: 'V', xUnit: 's'},
  {id: 'after', x: [26, 27, 28], y: [1, 2.5, 3.5], unit: 'V', xUnit: 's'},
], {alignment: 'exact', eventOffsets: {before: 20, after: 27}});
```

Plot `comparison.runs` to show aligned source curves. Plot `comparison.rows.map(row => row.deltas.after ?? NaN)` against row x for candidate-minus-reference. Missing matches stay null/gaps. `samples` identifies original sample indices and any interpolation. Keep `lineage` when handing data to another application.

Alignment is explicit: `exact` by default; `nearest` needs a meaningful tolerance; `linear` needs a meaningful maximum gap. Do not bridge missing rows or extrapolate silently. Matching units are required unless the user explicitly permits mismatch; values are never converted. Python exposes the equivalent `create_run_comparison` helper.

## Stable-ID cohorts

```js
import {linkObservations} from '@vesora/core/runtime';
const ids = ['request-a', 'request-b', 'request-c'];
const scatter = fig.panel(0, 0).scatter([1, 2, 3], [20, 90, 50]);
const distribution = fig.panel(0, 1).ecdf([20, 90, 50]);
const selection = linkObservations(fig, {
  datasetId: 'requests', rowIds: ids,
  members: [{layer: scatter}, {layer: distribution}],
});
selection.selectIds(['request-b']);
const page = selection.query({offset: 0, limit: 100});
// page.ids resolves application rows; page.total is complete membership.
```

Dataset IDs and row IDs are explicit and unique. Members may supply their own `rowIds` in source order when rows are reordered. Never join by array position after an application sort. `query` is paginated and returns a revision token; pass that token when continuing one consistent result. A stale token is an error, not a reason to merge pages from different selections.

This general observation link is separate from the legacy fixed scatter/scatter/histogram link. Scalar cells and spectrogram windows have different identity domains and do not join raw observation rows. Cleanup `selection.dispose()` before the owner closes the figure. Application tables remain application-owned; HTML carries the scene/selection, not table callbacks or application code.

The complete shared example is `examples/web/v1-scenarios.js` in the repository. It powers the plain browser page and `?demo=v1` React route using the same public core APIs.
