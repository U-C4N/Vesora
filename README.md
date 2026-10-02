# Vesora

Python ve JavaScript için aynı TypeScript çekirdeği kullanan, WebGL2 tabanlı bilimsel görselleştirme motoru.

**0.1 geliştirme sürümü.** WebGL2 destekleyen bir tarayıcı veya QtWebEngine gerekir. API henüz kararlı değildir. Hazır paketler GitHub Release üzerinden dağıtılır; PyPI veya npm registry üzerinde yayımlanmış değildir.

## Hazır paketleri kurma

[v0.1.0 GitHub Release](https://github.com/U-C4N/Vesora/releases/tag/v0.1.0) eklerinden kullanacağınız paketi indirin.

**Python:** İndirdiğiniz wheel dosyasının bulunduğu klasörde Python 3.10+ ile:

```bash
python -m pip install ./vesora-0.1.0-py3-none-any.whl
```

Derlenmiş ortak motor wheel'e dahildir; Python kullanıcısının Node.js kurması gerekmez. NumPy isteğe bağlıdır. Yerel bağlantı ve masaüstü görüntüleme için `aiohttp` ve `PySide6` kurulur.

**JavaScript / TypeScript:** İndirdiğiniz tarball'ı frontend projenize koyup çalıştırın:

```bash
npm install ./vesora-core-0.1.0.tgz
```

Bu komut yerel paketi `@vesora/core` adıyla kurar. Aşağıdaki [JavaScript örneği](#javascript-kullanımı) tarayıcıda çalışan bir bundler projesi içindir.

## Kaynaktan başlatma

Depo kökünde Node.js 22+ ve Python 3.10+ ile:

```bash
npm install
npm run build
python -m pip install -e .
```

Node.js çekirdeği **geliştirmek ve paketlemek** için gereklidir. Derlenmiş motor dosyaları Python wheel paketine dahil edilir; hazırlanmış wheel'in kullanıcısı Node.js veya bir sunucu kurmaz.

Python API'si NumPy gerektirmez; aşağıdaki örnekler standart kütüphane ve listelerle çalışır. Temel Python kurulumu yerel bağlantı için `aiohttp`, masaüstü görüntüleme için `PySide6` içerir. Notebook desteği `notebook`, isteğe bağlı NumPy kurulumu `numpy` extra'sıyla eklenir.

```python
import math
import vesora as vs

x = [i * 12 / 11_999 for i in range(12_000)]
vs.plot(x, [math.sin(t) for t in x], label="sin(x)")
vs.show()
```

`show()` normal Python script'inde pencere kapanana kadar bekler. Açık bir figure kullanmak için:

```python
fig = vs.figure(title="Ölçüm")
layer = fig.scatter(x, [math.cos(t) for t in x], color="#218061", size=4)
fig.savefig("measurement.png")
fig.show()
```

Mevcut NumPy dizileri buffer protocol üzerinden desteklenir. NumPy kullanmak isteyenler kaynak kurulumuna `python -m pip install -e ".[numpy]"` ile ekleyebilir. İndirilen wheel için `python -m pip install "./vesora-0.1.0-py3-none-any.whl[numpy]"`, notebook desteği için aynı komutta `[notebook]` kullanılır.

Tarayıcı demosu:

```bash
node scripts/serve.mjs
```

[http://127.0.0.1:4173/examples/web/](http://127.0.0.1:4173/examples/web/) adresini açın. Galeride 11 adet 2D ve beş 3D olmak üzere 16 deney bulunur: çok serili çizgiler, eğitim kaybı, benchmark skoru, kalite/gecikme karşılaştırması, keskin tepeler ve eksik verili sinyal, bir milyon kayıtlık yoğunluk, Float64 hassasiyeti, logaritmik spektrum, Lorenz sistemi ve matematiksel yüzeyler. Üç AI benchmark örneği temsili veriler kullanır; gerçek model sonuçları değildir. Arama, boyut ve AI benchmark filtreleriyle örnekleri bulun; çizgi serilerini gösterip gizleyin, grafikleri genişletin, model parametrelerini değiştirin veya PNG kaydedin. Her örneğin kopyalanabilir Python ve JavaScript kodu vardır; Python örnekleri NumPy gerektirmez.

## JavaScript kullanımı

Tarball kurulumundan sonra HTML sayfanıza bir grafik alanı ekleyin:

```html
<div id="chart"></div>
```

JavaScript veya TypeScript giriş dosyanızda:

```javascript
import { figure } from '@vesora/core';

const chart = document.getElementById('chart');
if (!chart) throw new Error('#chart elementi bulunamadı');

const fig = figure({ title: 'Ölçüm' });
fig.plot([0, 1, 2, 3], [0, 1, 4, 9], { label: 'y = x²' });
fig.mount(chart);
```

Bu kodu frontend projenizin geliştirme sunucusu/bundler'ı üzerinden çalıştırın. Kaynak depoyu kullanıyorsanız derlenmiş ESM dosyası doğrudan da alınabilir; aşağıdaki HTML'yi depo kökünden HTTP ile sunun:

```html
<div id="chart"></div>
<script type="module">
  import { figure } from './packages/core/dist/index.js';
  const fig = figure({ title: 'Measured signal' });
  const x = Float64Array.from({ length: 1000 }, (_, i) => i / 100);
  fig.plot(x, x.map(Math.sin), { label: 'sin(x)' });
  fig.mount(document.querySelector('#chart'));
  await fig.ready();
</script>
```

## Mevcut yetenekler

| Alan | Uygulanan davranış |
| --- | --- |
| 2D | Line, scatter, heatmap; lineer/log eksenler, başlık, legend ve colorbar |
| 3D | Düzenli grid surface ve scatter; orbit ve zoom |
| Etkileşim | 2D pan/zoom, hover ve Shift + sürükleme ile seçim |
| Güncelleme | Layer verisi/stili/görünürlüğü değiştirilebilir |
| Büyük veri | Worker'da count aggregation, extrema koruyan çizgi azaltma, sorgu iptali ve sınırlı sonuç cache'i |
| Doğruluk | Float64 kaynak değerleri, NaN boşlukları, açık temsil bilgisi |
| Export | WebGL çizimi ile metin katmanını birleştiren PNG |

Bu sürüm bellek içi veriyle çalışır. Veri taraması O(n)'dir; worker kaynak dizileri kopyalayabilir. İndeksli disk verisi, tile/streaming sağlayıcıları ve 100 milyon kayıt için genel bir performans garantisi bu sürümün parçası değildir. WebGPU, SVG/PDF, volume rendering, `vector_field` ve adaptif matematik fonksiyonu örnekleme sonraki genişlemelerdir.

## Belgeler ve doğrulama

- [API ve kullanım](docs/api.md)
- [Ortak çekirdek, veri modeli ve temsil kuralları](docs/architecture.md)
- [Test, paketleme ve benchmark](docs/development.md)

```bash
python -m pip install -e ".[test,notebook]"
npm run check
npm run test:browser
python -m pytest tests/python
```

