import { figure, Layer } from '../../packages/core/dist/index.js';
import { examples } from './scenarios.js';

const number = new Intl.NumberFormat('tr-TR');
const parameterNumber = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const cards = new Map();
window.vesoraGallery = new Map();
let activeFilter = 'all';
let pageClosed = false;

function representationText(infos) {
  if (!infos.length) return 'Görünüm hazırlanıyor…';
  const density = infos.find(info => info.kind === 'density');
  if (density) return `${number.format(density.visible)} kayıt · Hücre başına sayım`;
  const surface = infos.find(info => info.kind === 'surface');
  if (surface) return `${number.format(surface.rendered)} üçgen · Düzenli grid`;
  const grid = infos.find(info => info.kind === 'grid');
  if (grid) return `${number.format(grid.rendered)} hücre · Skaler alan`;
  const points = infos.find(info => info.kind === 'points');
  if (points) return `${number.format(points.rendered)} nokta · Gerçek kayıtlar`;
  const total = Math.max(...infos.map(info => info.total));
  const reduced = infos.some(info => !info.exact);
  return `${number.format(total)} örnek · ${reduced ? 'Min/max azaltma' : 'Tam çizgi'}${infos.length > 1 ? ` · ${infos.length} seri` : ''}`;
}

function searchText(value) {
  return value.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ı/g, 'i');
}

function applyFilters() {
  const terms = searchText(document.getElementById('gallery-search').value.trim()).split(/\s+/).filter(Boolean);
  let visible = 0;
  for (const { card, example } of cards.values()) {
    const text = searchText([example.title, example.type, example.description, example.insight, example.id, ...example.tags].join(' '));
    const matches = (activeFilter === 'all' || activeFilter === example.dimension || (activeFilter === 'ai' && example.category === 'ai'))
      && terms.every(term => text.includes(term));
    card.hidden = !matches;
    if (matches) visible++;
  }
  for (const dimension of ['2d', '3d']) {
    const matches = [...cards.values()].some(item => item.example.dimension === dimension && !item.card.hidden);
    document.getElementById(dimension === '2d' ? 'two-d' : 'three-d').hidden = !matches;
  }
  const count = document.getElementById('visible-count');
  count.textContent = `${visible} / ${examples.length} örnek`;
  count.dataset.count = String(visible);
  document.getElementById('gallery-empty').hidden = visible !== 0;
  for (const button of document.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === activeFilter));
}

function setFilter(value) { activeFilter = value; applyFilters(); }

function createCard(example, index) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.example = example.id;
  card.setAttribute('aria-labelledby', `title-${example.id}`);
  card.innerHTML = `<div class="card-header"><div class="card-heading"><div class="card-kicker"><span class="card-number"></span><span class="card-type"></span></div><h3 id="title-${example.id}"></h3><p class="card-description"></p></div><span class="dimension ${example.dimension === '3d' ? 'three' : ''}">${example.dimension.toUpperCase()}</span></div>
    <div class="card-tags"></div><div class="chart"></div><p class="error" role="alert" hidden></p>
    <div class="card-insight"></div>
    <div class="card-bottom"><span class="representation" role="status">Görünüm hazırlanıyor…</span><div class="card-actions"><button data-action="focus" aria-pressed="false" title="Grafiği tam satıra genişlet" disabled>Genişlet ↗</button><button data-action="reset" title="Başlangıç verisine ve görünümüne dön" disabled>↺ Sıfırla</button><button data-action="export" disabled>PNG ↓</button></div></div>
    <p class="feedback" aria-live="polite"></p>
    <details class="code-details"><summary><span>Başlangıç kodu<span class="code-label">Python / JavaScript</span></span></summary><div class="code-body"><div class="card-tools"><div class="code-tabs" aria-label="Örnek kod dili"><button data-language="python" aria-pressed="true">Python</button><button data-language="javascript" aria-pressed="false">JavaScript</button></div><button class="copy-code" data-action="copy">Kodu kopyala</button></div><pre><code></code></pre></div></details>`;
  card.querySelector('.card-number').textContent = String(index + 1).padStart(2, '0');
  card.querySelector('.card-type').textContent = example.type;
  card.querySelector('h3').textContent = example.title;
  card.querySelector('.card-description').textContent = example.description;
  card.querySelector('.card-insight').textContent = example.insight;
  card.querySelector('code').textContent = example.python;
  if (example.synthetic) {
    const note = document.createElement('p'); note.className = 'data-note';
    note.textContent = example.dataNote ?? 'Temsili veri · Gerçek model sonuçları değildir.';
    card.querySelector('.card-tags').after(note);
  }
  if (example.series) {
    const legend = document.createElement('div'); legend.className = 'series-legend';
    legend.setAttribute('role', 'group'); legend.setAttribute('aria-label', 'Grafik serilerini göster veya gizle');
    for (const [index, series] of example.series.entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.series = String(index);
      button.setAttribute('aria-pressed', 'true'); button.title = `${series.label} serisini gizle`; button.disabled = true;
      const swatch = document.createElement('span'); swatch.className = 'series-swatch';
      swatch.style.backgroundColor = series.color; swatch.setAttribute('aria-hidden', 'true');
      button.append(swatch, document.createTextNode(series.label)); legend.append(button);
    }
    card.querySelector('.chart').before(legend);
  }
  for (const text of example.tags) {
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = text;
    card.querySelector('.card-tags').append(tag);
  }
  if (example.control) {
    const control = document.createElement('div'); control.className = 'parameter-control';
    const label = document.createElement('label'); label.htmlFor = `parameter-${example.id}`; label.textContent = example.control.label;
    const input = document.createElement('input'); input.type = 'range'; input.id = label.htmlFor; input.dataset.control = example.id;
    for (const key of ['min', 'max', 'step', 'value']) input[key] = String(example.control[key]);
    input.disabled = true;
    const output = document.createElement('output'); output.setAttribute('for', input.id);
    output.textContent = `${parameterNumber.format(example.control.value)}${example.control.unit ? ` ${example.control.unit}` : ''}`;
    control.append(label, input, output); card.querySelector('.card-insight').after(control);
  }
  document.getElementById(`gallery-${example.dimension}`).append(card);
  const errorElement = card.querySelector('.error');
  const report = error => { errorElement.textContent = error?.message ?? String(error); errorElement.hidden = false; };
  let language = 'python';
  for (const button of card.querySelectorAll('[data-language]')) button.addEventListener('click', () => {
    language = button.dataset.language; card.querySelector('code').textContent = example[language];
    for (const tab of card.querySelectorAll('[data-language]')) tab.setAttribute('aria-pressed', String(tab === button));
    card.querySelector('.feedback').textContent = '';
  });
  card.querySelector('[data-action="copy"]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(example[language]);
      card.querySelector('.feedback').textContent = `${language === 'python' ? 'Python' : 'JavaScript'} kodu kopyalandı.`;
    } catch {
      const range = document.createRange(); range.selectNodeContents(card.querySelector('code'));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      card.querySelector('.feedback').textContent = 'Kod seçildi. Ctrl+C veya ⌘C ile kopyalayabilirsin.';
    }
  });
  const entry = { card, example, report, frame: 0, parameterVersion: 0, viewRevision: 0 };
  cards.set(example.id, entry);
  return entry;
}

async function mountExample(entry) {
  const { card, example, report } = entry;
  const chart = card.querySelector('.chart');
  const errorElement = card.querySelector('.error');
  let fig;
  try {
    fig = figure({ width: Math.max(200, chart.clientWidth), height: 380 });
    const controller = example.create(fig);
    const initialView = structuredClone(fig.spec.view);
    const initialVisibility = fig.spec.layers.map(layer => layer.visible);
    const layerHandles = fig.spec.layers.map(layer => new Layer(fig, layer.id));
    window.vesoraGallery.set(example.id, fig);
    fig.on('representation', infos => {
      const status = card.querySelector('.representation');
      status.textContent = infos.length ? representationText(infos) : 'Tüm seriler gizli · Bir seri seçin';
      if (infos.length && example.series) {
        const visible = example.series.filter(series => series.layerIndices.some(index => fig.spec.layers[index].visible)).length;
        const markers = example.series.some(series => series.layerIndices.length > 1);
        status.textContent = `${visible} / ${example.series.length} seri · ${markers ? 'Çizgi + noktalar' : 'Çok serili çizgi'}`;
      }
      status.title = infos.map(info => info.method).join(' / ');
    });
    fig.on('error', report);
    fig.on('selection', event => {
      card.querySelector('.feedback').textContent = event.kind === 'density'
        ? `Seçilen hücre bölgesinde ${number.format(event.count)} kayıt var.`
        : `${number.format(event.count)} kayıt seçildi.${event.truncated ? ' İlk 10.000 kaydın kimliği döndürüldü.' : ''}`;
    });
    fig.mount(chart); await fig.ready();
    card.dataset.ready = 'true';
    for (const button of card.querySelectorAll('[data-action]')) button.disabled = false;
    for (const button of card.querySelectorAll('[data-series]')) {
      button.disabled = false;
      button.addEventListener('click', async () => {
        const revision = entry.viewRevision;
        const series = example.series[Number(button.dataset.series)];
        const visible = button.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-pressed', String(visible));
        button.title = `${series.label} serisini ${visible ? 'gizle' : 'göster'}`;
        for (const index of series.layerIndices) layerHandles[index].setVisible(visible);
        try { await fig.ready(); } catch (error) { if (!pageClosed && revision === entry.viewRevision) report(error); }
      });
    }
    const input = card.querySelector('[data-control]');
    const updateParameter = async value => {
      const version = ++entry.parameterVersion;
      card.dataset.updating = 'true';
      try {
        controller.update(value); await fig.ready();
        if (version === entry.parameterVersion) errorElement.hidden = true;
      } catch (error) { if (!pageClosed && version === entry.parameterVersion) report(error); }
      finally { if (version === entry.parameterVersion) card.dataset.updating = 'false'; }
    };
    if (input) {
      input.disabled = false;
      input.addEventListener('input', () => {
        card.querySelector('output').textContent = `${parameterNumber.format(Number(input.value))}${example.control.unit ? ` ${example.control.unit}` : ''}`;
        if (entry.frame) cancelAnimationFrame(entry.frame);
        entry.frame = requestAnimationFrame(() => { entry.frame = 0; if (!pageClosed) void updateParameter(Number(input.value)); });
      });
    }
    card.querySelector('[data-action="focus"]').addEventListener('click', async event => {
      const revision = entry.viewRevision;
      const focused = card.classList.toggle('is-focused');
      event.currentTarget.setAttribute('aria-pressed', String(focused));
      event.currentTarget.textContent = focused ? 'Küçült ↙' : 'Genişlet ↗';
      fig.spec.height = focused ? 520 : 380; fig.changed();
      try { await fig.ready(); } catch (error) { if (!pageClosed && revision === entry.viewRevision) report(error); }
    });
    card.querySelector('[data-action="reset"]').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true;
      if (entry.frame) { cancelAnimationFrame(entry.frame); entry.frame = 0; }
      entry.parameterVersion++;
      entry.viewRevision++;
      try {
        layerHandles.forEach((layer, index) => layer.setVisible(initialVisibility[index]));
        for (const button of card.querySelectorAll('[data-series]')) {
          button.setAttribute('aria-pressed', 'true');
          button.title = `${example.series[Number(button.dataset.series)].label} serisini gizle`;
        }
        if (input) {
          input.value = String(example.control.value);
          card.querySelector('output').textContent = `${parameterNumber.format(example.control.value)}${example.control.unit ? ` ${example.control.unit}` : ''}`;
          controller.update(example.control.value);
        }
        fig.setView({ ...structuredClone(initialView), xDomain: initialView.xDomain, yDomain: initialView.yDomain, zDomain: initialView.zDomain });
        fig.mount(chart); await fig.ready();
        card.querySelector('.feedback').textContent = ''; errorElement.hidden = true;
      } catch (error) { if (!pageClosed) report(error); }
      finally { button.disabled = false; card.dataset.updating = 'false'; }
    });
    card.querySelector('[data-action="export"]').addEventListener('click', async event => {
      const button = event.currentTarget; button.disabled = true;
      try {
        if (entry.frame) {
          cancelAnimationFrame(entry.frame); entry.frame = 0;
          await updateParameter(Number(input.value));
        }
        const blob = await fig.savefig(), url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = `vesora-${example.id}.png`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { if (!pageClosed) report(error); }
      finally { button.disabled = false; }
    });
  } catch (error) {
    fig?.close(); window.vesoraGallery.delete(example.id);
    card.dataset.ready = 'error'; card.querySelector('.representation').textContent = 'Görünüm oluşturulamadı';
    report(error);
  }
}

examples.forEach(createCard);
document.getElementById('gallery-search').addEventListener('input', applyFilters);
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => setFilter(button.dataset.filter));
for (const link of document.querySelectorAll('nav a[href="#two-d"], nav a[href="#three-d"]')) link.addEventListener('click', () => {
  document.getElementById('gallery-search').value = '';
  setFilter(link.hash === '#two-d' ? '2d' : '3d');
});
applyFilters();
// Release every figure and its pending work when leaving this gallery.
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  pageClosed = true;
  for (const entry of cards.values()) if (entry.frame) cancelAnimationFrame(entry.frame);
  for (const fig of window.vesoraGallery.values()) fig.close();
  window.vesoraGallery.clear();
});
await Promise.all([...cards.values()].map(mountExample));
