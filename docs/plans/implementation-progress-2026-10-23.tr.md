# Uygulama başlangıcı — 23 Ekim 2026

Bu kayıt [onaylanan stratejinin](v1-strategy-2026-10-23.tr.md) önceki R0 hazırlığını ve sonrasında uygulanan ürün geliştirmesini kapsar. İki kullanıcı grubu eşit önceliklidir. Kullanıcının sonraki talimatıyla uzun soak beklenmeden ortak gözlem modeli, performans ve Studio/Embed uygulamasına geçildi. R0 bölümleri tarihsel kayıttır; güncel özellikler ve kullanım [ürün rehberindedir](../observation.md).

## Sabit aday ve yayın durumu

- Aday: `0.9.0-rc.6` / Python `0.9.0rc6`.
- Commit: `029258049818c8aadb6d2a80ca98457522be44c4`.
- Manifest SHA-256: `d29358cd5b18d3d95872b40af8c6bf1d2142a34b112d48734f8012e192b16337`.
- `dist/release-v0.9.0-rc.6` arşivleri yeniden üretilmedi. Yeni doğrulama araçları mevcut arşivleri kullanır; güncel test araçlarının kimliği ayrıca kaydedilir.
- Kayıtlı kapılar: **7 geçmiş, 1 başarısız, 2 bekliyor**. Başarısız soak kaydı Windows standby kesintisine aittir ve korunur. Gerçek ekran okuyucu ve beş katılımcılı pilot henüz yapılmadı.

## Tamamlanan hazırlık

`npm run release:readiness -- dist/release-v0.9.0-rc.6 --json` arşiv, manifest, kapı raporları ve hash bağlarını salt okunur doğrular. Mevcut sonuç `blocked`; bütünlük hatası bulunmadı. Çıkış kodları: hazır `0`, eksik/başarısız kapı `1`, geçersiz kanıt `2`. Bu komut test veya insan oturumu yürütmez.

Pilot başlatıcısı sabit RC paketlerinden katılımcı ve ekran okuyucu sayfalarını, görev metinlerini ve `pending` insan kayıt formunu hazırlar. [İnsan oturumu rehberi](../pilot/v0.9.0/human-evidence.tr.md) gerçek gözlem, dosya kaydı ve doğrulama adımlarını içerir. Otomatik fixture smoke'u insan sonucu olarak sayılmaz. Kayıt doğrulayıcısı yayın kapılarını değiştirmez.

Hazırlanan güncel yerel oturum: `artifacts/v09/pilot/0.9.0-rc.6-nKQC4I`. Sunucu açıkken katılımcı adresi `http://127.0.0.1:50687/`, ekran okuyucu adresi `http://127.0.0.1:50687/accessibility`. Oturum dizinindeki `preparation-validation.json` HTTP/dosya hash'leri, wrapper sözdizimi ve boş kaydın `pending` kaldığı kontrolleri içerir. Önceki `0.9.0-rc.6-sHqLEu` oturumundaki otomatik browser smoke'u son lifecycle düzenlemesinden öncedir; son oturum uzun soak ile yarışmamak için yeniden browser smoke'una alınmadı. Sunucu kapanırsa rehberdeki başlatıcı komutu yeni bir oturum dizini ve adres verir.

Mimari ve v1 hazırlık belgelerindeki eski indeks, context restore ve RC durumları güncellendi. [C1 uygulama sözleşmesi](observation-contract-v1.md) sonraki geliştirme için hazırlandı; henüz uygulanmış veya kararlı API değildir.

Doğrulama: `npm run test:release-contracts` **47/47** geçti. Yeni kontroller boş insan formlarını, hatalı kaynak kimliklerini, eksik skalerleri, yanlış dosya türlerini, değiştirilmiş arşiv/kanıtları, kısa koşunun uzun koşu sayılmasını, eksik kare muhasebesini ve uyku kesintisini reddediyor. Bu sonuç runtime özelliklerinin tüm regresyon testlerinin yeniden çalıştırıldığı anlamına gelmez; ürün runtime'ı bu dilimde değişmedi.

## Dayanıklılık koşuları

Yeni Windows denetleyicisi tek seferde bir grafik ortamı çalıştırır, arşiv ve kurulu wheel kimliğini doğrular, kaynak kullanımını örnekler, kuyruk/kare/cleanup muhasebesini denetler ve uyku kesintisini başarısız sayar. Geçici uyanık tutma isteği çıkışta bırakılır. Ayrıntılar ve tekrar çalıştırma komutları [soak rehberindedir](../../tests/soak/README.md).

Yeni denetleyicinin kısa matrisi başarıyla tamamlandı:

| Ortam | Gerçek üretici süresi | Kabul edilen / kareyle kapsanan güncelleme |
| --- | ---: | ---: |
| Browser | 30,012 sn | 595 / 595 |
| Qt | 30,007 sn | 600 / 600 |
| Jupyter | 30,012 sn | 600 / 600 |

Kanıt: `artifacts/releases/v0.9.0-rc.6/soaks-2026-10-23-supervised-short/summary.json`. Guard çıkışı `0`, uyanık tutma isteğinin bırakılması başarılı. Kısa koşular iki saatlik kapıyı geçirmez.

Uzun sıra **23 Ekim 2026 13:09 TRT** tarihinde başlatıldı: browser → Qt → Jupyter, her biri 7.200 saniye. Başlangıç kontrolünde browser üreticisi çalışıyordu. Bu yazı bitiş raporu değildir; güncel durum `artifacts/releases/v0.9.0-rc.6/soaks-2026-10-23-supervised-full/summary.json` içindedir. Ham loglar, kaynak örnekleri ve guard kaydı aynı dizindedir. Üç ortamın tamamı başarılı olmadan soak kapısı kapatılmaz.

Uzun koşu sırasında bilgisayarın kapağı açık ve güç bağlantısı takılı olmalıdır. Manuel uyku/kapak kapanması engellenmez. Pilotun grafik etkileşimlerini bu izole koşu bittikten sonra yapın.

## İlk planın geçiş koşulu — sonraki kullanıcı talimatıyla değiştirildi

İlk plan, C1/E1/U1 geliştirmesini üç uzun koşu ve insan oturumlarından sonra başlatıyordu. Kullanıcı 14:00 TRT'de uzun koşuyu durdurdu ve ardından doğrudan ürün uygulamasını istedi. Bu talimatla C1/E1/U1 geliştirmesi yapıldı; mevcut kısa koşular ve hazır formlar RC kabulünün tamamlandığı anlamına gelmez. İnsan oturumları yayın kabulü için ayrı, açık işlerdir.

## Aynı gün yapılan RC denetimi

23 Ekim 13:46 TRT denetiminde arşiv kimliği ve yedi geçmiş kapının kanıt bağları sağlamdı. Inventory içindeki 658 ham dosya, sekiz kapı raporu ve ayrıca ortak provenance dosyası yeniden hash'lendi: **667/667 dosya, 64.354.389 bayt, sıfır uyuşmazlık**. Salt dosya denetimi [JSON kaydındadır](../../artifacts/releases/v0.9.0-rc.6/evidence-integrity-audit-2026-10-23T10-46-17-515Z.json); testlerin yeniden çalıştırıldığı anlamına gelmez.

Erişilebilirliğin insan dışındaki gereksinimlerinin mevcut RC6 browser/Jupyter kayıtlarında karşılığı bulundu; [viewer QA belgesinde](../qa/v0.9.0-viewer.md) exact arşiv kanıtı tarihsel geliştirme sonuçlarından ayrılır. İnsan oturumları ve devam eden uzun soak dışında yeni bir RC6 ürün/test engeli saptanmadı. Geliştirme rehberindeki eski protokol ve Jupyter hücre sayısı düzeltildi; ayrı başarılı Jupyter recovery kontrolü ile uzun soak'ın reconnect sınırı açıkça ayrıldı.

`npm run soak:status -- RELEASE_DIZINI KOSU_DIZINI --json` devam eden veya biten koşunun kanıtını salt okunur denetlemek içindir. Güncel durum, son kaynak örneğinin zamanı ve `qualifiesTwoHourGate` alanı birlikte değerlendirilmelidir; eski kalmış bir `running` etiketi tamamlanma kanıtı sayılmaz.

Bu denetleyici eklendikten sonra birleşik `npm run test:release-contracts` sonucu **63/63 geçti**. Mevcut kısa koşu yeniden incelendi: `passed`, iki saatlik yeterlilik `false`, 26 kaynak kaydı, başarılı guard release ve Qt/Jupyter için toplam 12 saklanan export dosyası doğrulandı. HTML rapor hash'lerinin Windows CRLF→LF dönüşümü ile hesaplanabildiği açıkça ayrılır; ham dosya hash'leri ayrıca raporlanır. Browser export'ları harness içinde doğrulanır, saklanmış dosya olarak sunulmaz.

**13:57 TRT gözlemi:** uzun koşu `running`, iki saatlik yeterlilik `false`; browser çalışıyor, Qt ve Jupyter henüz başlamadı. 579 kaynak kaydı birbiriyle eşleşti, hata nedeni bulunmadı. Bu, süre tamamlanmadan başarı veya bellek sızıntısı yokluğu iddiası değildir. Güncel durum için komutu tekrar çalıştırın.

İnsan dışı erişilebilirlik denetiminin [ayrı raporu](../../artifacts/releases/v0.9.0-rc.6/accessibility-nonhuman-audit-2026-10-23.json) altı başlığın mevcut kanıtlarını ve 109 dosya referansını içerir. Bağımsız incelemede 109/109 hash doğrulandı; yeni browser/GPU testi yapılmadı, gerçek insan sonucu üretilmedi.

## Kullanıcı isteğiyle uzun koşunun durdurulması

23 Ekim **14:00 TRT** tarihinde kullanıcı altı saatlik koşuya gerek olmadığını belirtti. Yalnız süreç kimliği doğrulanan uzun-test browser runner durduruldu; supervisor kapandı, native guard uyanık tutma isteğini başarıyla bıraktı. Son browser ilerleme kaydı yaklaşık 50,5 dakika ve 10 freeze/export döngüsüdür. Qt/Jupyter uzun koşuları başlamadı.

Supervisor'ın `failed` kaydı bu talep edilen sonlandırmanın sonucudur; yeni ürün hatası olarak yorumlanmamalıdır. Ham kayıt değiştirilmedi, neden ve hash'ler [user-stop.json](../../artifacts/releases/v0.9.0-rc.6/soaks-2026-10-23-supervised-full/user-stop.json) içinde saklandı. İki saatlik üç-host kabulü tamamlanmadı ve başarılı olarak işaretlenmedi. Uzun koşu kendiliğinden yeniden başlatılmayacak.

## Uygulanan ürün dilimi — C1, E1 ve U1

Kullanıcının son talimatıyla üç ajan kaynak kodunda paralel çalıştı; ortak model doğrulandıktan sonra performans ve arayüz entegrasyonu tamamlandı. Bu değişiklikler geliştirme ağacındadır; sabit RC6 arşivleri yeniden paketlenmedi ve yayın yapılmadı.

- **C1:** JS/Python kanal anlam bilgileri (`name`, `quantity`, `unit`, `dimension`, `origin`, dış dönüşüm açıklamaları), protokol 8, atomik metadata doğrulama, alias/COW kaynak yaşam döngüsü, bağımsız observation invalidation ve eşdeğer patch koruması. HTML opt-in kaydı kaynak sürümlerini ve tutulan stream aralığını tek yakalamadan taşır. Displayed kayıt tamamlanan karenin temsilini; accepted kayıt `not-evaluated` durumunu taşır. Ortak Float32/Unicode fixture ve Python→çevrimdışı browser akışı doğrulandı.
- **E1:** Kaynak kimliği/sürümü bağlı exact scatter grid indeksi; worker ve immutable fallback yolu; ayrı 8 MiB limit, candidate taraması ve cleanup tanılaması. Mutable kaynak, geniş viewport ve bütçe dışı veri için scan yolu korunur. Eşzamanlı cold-build yarışı bağımsız ajan incelemesinde bulunup regresyonuyla düzeltildi. HTML kodlamasında byte başına kopya yerine bulk kopya kullanılır.
- **U1:** `mode: studio|embed`, bağımsız chrome görünürlüğü, viewer renk token'ları, remount yapmayan `updateOptions` ve React prop güncellemeleri. Container genişliğine göre yerleşim, gerçek metadata inspector, HTML observation seçeneği ve accepted/displayed kaynak seçimi. React Workbench aynı sentetik veriyi bağımsız Studio ve 320 px Embed deneyimlerinde gösterir.

[Kullanım ve API rehberi](../observation.md) JS/Python/React örneklerini içerir. Yerel demo: `npm run demo:react`, ardından `?demo=workbench`. Bu oturumdaki production önizlemesi sunucu açıkken `http://127.0.0.1:4188/?demo=workbench` adresindedir.

### Kısa doğrulama sonuçları

| Kontrol | Sonuç |
| --- | --- |
| Core unit | 400 geçti / 34 dosya |
| React | 41 geçti / 4 dosya |
| Python | 440 geçti, 15 koşula bağlı test atlandı |
| Yeni browser/production örneği | 4 observation + 2 Studio/Embed + 1 gerçek worker + 1 Workbench geçti |
| Mevcut freeze/export/Labs/browser regresyonu | 6 geçti |
| Release contract | 64 geçti; protokol 7 arşiv ve protokol 8 manifest yolları birlikte doğrulandı |
| Core/React/example tip kontrolü ve kaynak/production build | Geçti |

Bu kısa kontroller yeni çok saatli soak veya insan kabulü değildir. Yeni ürün kodu için Qt/Jupyter tam host matrisi ve yayın paketi kabulü yeniden tamamlanmış sayılmaz. Production örneği büyük chunk uyarısı veriyor: ana JS yaklaşık 1,744 MB / gzip 454 KB; bundle bölme bu dilimde uygulanmadı.

### Ölçülen performans ve görünüm

[Scatter ölçümü](../../artifacts/product-update/scatter-index.json): Node v24.19.0, i9-14900HX, deterministik 1M nokta, %1 viewport, exact density planner. Tam tarama medyanı **17,84 ms**, ilk indeks kuran sorgu **45,54 ms**, warm sorgu medyanı **1,60 ms**; bu koşulda **11,12×**. İndeks yaklaşık **4,02 MB**, candidate **19.714/1.000.000**. Cold maliyet açıkça ayrılır; GPU/FPS veya genel p95 iddiası değildir. Ham örnekler, ortam ve kaynak hash'leri rapordadır.

[Son HTML ölçümü](../../artifacts/product-update/html-encoding.json): 4.000.024 baytta dokuz eşleştirilmiş CPU turu; contiguous medyan **118,71→113,34 ms**, immutable chunks **117,72→111,16 ms**. Aynı base64 baytları doğrulandı; son ölçümde süre kazancı yaklaşık **%4,5–5,6**. İlk keşif ölçümündeki %10–11 değeri yerine bu son kaynak hash'ine bağlı kayıt esas alınır.

[Workbench ekran görüntüsü](../../artifacts/studio-embed-2026-10-23/workbench-production-Workb-a7307-20px-Embed-card-independent/workbench-1440.png) ve [yerleşim ölçümü](../../artifacts/studio-embed-2026-10-23/workbench-production-Workb-a7307-20px-Embed-card-independent/workbench-metrics.json): 1440 px viewport, 320 px kart, 318 px plot, yatay taşma yok, browser hatası yok. Her iki deneyimin freeze/inspector durumları bağımsız kaldı.

## Sonraki ürün dilimi — açılış paketi ve Vesora Denge

Bu bölüm yukarıdaki 1,744 MB paket ve henüz uygulanmamış bundle bölme durumunun ardından tamamlanan çalışmayı kaydeder. Üç ajan motor/paket, arayüz ve fizik modeli üzerinde çalıştı; kök ajan entegrasyonu, bağımsız incelemeyi ve karşılaştırmalı ölçümü tamamladı.

### Uygulama

- `@vesora/core/runtime` ortak Figure sınıfını ve hafif tarayıcı motorunu sunar. Viewer, React ve Python desktop bu motoru paylaşır. Eski kök girişin senkron HTML API'si korunur.
- `toHTMLAsync` / `downloadHTMLAsync` büyük HTML şablonunu ilk dışa aktarmada yükler. Sahne/veri/gözlem snapshot'ı indirme başlamadan yakalanır; başarıda ve hatada bırakılır. Notebook blob ve bağımsız HTML için kendi kendine yeterli derleme yolları korunur.
- React ekranları ve CSS ayrı yüklenir. Dashboard fontları, Denge, Streaming ve HTML şablonu Workbench açılışına girmez. İlk ekran modülü React kökü bağlanmadan çözülür; erişilebilir yükleme/hata/yeniden yükleme akışı vardır.
- Paket/host doğrulayıcıları yeni runtime, template ve balance dosyalarını kapsar; tarihsel dört dosyalı arşiv manifestleri okunmaya devam eder. Sabit RC6 arşivlerine yazılmadı.
- **Vesora Denge:** ayrı, 6.227 baytlık `@vesora/core/balance` modeli; ortak taban ve eşit kesitli 2D hazneler, gerçek motorla çizilen döndürülebilir 3D sınırlar/yüzeyler, seçili çiftin denge bağlantısı, vana, basınç, enerji, pasif kayıp, manuel aktarım, karşılaştırma tabanı ve kesin değer tablosu. 3–8 hazne, klavye etkileşimi, reduced motion ve mobil yerleşim desteklenir.

[Fizik ve UI sözleşmesi](balance-model-v1.md), alan/litre dönüşümünü ve analitik tek-vana çözümünü açıklar. 3D düşey ölçek büyütmesi görünür metinde ve export'ta belirtilir. HTML, kaynak tamponları/semantikleri/gözlemi olan 3D sahneyi saklar; simülasyon kontrol panelini yeniden çalıştırmaz. Bu özgün ürün bileşimi için dünya-ilki veya yeni fizik keşfi iddiası yapılmaz.

### Son karşılaştırmalı açılış ölçümü

[Ham sonuç](../../artifacts/startup-2026-10-23/comparison.json), her iki derlemenin SHA-256 envanterlerini, tüm istekleri, worker baytlarını ve 30 örneği içerir. Boyutlarda KB = 1.000 bayt kullanılır.

| Deneyim | İlk JS: önce → sonra | Hesaplanan gzip: önce → sonra | İlk tamamlanan kare medyanı: önce → sonra |
| --- | ---: | ---: | ---: |
| Studio, doğrudan ESM | 1.715.262 → 495.008 B (%71,1 azalma) | 403.978 → 118.859 B | 1.339,1 → 790,1 ms (%41,0) |
| Embed, doğrudan ESM | 1.715.262 → 495.008 B (%71,1 azalma) | 403.978 → 118.859 B | 1.396,9 → 498,7 ms (%64,3) |
| React Workbench, production | 1.890.325 → 631.481 B (%66,6 azalma) | 484.255 → 183.753 B | 1.078,1 → 957,7 ms (%11,2) |

Studio/Embed satırları dağıtım ESM modüllerini, Workbench satırı minify edilmiş React üretim uygulamasını karşılaştırır; satırlar birbirine karşı hız sıralaması değildir. Workbench iki worker isteği içerir. Tek ana React giriş dosyası 1.744.093 → 222.850 B oldu; tabloda yanıltıcı bir tek-chunk karşılaştırması yerine bütün ilk JS istekleri sayılır. 592.980 B / gzip 140.072 B HTML chunk'ı yalnız export sırasında yüklenir; derleyicinin büyük chunk uyarısı bu isteğe bağlı dosya için kalır.

Yöntem: her mod için beş eşleştirilmiş tur, sırayla değişen önce/sonra düzeni, yeni browser context, kapalı ağ önbelleği, yerel sıkıştırılmamış HTTP, 1280×1000/DPR1, Chrome ve ANGLE SwiftShader. Tarayıcı süreci yeniden başlatılmaz; süreç/GPU açısından soğuk açılış testi değildir. Dış font/ağ istekleri iki tarafta da engellenir; aynı self-only CSP, makinedeki güvenlik yazılımının eklediği harici script'lerin ölçüme girmesini de engeller. Studio/Embed `figure.ready()` ve pozitif frame ID bekler; Workbench iki görünümün ilk kareden sonra etkinleşen Freeze kontrollerini bekler. İki rAF sonrası süre ayrıca kaydedilir; fiziksel ekrana sunum ölçümü değildir. Gzip-9 çevrimdışı hesaplanır ve HTTP'de kullanılmaz. Beş turun medyanı genel cihaz/İnternet garantisi değildir; ilk tur ve bütün değişkenlik ham kayıtta tutulur. Workbench çiftlerinin üçünde yeni sürüm daha hızlı, ikisinde daha yavaştı; medyan kazanımı her açılış için garanti değildir.

İlk geçerli ara koşu [comparison-initial.json](../../artifacts/startup-2026-10-23/comparison-initial.json) içinde korundu; o derleme artık `after-initial/` altındadır. Burada React Suspense başlangıç geçişi Workbench'i 235,5 → 507,8 ms yavaşlatmıştı. Bu bulgu üzerine başlangıç yükleyicisi düzeltildi. Ardından koşullu import biçiminin ilgisiz dashboard preload'larını taşıdığı bulundu; ayrı ekran yükleyicileri ve yükleme izolasyonu testi eklendi. CSP eklenmeden önceki aynı-son-build ölçümü [comparison-before-csp.json](../../artifacts/startup-2026-10-23/comparison-before-csp.json) içinde saklandı. Nihai tablo yalnız aynı CSP ile tamamlanan son `comparison.json` koşusunu kullanır; hızlı görünen önceki motor sonuçları seçilmedi. Koşular arasındaki mutlak süre değişimi bu bilgisayarın ortam etkisini gösterir; boyutlar değişmedi.

Yeniden ölçüm: saklanan `before/` ve `after/` envanterleriyle `node scripts/benchmark-startup.mjs measure`. Yalnız sorun incelemek için `probe after workbench` tek örnek çalıştırır ve karşılaştırmalı kanıt sayılmaz. `capture before|after` var olan klasörün üzerine yazmayı reddeder.

### Kısa doğrulama ve önizleme

Kaynak/React/example tip ve derleme kontrolleri, core birim kümesi (415), React kümesi (41), son Denge model kümesi (12), Python host/paket kontrolleri (12), release sözleşmeleri (65) geçti. Bu kümeler örtüşür; toplam test sayısı olarak toplanmaz. Tarayıcıda üç yeni lazy-export kontrolü ve iki mevcut notebook/offline kontrolü; üç Denge, Workbench ve dashboard senaryosu; ayrıca gerçek RAF başlat/duraklat ve yükleme-hatası/yeniden yükleme kontrolleri geçti. Denge export'unun dört surface tamponu ekrandaki hacim/yüksekliklerle karşılaştırıldı. Uzun soak başlatılmadı.

[1440 px masaüstü](../../artifacts/balance-2026-10-23-final/balance-Denge-couples-exac-3298a-s-and-a-real-3D-observation/denge-desktop-1440.png) ve [390 px mobil grafik](../../artifacts/balance-2026-10-23-final/balance-reduced-motion-and-bf1c9--scrolling-and-single-steps/denge-mobile-chart-390.png) görsel olarak incelendi. Yerel preview açıkken [Denge](http://127.0.0.1:4188/?demo=balance) ve [Studio/Embed](http://127.0.0.1:4188/?demo=workbench) kullanılabilir. Çalışma geliştirme ağacındadır; yayın yapılmadı.
