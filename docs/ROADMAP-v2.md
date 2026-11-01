# Pixel Dungeon 2.0: ana yol haritası

Tarih: 2026-11-01. Durum: taslak, kullanıcı onayı bekliyor. Kapsam: efektlerin tamamı, silahlar, karakterlerin yeniden yapımı, aynı sınıfa farklı büyüler, dünya, canavarlar, arayüz, denge ve kalite. İlke: **acele yok**. Her aşama ayrı dalda yapılır, sen test edersin, onaylarsan `main`'e girer.

---

## 1. Bugünkü durum (dürüst döküm)

### 1.1 Sitedeki efektlerin hepsini kullandık mı? **Hayır, üçte birini.**

pixelfx'te 244 efekt var; oyunda **82'si** kullanılıyor (palet varyantlarıyla 98 sayfa).

| Kategori | Kullanılan | Kullanılmayan (önemlileri) |
|---|---|---|
| Hamleler (tam saldırı koreografileri) | 0/12 | ok atışı, kılıç kombosu, yer yumruğu, meteor çağrısı, kutsal ceza... (karakter animasyonu için referans) |
| Ateş | 3/12 | ateş nefesi, alev sütunu, ateş kasırgası, alev püskürtücü, ruh alevi, meşale, mangal, kamp ateşi, mum |
| Patlama | 4/12 | büyük patlama, içe çökme, havai fişek, bomba (nükleer ve plazma temaya uymuyor) |
| **Su** | **0/12** | dalga, girdap, fıskiye, su topu, şelale, sıçrama, yağmur sıçraması... (hiç su sınıfı/büyüsü yok) |
| Buz | 4/10 | dondurma, buz nefesi, tipi girdabı, buz sarkıtı, kar tanesi patlaması, buz kristali |
| Şimşek | 7/11 | elektriklenme, plazma topu, kıvılcım yayı, tesla bobini |
| Yakın dövüş | 9/12 | tırpan biçişi, mızrak savuruşu, kırbaç |
| Darbe | 6/11 | savuşturma (parry), ağır iniş, vuruş flaşı |
| Mermi | 1/13 | sihirli füze, enerji diski, işaret fişeği, güdümlü füze (çoğu silah/bilim-kurgu) |
| Doğma/ölüm | 2/10 | parçalanma, eriyerek yanma, dirilme ışını, çağırma, portal, yumurta |
| Arkan | 6/12 | zaman durdurma, portal, arkan ışını/küresi, rün çemberi, büyü şarjı |
| Kutsal | 8/10 | hale, diriliş |
| Gölge | 8/12 | kara delik, tutulma, gölge alevleri, ruh emme |
| Durum | 7/13 | **dondurulmuş, taşlaşma, uyku, yavaşlama, büyülenme, şaşkınlık** (oyunda karşılıkları yok) |
| Doğa | 11/13 | kaya, deprem |
| Hava | 1/12 | yağmur, kar, sis, fırtına, tipi, tanrı ışınları, kutup ışıkları, düşen yapraklar, kayan yıldızlar |
| Arayüz | 2/12 | başarım, görev tamam, altın toplama, kombo sayacı, kritik sayısı |
| Ganimet | 3/11 | altın/elmas dönmesi, kristal, can kalbi, XP küresi, anahtar parıltısı |
| **Geçişler** | **0/10** | yanarak silinme, kırılma, kesik silinme, iris... (kat geçişleri yok) |
| **Yaratıklar** | **0/12** | yarasa, hayalet, uçan kafatası, balçık, yılan, ruh ışığı, göz... (ortam ve küçük canavarlar) |
| Bilim-kurgu | 0/12 | **bilerek dışarıda** (temaya uymuyor) |

Kullanılmayan 162 efektin ~25'i temaya uymadığı için bilerek dışarıda; geri kalan **~135'i bu planda bir yere oturtuluyor** (bkz. bölüm 4).

### 1.2 Silahlara özel efektler geldi mi? **Kısmen.**

- **Var:** nadirlik renginde vuruş kıvılcımı (mavi → turkuaz), 24 efsanevinin pasifi tetiklenince imza efekti, ganimet ışını.
- **Yok:**
  - Silah türüne göre efekt: balta, gürz, mızrak, tırpan, yay, asa aynı görünüyor. Silah türü hamleleri var ama hâlâ eski vektör efektlerle.
  - Silahın elinde sürekli parlaması.
  - Element özellikli silahlar (ateş, buz, zehir...).
  - Efsanevi silahın saldırının kendisini değiştirmesi.
  - Set eşyası görselleri.

### 1.3 Karakterler efektlerle uyumlu hale getirildi mi? **Hayır.**

Karakterlere hiç dokunulmadı; efektleri onlara uydurduk (siluet maskesi, gövdeyi boyamayan durum efektleri, D görünümü). Eksikler:
- Karakterler parça parça (gövde, kollar, bacaklar) dönen bir rig. pixelfx'in efektleri ise hazırlık pozu → kesik vuruş pozu → temas anında donma → toparlanma ritmiyle tasarlanmış. Bizim pozlar bu ritmi tam taşımıyor.
- Silah elde sabit duruyor; büyü yaparken el ve asa ucu efektin çıktığı yerle her zaman eşleşmiyor.
- Boyalı (pürüzsüz) karakterlerle piksel efektler aynı sahnede iki farklı dünya gibi durabiliyor.

### 1.4 Oyunda başka neler eksik?

- **Hamleler sadece görsel.** Hasarı taşlar belirliyor; büyünün kendisinin bir anlamı yok. "Aynı sınıfa farklı büyüler" gerçek bir oyun sistemi olarak yok.
- **Dünya tek düze.** Tek bir zindan arka planı var; canavarlar 5 tür (normal, zırhlı, hızlı, ruh emici, boss), biyom ve element yok.
- **Boss'lar** sadece daha güçlü canavar, mekanikleri (aşama, kalkan, çağırma) yok.
- **Kat geçişi, harita ve ilerleme hissi** zayıf.
- **Ses:** yeni efektlerin sesleri yok.
- **Ayarlar:** efekt yoğunluğu ve ışık hassasiyeti (fotosensitivite) seçeneği yok.
- **Kodeks** yok (büyü kitabı, canavar ansiklopedisi).
- **Denge:** 10 sınıfın birbirine karşı dengesi sayılarla ölçülmüyor.

---

## 2. Önce verilmesi gereken üç karar

Bunlar sonraki her şeyi belirliyor; her biri için önce küçük bir **deneme** yapıp gözle/oynayarak karar vermeni öneriyorum (Faz 0'daki gibi).

### Karar A: Karakterlerin sanat yönü

| Seçenek | Ne | Artı | Eksi |
|---|---|---|---|
| **A1. Stil C'yi koru, animasyonu yeniden yap** | Bugünkü boyalı karakterler; yeni poz/animasyon sistemi, pixelfx ritmine göre hareket, el/silah ucu noktaları, ince bir kontur ve ışık geçişiyle efektlere yaklaştırma | En az risk, mevcut 962 eşya görünümü korunur | Piksel efektlerle stil farkı tamamen kapanmaz |
| **A2. Yüksek çözünürlüklü piksel karakterler** | Karakterler de piksel art; ama düşük çözünürlüklü değil (~120-160 px boy, Dead Cells / Blasphemous seviyesi), kare kare akıcı animasyon | Efektlerle tam bütünlük, "pixelfx dünyası" | Her sınıf, cinsiyet ve eşya katmanı için çok büyük çizim/üretim işi; eşya görselleri baştan |
| **A3. Karma (önerim, denemeyle doğrulanmalı)** | Stil C'nin oranları ve gövdesi korunur ama piksel-boya karışımı bir işlemle (kademeli gölge, keskin kontur, D görünümündeki gibi akıllı büyütülmüş piksel dokusu) çizilir; animasyon yeniden yapılır | Efektlerle uyum + mevcut eşya sistemi büyük ölçüde korunur | Doğru tonu bulmak için birkaç deneme turu |

**Deneme:** Aynı sahnede 3 sınıf, A1/A2/A3 olarak yan yana, aynı pixelfx büyüleriyle. Karar senin gözünle.

### Karar B: Büyü sistemi (aynı sınıfa farklı büyüler)

Önerim: **her sınıfa 3 büyü okulu**. Okul seçimi oynanışı gerçekten değiştirir; efektler de okula göre değişir.

- **Okul:** Sınıfın bir dalı (ör. Büyücü: Ateş / Buz / Arkan). Karakter bir okul seçer (kasabada ücretli değiştirilebilir).
- **Taş büyüleri:** Okul, taş eşleşmelerinin ne yaptığını değiştirir. Örneğin Ateş Büyücüsü'nün kafatası eşleşmesi %25 ihtimalle yakar, Buz Büyücüsü'nün kılıç eşleşmesi yavaşlatır. Hamle animasyonu ve efekti de okula göre değişir.
- **Aktif büyüler:** Her okulun 4 büyüsü olur; karakter 2'sini yuvaya takar. Enerji taşlarından dolan ayrı bir **mana** çubuğuyla kullanılır (ult yerinde kalır).
- **Ult:** Okula göre değişir (Ateş: Meteor Yağmuru, Buz: Mutlak Sıfır, Arkan: Zaman Durdurma).
- **Açılış:** Seviye ve yetenek puanlarıyla; mevcut yetenek sistemiyle (`talent_defs`) birleştirilir.

Bu, solo, PvP ve co-op'u etkileyen büyük bir oyun tasarımı işi; ayrıntılı tasarım belgesi ve denge simülasyonu olmadan kodlanmamalı.

**Deneme:** Bir sınıf (Büyücü) için 3 okulun kağıt üstünde tasarımı + basit bir prototip; oynayıp "eğlenceli mi, anlaşılır mı" kararı.

### Karar C: Dünya yapısı

Önerim: **5 biyom × 10 kat** (her 5. kat boss). Biyomlar:

| Biyom | Element | Ortam efekti |
|---|---|---|
| Mezar Mahzeni | gölge | sis, yarasalar, uçan kafatasları |
| Buz Mağaraları | buz | kar, tipi |
| Volkan | ateş | korlar, mangallar |
| Zehirli Bataklık | zehir | yağmur, balçıklar, yılanlar |
| Fırtına Zirvesi | şimşek | fırtına, şimşek |

Her biyomun kendine özgü canavar ailesi, boss'u, taş arka planı ve müziği olur.

---

## 3. Aşamalar

Süreler, bir oturumun bugünkü çalışma temposuna göre kabaca tahmindir. Her aşamanın sonunda: testler, telefon performansı ölçümü, canlı test linki, senin onayın.

### R0: Kararlar ve altyapı hazırlığı (2-3 oturum)
- Sanat yönü denemesi (Karar A) ve büyü sistemi tasarım belgesi + Büyücü prototipi (Karar B).
- **Denge simülatörü:** Tarayıcıda, oyunun gerçek savaş kodunu kullanıp binlerce maçı hızlıca oynatan bir araç: sınıf × canavar × kat, kazanma oranı, ortalama tur, hasar dağılımı. Bundan sonraki her denge kararı sayıya dayanır.
- **Varlık bütçesi:** efekt sayfalarını biyom ve sınıf bazında yükleme; WebP dönüştürücü (sayfaları ~%40 küçültür); telefon için bellek ve indirme sınırları.
- CI'daki ara sıra takılan zamanlama testlerinin sağlamlaştırılması.
- **Çıktı:** Karar A, B, C senin onayınla kesinleşir.

### R1: Karakterlerin yeniden yapımı (6-10 oturum, Karar A'ya göre)
- **Animasyon sistemi:** Her hamle için anahtar pozlar (hazırlık → vuruş → takip → toparlanma), pixelfx'in `act` zamanlamasıyla senkron. Temas anında donma ve hedefin savrulması, ağırlık hissi, 12 kare/sn "kesik" poz seçeneği.
- **Bağlantı noktaları:** El, silah ucu, asa başı, göğüs, baş. Efektler tam bu noktalardan çıkar: asa ucundan ateş topu, kılıcın ağzından yay.
- **Animasyon seti** (her sınıf ve cinsiyet): boşta, yürüme/koşma, 3+ saldırı, büyü (kısa/uzun), savunma, iyileşme, vurulma, sersemleme, ölüm, zafer, ult.
- **Görünüm:** Seçilen sanat yönünde 10 sınıf × 2 cinsiyet; sınıf siluetleri belirgin; 962 eşyanın yeni stile uyarlanması (veriyle, tek tek çizim değil).
- **Canavarlar:** 5 türün yeniden yapımı + biyom canavarları için temel (R4).
- **Karakter oluşturma ekranı:** Yeni görünüm seçenekleri, canlı animasyonlu önizleme.
- **Kabul:** Her sınıf ve cinsiyet her animasyonu oynatabiliyor, efektler doğru noktadan çıkıyor, telefonda 60 fps.

### R2: Büyü okulları (8-12 oturum, Karar B'ye göre)
- **10 sınıf × 3 okul = 30 okul**; her okulda 4 aktif büyü, okula özel taş etkileri ve ult. Örnek okullar:

| Sınıf | Okullar |
|---|---|
| Savaşçı | Silah Ustası, Kalkan Muhafızı, Savaş Narası |
| Paladin | Işık, Koruma, Ceza |
| Berserker | Öfke, Kan, Deprem |
| Haydut | Gölge, Zehir, Çeviklik |
| Okçu | Keskin Nişancı, Doğa Avcısı, Tuzakçı |
| Büyücü | Ateş, Buz, Arkan |
| Nekromant | Kemik, Ruh, Veba |
| Druid | Şifa, Diken, Gelgit (su) |
| Fırtına Çağırıcı | Şimşek, Rüzgar, Tipi |
| Simyacı | Patlayıcı, Zehir, İksir |

- **Yeni durum etkileri:** Dondurma (tur kaybı + kırılınca ek hasar), taşlaşma, uyku (vurulunca uyanır), yavaşlama, büyülenme, şaşkınlık. pixelfx'in kullanılmayan durum efektleri burada devreye girer.
- **Mana çubuğu ve büyü yuvaları:** Arayüz, mobilde tek dokunuşla kullanım, bekleme süresi.
- **Sunucu:**
  - Karakterin okulu ve büyü düzeni, güvenli fonksiyonlarla saklanır (doğrudan tablo yazımı yok; mevcut kural).
  - Okul değişimi altın karşılığında yapılır.
  - `schema.sql` değişir ve Supabase'de yeniden çalıştırılır.
- **PvP ve co-op:** Büyüler ve yeni durumlar, bugünkü durum etkisi modeliyle ("her taraf kendi canının sahibi") senkron çalışır.
- **Denge:** Simülatörde her okul hedef kazanma oranı aralığında (ör. %45-55).
- **Kabul:** Her okulun her büyüsü üç modda çalışıyor; testler ve simülasyon raporu.

### R3: Silahlar (5-7 oturum)
- **Silah türü hamleleri** (pixelfx ile):

| Silah | Hamleler |
|---|---|
| Kılıç | kombo |
| Balta | yarma |
| Gürz / çekiç | ezme + yer sarsıntısı |
| Mızrak | savuruş + delme |
| Hançer | seri saplama |
| Tırpan | biçme |
| Kırbaç | şaklatma (yeni silah türü) |
| Yay | atış, yaylım, sekme |
| Asa | asa ucundan büyü |
| Değnek | sihirli füze (yeni) |
| Kitap | rün çemberi |

- **Silah izleri:** Savuruşta nadirliğe göre iz (D görünümünde, ekran kartında).
- **Elde parlama:** Turuncu ve üstü silahlarda elde sürekli, hafif bir parıltı. Arena boşta da hafifçe çizildiği için pil bütçesiyle sınırlı.
- **Element özellikleri:** Eşyalara ateş, buz, şimşek, zehir, kutsal ve gölge hasarı eklenir. Vuruşta element efekti oynar, durum uygulama şansı verir, canavarların direnç ve zayıflığıyla etkileşir.
  - Katalog üreticisi, eşya üretim aralıkları, sunucu doğrulama tabloları ve ipucu kutusu güncellenir.
  - `schema.sql` değişir.
- **Efsanevi silahlar saldırıyı değiştirir:** Örneğin Dünya Yiyen ile her kafatası vuruşu karanlık patlama olur, Fırtına Kartalı ile kılıç vuruşu zincir yıldırıma dönüşür. Elde kendine özgü görünürler.
- **Set eşyaları:** Set tamamlanınca aura ve set efekti; 2/4/6 parça bonusları görünür.
- **Büyüleme (enchant):** Kasabadaki demirci malzemeyle silaha element büyüsü işler; yeni güvenli sunucu fonksiyonu gerekir.
- **Kabul:** Her silah türünün kendi hareket ve efekti var; element ve efsanevi davranışlar test ediliyor.

### R4: Dünya, canavarlar ve boss'lar (7-10 oturum)
- **5 biyom:** Her birinin arena arka planı (boyalı, katmanlı paralaks), tahta çerçevesi ve taş tonu var.
  - Ortam efektleri: sis, kar, yağmur, fırtına, korlar, tanrı ışınları.
  - Küçük yaratıklar: yarasa, hayalet, balçık, yılan, ruh ışığı, uçan kafatası. Pil bütçesiyle, düşük grafikte kapalı.
- **Canavar aileleri:** Biyom başına 4-5 canavar (toplam ~22).
  - Her birinin elementi, direnç ve zayıflığı, kendine özgü 3-4 hamlesi ve uyguladığı durum etkisi var.
  - Elit canavarlar: "zırhlı", "hızlı", "lanetli" gibi rastgele özellikler.
- **Boss'lar:** Biyom başına bir boss, 2-3 aşamalı.
  - Aşama geçişinde sinematik.
  - Kalkan kırma, minyon çağırma, tahtaya etki (taş dondurma, taş zehirleme gibi tahta mekanikleri).
- **Kat geçişleri:** pixelfx geçiş efektleri (yanarak silinme, kırılma). Kat haritası: dallanan yol, dinlenme, sandık, olay odaları.
- **Canavar doğuşu ve ölümü:** Ailesine göre portal, çağırma, parçalanma, eriyerek yanma.
- **Co-op ve PvP:** Biyom seçimi (co-op), PvP için arena biyomu.
- **Kabul:** Her biyom oynanabilir, 5 boss'un mekanikleri test ediliyor, simülasyonda zorluk eğrisi düzgün.

### R5: Kalan efektler, arayüz ve ses (4-6 oturum)
- **Kullanılmayan efektlerin yerleştirilmesi** (bölüm 4'teki tablo), toplamda ~135 efekt.
- **Arayüz efektleri:**
  - Başarım, görev tamamlandı, altın toplama, XP küreleri, kombo sayacı, kritik vuruş.
  - Tahtada büyük kombolarda patlama (mobil performans ölçülerek).
  - Seviye atlama sinematiği.
- **Kodeks:**
  - Büyü kitabı: her okul ve büyünün açıklaması ve canlı önizlemesi.
  - Canavar ansiklopedisi: görülen canavarlar, direnç ve zayıflıkları.
  - Durum etkileri sözlüğü.
- **Ses:** Her element ve büyü ailesi için ses; boss ve biyom müzikleri. Kaynaklar ücretsiz ve lisansı uygun olmalı.
- **Ayarlar:**
  - Efekt yoğunluğu (tam / azaltılmış / kapalı).
  - Ekran sarsıntısı aç/kapa.
  - Işık hassasiyeti modu (parlak flaşları yumuşatır).
  - Renk körlüğü için durum simgeleri.
- **Eğitim:** Yeni sistemleri (okullar, mana, durumlar, elementler) adım adım öğreten kısa görevler.

### R6: Denge, performans, kalite ve yayın (3-5 oturum)
- **Denge:** Simülatörle sınıf, okul, canavar ve kat ayarları. PvP'de okul eşleşme tablosu.
- **Performans:** Zayıf telefon (ör. Galaxy A50) hedefi 60 fps, en kötü sahnede 45 fps. Bellek ve indirme bütçesi. Düşük grafik modunun her yeni özellikte doğru çalıştığının testi.
- **Test kapsamı:** Her yeni sistem için solo, PvP ve co-op uçtan uca testler. Golden master güncellemesi. Görsel karşılaştırma ekran görüntüleri.
- **Yayın:**
  - Sürüm notları, eski oyuncular için geçiş (okul seçimi ekranı, eşyalara element dağıtımı yok, yeni eşyalar düşer).
  - `schema.sql` çalıştırma.
  - Canlıda izleme: istemci hata kayıtları.

---

## 4. Kullanılmayan efektler nereye gidiyor?

| Efektler | Nerede |
|---|---|
| **Su** (12) | Druid'in **Gelgit** okulu (dalga, girdap, su topu, fıskiye, şelale) + Bataklık biyomu (yağmur sıçraması, damlalar, dalgacıklar) |
| Ateş: nefes, sütun, kasırga, püskürtücü, ruh alevi | Ateş Büyücüsü, Volkan canavarları ve boss'u |
| Ateş: meşale, mangal, kamp ateşi, mum | Biyom ortamı, kasaba |
| Buz: dondurma, nefes, tipi, sarkıt, kar tanesi, kristal | Buz Büyücüsü, Tipi okulu, Buz Mağaraları, **dondurma** durumu |
| Şimşek: elektriklenme, plazma topu, kıvılcım yayı, tesla | Şimşek okulu, Fırtına Zirvesi, şimşek elementli silahlar |
| Yakın dövüş: tırpan, mızrak, kırbaç | Silah türü hamleleri (R3) |
| Darbe: savuşturma, ağır iniş, vuruş flaşı | Savuşturma mekaniği (kalkan okulu), sıçrama saldırıları |
| Hamleler (12, tam koreografiler) | R1'de animasyon referansı; ok atışı, kılıç kombosu, yer yumruğu doğrudan hamle olarak |
| Mermi: sihirli füze, enerji diski, işaret fişeği | Değnek silahı, Arkan okulu, tuzakçı okulu |
| Doğma/ölüm: parçalanma, eriyerek yanma, çağırma, dirilme, portal, yumurta | Canavar aileleri, Nekromant'ın Kemik okulu (çağırma), co-op'ta diriltme |
| Arkan: zaman durdurma, portal, ışın, küre, rün çemberi, şarj | Arkan okulu (Zaman Durdurma ult'u), büyü şarj animasyonları |
| Kutsal: hale, diriliş | Işık okulu, co-op diriltme |
| Gölge: kara delik, tutulma, gölge alevleri, ruh emme | Gölge ve Ruh okulları, Mezar boss'u |
| Durum: dondurulmuş, taşlaşma, uyku, yavaşlama, büyülenme, şaşkınlık | R2'deki yeni durum etkileri |
| Doğa: kaya, deprem | Deprem okulu (Berserker), Druid |
| Hava (11) | Biyomlar, kasabada mevsim etkinlikleri (kar, kiraz çiçekleri) |
| Arayüz (10) | R5 arayüz efektleri (Türkçe metin gerektirenlerde yazı kapatılır) |
| Ganimet (8) | Altın, XP, anahtar, kristal düşmeleri; sandık odaları |
| Geçişler (10) | Kat ve biyom geçişleri, mod değişimleri |
| Yaratıklar (12) | Biyom ortamı ve küçük canavarlar |
| Bilim-kurgu, ateşli silahlar, nükleer | Kullanılmayacak (temaya uymuyor) |

---

## 5. Riskler ve önlemler

| Risk | Önlem |
|---|---|
| Karakter yeniden yapımı çok büyür | Karar A denemesi; eşya görselleri veriyle üretilir, tek tek çizilmez; önce 1 sınıf uçtan uca, sonra diğerleri |
| Büyü sistemi oyunu karmaşıklaştırır | Basit başlangıç (okul + 2 büyü), eğitim görevleri, kodeks; prototip oynanmadan kodlanmaz |
| Denge bozulur (özellikle PvP) | Simülatör, hedef kazanma oranları, PvP'de ayrı denge katsayıları |
| Telefon performansı ve indirme boyutu | Biyom/sınıf bazlı yükleme, WebP, efekt yoğunluğu ayarı, zayıf telefon ölçümü her aşamada |
| Veritabanı değişiklikleri | Her aşama tekrar çalıştırılabilir SQL, gerçek Postgres CI testi, oyuncu verisi silinmez |
| Ses ve ek varlık lisansları | Sadece MIT/CC0 kaynaklar, `assets/CREDITS.md` |

## 6. Sıra ve toplam

R0 → R1 → R2 → R3 → R4 → R5 → R6. R3 ve R4 kısmen paralel yürüyebilir.

Toplam kabaca **35-55 oturum**. Her aşama kendi başına oynanabilir bir sürüm olarak yayınlanır; arada oyun hiçbir zaman yarım kalmaz.

**İlk adım:** R0'daki üç deneme. Önce sanat yönü (Karar A), çünkü karakterlerin yeniden yapılıp yapılmayacağı her şeyi etkiliyor.
