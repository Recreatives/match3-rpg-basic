# Dosya bütçesi R0 (2026-11-01)

## Bugün
- Toplam: 102 efekt, `assets/fx/` altında **15,2 MB** (bu çalışmadan önce 16,0 MB).
- **Işık katmanları** (fl/bl) toplamın yaklaşık **%65'i**.
- Tembel yükleme çalışıyor. Oyuncu sadece kendi sınıfının, karşılaştığı canavarın ve kuşandığı eşyaların efektlerini indirir. Testlerde ön yükleme kapalı (`PFX_NO_PRELOAD`).

İlk savaşta indirilen miktar (ortak paket + sınıf):

| Ortak (sandık, ganimet ışını, seviye, durumlar) | 1,1 MB |
|---|---|
| Okçu / Haydut | 1,0-1,1 MB |
| Fırtına Çağırıcı / Berserker | 1,3-1,5 MB |
| Druid / Nekromant / Savaşçı / Simyacı | 1,8-1,9 MB |
| Paladin | 2,9 MB |
| **Büyücü** | **4,4 MB** (16 efekt; meteor, arkan füzeler, buz dikenleri çok büyük) |

Buna canavarın efektleri eklenir. Telefonda Büyücü ile ilk savaş yaklaşık 5,5 MB indirir. Efektler gelene kadar eski vektör efektler oynar; oyun beklemez.

## Bu turda yapılanlar
- **Kayıpsız PNG filtresi** (`tools/make_pixelfx.mjs`): Her sayfa altı farklı filtreyle sıkıştırılır, en küçüğü seçilir.
  - Sonuç: 16,0 → 15,2 MB (%5).
  - Pikseller birebir aynı; tarayıcıda eski ve yeni dosyalar karşılaştırılarak doğrulandı.
- **Durum efektleri:** `status-frozen` ve `status-slowed` eklendi (büyü okulları için, ~70 KB).

## Ölçülen ama yapılmayanlar (karar gerekiyor)
- **WebP:** Tarayıcıda denendi.
  - Kayıpsız ayar (q1) PNG'den büyük çıktı.
  - Kayıplı q0,9 büyük ışık sayfalarında %40-45 küçültüyor (ör. 360 → 199 KB). Küçük sayfalarda ise büyütüyor.
  - Renk katmanlarında kullanılamaz: D görünümü (Scale2x) piksellerin birebir aynı renkte olmasına dayanır, kayıplı sıkıştırma bunu bozar.
  - Sadece ışık katmanlarına uygulanırsa toplam ~%25-30 düşer (15 → ~11 MB).
  - Engel: Node'da WebP kodlayıcı yok. Bir kerelik tarayıcı aracı ya da Pillow gibi bir kütüphane gerekir.
- **Işık katmanı yarım çözünürlük:** Daha büyük kazanç (~%45), ama ışık katmanı keskin modda da çiziliyor. Parlak çekirdekler kabalaşır, görsel kayıp olur.
- **Büyücü'yü hafifletme:** En büyük efektlerde fps 20 → 15 ya da daha kısa süre (`maxSec`) en kolay kazanç. Görünür fark küçük, R1'de efekt efekt bakılmalı.

## Öneri
1. R1'de en büyük 10 sayfaya `maxSec`/`fps` ayarı (Büyücü 4,4 → ~3 MB).
2. Sadece ışık katmanları için WebP, ancak görsel karşılaştırma sayfasıyla birlikte.
3. İsteğe bağlı: Service worker ilk açılışta oyuncunun sınıf efektlerini arka planda önbelleğe alsın. Şu an ilk kullanımda iniyorlar.
