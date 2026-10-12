// Deterministic synthetic observations; Python and JavaScript use the same rows.
export function modelErrors(fig, count = 200_000) {
  const prediction = new Float64Array(count), feature = new Float64Array(count), residual = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    prediction[i] = (i % 1000) / 10;
    feature[i] = (i % 257) / 256;
    residual[i] = 3 * Math.sin(i * .173) + 2 * Math.cos(i * .071);
    if (prediction[i] >= 60 && prediction[i] <= 80 && feature[i] >= .8) residual[i] += 22;
  }
  const left = fig.panel(0, 0), middle = fig.panel(0, 1), right = fig.panel(0, 2);
  left.setTitle('Find unusual errors');
  const a = left.scatter(prediction, residual, {label: 'Observations', color: '#3569c8', size: 4});
  left.setView({xLabel: 'Prediction', yLabel: 'Residual'});
  middle.setTitle('Inspect the same observations');
  const b = middle.scatter(feature, residual, {label: 'Observations', color: '#3569c8', size: 4});
  middle.setView({xLabel: 'Feature', yLabel: 'Residual'});
  right.setTitle('Compare error distributions');
  const histogram = right.hist(residual, {bins: Array.from({length: 41}, (_, i) => -6 + i * .85), color: '#3569c8', label: 'All observations'});
  right.setView({xLabel: 'Residual', yLabel: 'Count'});
  const link = fig.linkSelection({scatter: [a, b], histogram});
  fig.bookmark('Overview', {note: 'Shift + drag around the high-residual group in either scatter plot.'});
  left.setView({xDomain: [55, 85], yDomain: [15, 28]});
  fig.bookmark('Unusual errors', {note: 'Selecting this group highlights the same rows in the other scatter and histogram.'});
  fig.restoreBookmark('Overview');
  return {link, scatter: [a, b], histogram};
}

const python = `import math
import vesora as vs

n = 200_000
prediction = [(i % 1000) / 10 for i in range(n)]
feature = [(i % 257) / 256 for i in range(n)]
residual = [3 * math.sin(i * .173) + 2 * math.cos(i * .071)
            + (22 if 60 <= prediction[i] <= 80 and feature[i] >= .8 else 0)
            for i in range(n)]
fig = vs.subplots(1, 3, title="Investigate unusual model errors", width=1200, height=520)
left, middle, right = fig.panel(0, 0), fig.panel(0, 1), fig.panel(0, 2)
left.set_title("Find unusual errors")
a = left.scatter(prediction, residual, label="Observations", color="#3569c8", size=4)
left.set_axes(xlabel="Prediction", ylabel="Residual")
middle.set_title("Inspect the same observations")
b = middle.scatter(feature, residual, label="Observations", color="#3569c8", size=4)
middle.set_axes(xlabel="Feature", ylabel="Residual")
right.set_title("Compare error distributions")
h = right.hist(residual, bins=[-6 + i * .85 for i in range(41)],
               color="#3569c8", label="All observations")
right.set_axes(xlabel="Residual", ylabel="Count")
link = fig.link_selection(scatter=[a, b], histogram=h)
fig.bookmark("Overview", note="Shift + drag around the high-residual group in either scatter plot.")
left.set_axes(xlim=(55, 85), ylim=(15, 28))
fig.bookmark("Unusual errors", note="Selecting this group highlights the same rows in the other scatter and histogram.")
fig.restore_bookmark("Overview")
fig.show()
# After inspecting the selection, save it with fig.save_html("model-errors.html").`;

export const linkedExamples = [{
  id: 'linked-model-errors', title: 'Investigate unusual model errors', type: 'LINKED SELECTION',
  dimension: '2d', layout: {rows: 1, cols: 3}, create: modelErrors,
  tags: ['200,000 observations', 'Python + JavaScript', 'Offline HTML'], synthetic: true,
  dataNote: 'Synthetic observations with an injected error group · Not real model results.',
  description: 'Select an unusual group, follow the same rows in another variable, and compare their distribution.',
  insight: 'Shift + drag in either scatter. Pan, zoom and Reset preserve the cohort; Clear selection removes it. Histogram bins do not change.',
  python,
  javascript: `import { subplots } from "@vesora/core";\n\n${modelErrors.toString()}\n\nconst fig = subplots({rows: 1, cols: 3, title: "Investigate unusual model errors", width: 1200, height: 520});\nconst {link} = modelErrors(fig);\nfig.mount(document.querySelector("#chart"));\n// link.clear() clears the cohort; link.remove() unlocks the linked layer data.`,
}];
