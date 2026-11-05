# Vesora 1.0: hangi grafik hangi soruyu cevaplar?

Yeni on grafik ailesi, aynı veriyi farklı sorular için incelemeyi sağlar. Örneklerin tamamı sentetiktir. Kaynak veriler, birimler ve seçilen gözlemler grafikle birlikte korunur; çizim, verinin bilimsel doğruluğunu kendi başına doğrulamaz.

Turu açmak için proje kökünde `npm run demo:react` çalıştırıp Vite adresine `?demo=tour` ekleyin. `?demo=tour&chart=spectrogram` gibi bağlantılar tek grafiği açar. API adları ve veri sözleşmeleri [v1 rehberinde](v1.md), görseller [ana sayfada](../README.md#ten-charts-ten-questions).

## 1. ECDF / CCDF: ortalamanın gizlediği kuyruk

**Kullanım:** Servis gecikmesi, sensör yanıt süresi veya deney süresi. “İsteklerin yüzde kaçı 200 ms içinde bitiyor?” sorusu doğrudan okunur.

ECDF, eşikte veya altında kalan örneklerin payını; CCDF, eşikten kesin olarak büyük olanların payını gösterir. `query_ecdf` / `queryECDF` eşik sayımlarını ve en yakın sıra yöntemine göre yüzdelikleri verir. Turdaki 1.200 isteğin az sayıdaki yavaş örneği, histogram aralığı seçmeden görünür kalır.

## 2. Spectrogram: değişim hangi frekansta, ne zaman?

**Kullanım:** Titreşim, ses veya cihaz ölçümlerinde kayan frekans bandını kısa bir enerji patlamasından ayırmak.

Yatay eksen frekans, dikey eksen zaman, renk verilen güç değeridir. Turdaki yükselen bant ve kısa olay farklı örüntüler oluşturur; 5,25 saniyedeki boş sıra eksik ölçüm adımıdır. `append_rows` / `appendRows` sınırlı sayıda zaman sırasını tutar. FFT ve güç matrisinin hazırlanması sizin analiz hattınıza aittir.

## 3. Event timeline: olaylar nasıl örtüşüyor?

**Kullanım:** Dağıtım, deney aşaması veya cihaz günlüğü. Canary çalışırken doğrulamanın başladığını ve geri dönüşün hangi aralığa denk geldiğini görün.

Blok genişliği süreyi, kısa işaret tek bir anı, şerit ise adlandırılmış işi gösterir. Örnekte beş şeritte dokuz olay ve kontrol noktası vardır. Bir olayın sinyal değişiminden önce gelmesi nedenselliği kanıtlamaz; inceleyeceğiniz zaman aralığını belirlemeye yardımcı olur.

## 4. Error bars: merkez değer ile verilen sınırlar

**Kullanım:** Sensör kalibrasyonu veya alt ve üst belirsizlik sınırları farklı olan ölçümler.

Merkez noktayı referans çizgisiyle, çubuk uçlarını verilen alt ve üst değerlerle karşılaştırın. Turdaki sıcaklık ölçümleri referansın üzerinde kayarken asimetrik sınırlar korunur. Vesora bu sınırları hesaplamaz; çubukların örtüşmesini otomatik bir istatistiksel anlamlılık testi olarak yorumlamayın.

## 5. Contour / contourf: eşiklerin konumu ve biçimi

**Kullanım:** Sıcaklık, basınç veya iki parametreli amaç fonksiyonu ızgarası. “Sıcak nokta kaç derece?” sorusuna ek olarak “Hangi bölge eşiği aşıyor?” sorusunu sorun.

İzohatlar aynı değeri, dolu bantlar komşu seviyeler arasını gösterir. Turdaki kart üzerinde iki ısı bölgesi, 5 °C aralıklı seviyelerle okunur. Konturlar düzenli kaynak ızgarasının üçgenleri üzerinde interpolasyon kullanır; bant sınırı yeni bir ölçüm değildir.

## 6. Quiver: yerel yön ve büyüklük

**Kullanım:** Akış, kuvvet veya önceden hesaplanmış gradyan vektörleri. İki karşıt dönme bölgesini ve arka plan sürüklenmesini ayırt edin.

Her ok bir kaynak konumu ve iki bileşen taşır. Turda hızlar m/s, ok ölçeği 0,55 saniyedir; çizilen yer değiştirme hız × ölçek ilişkisindedir. `normalize` açılırsa uzunlukların anlamı değişir. Kaynak büyüklüğünü karşılaştırırken bu tercihi açık tutun.

## 7. Parallel coordinates: aynı aday, birden çok kısıt

**Kullanım:** Model ayarları veya tasarım adayları. Düşük loss ve düşük gecikmeyi aynı anda sağlayan seçenekleri bulun.

Bir çizginin bütün eksenlerdeki noktaları aynı aday kimliğine aittir. Turda öğrenme oranı, batch boyutu, loss, gecikme ve bellek birlikte gösterilir; bazı eksenler logaritmik veya ters yönlüdür. Fırçalar kaynak birimlerinde çalışır. Eksen yönünü ve ölçeğini okuyarak karşılaştırın; çizgilerin kesişmesi kendi başına ilişki kanıtı değildir.

## 8. Pareto frontier: iki amaç arasında kalan seçenekler

**Kullanım:** Çıkarım maliyeti ve kalite gibi iki açık hedef. Daha ucuz ve en az aynı kalitede bir alternatif varken pahalı adayı ayırt edin.

Bir aday, başka bir aday iki amaçta da en az onun kadar iyiyken en az bir amaçta daha iyiyse baskılanır. Vurgulu sınır baskılanmayan adayları gösterir. Her eksenin `min` / `max` yönü açık seçilir. Sınır, bütün kullanım koşulları için tek bir “en iyi model” seçmez.

## 9. Phase portrait / hysteresis: aynı giriş, farklı geçmiş

**Kullanım:** Yükleme–boşaltma taraması, kontrol cevabı veya eş zamanlı iki durum değişkeni.

Turdaki gerilim–akım eğrisinde aynı gerilime gidiş ve dönüşte farklı cevaplar oluşur. Oklar edinim yönünü gösterir; x değerine göre yeniden sıralama döngüyü bozardı. Zaman ve örnek sırası korunur. Döngü alanı otomatik olarak enerji veya fiziksel kayıp diye hesaplanmaz.

## 10. Ternary: toplamı sabit üç parçalı karışım

**Kullanım:** Reçine–sertleştirici–dolgu gibi üç bileşenli formülasyonlar veya üç yöne paylaştırılan bir toplam.

Köşeler tek bileşeni, kenarlar bir bileşenin sıfır olduğu karışımları, iç bölge üçlü karışımları gösterir. Turdaki her örnekte üç kaynak oranının toplamı 1’dir. Renkler dolgu gruplarıdır; malzeme performansı tahmini değildir. Otomatik normalizasyon açıkça seçilmedikçe hatalı toplamlar reddedilir.

Birden çok grafiği aynı incelemeye bağlamak için React örneğinde `?demo=v1` yolundaki sinyal, koşu karşılaştırma ve cohort çalışma alanlarına bakın. Paylaşımda `accepted` ile `displayed` farkı ve dondurulmuş gözlem davranışı [observation rehberinde](observation.md) açıklanır.
