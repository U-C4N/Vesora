import {useEffect, useRef, useState} from 'react';
import * as core from '@vesora/core/runtime';
import {VesoraViewer, type ViewerHandle} from '@vesora/react/viewer';
import {chartStories, createChartStory} from '../../web/v1-tour-scenarios.js';
import './tour.css';

type Story = (typeof chartStories)[number];
type Scene = ReturnType<typeof createChartStory>;
const chrome = {toolbar: false, inspector: false, help: false, status: false};
const initialStory = () => {
  const requested = new URLSearchParams(window.location.search).get('chart');
  return chartStories.find(story => story.slug === requested)?.slug ?? chartStories[0].slug;
};
function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ChartTour() {
  const [slug, setSlug] = useState(initialStory), [theme, setTheme] = useState<'light'|'dark'>('light');
  const [scene, setScene] = useState<Scene>(), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [language, setLanguage] = useState<'js'|'python'>('js');
  const active = useRef<Scene | undefined>(undefined), mountedViewer = useRef<ViewerHandle | undefined>(undefined);
  const index = chartStories.findIndex(story => story.slug === slug), story: Story = chartStories[index];
  useEffect(() => {
    setError(''); setReady(false); mountedViewer.current = undefined;
    let current: Scene | undefined;
    try {
      current = createChartStory(core, slug, {theme, width: 900, height: 480});
      active.current = current; setScene(current);
    } catch (caught) {active.current = undefined; setScene(undefined); setError(caught instanceof Error ? caught.message : String(caught));}
    return () => {if (active.current === current) active.current = undefined; current?.dispose();};
    // A theme update preserves this figure, its camera and current interaction.
  }, [slug]);
  useEffect(() => {
    const url = new URL(window.location.href); url.searchParams.set('demo', 'tour'); url.searchParams.set('chart', slug);
    window.history.replaceState(null, '', url);
  }, [slug]);
  useEffect(() => {
    if (!scene || active.current !== scene) return;
    const existing = scene.figure.spec.theme;
    scene.figure.setTheme({...(typeof existing === 'object' ? existing : {}), background: theme === 'dark' ? '#17251f' : '#ffffff', foreground: theme === 'dark' ? '#e4eee6' : '#18312a', muted: theme === 'dark' ? '#a6b8ac' : '#61726a', grid: theme === 'dark' ? '#34483b' : '#e7ece4', axis: theme === 'dark' ? '#82998b' : '#a1b1a4'});
    const viewer = mountedViewer.current;
    if (!viewer) return;
    setReady(false);
    void viewer.figure.ready().then(() => {if (viewer.element.isConnected && active.current === scene && mountedViewer.current === viewer) {setReady(true); setError('');}}).catch(caught => {if (viewer.element.isConnected && active.current === scene && mountedViewer.current === viewer) setError(caught.message);});
  }, [scene, theme]);
  function viewerReady(viewer: ViewerHandle) {
    mountedViewer.current = viewer;
    void viewer.figure.ready().then(() => {
      if (viewer.element.isConnected && active.current?.figure === viewer.figure && mountedViewer.current === viewer) {setReady(true); setError('');}
    }).catch(caught => {
      if (viewer.element.isConnected && active.current?.figure === viewer.figure && mountedViewer.current === viewer) setError(caught.message);
    });
  }
  const go = (next: number) => {if (!busy && next >= 0 && next < chartStories.length) setSlug(chartStories[next].slug);};
  async function exportChart(kind: 'png'|'html') {
    if (!scene || !ready || busy) return;
    setBusy(true); setError('');
    try {
      if (kind === 'png') saveFile(await scene.figure.savefig({source: 'displayed', width: 1200, height: 640, scale: 1}), `vesora-${slug}.png`);
      else saveFile(new Blob([await core.toHTMLAsync(scene.figure, {source: 'displayed', observation: true})], {type: 'text/html'}), `vesora-${slug}.html`);
    } catch (caught) {setError(caught instanceof Error ? caught.message : String(caught));}
    finally {setBusy(false);}
  }
  return <main className="chart-tour" data-theme={theme} lang="tr">
    <div className="tour-shell">
      <header className="tour-header">
        <a className="tour-brand" href="?demo=tour" aria-label="Vesora grafik rehberi"><span className="tour-brand-mark" aria-hidden="true">v</span>vesora<span className="tour-brand-dot">.</span></a>
        <span className="tour-edition">1.0 / GRAFİK REHBERİ</span>
        <div className="tour-header-actions"><a href="?demo=v1">Analiz laboratuvarı <span aria-hidden="true">↗</span></a><button type="button" className="tour-theme" disabled={busy} onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'Koyu temaya geç' : 'Açık temaya geç'}><span aria-hidden="true">◐</span><span>{theme === 'light' ? 'Koyu tema' : 'Açık tema'}</span></button></div>
      </header>
      <section className="tour-intro" aria-labelledby="tour-heading">
        <div><p className="tour-eyebrow">ON GRAFİK. ON SOMUT SORU.</p><h1 id="tour-heading">Veriye doğru<br/><em>soruyu sor.</em></h1></div>
        <p className="tour-intro-copy">Bir grafiğin ne çizdiğini görmek yetmez.<br/>Hangi sorunu çözdüğünü, nasıl okunduğunu ve nerede durduğunu birlikte incele.</p>
      </section>
      <nav className="tour-index" aria-label="Grafik ailesi" onKeyDown={event => {if (event.key === 'ArrowRight') {event.preventDefault(); go(index + 1);} if (event.key === 'ArrowLeft') {event.preventDefault(); go(index - 1);} if (event.key === 'Home') {event.preventDefault(); go(0);} if (event.key === 'End') {event.preventDefault(); go(chartStories.length - 1);}}}>
        {chartStories.map((item, itemIndex) => <button type="button" key={item.slug} aria-current={item.slug === slug ? 'step' : undefined} disabled={busy} onClick={() => setSlug(item.slug)}><span>{String(itemIndex + 1).padStart(2, '0')}</span>{item.title}</button>)}
      </nav>
      <label className="tour-mobile-select">Grafik seç<select aria-label="Grafik seç" value={slug} disabled={busy} onChange={event => {const next = chartStories.find(item => item.slug === event.target.value); if (next) setSlug(next.slug);}}>{chartStories.map((item, itemIndex) => <option key={item.slug} value={item.slug}>{String(itemIndex + 1).padStart(2, '0')} · {item.titleTr}</option>)}</select></label>
      <article className="tour-story" aria-labelledby="tour-question" data-chart-story={slug}>
        <div className="tour-story-heading"><div><p className="tour-eyebrow">{String(index + 1).padStart(2, '0')} / {String(chartStories.length).padStart(2, '0')} <span className="tour-divider">—</span> {story.titleTr}</p><h2 id="tour-question">{story.questionTr}</h2></div><span className="tour-synthetic"><span aria-hidden="true"/>Sentetik örnek veri</span></div>
        <div className="tour-story-grid">
          <section className="tour-chart-card" aria-label={`${story.titleTr} etkileşimli grafik`}>
            <div className="tour-chart-toolbar"><span><i aria-hidden="true"/>{ready ? 'Etkileşimli grafik' : 'Grafik hazırlanıyor…'}</span><div><button type="button" disabled={!ready || busy} onClick={() => void exportChart('png')}>PNG indir <span aria-hidden="true">↓</span></button><button type="button" disabled={!ready || busy} onClick={() => void exportChart('html')}>HTML paylaş <span aria-hidden="true">↗</span></button></div></div>
            <div className="tour-canvas" aria-busy={!ready}>
              {scene && <VesoraViewer key={scene.figure.spec.id} figure={scene.figure} mode="embed" theme={theme} preserveTheme chrome={chrome} live={false} observation exportSource="displayed" onReady={viewerReady} onError={caught => {const viewer = mountedViewer.current; if (viewer?.element.isConnected && active.current?.figure === viewer.figure) setError(caught.message);}}/>}
            </div>
            <div className="tour-metrics" aria-label="Örneğin ölçüleri">{scene?.keyStats.map((metric, metricIndex) => <div key={`${metric.label}-${metricIndex}`}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}</div>
            <div className="tour-insight"><span className="tour-insight-label">BU ÖRNEKTE</span><p>{scene?.caption}</p></div>
          </section>
          <aside className="tour-reading" aria-label="Grafiği anlama rehberi">
            <section><p className="tour-section-label">01 / HANGİ İŞİ ÇÖZER?</p><p className="tour-explanation">{story.explanationTr}</p></section>
            <section><p className="tour-section-label">02 / NASIL OKUNUR?</p><ol>{story.readingTr.map((reading, readingIndex) => <li key={reading}><span>{String(readingIndex + 1).padStart(2, '0')}</span><p>{reading}</p></li>)}</ol></section>
            <section className="tour-boundary"><p className="tour-section-label">03 / SINIRINI BİL</p><p>{story.limitationsTr}</p></section>
          </aside>
        </div>
        {error ? <p className="tour-error" role="alert">{error}</p> : <p className="tour-state" role="status">{ready ? `${story.titleTr} hazır. Veri sentetiktir; grafikle etkileşime geçebilirsin.` : 'Örneğin ilk karesi hazırlanıyor…'}</p>}
        <details className="tour-api"><summary><span><span aria-hidden="true">⌘</span> Kendi verinle dene</span><span>API örneğini aç <span aria-hidden="true">+</span></span></summary><div className="tour-code"><div className="tour-code-tabs" role="group" aria-label="Kod dili"><button type="button" aria-pressed={language === 'js'} onClick={() => setLanguage('js')}>JavaScript</button><button type="button" aria-pressed={language === 'python'} onClick={() => setLanguage('python')}>Python</button><span>Vesora 1.0</span></div><pre><code>{language === 'js' ? story.apiJs : story.apiPython}</code></pre><p>Örnek sayısal veriyi kendi ölçümlerinle değiştir. Birimleri ve veri kaynağını ayrıca belirt.</p></div></details>
      </article>
      <nav className="tour-pagination" aria-label="Rehberde ilerle"><button type="button" disabled={index === 0 || busy} onClick={() => go(index - 1)}><span aria-hidden="true">←</span><span>Önceki grafik{index > 0 && <small>{chartStories[index - 1].titleTr}</small>}</span></button><span className="tour-page-count">{String(index + 1).padStart(2, '0')}<span> / </span>{String(chartStories.length).padStart(2, '0')}</span><button type="button" disabled={index === chartStories.length - 1 || busy} onClick={() => go(index + 1)}><span>Sonraki grafik{index < chartStories.length - 1 && <small>{chartStories[index + 1].titleTr}</small>}</span><span aria-hidden="true">→</span></button></nav>
      <footer className="tour-footer"><span>Bir motor. Aynı gözlem.</span><p>Bu rehberdeki tüm veriler sentetiktir. HTML, seçilen görünüm ve kaynak değerlerini taşır; canlı bağlantıyı yeniden başlatmaz.</p><a href="?demo=v1">Çalışma alanlarını aç ↗</a></footer>
    </div>
  </main>;
}
