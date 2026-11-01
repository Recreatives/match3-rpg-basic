# Ekran yönü: dikey mi, yatay mı?

Tarih: 2026-11-01. Ölçümler oyunun gerçek sayfasından (test dünyası, solo savaş, Büyücü), CSS pikseli.

## 1. Bugün ne var?

- Oyun **dikey öncelikli** tasarlanmış: yüklenen uygulama (PWA) `manifest.json`'da dikeye kilitli.
- Yatay da destekleniyor: kısa yatay ekranlarda (yükseklik ≤ 600 px) iki sütuna geçiyor; solda arayüz ve arena, sağda tahta.
- Masaüstü ve tablette dikey düzen ortada dar bir sütun olarak gösteriliyor.
- Yerleşim testleri 13 ekran boyutunda iki yönü de kontrol ediyor.

| Ekran | Arena (G x Y) | Karakter boyu | Tahta | ULT düğmesinin altında boş kalan |
|---|---|---|---|---|
| Telefon dikey 390x844 | 380 x 154 | 112 | 375 | **~150 px** |
| Küçük telefon dikey 360x640 | 350 x 133 | 91 | 253 | ~90 px |
| Telefon yatay 844x390 | 456 x 152 | 110 | 368 | ~100 px (sol sütun) |
| Küçük telefon yatay 640x360 | 282 x 143 | 101 | 338 | ~60 px |
| Dizüstü 1366x768 | 400 x 153 | 111 | 371 | ekranın 2/3'ü boş (yanlar) |

**Gözlemler:**
1. Tahta iki yönde de neredeyse aynı büyüklükte. Yatay çevirmek tahtayı büyütmüyor.
2. Arena her yerde yaklaşık 150 px yüksekliğinde. Yeni efektlerin (patlama, sütun, nova) asıl sınırı bu yükseklik.
3. Uzun telefonlarda (19,5:9, bugünkü telefonların çoğu) dikeyde **150 px boş alan** var. Arena bunu kullanmıyor.
4. Yatay, büyük telefonda arenayı genişletiyor (456 px), ama küçük telefonda daraltıyor (282 px).
5. Masaüstü ekranın büyük kısmını boşa harcıyor.

## 2. Karşılaştırma

| Konu | Dikey | Yatay |
|---|---|---|
| Tek elle oynama | ✓ Başparmakla rahat | ✗ İki el gerekir |
| Tür alışkanlığı (mobil eşleştirme oyunları) | ✓ Neredeyse hepsi dikey | Nadir (PC/konsol sürümleri) |
| Tahta büyüklüğü | Aynı | Aynı |
| Arena / efektler | Dar ama uzun telefonda büyütülebilir | Büyük telefonda geniş, küçükte dar |
| Sohbet, mesaj, klan (klavye açılınca) | ✓ Ekranın yarısı kalır | ✗ Klavye ekranın çoğunu kaplar |
| Envanter, kasaba, müzayede pencereleri | ✓ Bugün bunlara göre tasarlı | Yeniden düzenleme gerekir |
| PvP / co-op | ✓ Bugün bunlara göre tasarlı | Var ama sıkışık |
| Masaüstü / tablet | ✗ Dar sütun | ✓ Doğal yön |
| İş yükü | Küçük iyileştirmeler | Tüm ekranların yeniden tasarımı |

## 3. Öneri

**Telefonda dikey kalalım, ama ekranı daha iyi kullanalım; masaüstü ve tablette yatay düzene geçelim.**

1. **Telefon: dikey (ana yön).** Tek elle oynama, tür alışkanlığı, sosyal özellikler ve bugünkü tüm pencereler dikeye uygun. PWA kilidi kalır.
2. **Dikeyde arenayı büyütmek.** Uzun telefonlarda ULT düğmesinin altında kalan ~150 px'i arenaya vermek. Arena 154 px'ten ~250 px'e çıkar, karakterler ve efektler belirgin şekilde büyür. Küçük telefonlarda bugünkü gibi kalır (taşma kuralı korunur).
3. **Masaüstü ve tablet (geniş yatay ekran): iki sütunlu "geniş düzen".** Solda büyük arena (ör. 700 x 400) ve bilgi çubukları, sağda tahta. Telefonda yatay için zaten var olan iki sütun düzeninin büyük ekran sürümü. Yeni efektler en çok burada parlar.
4. **Telefonda yatay: desteklenmeye devam.** Biri telefonu çevirirse oyun çalışır, ama hedef yön değil.

Maliyet: 2. madde küçük (CSS + yerleşim testleri). 3. madde orta (ana ekran ve savaş pencereleri için geniş düzen). Tamamen yataya geçmek ise büyük bir iş ve telefonda kazandırdığından fazlasını kaybettirir.

## 4. Uygulandı (v1.50)

Kullanıcı öneriyi onayladı.
- **Dikey telefon:** Tahtanın altında kalan boş yükseklik (en fazla 110 px) arenaya veriliyor (`--arena-extra`). 390x844'te arena 154 → 222 px, 412x915'te 270 px; 360x640'ta değişiklik yok.
- **Geniş yatay ekran** (en az 900 x 601): iki sütun - solda büyük arena (1366x768'de 680x341, 1920x1080'de 860x341), sağda büyük tahta (637-648 px). Sol sütun en fazla 860 px, ikisi ortada. Büyük arena yalnızca solo ekranda; PvP/co-op pencereleri kendi dar düzenini koruyor.
- 13 boyutluk yerleşim testleri (solo, PvP, co-op) geçiyor; pixelfx efektleri büyük arenada en fazla 5x piksel büyüklüğüne çıkıyor.
- **v1.53, kullanıcı geri bildirimi** ("yatay olunca garip, ama büyük ekranda savaş güzel"): üst çubuk iki sütunun üstünde tam genişlikte bir başlık satırı oldu (sürüm solda, düğmeler sağda); sol sütun tahtayla aynı yükseklikte bitiyor ve aradaki her piksel arenaya gidiyor (`--wide-left-chrome`). 1366x768'de arena 680x341 → 680x500, 1920x1080'de 860x512.
