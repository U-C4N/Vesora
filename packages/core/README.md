# @vesora/core

Python ve JavaScript'in paylaştığı TypeScript bilimsel görselleştirme motoru. WebGL2 ile 2D çizgi/scatter/heatmap, 3D surface/scatter ve PNG export sağlar. TypeScript tipleri pakete dahildir.

**0.1 geliştirme sürümü:** API henüz kararlı değildir. Çizim için WebGL2 destekleyen bir tarayıcı gerekir.

## Kurulum

[v0.1.0 GitHub Release](https://github.com/U-C4N/Vesora/releases/tag/v0.1.0) eklerinden `vesora-core-0.1.0.tgz` dosyasını indirip frontend projenize koyun:

```bash
npm install ./vesora-core-0.1.0.tgz
```

Paket GitHub Release üzerinden dağıtılır; npm registry üzerinde yayımlanmış değildir.

## JavaScript / TypeScript kullanımı

HTML sayfanıza bir grafik alanı ekleyin:

```html
<div id="chart"></div>
```

Tarayıcıda çalışan bundler projenizin JavaScript veya TypeScript giriş dosyasında:

```javascript
import { figure } from '@vesora/core';

const chart = document.getElementById('chart');
if (!chart) throw new Error('#chart elementi bulunamadı');

const fig = figure({ title: 'Ölçüm' });
fig.plot([0, 1, 2, 3], [0, 1, 4, 9], { label: 'y = x²' });
fig.mount(chart);
```

`await fig.ready()` bekleyen çizimin tamamlanmasını bekler; `await fig.savefig()` PNG `Blob` döndürür. Layer'lar `setData`, `setStyle` ve `setVisible` ile güncellenebilir. Sayfadan kaldırılan figure için `fig.close()` çağırın.

## Belgeler

- [API ve örnekler](https://github.com/U-C4N/Vesora/blob/main/docs/api.md)
- [Ortak çekirdek ve veri modeli](https://github.com/U-C4N/Vesora/blob/main/docs/architecture.md)
- [Python kurulumu ve kaynak geliştirme](https://github.com/U-C4N/Vesora#readme)

Bu sürüm bellek içi veriyle çalışır. Büyük scatter verilerinde count aggregation, çizgilerde extrema koruyan azaltma uygulanır. WebGPU ve SVG/PDF export bu sürümde bulunmaz.
