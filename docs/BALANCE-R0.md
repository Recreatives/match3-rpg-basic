# Denge ölçümü R0 (2026-11-01)

Araç: `tests/balance.html` (yerel sunucuda aç). Gerçek oyunu bir botla oynatır; sunucusuz, sabit tohumlu, sahte saatli. 1300 savaş 97 saniye sürdü.

Ayarlar:
- `floors=1,3,5,8,10`, `runs=20`.
- Kahraman seviyesi = kat; **ekipman yok** (yalnızca sınıfın kendisi).
- Bot taş hamlesinden önce 2,5 sn düşünür (hız bonusu buna göre).
- Bot önceliği: ult doluysa ult; okul varsa gücü yeten en pahalı büyü; yoksa en iyi taş hamlesi.

## Kazanma oranı

| Sınıf | Kat 1 | Kat 3 | Kat 5 (boss) | Kat 8 | Kat 10 (boss) | Ortalama |
|---|---|---|---|---|---|---|
| Berserker | 100 | 95 | 75 | 90 | 55 | **83** |
| Archer | 100 | 100 | 75 | 95 | 35 | 81 |
| Rogue | 100 | 100 | 70 | 90 | 40 | 80 |
| Alchemist | 100 | 100 | 65 | 100 | 35 | 80 |
| Paladin | 100 | 95 | 80 | 95 | 20 | 78 |
| Druid | 100 | 100 | 60 | 95 | 35 | 78 |
| Stormcaller | 100 | 100 | 65 | 90 | 35 | 78 |
| Necromancer | 100 | 95 | 70 | 75 | 35 | 75 |
| Warrior | 100 | 95 | 60 | 75 | 25 | 71 |
| Mage | 100 | 95 | 50 | 85 | 10 | 68 |
| Mage: Ateş | 100 | 100 | 45 | 85 | 10 | 68 |
| Mage: Buz | 100 | 100 | 55 | 85 | 0 | 68 |
| Mage: Arkan | 100 | 95 | 35 | 60 | 10 | **60** |

## Bulgular

1. **Savaşlar kısa.** Normal katlarda 2-7 oyuncu turu sürüyor; hedef 6-12 tur. Zincirleme eşleşmeler ve 4'lü/5'li çarpanları çok güçlü. R1'de düşman canı ya da çarpanlar ayarlanmalı.
2. **Büyücü en zayıf sınıf** (%68; en iyi sınıf %83, fark 15 puan).
   - Okullar bunu düzeltmiyor: Ateş ve Buz aynı seviyede kalıyor, Arkan daha da kötü.
   - Prototip sayıları yükseltilmeli. Ayrıca Büyücü'nün ult büyümesi (+10/ult) kısa savaşlarda hiç işe yaramıyor.
3. **Bosslar duvar.** Kat 10'da kazanma oranı %0-55. Ekipmansız ölçüldü; ekipmanla ölçmek için simülatöre ekipman seçeneği gerekiyor (R1).
4. **Arkan okulu:**
   - Zaman Bükme pahalı (55) ve bot büyüyü hep en pahalıdan seçiyor; daha akıllı bir bot sonucu değiştirebilir.
   - Mana Kalkanı manayı yiyip saldırıyı geciktiriyor.
   - Öneri: Zaman Bükme 40 mana; Arkan Patlama çarpanı 0,02 → 0,03.

Not: Kat başına 20 savaş var; ±%10'luk farklar gürültü olabilir. Kesin karar için `runs=50` ile çalıştır.
