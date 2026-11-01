# pixelfx efektleri: analiz ve yol haritası

Durum: Faz 0-1 bitti (görünüm D). Fazlar sırayla `feature/pixelfx-faz1` dalında yapılıyor (2026-11-01). Kaynak: https://patch-gg.github.io/pixelfx/ (kod: https://github.com/patch-gg/pixelfx). Kapsam: savaş efektleri, mevcut sınıflara yeni beceriler, nadir silah efektleri, yeni sınıflar, dünya ve arayüz efektleri, karakter animasyonu.

## 1. pixelfx nedir?

| Konu | Bulgu |
|---|---|
| **İçerik** | 244 efekt, 21 kategori: hamleler (12 tam saldırı), ateş, patlama, su, buz, şimşek, bilim-kurgu, yakın dövüş, darbe, mermi, doğma/ölüm, arkan, kutsal, gölge, durum (yanma, zehir, donma...), doğa, hava durumu, arayüz, ganimet, geçiş, küçük yaratıklar. |
| **Lisans** | **MIT. Ücretsiz, ticari kullanım dahil serbest.** Tek şart: telif ve lisans metnini dağıttığımız dosyalarda tutmak. İçindeki Sprite Fusion (Hugo Duprez) ve Hollow Crown kodları da MIT. Yalnızca sitedeki yazı tipi lisansa dahil değil; ona ihtiyacımız yok. |
| **Nasıl yapılmış** | Hiç resim yok, her efekt küçük bir JavaScript dosyası (toplam ~2,1 MB kaynak). Piksel tamponuna çiziyor: bir **renk** katmanı ve bir **ışık** katmanı (parlayan şeyler eklenerek üstüne biniyor). Parçacıklar 120 Hz simüle ediliyor, her şey tohumlu (aynı efekt her seferinde aynı oynuyor). |
| **Renk değiştirme** | Her efekt bir `palette` alıyor: aynı ateş mavi, aynı iyileşme pembe yanabilir. Nadirlik renkleri için birebir. |
| **Oyunculuk (acting)** | Karakterli efektler ve 12 hamle, vücudun ne zaman ne yaptığını veri olarak tutuyor: hazırlık pozu, vuruş anı, temas anında donma (hit-stop), ekran sarsıntısı, hedefin geri savrulması, toparlanma. |
| **Çıktı** | İki yol: (a) kodu doğrudan oyunda çalıştırmak, (b) Node aracıyla efekti hazır **sprite sayfasına** (şeffaf PNG + JSON) dönüştürmek. |
| **Bizim için uymayanlar** | Bilim-kurgu (hologram, lazer, jetpack), tabanca, roket, nükleer patlama. Karanlık fantezi temasına uymuyor; kullanmayacağız. |

## 2. Bizim oyunda bugün ne var?

| Alan | Bugünkü durum | pixelfx ile fırsat |
|---|---|---|
| **Hamleler** (`moves.js`) | 7 sınıf, her eşleşme türü için 2-5 hamle, 3 güç kademesi, sınıf başına bir ult. Canavar ve silah türü hamleleri de var. Hepsi veri. | Her hamlenin `fx` alanı bir fonksiyon. Yeni bir yardımcı (`cgPfx('ice/frost-nova', {...})`) ile pixelfx efektleri mevcut sisteme takılabilir. Yapı hazır. |
| **Efektler** (`graphics.js` `CG_VFX`) | Pixi ile çizilen vektör şekiller: yay kesik, halka, kubbe, rün, sütun, aura, parçacık. Bir de Kenney paketinden 10 doku. | Bizimkiler temiz ama sade. pixelfx'te alev, duman, kıvılcım, buz kristali gibi "malzeme" hissi veren detaylar var. |
| **Arena** (`arena.js`) | Ortak savaş sahnesi: yakın dövüşe koşma, mermiler, kamera, hit-stop zaten var. | Vuruş zamanlamasını pixelfx'in `act` verisine göre ayarlayabiliriz. |
| **Durum etkileri** | **Yok.** Yanma, zehir, donma, sersemleme yok. | pixelfx'in "status" kategorisi hazır görseller sunuyor ama bu bir **oyun mekaniği** değişikliği (Faz 6). |
| **Efsanevi eşyalar** | 3 nadirlik (Efsanevi, İlksel Efsanevi, Ethereal), her biri için yuvaya özel benzersiz eşyalar ve pasifler. Görsel olarak sadece portre aurası var. | Her benzersiz eşyaya imza efekti, nadirliğe göre vuruş kıvılcımı, düşen ganimette nadirlik ışını. |
| **Sanat yönü** | 2D boyalı "stil C" (baş ≈ boyun 1/5'i). **Piksel art ve chibi daha önce denendi ve reddedildi**, 3D de reddedildi. | Bkz. bölüm 3: en önemli karar. |
| **Araçlar** | Oyun derleme adımı olmayan düz script'ler. Bu bilgisayarda Node.js var (eskisinde yoktu). | Node'u yalnızca geliştirme aracı olarak kullanırız (efektleri önceden pişirmek). Oyunun kendisi yine derlemesiz kalır. |

## 3. En önemli karar: piksel efekt + boyalı karakter uyumu

pixelfx'in efektleri **piksel art**. Daha önce oyunun karolarını ve karakterlerini piksel art'a çevirmeyi denedik ve beğenmedin; karakterlerde stil C'yi seçtin. **Açıklama (2026-11-01):** o denemeyi beğenmeme sebebi animasyonun akıcı olmaması ve çözünürlüğün çok düşük olmasıydı, piksel art'ın kendisi değil. pixelfx'in akıcı ve detaylı efektleri beğenildi. "Karakter tasarımımızı buna göre yapabiliriz" fikrini iki ayrı parça olarak ele almayı öneriyorum:

1. **Oyunculuğu almak (öneriyorum):** hazırlık pozu, vuruşta donma, hedefin savrulması, 12 kare/sn'lik "kesik" pozlar, toz bulutları, darbe karesi. Bunlar stilden bağımsız; stil C karakterlerimize doğrudan uygulanır ve savaşları çok daha "vurucu" yapar.
2. **Piksel görünümü almak (önce denemeli):** Karakterleri piksel art'a çevirmek, daha önce reddettiğin yöne geri dönmek olur. Önerim karakterleri stil C'de tutmak.

Efektlerin kendisi için üç görünüm seçeneği var. Hangisinin güzel durduğuna gözle karar vermek gerekiyor, bu yüzden **Faz 0'da yan yana deneme sayfası** yapacağız:

| Seçenek | Görünüm | Artı | Eksi |
|---|---|---|---|
| **A. Ham piksel** | Efekt keskin piksellerle, tam sayı katında büyütülmüş. | pixelfx'in tam havası. | Pürüzsüz stil C karakterin yanında "yamalı" durabilir. |
| **B. Yumuşatılmış + ışık** | Renk katmanı hafif yumuşatılır, ışık katmanı toplanarak parlatılır (bloom). | Piksel detayı kalır ama boyalı sahneye kaynaşır. | Biraz daha fazla işlem gücü (düşük kalitede kapatılır). |
| **C. Keskin piksel + parlama** | Pikseller keskin kalır, ışık katmanı yumuşak bir parlama (bloom) olarak eklenir. | pixelfx'in keskinliği + boyalı sahneye uyan sıcak ışık. | B kadar işlem gücü. |
| **D. Yüksek çözünürlük** | Dama deseni yerine gerçek saydamlık + akıllı 4x büyütme (Scale2x iki kez) + parlama. | Basamaklar ve noktalı desen kaybolur; boyalı sahneye en iyi uyan görünüm. | Oyunda GPU filtresi gerekir (bkz. 7b-5). |

Benim tahminim B'nin en iyi sonucu vereceği, ama karar senin gözünle verilmeli.

## 4. Teknik mimari (önerilen)

1. **Efektleri önceden pişirmek, oyunda çizmemek.** pixelfx'i canlı çalıştırmak her karede piksel piksel işlemci çizimi demek; telefonlarda yorucu olur. Bunun yerine bir geliştirme aracı (`tools/make_pixelfx.mjs`, Node) seçtiğimiz efektleri **renk** ve **ışık** olmak üzere iki ayrı sprite sayfasına (WebP) çevirir. Oyunda Pixi bunları hazır animasyon olarak oynatır; ışık sayfası "toplama" karışımıyla çizildiği için gerçekten parlar.
2. **Seçili liste, tek kaynak.** Hangi efektin hangi paletle pişirileceği tek bir listede durur (`tools/pixelfx-list.json`). Araç, `catalog.js` gibi **üretilmiş** bir veri dosyası (`pixelfx-data.js`: kare sayısı, hız, pivot, vuruş zamanları) yazar. Elle düzenlenmez.
3. **pixelfx'i sabit bir sürümde tutmak.** Kodunu belirli bir commit'te `tools/vendor/pixelfx/` altına alırız (lisans dosyasıyla birlikte). Yukarıdaki değişiklikler bizi bozmaz.
4. **Oyun tarafı: tek yeni script** (`pfx.js`, `arena.js`'den sonra). `cgPfx(id, seçenekler)` yardımcısı `moves.js`'te diğer efektler gibi kullanılır. Hit-stop sırasında efekt de donar, ön/arka katman (karakterin önü/arkası) desteklenir.
5. **İndirme boyutu.** Sprite sayfaları ilk açılışta indirilmez; bir sınıfın efektleri o sınıf savaşa girince yüklenir ve service worker'ın çalışma anı önbelleğine alınır. Hedef: toplam ≤ 4 MB, ilk açılışa ek yük yok.
6. **Kalite ayarı.** Mevcut otomatik kalite sistemine bağlanır: düşük kalitede ışık katmanı ve dekoratif efektler kapanır, aynı anda oynayan efekt sayısı sınırlanır.
7. **Lisans.** `assets/CREDITS.md`'ye pixelfx, Sprite Fusion ve Hollow Crown satırları; pişirilmiş dosyaların yanına MIT lisans metni.
8. **Testler.** `moves.js`'te kullanılan her efekt kimliği üretilmiş veride var mı; efekt bitince sahnede sprite kalıyor mu; toplam dosya boyutu bütçede mi; 13 ekran boyutunda yerleşim bozulmuyor mu.

## 5. Sınıf ve efekt eşleştirmesi

### Mevcut 7 sınıf

| Sınıf | Kullanılacak pixelfx efektleri | Ult önerisi |
|---|---|---|
| **Savaşçı** | sword slash, sword combo, heavy cleave, thrust, shield block, parry, hit spark, critical hit, heavy landing | **SHIELD SLAM:** ground pound hamlesi + ground slam şok dalgası + impact frame |
| **Paladin** | holy smite, smite, holy pillar, divine shield, halo, heal, healing ring, blessing, feather burst | **DIVINE JUDGEMENT:** holy pillar + sunburst + feather burst |
| **Berserker** | spin slash, heavy cleave, claw swipe, uppercut, blunt hit, ground pound, rage (aura), life steal | **BLOOD LUST:** rage aurası + art arda double slash + life steal |
| **Haydut** | dagger flurry, double slash, thrust, blink out / blink in, smoke bomb, shadow tendrils, bleeding | **ASSASSINATE:** smoke bomb + blink out → blink in + dagger flurry + critical hit |
| **Okçu** | arrow shot hamlesi, arrow mermisi, ricochet, signal flare, leaf storm, vine whip, root snare | **PIERCING SHOT:** charge up + arrow + impact frame + delip geçen ışık izi |
| **Büyücü** | fireball throw, meteor call, ice lance throw, frost nova, lightning call, chain lightning, arcane missiles, magic circle cast | **ARCANE BLAST:** magic circle cast + arcane beam + mana burst |
| **Nekromant** | necro skulls, soul drain, life steal, grasping hands, curse, hex sigil, summon rise, dark explosion | **SOUL SIPHON:** hex sigil + grasping hands + soul drain |

### Mevcut sınıflara yeni beceriler

İlk aşamada yeni beceriler **görsel çeşitlilik** olarak eklenir: aynı eşleşme, aynı hasar, ama savaşta farklı hamleler dönüşümlü oynar (sistem zaten "aynı hamle üst üste oynamaz" kuralıyla çalışıyor). Denge değişmez, risk düşük. Örnekler:

- **Büyücü:** buz mızrağı (ice lance), zincir şimşek (chain lightning), buz novası (frost nova), arkan füzeler (arcane missiles).
- **Nekromant:** uçan kafatasları (necro skulls), lanet (curse), ruh yükselişi (soul rise).
- **Paladin:** iyileşme halkası (healing ring), ilahi kalkan (divine shield), kutsama (blessing).
- **Haydut:** duman bombası (smoke bomb), gölge dokunaçları (shadow tendrils).
- **Okçu:** sekme atışı (ricochet), kök tuzağı (root snare), yaprak fırtınası (leaf storm).

Gerçek oyun etkisi olan beceriler (donma, zehir vb.) Faz 6'daki durum etkileri sistemi gelince açılır.

### Yeni sınıf önerileri

pixelfx'in güçlü olduğu ama hiçbir sınıfımızın kullanmadığı kategoriler:

| Sınıf | Tema | Efektler | Not |
|---|---|---|---|
| **Druid** | Doğa, şifa, kökler | vine whip, thorns, root snare, healing bloom, poison cloud, earth spike, boulder, quake, tornado | İyileştirici + zehir. Co-op için çok iyi bir destek sınıfı. |
| **Fırtına Çağırıcı** | Şimşek | ball lightning, chain lightning, storm cloud, thunderclap, charge up, electrified, lightning strike | Büyücüden ayrışsın diye: ult dolumu ve zincirleme kombo odaklı. |
| **Simyacı** | Bomba, asit, iksir | grenade, barrel explosion, acid splash, smoke bomb, toxic puddle, potion | Bilim-kurgu yerine fantezi "patlayıcı" sınıfı. |
| **Buz Cadısı** (alternatif) | Buz | ice spikes, icicle fall, blizzard vortex, freeze, ice shatter | Büyücünün buz dalı ile çakışabilir; Druid veya Fırtına Çağırıcı'dan sonra düşünülmeli. |

Yeni sınıf büyük iş: sınıf tanımı ve dengesi, stil C karakter çizimi (gövde, kıyafet, silah), tüm hamleler ve ult, Türkçe/İngilizce metinler, testler. Ayrıca veritabanında `characters.class_key` için izin verilen sınıflar listesi var; değişiklik **`schema.sql`'in Supabase'de yeniden çalıştırılmasını** gerektirir.

## 6. Nadir silah ve eşya efektleri

1. **Nadirliğe göre vuruş efekti (her silah):** Mavi: küçük kıvılcım. Sarı: parlak kıvılcım. Efsanevi: alevli vuruş + kor. İlksel Efsanevi: critical hit + ekran sarsıntısı. Ethereal: arkan parıltı. Hepsi aynı efektin farklı paletle pişirilmiş hali.
2. **Benzersiz eşyalara imza efekti:** pasif tetiklendiğinde oynar. Örnekler:
   - **Dünya Yiyen:** kafatası hasarında dark explosion.
   - **Fırtına Kartalı Omuzluğu:** kılıç vuruşunda chain lightning.
   - **Yıldız Düşüren Miğfer:** ult'ta star fall.
   - **Kıyamet Kanatları:** meteor.
   - **Zaman Adımı:** time stop.
   - **Hiçliğin Fısıltısı:** void orb.
   - **Gölge Örtüsü:** shadow flames.
   - **Ejderha Yürek Zırhı:** fire breath.
   - **Sonsuzluk Kalkanı:** divine shield.
3. **Ganimet anı:** düşen eşyada nadirlik renginde loot beam, sandık açılışında chest open, altında coin collect. Efsanevi düşünce ekstra confetti ve achievement.

## 7. Dünya, canavarlar ve arayüz

- **Canavarlar:** girişte spawn portal; ölümde poof (normal), shatter death (zırhlı), dissolve burn (boss), soul rise (ruh emici). Boss öfkelenince rage aurası.
- **Arena süsleri:** zindanda torch, brazier, candle, fog; arka planda bat, flying skull, wisp gibi küçük yaratıklar (düşük kalitede kapalı).
- **Kasaba:** fireflies, falling leaves, god rays; mevsim etkinliklerinde snow ve cherry blossoms.
- **Arayüz:** level up, achievement, quest complete, combo counter, crit number. Kat geçişlerinde burn away veya shatter wipe.
- **Tahta (dikkatli):** büyük kombolarda collect burst. Tahta mobilde en hassas yer; sadece yerleşimi ve FPS'i bozmadığı kanıtlanırsa.

## 7b. Faz 0 bulguları

Deneme sayfası: `tools/pixelfx-study.html` (pixelfx kodu `tools/vendor/pixelfx/`, sabit sürüm).

1. **Işık katmanı ve şeffaf arena.** Arenanın arka planı WebGL sahnesinde değil, arkadaki CSS katmanında; canvas şeffaf. Işığı düz "toplama" ile çizmek şeffaf zeminde koyu, opak lekeler bırakıyordu. Çözüm (pixelfx'in kendi yöntemi): ışığın şeffaflığı en parlak renk kanalı olur, sonra toplanarak çizilir. Oyunda da aynısı gerekli.
2. **Kukla yerine kendi karakterimiz.** Vücuda sarılan efektler (iyileşme, aura, buz, vuruş) pixelfx kuklasının siluetini kullanıyor ve bazıları kuklanın renklerini karakterin üstüne boyuyor (kahramanın yerine gri kukla görünüyordu). Çözüm: savaşçımızın ekrandaki görüntüsünden piksel ölçeğinde siluet çıkarıp efekte o veriliyor. Renk dizisi tamamen şeffaf bırakılıyor; böylece efekt karakteri boyamıyor, sadece etrafına sarılıyor ve kahraman pürüzsüz kalıyor. Durum efektleri (donma, zehir) karakteri boyamaya dayandığı için Faz 6'da ayrıca ele alınmalı.
3. **Performans.** Canlı çizim, güçlü bir masaüstünde: tek vuruş kıvılcımı 0,1 ms/kare, buz novası 2,2 ms, üç ağır efekt birden (buz novası + kutsal sütun + büyük patlama) 14 ms (sınır 16,7 ms). Telefonda bu birkaç kat yavaş olur. **Oyunda efektler önceden pişirilmiş sprite sayfası olarak oynatılmalı** (bölüm 4'teki plan doğrulandı).
5. **Daha kaliteli görünüm (D).** Kullanıcı geri bildirimi: efektler hâlâ "piksel piksel" görünüyor. İki kaynağı var:
   - **Desenli saydamlık:** pixelfx yarı saydam her şeyi (duman, solma, kenarlar) 4x4 dama deseniyle çiziyor. D'de bunun yerine çizim motorunun kendi gerçek saydamlık fonksiyonu kullanılıyor; duman ve parıltılar yumuşak bulutlara dönüşüyor.
   - **Basamaklı kenarlar:** Scale2x (EPX) algoritması iki kez uygulanıyor (4x). Çapraz kenarlar ve eğriler bulanıklaşmadan pürüzsüzleşiyor.
   - Canlı maliyeti C'nin ~2 katı (tek efekt 2 ms, üç ağır efekt 18 ms). 4x pişirilmiş sayfalar 16 kat büyük olacağı için oyunda şöyle yapılmalı: efektler **1x, desensiz** pişirilir, 4x büyütme Pixi'de bir **GPU filtresiyle** (Scale2x/xBR gölgelendiricisi) yapılır. İndirme boyutu ve telefon yükü küçük kalır.
6. **Boyut.** Arenada karakterler telefonda ~120, masaüstünde ~150 piksel boyunda; pixelfx'in kuklası 38 piksel. Efektlerin karakterle orantılı durması için ~2,5-3x piksel büyütme gerekiyor. Deneme sayfasında 1,5x-4x arası seçilebiliyor.

## 8. Fazlar

Her faz ayrı bir dalda yapılır, GitHub Pages o dala çevrilir, sen test edip onay verince `main`'e alınır.

### Faz 0: Deneme ve karar (küçük)
- Deneme sayfası (`tools/pixelfx-study.html`): gerçek arenada stil C kahramanımızın yanında 6 efekt (sword slash, fireball throw, frost nova, holy pillar, soul drain, loot beam), 3 görünümde (A / B / C).
- Telefonda FPS ve dosya boyutu ölçümü.
- **Karar kapısı:** görünüm seçimi. Beğenmezsen burada durur, sadece oyunculuk fikirlerini alırız.

### Faz 1: Altyapı
- `tools/make_pixelfx.mjs` pişirme aracı, efekt listesi, üretilmiş `pixelfx-data.js`, `pfx.js` oynatıcısı.
- Hit-stop ve kalite sistemine bağlama, tembel yükleme ve önbellek, lisans/emek notları, testler.
- Görünür sonuç: tek bir hamle (ör. Büyücü'nün ateş topu) yeni efektle.

**Faz 1 yapılanlar (v1.42):** `tools/make_pixelfx.mjs` + `tools/pixelfx-list.json` (pişirme), `assets/fx/*.png` ve üretilmiş `pixelfx-data.js`, `pfx.js` (oynatıcı: D görünümü tek GPU gölgelendiricisinde, ışık + yumuşak parlama, vuruş donmasına uyar, düşük grafikte kapalı, görsel yüklenmeden eski efekt). Büyücü'nün iki ateş topu hamlesi (`m.fireball`, `m.fire`) pişirilmiş ateş topu + küçük patlamayla oynuyor. Geliştirici sayfası: `tools/pfx-preview.html`. 3 yeni test. Henüz yok: sınıf başına tembel yükleme (şimdilik 3 efekt, ~0,9 MB, sayfa boşalınca hepsi yükleniyor) ve vücuda sarılan efektler için kendi karakter siluetimiz (pişirmede kuklanın şekli kullanılıyor).

### Faz 2: Mevcut sınıfların efektleri
- Önce 7 ult, sonra kademe 3 bitirici hamleler, sonra kademe 2 ve 1.
- Oyunculuk iyileştirmesi aynı fazda: hazırlık pozu, vuruşta donma, hedefin savrulması, toz.

**Faz 2 yapılanlar (v1.43):** 43 pişirilmiş efekt (~8,6 MB toplam; oyuncu yalnızca kendi sınıfınınkini indirir, ~1-2,5 MB). `moves.js` `CG_PFX_MOVES`: 7 sınıfın 7 ult'u ve 110+ hamle/efekt eşleşmesi (kılıç/kafatası saldırıları, kalkan/kalp/enerji güçlendirmeleri). Yeni mermiler: `pfxarrow` (ok + kıvılcım), `pfxshard` (buz mızrağı + kırılma), `pfxshadow` (gölge küresi + karanlık patlama). Efektin çarpma karesi oyunun hasar anına denk getiriliyor (gerekirse efekt baştan kırpılarak); pixelfx hamlesinde eski vektör parlaması/yer çatlağı oynamıyor, hit-stop ve sarsıntı kalıyor. Pişirmede: soluk ışık atılıyor, ışık 4'lü adımlarla saklanıyor, uzun efektler 20 fps. "Impact frame" (tam ekran siyah-beyaz hız çizgileri) arenayı kapladığı için çıkarıldı. Oyunculuk (hazırlık pozu, donma, savrulma) bizim rig'de zaten vardı; ayrıca değiştirilmedi.

### Faz 3: Yeni beceriler (görsel çeşitlilik)
- Bölüm 5'teki listeden her sınıfa 2-4 yeni hamle. Denge değişmez.

**Faz 3 yapılanlar (v1.44):** 16 yeni hamle (Savaşçı: kasırga, çekiç düşüşü; Berserker: pençe, deprem; Haydut: kayboluş, zehir bulutu; Okçu: seken ok, kök tuzağı, diken dalgası; Büyücü: buz dikenleri, arkan füzeler, yıldız yağmuru; Nekromant: gölge dokunaçları, lanet; Paladin: altın kılıç, güneş patlaması). Hasar ve denge aynı: aynı eşleşmenin hamle listesine eklendiler, oyun aralarından seçiyor. Her birinin vektör yedeği var. 14 yeni pişirilmiş efekt; Paladin'in altın kılıç yayı pixelfx paletiyle (aynı efekt, farklı renk). Toplam 12 MB (sınıf başına ~1,5-3 MB).

### Faz 4: Nadir silah ve eşya efektleri
- Nadirliğe göre vuruş efekti, benzersiz eşya imza efektleri, ganimet ışını ve sandık.

### Faz 5: Dünya, canavarlar ve arayüz
- Canavar doğuş/ölüm, arena süsleri, kasaba havası, seviye/başarım/görev efektleri, kat geçişleri.

### Faz 6: Durum etkileri (oyun mekaniği)
- Yanma, zehir, kanama (tur başı hasar); donma, sersemleme (tur kaybı); yavaşlama.
- Solo, PvP ve co-op'ta aynı kurallar; PvP'de iki tarafın senkron kalması; denge ve testler.
- Bazı yeni beceriler ve efsanevi pasifler bu etkileri kullanmaya başlar.
- En riskli faz: savaş matematiği ve PvP değişir.

### Faz 7: Yeni sınıflar
- Her sürümde bir sınıf: önce Druid, sonra Fırtına Çağırıcı, sonra Simyacı.
- Her sınıf için stil C karakter tasarımı (yan yana önizlemeyle onay), hamleler, ult, denge, metinler, testler.
- `schema.sql` değişikliği ve Supabase'de yeniden çalıştırma.

### Faz 8 (isteğe bağlı): Kendi efektlerimiz
- pixelfx'in Claude Code becerisiyle temamıza özel yeni efektler: benzersiz eşyaların imza efektleri ve yeni sınıfların ult'ları.

## 9. Riskler

| Risk | Önlem |
|---|---|
| Piksel efektler boyalı karakterlerle uyumsuz durur | Faz 0'da gözle karar; uymazsa sadece oyunculuk alınır. |
| Telefonda yavaşlama | Önceden pişirilmiş sayfalar, kalite sistemi, eşzamanlı efekt sınırı, 13 ekran boyutu testi. |
| İndirme boyutu | Tembel yükleme, WebP, efekt başına boyut bütçesi. |
| Durum etkileri dengeyi ve PvP'yi bozar | Ayrı faz, önce solo, sonra PvP; kapsamlı testler. |
| Yeni sınıf, veritabanı değişikliği ister | Her sınıf ayrı sürüm; SQL'in yeniden çalıştırılması açıkça belirtilir. |
| pixelfx güncellenir, bir şey bozulur | Sabit sürüm (vendor), güncelleme bilinçli yapılır. |
