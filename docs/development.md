# Geliştirme, test ve ölçüm

Depo kökünden Node.js 22+ kullanın. Python geliştirmesi için Python 3.10+ gerekir. WebGL2 tarayıcıda ve masaüstü QtWebEngine ortamında etkin olmalıdır.

NumPy Python API'sinin zorunlu bağımlılığı değildir. Temel kurulum `aiohttp` ve `PySide6` içerir; notebook için `.[notebook]`, NumPy ile çalışmak için isteğe bağlı `.[numpy]` kurulabilir. Varsayılan Python örnekleri `math`, `random` ve listeler kullanır. NumPy birlikte çalışabilirlik kontrollerini de çalıştırmak isteyen geliştiriciler NumPy extra'sını test ortamına eklemelidir.

## Çekirdeği derleme

```bash
npm install
npm run check
```

Build, JS paketinin dağıtım dosyalarını üretir ve aynı motoru Python asset dizinine kopyalar. Python paketi için build önce tamamlanmalıdır. Core, worker ve Python'ın motor asset'leri birlikte sürümlenir; protokol sürümü iki tarafta da `1` olur.

Hazır wheel üretmek için build sonrasında:

```bash
python -m pip wheel --no-deps --no-build-isolation . --wheel-dir dist
```

## Browser testlerini çalıştırma

```bash
python -m pip install -e ".[test,notebook]"
npx playwright install chromium
npm run test:browser
```

Windows'ta standart konumdaki Chrome varsa otomatik seçilir. `VESORA_CHROME` ortam değişkeni farklı executable yolunu belirler. CI Playwright Chromium kullanır. Testler SwiftShader ile yazılımsal WebGL çalıştırır; sonuçları donanım performansı olarak yorumlamayın.

Browser testleri gerçek WebGL piksellerini okur; layer güncellemesi, Float64 koordinat farkları, çizgi boşlukları, adaptif temsil, hover/seçim, görünüm değişimi, heatmap/3D ve PNG başlık kompozisyonunu denetler. Python tarafından üretilmiş gerçek binary snapshot'lar da JS sahnesiyle karşılaştırılır ve aynı motorda çizilir. Bu test `.venv` içindeki Python'ı veya PATH'teki `python` komutunu kullanır; `PYTHON` ortam değişkeniyle değiştirilebilir. PNG boyutları ekran piksel oranını dikkate alır. Hata durumunda Playwright trace ve test sonuçları saklanır.

Notebook JavaScript adaptörü gerçek Python trait verisi ve mock widget model'iyle tarayıcıda test edilir: blob ESM yükleme, blob worker, binary buffer güncellemesi, comm üzerinden PNG export ve cleanup. Bu, tam bir Jupyter arayüzü otomasyon testi değildir. `npm run test:parity` Python/JS normalize sahne modelini ayrıca tarayıcı olmadan karşılaştırır; CI bu kontrolü de çalıştırır.

`npm run test:examples`, galerideki 16 JavaScript ve 16 Python kod örneğini çalıştırır. Python alt süreci NumPy erişimi kapalı ve site paketleri olmadan başlatılır; yalnızca pencere açma ve DOM'a bağlama çağrıları test adaptörüyle değiştirilir. Gerçek sahne oluşturma, boyutlar ve veri kanalları kontrol edilir. Galeri browser testi ayrıca parametre değişikliklerini, arama/filtreleri, PNG çıktısını, mobil taşmayı ve tekrar sıfırlama sırasında GPU kaynaklarının serbest bırakılmasını doğrular. Üç AI benchmark kartı sentetik verilerle eğitim kaybı, skor ve kalite/gecikme örnekleri sunar; model performansına ilişkin ölçüm veya kıyas iddiası taşımaz.

## Python testleri

```bash
python -m pip install -e ".[test,notebook]"
python -m pytest tests/python
```

Pencereyi normal script'te `fig.show()` açar. Qt çağrıları ana thread'de çalışmalıdır. `show(block=False)` ile ana döngünüzden `vs.process_events()` çağırın. Başka bir Qt uygulaması içine gömüyorsanız mevcut event loop'u kullanın. Headless bir sistemde QtWebEngine export için çalışan bir grafik/sanal ekran ortamı gerekir.

Gerçek QtWebEngine testleri normal test koşusunda atlanır. Çalışan grafik ortamında `VESORA_TEST_QT=1` ayarlayıp `python -m pytest tests/python/test_desktop.py` çalıştırın. Bu testler line/heatmap/surface/scatter3d PNG'lerini, veri güncellemesini ve pencereyi kapatıp yeniden açmayı doğrular.

## Tekrarlanabilir benchmark

```bash
npm run build
node scripts/benchmark.mjs 1000000
```

Çıktı `artifacts/benchmark.json` dosyasına kaydedilir. Donanım GPU'su kullanılamıyorsa `VESORA_SOFTWARE_GPU=1` ile SwiftShader ölçümü yapılabilir; rapor bu tercihi ve sürücünün bildirdiği GPU renderer'ını kaydeder.

Rapor şu bilgileri ayırır:

- CPU, işletim sistemi, bellek, tarayıcı sürümü ve GPU renderer.
- Seed 42 ile üretilen Gaussian veri, dtype, kayıt sayısı ve kaynak byte miktarı.
- Figure boyutu, ekran piksel oranı ve başlangıç/son temsil bilgisi.
- İlk çizim süresi, 20 görünüm değişiminin `ready()` gecikmeleri ve örnek dağılımı.
- Boşta `requestAnimationFrame` aralıkları; bunlar render FPS garantisi değildir.
- Erişilebilirse JS heap; ölçülemeyen Python/GPU belleği ve Python transfer miktarı `null`.

Bu browser benchmark'ı Python bridge gecikmesini ölçmez. Bütün metrikler aynı donanım, veri dağılımı, browser ve görüntü boyutuyla karşılaştırılmalıdır. İlk görüntü süresi veri üretimini içermez; veri üretimi ayrıca raporlanır. Tek bir ölçümden genel bir nokta/FPS iddiası çıkarılmaz.

## Destek sınırları

Bu sürüm in-memory 2D/temel 3D temelidir. İndeksli dosya sorguları, tile/streaming, çoklu view düzeni, vector_field, adaptif fonksiyon örnekleme, mesh/volume işlemleri ve SVG/PDF export sonraki işlerdir. WebGL2 olmayan bir ortam için alternatif renderer bulunmaz. 3D seçim ve gelişmiş picking destek düzeyi 2D ile aynı değildir.
