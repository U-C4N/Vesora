# API ve kullanım

Python isimleri `snake_case`, JavaScript isimleri `camelCase` kullanır. İki API aynı sahne ve veri modelini ortak TypeScript motoruna iletir. Bir figure 2D veya 3D layer'lar içerir; aynı figure'da ikisini karıştırmak hata üretir.

## Grafik oluşturma

| İşlem | Python | JavaScript |
| --- | --- | --- |
| Figure | `vs.figure(title="Deney")` | `figure({title: 'Experiment'})` |
| Çizgi | `fig.plot(x, y)` | `fig.plot(x, y)` |
| Nokta | `fig.scatter(x, y)` | `fig.scatter(x, y)` |
| Isı haritası | `fig.heatmap(x, y, z)` | `fig.heatmap(x, y, z)` |
| Yüzey | `fig.surface(x, y, z)` | `fig.surface(x, y, z)` |
| 3D nokta | `fig.scatter3d(x, y, z)` | `fig.scatter3d(x, y, z)` |
| Gösterme | `fig.show()` | `fig.mount(element)` |
| PNG | `fig.savefig("figure.png")` | `await fig.savefig()` → `Blob` |
| Kapatma | `fig.close()` | `fig.close()` |

Figure üzerinden çağrılan çizim metotları bir layer döndürür. Python'daki `vs.plot` gibi kolaylık fonksiyonları geçerli figure'a ekler. JavaScript'in üst seviye `plot`/`scatter` fonksiyonları yeni figure oluşturup döndürür; açık `figure()` kullanımı birden çok layer için uygundur.

Point koordinatları eşit uzunlukta tek boyutlu dizilerdir. Grid x/y eksenleri artan, sonlu tek boyutlu koordinatlar olmalıdır. Grid z verisinin düzeni `z[yIndex][xIndex]` şeklindedir; Python iç içe listeleri, JS satır dizileri veya satır öncelikli düz typed array kabul eder. Python API'sini kullanmak için NumPy kurulumu gerekmez.

```python
import math
import vesora as vs

x = [-3 + i * 6 / 80 for i in range(81)]
z = [[math.sin(a*a + b*b) / (1 + a*a + b*b)
      for a in x] for b in x]
fig = vs.figure(title="Damped radial wave")
fig.surface(x, x, z, colormap="viridis")
fig.show()
```

## NumPy ile isteğe bağlı kullanım

Temel girişler Python listeleri, tuple'lar, `array.array` ve desteklenen sayısal buffer'lardır. NumPy kuruluysa `ndarray` buffer protocol üzerinden kabul edilir; veri hazırlama için ayrı bir NumPy motoru kullanılmaz. Kaynaktan isteğe bağlı kurulum: `python -m pip install -e ".[numpy]"`; hazırlanmış paket için extra adı `vesora[numpy]` olur. Float32/Float64 ve desteklenen integer buffer türleri ortak veri tanımına dönüştürülür. NumPy grid'lerinde boyut kuralı `z.shape == (len(y), len(x))` şeklindedir.

NumPy gerektirmeyen, Float32 buffer kullanan bir örnek:

```python
from array import array
import vesora as vs

fig = vs.figure(title="Float32 ölçümler")
fig.scatter(array("f", [1, 2, 3]), array("f", [3, 1, 2]))
fig.show()
```

## Stili ve veriyi değiştirme

Stil seçenekleri: `color`, `size`, `width`, `opacity`, `label`, `colormap`, `representation`, `colorDomain` (Python: `color_domain`). Renk haritası `viridis` veya `magma`; temsil modu `auto`, `points` veya `density` olabilir. `representation` scatter için anlamlıdır.

```javascript
// Core paketini import edip sayfanızda #chart elementi oluşturduktan sonra:
const fig = figure({ title: 'Updated measurements' });
const layer = fig.scatter([1, 2, 3], [3, 1, 2], {
  color: '#218061', size: 6, label: 'Measurements',
});
fig.mount(document.querySelector('#chart'));
await fig.ready();
layer.setData({ y: new Float64Array([2, 3, 1]) });
layer.setStyle({ color: '#476dc2' });
await fig.ready();
console.log(fig.inspect());
```

JS'de `setData({y: yeniVeri})`, Python'da `set_data(y=yeni_veri)` yalnızca belirtilen kanalları değiştirir. Python ayrıca `layer.set_data(x, y)` (3D/grid için `x, y, z`) kabul eder. Koordinat uzunluğu değişirse diğer kanallar ve mevcut scalar renkler de eşleşmelidir. Dizileri yerinde değiştirmek yerine bu metotları kullanın. `setVisible(false)` / `set_visible(False)` layer'ı gizler; `remove()` layer ve veri referanslarını serbest bırakır.

JS `fig.setView({xScale: 'log', xDomain: [1, 1000], yLabel: 'Amplitude'})`, Python `fig.set_axes(xscale="log", xlim=(1, 1000), ylabel="Amplitude")` görünümü günceller. Log domain sınırları pozitif, bütün domain'ler sonlu ve kesin artan olmalıdır. Pozitif olmayan log verileri görünmez; çizgilerde boşluk oluşturur. NaN/sonsuz koordinatlar noktadan çıkarılır ve çizgi bağlantısını keser.

## Görünümü inceleme ve etkileşim

2D'de sürükleme pan, tekerlek zoom, Shift + sürükleme dikdörtgen seçimdir. 3D'de sürükleme kamerayı döndürür, tekerlek yakınlaştırır. Hover ve seçim verileri orijinal kaynak indeksleriyle veya aggregation hücresiyle ilişkilendirilir.

```javascript
// Yukarıda oluşturulan fig üzerinde:
const unsubscribe = fig.on('selection', selection => console.log(selection));
fig.on('representation', info => console.log(info));
fig.on('error', error => console.error(error));
console.log(fig.inspect());
unsubscribe();
```

`fig.inspect()` layer başına `kind`, `total`, `visible`, `rendered`, `exact`, `method` ve `layerId` döndürür. `exact: true` yoğunluk gösteriminde sayımın tam olduğunu belirtir; her noktanın ayrı çizildiği anlamına gelmez. Görünüm güncellemelerinden sonra son sonuç için `await fig.ready()` kullanın.

Olay isimleri `hover`, `selection`, `viewchange`, `representation`, `error` şeklindedir. Bir nokta seçimi kaynak `indices`, `count`, `truncated` alanlarını; yoğunluk seçimi `bounds` ve `count` alanlarını taşır. Renkli yüzeyin/heatmap'in rengi z değerini; density colorbar'ı hücre başına nokta sayısını ifade eder.

## Python host ve notebook

`fig.show()` normal script'te QtWebEngine penceresi açar ve kapanana kadar bekler; IPython notebook kernel'inde widget seçer. Host açıkça `host="desktop"` veya `host="notebook"` ile seçilebilir. GUI çağrıları ana thread'de yapılmalıdır. `show(block=False)` kullanırken mevcut Qt event loop'u veya düzenli `vs.process_events()` çağrıları gerekir.

Notebook için `python -m pip install -e ".[notebook]"` kurulumundan sonra `fig.show()` kullanın. Notebook adaptörü de aynı motoru ve binary veriyi kullanır. Kernel yaşam döngüsü ve widget iletişimi açıkken etkileşimler çalışır. Gösterilmiş widget'tan `await fig.savefig_async("plot.png")` ile Qt penceresi açmadan export alınabilir; senkron `savefig` Qt host kullanır.

## PNG kaydetme ve yaşam döngüsü

JavaScript figure önce mount edilmelidir. `await fig.savefig()` bekleyen çizimi bitirir, WebGL ve açıklama canvas'ını birleştirir ve PNG Blob döndürür. Tarayıcıda genişlik mount elementine uyar; sabit genişlik için bu elementin CSS genişliğini ayarlayın. Görüntü boyutu gerçek CSS figure ölçülerinin ekran piksel oranıyla çarpımıdır; motor piksel oranını 2 ile sınırlar. Python `fig.savefig(path)` gösterilmemiş figure için de Qt host üzerinden export yapar.

`close()` GPU kaynaklarını, worker'ı ve olay dinleyicilerini temizler; kapanmış figure tekrar kullanılmaz. Python'da yalnızca pencereyi kapatmak figure verisini korur: daha sonra yeniden gösterilebilir veya kaydedilebilir. Açıkça `fig.close()` çağrısı bu veriyi de serbest bırakır.
