# v0.9 kullanıcı pilotunu yürütme

**Durum: hazırlık; gerçek pilot henüz yürütülmedi.** Bu paket beş gerçek katılımcı için tarafsız görev metni ve boş kayıt formu içerir. Kimseye mesaj gönderildiği, görüşme planlandığı veya görevin başarıyla tamamlandığı anlamına gelmez.

Üç bilimsel veri kullanıcısı/araştırmacı ile iki telemetri geliştiricisi hedeflenir. P01–P05 kodlarını kullanın. Katılımcıya yalnız [görev metnini](participant-tasks.tr.md) verin; bu belgeyi ve [sonuç formunu](results-template.md) gözlemci kullanır.

Mevcut erişilebilirlik kapısının insan kontrolü için ayrı [Narrator/NVDA kontrol listesi](../../qa/v0.9.0-screen-reader.tr.md) hazırdır; henüz uygulanmamıştır. Bu kontrolü pilot görevine veya 4/5 başarı hesabına eklemeyin.

## Yayın için gereken tek pilot görevi

En az **4/5 katılımcı**, **yüzey → kesit → görüntüyü dondurma → dışa aktarma** akışının tamamını yardım almadan tamamlamalıdır. Üretilen her dosya çevrimdışı açıldığında seçilen gözlemin kimliği ve değerleri doğru olmalıdır. Tek bir yanlış veri kaydı doğruluk kapısını kapatır.

Süreyi ölçün, ancak bu pilot için yeni bir süre sınırı veya ek başarı eşiği koymayın. Beşten az kişi tamamladıysa gate `pending` kalır. Yardımla biten görev yardımsız başarı sayılmaz. Eksik kişileri paydadan çıkarmayın; aynı adayın sonuçlarını gördükten sonra eşiği değiştirmeyin.

## Oturumu hazırlama

1. Depo kökünde Node.js ve `tar` erişilebilirken, sınanacak doğrulanmış RC dizinini başlatıcıya verin. Örnekteki dizin adını kullanacağınız adayla değiştirin; komut yeni bir arşiv oluşturmaz ve yayın yapmaz.

   ```powershell
   node scripts/run-pilot-v09.mjs dist/release-v0.9.0-rc.2
   ```

   Başlatıcı manifesti ve bütün arşiv/demoların SHA-256 değerlerini doğrular; core paketinin sürümünü ve `index`, `worker`, `viewer`, `labs` dosyalarını ayrıca karşılaştırır. Bu doğrulama teknik yayın kapılarının geçtiği anlamına gelmez: RC1 performans kapısında başarısız oldu; asıl pilot için düzeltmelerden sonra sabitlenen aday kullanılmalıdır. Terminaldeki `http://127.0.0.1:.../` adresini katılımcının tarayıcısında açın. Sunucu yalnız bu makineden erişilir; oturum sonunda `Ctrl+C` ile kapatın. Sabit port gerekirse `--port 4179`, sunucuyu açmadan kurulum kaydı üretmek için `--prepare-only` ekleyin.
2. Bu kurulum mevcut sentetik yüzey, bağımsız skaler alan ve iki bağlı kesit örneğini açar. Kaynak statiktir; çalışan bir veri üreticisi yoktur. Dondurma ve dışa aktarma ürünün mevcut viewer arayüzünü kullanır. Katılımcı sayfası görev sırasını veya düğmelerin yerini anlatmaz. Kendi verisini kullanacak katılımcı için kullanma/paylaşma izni olan protokol 7 yüzey ve kesitlerini ayrıca hazırlayabilirsiniz; veri kaynağını ve kurulum farkını kaydedin.
3. Terminalde verilen `artifacts/v09/pilot/.../results.md` dosyasını gözlemci kaydı olarak kullanın. Sürüm, commit, manifest/arşiv SHA-256 ve sentetik örnek kimliği otomatik doldurulur; katılımcı sonuçları ve karar `pending` kalır. Aynı dizindeki `participant-tasks.tr.md`, görev metninin değiştirilmemiş kopyasıdır; katılımcıya yalnız bunu verin. `provenance.json` belge/kaynak hash'lerini içerir; `fixture/` örnek kaynaklarını da saklayın. Motor/viewer arşivden gelir, bilimsel örnek ayrı kaydedilmiş depo kaynağıdır. Çalışma dizinini sınanmış arşiv diye kaydetmeyin. Sürümün belgelerini hazır bırakın; kurulum sorunlarını görev başlamadan giderin. Gözlem, başlangıç verisi teslim edildiğinde başlar.
4. HTML dosyasını ağ kapalıyken açacak ikinci profil veya makine hazırlayın. Kullanıcı açıkça istemedikçe başkasına dosya göndermeyin; yerel ikinci profil yeterlidir.
5. Kayıt için izin alın. Ekran kaydı zorunlu değildir; süre, eylemler, hata ve katılımcının açıklaması yeterlidir. Katılımcı istediği an bırakabilir.

## Yönlendirmeden gözlemleme

Görev metnini değiştirmeden okuyun. Düğme adını, doğru sırayı veya imleç hedefini söylemeyin. “Şu anda ne bekliyorsunuz?” ve “Bu değer sizce neyi gösteriyor?” gibi tarafsız sorular sorabilirsiniz. Belgeleri kendisinin kullanması yardım sayılmaz.

Yardım istediğinde önce normalde nasıl ilerleyeceğini sorun; ardından verilen her ipucunu ve zamanını kaydedin. Ürünün çalışması için verilen teknik yardım ile görevi nasıl yapacağını gösteren yardımı ayırın. Yardım sonrası tamamlanmayı `assisted` olarak işaretleyin.

| Adım | Gözlemcinin doğrulayacağı sonuç |
| --- | --- |
| Yüzey | Bir gözlem seçildi; x/y/z ve varsa ayrı skalerin anlamı doğru açıklandı |
| Kesit | Bağlı satır/sütun değiştirildi; değerler kaynak grid ile eşleşti |
| Dondurma | İncelenen görüntü sabitlendi; katılımcı görüntü ve kaynak veri arasındaki ayrımı doğru açıkladı |
| Dışa aktarma | PNG ve tekrar açılabilen HTML oluştu; HTML ikinci ortamda çevrimdışı açıldı; seçili gözlem ve görünüm eşleşti |

Kaynak örneğin kimliği ve değerleri eşleşmelidir. Yüzey hücresi/üçgeni üzerinde interpolasyon seçildiyse bunu açıkça kaydedin ve sayısal toleransı testten önce belirleyin. Sonuçları gördükten sonra toleransı değiştirmeyin. Ortam, görev süresi, yardım, hatalar, dosyalar ve hash'ler birlikte saklanır.

## Karar ve isteğe bağlı araştırma

Her sorun için görevi, gözlenen davranışı, beklenen sonucu ve yeniden üretme adımlarını kaydedin. Düzeltme yapılırsa yeni sürüm/hash ile yeniden sınayın; eski başarısız kaydı koruyun. Beş kaydı ve doğru dışa aktarma kanıtını release manifestine bağlamadan `betaPilot.status: passed` yazmayın.

Kendi veriyle ilk görünümü oluşturma süresi, telemetri keşfi, ek klavye görevleri, tercih görüşmeleri ve iki hafta sonra tekrar kullanım **isteğe bağlı araştırmadır; yayın kapısı değildir**. Bu pilot, ayrıca gerekli erişilebilirlik/platform/iki saatlik soak kontrollerinin yerine geçmez.
