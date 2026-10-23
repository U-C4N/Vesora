# Gerçek insan kanıtını kaydetme

Bu giriş dosyası mevcut ekran okuyucu ve beş kişilik pilot ölçütlerini makineyle kontrol edilebilir hale getirir. Gerçek katılımcı veya ekran okuyucu çalışması yerine geçmez. Başlatıcı tüm sonuçları `pending` bırakır; kanıt doğrulama komutu yayın kapısını veya arşivleri değiştirmez.

```powershell
node scripts/run-pilot-v09.mjs dist/release-v0.9.0-rc.6
```

Terminaldeki oturum dizinini saklayın. Katılımcılar normal `URL` adresini ve `participant-tasks.tr.md` görev metnini kullanır. Ekran okuyucu denetçisi `Screen-reader URL` adresini ve `screen-reader.tr.md` listesini kullanır. Aynı kişinin ekran okuyucu denetimi beş katılımcı sayısına otomatik eklenmez. Hazırlayıcı kimseye mesaj göndermez veya oturum ayarlamaz.

`human-evidence.json` içindeki sürüm, commit ve manifest hash'ini değiştirmeyin. Bunlar gözlemin hangi sabit arşive ait olduğunu belirtir. Gözlemci alanları ve kayıtlar gerçek oturum yapıldıkça doldurulur. Kişisel isim yerine katılımcı kodlarını kullanın; ses/video zorunlu değildir. İzinli gözlem notu ve gerçek duyulan metin kaydı yeterlidir.

## Ekran okuyucu kaydı

`screenReader` alanında Narrator veya NVDA adını, tam sürümünü, konuşma dilini, işletim sistemi/tarayıcı sürümünü, denetçiyi ve tarih/saatini girin. Tarihler saat dilimi içeren ISO biçiminde olmalıdır; örnek biçim `YYYY-MM-DDTHH:mm:ss+03:00`.

Dokuz `steps` satırının sırasını veya kimliklerini değiştirmeyin. Her yapılan adım için `result` değeri `passed` veya `failed`, `announcement` gerçek duyulan metin, `notes` gözlem açıklaması, `evidence` kanıt dosyalarının listesi olur. Yapılmayan adım `pending` kalır. Aynı konuşma günlüğü birden fazla adım tarafından gösterilebilir. `review` alanını gerçek kaydı inceleyen kişi ve inceleme tarihiyle doldurun.

Ekran okuyucu kaydının tamamlanması yalnız insan smoke kontrolünü kapsar. Klavye, kontrast, zoom, reflow ve diğer erişilebilirlik kanıtları ayrıca gereklidir.

## Beş kişilik pilot kaydı

`pilot` ortam ve gözlemci alanlarını doldurun. P01–P03 bilimsel veri kullanıcıları, P04–P05 telemetri geliştiricileri olarak kalır. Her kişinin `result` değeri `unaided`, `assisted`, `failed` veya `pending` olur. Beş kişinin tamamı gözlenmeden ve en az dördü tam akışı yardımsız tamamlamadan sonuç başarılı olmaz. Süre kaydı `results.md` içinde tutulur; yeni bir süre eşiği uygulanmaz.

Tamamlanan kişilerde dört `steps` alanını gözlenen sonuca göre doldurun. `freeze` alanına dondurma sırasında görülen en az iki kaynak güncellemesini, ilerleyen accepted revision değerlerini ve aynı kalan displayed frame numarasını kaydedin. `notes` ve `evidence` yardım/zamanı, kaynak-görüntü ayrımının kişinin kendi açıklamasını, kesit doğrulamasını ve eksik/başarısız adımları içermelidir.

Seçilen gözlemin `selectionKind` alanı `source` veya `interpolated` olur. Yüzey seçimi köşeye denk gelse bile ürün tarafından `surface` ve `interpolated` olarak kaydedilir. İnterpolasyon varsa `pilot.interpolation.absoluteTolerance` ve `declaredAt` ilk ilgili gözlemden **önce** belirlenir; sonuçları gördükten sonra tolerans değiştirilmez. Kaynak nokta gözleminde değerler tam eşleşir. `observationBefore` ve `observationOffline` aynı yapıdadır:

```json
{
  "identity": {"kind": "surface", "layerId": "GERÇEK_KATMAN", "cell": [0, 0], "triangle": 0},
  "values": {"x": 0, "y": 0, "z": 0, "value": 0}
}
```

Bu sıfırlar örnek şemadır; gerçek ölçüm sonucu değildir. Yüzeyde `kind: "surface"`, gerçek `cell`/`triangle` ve `value` zorunludur; bağımsız skaler yoksa bile ürünün verdiği yükseklik skalerini kaydedin. Bir kaynak 3D noktasında `kind: "point3d"`, `layerId` ve `index` (veya aynı anlamda `sourceIndex`) kullanın; tek başına sequence yeterli kimlik değildir. 3D çizgi ara değeri için `kind: "segment3d"`, `indices: [ilk, ikinci]` ve `t` kullanılır. Panel ana panel değilse `panelId` de girilir. Çevrimdışı kayıt dosyayı ikinci ortamda açınca okunur; ilk kaydın kopyası olarak doldurulmaz. Kamera ve kesit eşleşmesi de gözlem notunda kaydedilir.

Her üretilen PNG/HTML dosyasını `exports` listesine yazın. Satır `kind`, `path`, `sha256`, `observationMatches` içerir; HTML ayrıca `openedOffline` içerir. Tamamlanan kişilerde her iki format bulunmalıdır. Başarısız veya yardım alan kişinin ürettiği dosyalar da listelenir. Tek yanlış gözlem kaydı doğruluk kapısını kapatır.

## Dosya hash'leri ve doğrulama

Kanıtlar oturum dizininde bulunmalıdır; `path` bu dizine göredir. Hash'i gerçek kaydedilmiş dosyadan alın:

```powershell
(Get-FileHash -Algorithm SHA256 -LiteralPath 'OTURUM_DIZINI/P01-notes.txt').Hash.ToLowerInvariant()
```

Örnek bir `evidence` satırı `{"path":"P01-notes.txt","sha256":"DOSYANIN_64_KARAKTERLIK_HASHI"}` biçimindedir. Dosya değiştiğinde yeniden incelenmeli ve hash yeniden hesaplanmalıdır. Katılımcı görev metnini değiştirmeyin.

```powershell
node scripts/validate-human-evidence.mjs dist/release-v0.9.0-rc.6 OTURUM_DIZINI
node scripts/validate-human-evidence.mjs dist/release-v0.9.0-rc.6 OTURUM_DIZINI --require-passed
```

İlk komut eksikleri ve hesaplanan `pending`/`failed`/`passed` durumunu JSON olarak gösterir. İkinci komut iki insan kaydı da tamam değilse başarısız çıkış kodu verir. Değişmiş arşiv, yanlış aday, eksik/tekrarlanan katılımcı, oturum dışı dosya veya uyuşmayan hash reddedilir. PNG imzası ve temel görüntü blokları kontrol edilir; raster piksellerinin doğru gözlemi gösterdiği ayrıca insan tarafından doğrulanır. HTML kodu çalıştırılmadan JSON yükü okunur: görüntülenen donmuş snapshot, kaynak/katman/sürüm bağlantıları, seçili kimlik/koordinat/skaler ve kaydedilen gözlem karşılaştırılır. Dışa aktarma zamanı dondurma zamanından ve sonraki kamera/kesit değişiminin frame numarası ilk stabilite ölçümünden farklı olabilir. Çıktı bir insan gözlemi değil, verilen kayıtların bütünlük kontrolüdür. Nihai yayın kararı ayrıca gerçek kayıtlar ve diğer yayın kanıtları incelenerek verilir.
