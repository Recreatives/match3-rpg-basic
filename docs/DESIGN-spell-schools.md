# Büyü okulları: tasarım (yol haritası 2.0, R0 / Karar B)

Durum: taslak, kullanıcı onayı bekliyor (2026-11-01). Amaç: aynı sınıfın farklı büyülerle **gerçekten farklı oynanması**. Bugün hamleler sadece görsel; hasarı taşlar belirliyor.

## 1. Bugünkü kurallar (temel)

| Taş | Ne yapar |
|---|---|
| ⚔️ Kılıç | Rakibe `sword × çarpan` hasar |
| 💀 Kafatası | Rakibe büyük hasar, kendine geri tepme |
| 🛡️ Kalkan | Zırh |
| 💖 Kalp | İyileşme |
| ⚡ Enerji | Ult dolumu |

- **Çarpanlar:** 3'lü ×1, 4'lü ×2 (+ekstra tur), çapraz ×2,5, 5'li ×3. Zincirleme eşleşmeler ve hız bonusu da çarpanı etkiler.
- **Ult:** %100'de kullanılır, turu bitirir.
- **Durum etkileri** (yanma, zehir, kanama, sersemleme, zayıflık) her üç modda çalışıyor.

## 2. Önerilen sistem

### 2.1 Okul
- Her sınıfın **3 okulu** var. Karakter **5. seviyede** bir okul seçer; o zamana kadar sınıfın bugünkü hali oynanır.
- Okul **kasabada altınla** değiştirilebilir (ilk değişim ücretsiz).
- Okul üç şeyi değiştirir:
  1. **Taş kuralları:** 1-2 pasif kural. Örneğin Ateş Büyücüsü'nün kafatası eşleşmesi %25 ihtimalle yakar.
  2. **Büyü listesi:** 4 aktif büyü; 2'si yuvaya takılır.
  3. **Ult:** Okula özel ult, sınıfın bugünkü ult'unun yerine geçer.
- Hamle animasyonları ve efektler de okula göre değişir: Ateş Büyücüsü'nün kılıç eşleşmesi ateş topu, Buz Büyücüsü'nünki buz mızrağı.

### 2.2 Mana ve büyüler

**Mana:** 0-100 arası, ult'tan ayrı ikinci bir çubuk.

| Seçenek | Kural | Artı | Eksi |
|---|---|---|---|
| **M1 (önerim)** | Eşleşen her taş +1 mana; 4'lü eşleşme +3, 5'li +6 bonus | Ult dolumu bugünkü gibi kalır; anlaşılır | Mana her taştan gelir, taş seçimini daha az değiştirir |
| M2 | Her okulun mana taşı var (Ateş: kafatası, Buz: kalkan...) | Okul, hangi taşa gideceğini değiştirir (derinlik) | Taşın kendi etkisiyle çakışır, öğrenmesi zor |

**Büyüler:**
- Bir büyüyü kullanmak **turu bitirir** (ult gibi); bazı büyüler "hızlı"dır ve turu bitirmez.
- Bekleme süresi yok; kısıtı mana sağlar.
- **Açılış:** 5. seviyede 2 büyü, 10'da 3., 15'te 4.; 20'de okul ustalığı (pasif güçlenir).
- **Yetenek ağacı:** Bugünkü sistemle birleşir: her okulun 6-8 düğümlük küçük bir dalı olur.

### 2.3 Yeni durum etkileri

| Etki | Kural | pixelfx |
|---|---|---|
| ❄️ Dondurma | Hedef 1 tur kaçırır (prototipte var) | status/frozen, ice/ice-shatter |
| 🐌 Yavaşlama | Hedefin hasarı -%15; zayıflıkla çarpılarak birikir (prototipte var) | status/slowed |
| 🗿 Taşlaşma | Hedef 1 tur kaçırır ama o tur hasarın %50'sini almaz | status/petrified |
| 💤 Uyku | Hedef vurulana kadar tur kaçırır (en fazla 3 tur) | status/sleep |
| 💗 Büyülenme | Hedefin bir sonraki saldırısının %50'si kendine döner | status/charmed |
| ❓ Şaşkınlık | Hedefin bir sonraki eşleşmesi %50 ihtimalle boşa gider | status/confused |

## 3. Büyücü'nün üç okulu (tam örnek)

Sayılar ilk taslaktır; denge simülatörüyle ayarlanacak. `U` = `ult_dmg` (bugün 35'ten başlar), `H` = kalp gücü.

### 🔥 Ateş
- **Taş kuralları:** Kafatası eşleşmesi %25 ihtimalle 2 tur yakar. Yanan düşmana kılıç hasarı +%20.
- **Büyüler:**

| Büyü | Mana | Etki | Efekt |
|---|---|---|---|
| Ateş Topu | 30 | 0,7U hasar | fire/fireball → small-explosion |
| Kıvılcım (hızlı) | 15 | 3 tur yanma, turu bitirmez | status/burning |
| Alev Duvarı | 40 | Sonraki 2 düşman saldırısı -%40, saldıranı yakar | fire/fire-ring |
| Ateş Yağmuru | 60 | 3 × 0,4U, her biri yanma tazeler | fire/meteor ×3 |

- **Ult — Meteor Yağmuru:** 1,8U hasar + 3 tur yanma. Efektler: arcane/magic-circle-cast, fire/meteor, explosions/big-explosion.

### ❄️ Buz
- **Taş kuralları:** Kılıç eşleşmesi %20 ihtimalle 2 tur yavaşlatır. Yavaş veya donmuş düşmana kılıç hasarı +%20.
- **Büyüler:**

| Büyü | Mana | Etki | Efekt |
|---|---|---|---|
| Buz Mızrağı | 25 | 0,6U hasar, yavaşlatır | ice/ice-lance → ice-shatter |
| Dondur | 50 | 1 tur dondurma | status/frozen, ice/freeze |
| Buz Zırhı (hızlı) | 35 | Zırh = 3× kalkan gücü | holy-divine-shield (buz paleti) |
| Tipi | 60 | 1,0U hasar + 2 tur yavaşlama | ice/blizzard-vortex |

- **Ult — Mutlak Sıfır:** 1,2U hasar + 1 tur dondurma + 3 tur yavaşlama. Efektler: ice/frost-nova, ice/icicle-fall.

### ✨ Arkan
- **Taş kuralları:** Enerji eşleşmesi +5 ek mana. Her 3. büyü manasızdır.
- **Büyüler:**

| Büyü | Mana | Etki | Efekt |
|---|---|---|---|
| Arkan Füzeler | 25 | 3 × 0,25U | arcane/arcane-missiles |
| Mana Kalkanı | 40 | 2 tur boyunca gelen hasarın yarısını mana öder | arcane/rune-circle |
| Zaman Bükme | 55 | Ekstra tur | arcane/time-stop (kısa) |
| Arkan Patlama | en az 20, tüm mana | Mana × 0,02U hasar | arcane/mana-burst + arcane-beam |

- **Ult — Zaman Durdurma:** 0,8U hasar + ekstra tur. Efekt: arcane/time-stop.

## 4. Diğer sınıflar (ana hat)

| Sınıf | Okul 1 | Okul 2 | Okul 3 |
|---|---|---|---|
| Savaşçı | **Silah Ustası:** kılıç kombosu, kritik | **Kalkan Muhafızı:** savuşturma (impacts/parry), geri yansıtma | **Savaş Narası:** takıma/kendine güç, sersemletme |
| Paladin | **Işık:** iyileşme, hale (holy/halo) | **Koruma:** ilahi kalkan, diriliş (co-op) | **Ceza:** kutsal sütun, zayıflatma |
| Berserker | **Öfke:** can azaldıkça hasar | **Kan:** kanama, can çalma | **Deprem:** yer sarsıntısı, kaya (nature/boulder, quake) |
| Haydut | **Gölge:** ışınlanma, kritik | **Zehir:** zehir istifi | **Çeviklik:** savuşturma, ekstra tur |
| Okçu | **Keskin Nişancı:** delici atış | **Doğa Avcısı:** kök, yaprak | **Tuzakçı:** işaret fişeği, patlayıcı ok |
| Büyücü | Ateş | Buz | Arkan |
| Nekromant | **Kemik:** iskelet çağırma (spawn/summon-rise) | **Ruh:** ruh emme (shadow/soul-drain), lanet | **Veba:** zehir bulutu, salgın |
| Druid | **Şifa:** çiçek, yenilenme | **Diken:** diken, kök | **Gelgit:** dalga, girdap, su topu (su efektleri) |
| Fırtına Çağırıcı | **Şimşek:** zincir, şok | **Rüzgar:** kasırga, savurma | **Tipi:** buz + şimşek, dondurma |
| Simyacı | **Patlayıcı:** bomba, fıçı | **Zehir:** asit, bulut | **İksir:** iyileşme, güçlendirme, büyülenme iksiri |

## 5. Arayüz
- **Büyü çubuğu:** Arenanın altında 2 büyü düğmesi (simge, ad, mana bedeli; yetmiyorsa soluk) ve mana çubuğu.
  - Telefonda ULT düğmesinin yanında, tek dokunuşla kullanılır.
  - Geniş ekranda sol sütunda.
- **Büyü kitabı (kasaba):** Okul seçimi, büyü yuvaları, her büyünün canlı önizlemesi (pixelfx).
- **Durum ve büyü açıklamaları:** Dokununca kısa açıklama.
- **İlk okul seçimi:** 5. seviyede, üç okulun kısa canlı tanıtımı.

## 6. Sunucu ve güvenlik
- Yeni alanlar: `characters.school` ve `characters.spell_loadout`. Sadece güvenli fonksiyonlarla değişir:
  - `set_school`: seviye ≥ 5; altın bedeli `earn/spend` gibi sınırlı.
  - `set_loadout`: büyü açık mı, seviye yeterli mi kontrol edilir.
- Büyü sonuçları (hasar, durum) bugünkü gibi istemcide hesaplanır; PvP'de her taraf kendi canının sahibi modeli sürer.
- `schema.sql` değişir; tekrar çalıştırılabilir, mevcut karakterler okulsuz başlar ve 5. seviyenin üstündeyse ilk girişte seçer.

## 7. PvP ve co-op
- Büyüler ult gibi yayınlanır (`spell` olayı); durumlar bugünkü `status-apply` yolunu kullanır.
- Co-op'ta düşmana etki eden büyüler, düşmanın sahibi olan ev sahibine gider.
- PvP'ye ayrı denge katsayıları (ör. sersemletme/dondurma süreleri PvP'de kısa).

## 8. Denge hedefleri (simülatörle)
- Her okulun 1-20. katlarda kazanma oranı, sınıf ortalamasının ±%5'i içinde.
- Ortalama savaş süresi 6-12 tur.
- PvP: aynı seviyede hiçbir okul eşleşmesi %60'ı geçmesin.

## 9. Prototip (R0, yapıldı)
- **Nasıl denenir:** Oyunu `?okul=ates`, `?okul=buz` veya `?okul=arkan` ile aç, Büyücü seç. Bayrak yoksa oyun hiç değişmez.
- **Kapsam:** Sadece Büyücü, sadece solo. Okul seçimi, kayıt, kasaba ekranı ve PvP/co-op yok.
- **Büyüler:** Denenebilsin diye 4 büyünün hepsi görünür; tasarımda 2'si yuvaya takılır.
- **Kod:** `spells.js` (okullar, mana, büyüler); `status.js`'e donma ve yavaşlama eklendi; `game.js`'e birkaç kanca. Testler: `combat.spec.js` "Spell schools".
- **Görseller:** Büyüler mevcut Büyücü hamle animasyonlarını kullanır; okula özel yeni animasyonlar R2'de.
- **Sonra:** Oynayıp karar ver: eğlenceli mi, anlaşılır mı, mobilde rahat mı? Onaylanırsa R2'de tüm sınıflara.
