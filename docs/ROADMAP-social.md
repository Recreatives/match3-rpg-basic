# Sosyal sistemler: analiz ve yol haritası

Durum: taslak, kullanıcı onayı bekliyor (2026-10-02). Kapsam: benzersiz takma ad (Ad#1234), arkadaşlık, mesajlaşma, parti, klan, güvenlik ve moderasyon.

## 1. Bugün oyunda ne var?

| Alan | Bugünkü durum | Eksik / sorun |
|---|---|---|
| **Takma ad** | `players.display_name`, bütün oyunda benzersiz, en fazla 24 karakter, küfür filtresi var. | İstemci adı kendi `players` satırına **doğrudan** yazıyor. Etiket (#1234) yok; popüler adlar tek kişiye kalıyor ("Hakan" alındıysa kimse alamıyor). Anonim hesapların adı boş ("İsimsiz Kahraman"). |
| **⚠️ Güvenlik bulgusu** | `players` tablosundaki "update own player row" politikası istemcinin kendi satırındaki **bütün** kolonları değiştirmesine izin veriyor. | İstemci örneğin `prestige_level`'ı (altın çarpanı) kendisi yükseltebilir. Altın kazancı kazanç fonksiyonunda zaten sınırlı ama bu bir açık. **Faz S0'da kapatılmalı.** |
| **Arkadaşlık** | İstek gönder (tam adla), kabul / ret, arkadaş listesi. | Arkadaşı silme, engelleme, gelen/giden istek listesi, çevrimiçi durumu, arkadaş sınırı yok. |
| **Mesajlaşma** | Sadece arkadaşlar arası, 500 karakter, `direct_messages` tablosu. Açık konuşma 3 saniyede bir yenileniyor (polling). | Anlık iletim yok, okunmamış sayacı / bildirim yok, sohbet listesi yok, hız sınırı yok, mesaj şikâyeti / engelleme yok, eski mesajlar hiç silinmiyor. |
| **Parti** | Yok. Co-op oda koduyla, PvP rastgele eşleşmeyle. | Arkadaşı davet edip birlikte zindana girme yok. |
| **Lonca (klan)** | Ad benzersiz, sahip + üye rolü, liste, katıl, ayrıl. | **Herkes istediği loncaya izinsiz katılabiliyor.** Rütbe/yetki, davet/başvuru, klan sohbeti, etiket, üye sınırı, klan seviyesi, klan binası yok. |
| **Takas** | Arkadaşlar arası eşya/altın takas teklifleri. | Çalışıyor. Yeni sistemle "Ad#1234" ve klan üyeleri arasında da açılabilir. |
| **Moderasyon** | Küfür listesi, oyuncu şikâyeti. | Engelleme, susturma, "kim bana yazabilir" ayarı, mesaj ve klan adı şikâyeti yok. |

Sonuç: temel taşlar var ama sosyal sistem "çalışan bir prototip" seviyesinde. Ad#1234, parti ve gerçek bir klan sistemi için kimlik katmanını yeniden kurmak, mesajlaşmayı anlık hale getirmek ve loncayı klana dönüştürmek gerekiyor.

## 2. Temel tasarım kararları (önerilen)

1. **Takma ad hesaba ait, karaktere değil.** Arkadaşlar, mesajlar, parti ve klan *oyuncular* arasındadır. Oyuncunun 6 karakteri olabilir ama tek kimliği vardır: `Hakan#4821`. Oyun içinde karakter adı görünmeye devam eder ("Borin · Hakan#4821").
2. **Etiketi sunucu verir.** Oyuncu sadece adı seçer. Sunucu o ad için boş bir 4 haneli sayı (1000-9999) atar. Aynı addan 9000 kişi olabilir; "Ad#etiket" çifti benzersizdir.
3. **Eklemek için tam etiket gerekir.** Sadece "Hakan" yazarak arama yapılamaz (gizlilik ve taciz önleme). Arkadaş eklemek için `Hakan#4821` yazılır. Klan üyeleri ve parti arkadaşları listeden de eklenebilir.
4. **Anlık iletim Supabase Realtime ile.** Mesajlar, davetler ve klan sohbeti sunucuda tabloya yazılır (RLS korumalı). İstemci yalnızca kendini ilgilendiren satırları canlı dinler. Çevrimiçi durumu hafif bir "son görülme" kaydıyla tutulur (dakikada bir). Ücretsiz Supabase kotası (200 eşzamanlı bağlantı, ayda 2M mesaj) bu tasarımla rahat yeter.
5. **Her şey sunucu fonksiyonundan geçer.** Adı değiştirme, davet, klana katılma ve mesaj gönderme dahil; doğrudan tablo yazımı yok (projenin mevcut kuralı).

## 3. Fazlar

### Faz S0: Kimlik (Ad#1234) ve güvenlik açığının kapatılması
- `players` tablosuna `handle_name` (3-16 karakter: harf, rakam, alt çizgi; Türkçe harfler dahil) ve `handle_tag` (1000-9999) eklenir. `(lower(handle_name), handle_tag)` benzersizdir.
- `set_handle(p_name)` adı ayarlar, rastgele boş bir etiket verir ve `Ad#1234` döndürür. Küfür filtresi ve ayrılmış adlar (Admin, Moderatör, GM…) kontrol edilir. İlk ad ücretsiz, sonraki değişiklikler 30 günde bir. **Karar sende:** ad değişikliği altınla mı olsun, yoksa süreyle mi sınırlansın?
- "update own player row" politikası kaldırılır. Ad, unvan ve aktif karakter yalnızca kendi fonksiyonlarından değişir.
- Göç: mevcut `display_name`'ler `handle_name`'e taşınır ve herkese rastgele bir etiket verilir. Adı olmayan anonim hesaplar ilk girişte ad seçer.
- Arayüz: ilk girişte "Ad seç" adımı (karakter oluşturmadan önce). Kasaba başlığında `Hakan#4821` ve "kopyala" düğmesi. Profilde ad değiştirme.
- Testler: aynı ada farklı etiket, büyük/küçük harf duyarsız benzersizlik, filtre, 30 gün sınırı, açığın kapandığının SQL testi.

### Faz S1: Arkadaşlık 2.0
- İstek `Ad#1234` ile gönderilir. Gelen ve giden istek listeleri görünür.
- Arkadaşı silme, engelleme (engelli oyuncudan istek, mesaj ve davet gelmez), en fazla 100 arkadaş.
- **Çevrimiçi durumu:** `player_presence` tablosunda `last_seen` ve `activity` (Kasabada / Zindanda kat 12 / PvP'de / Co-op'ta) tutulur, istemci dakikada bir günceller. Arkadaş listesinde 🟢 çevrimiçi, 🟡 maçta, ⚫ çevrimdışı (son görülme) gösterilir.
- Arkadaşın profil kartı: karakterleri, seviyeleri, klanı, PvP derecesi ve kuşandıklarının küçük bir önizlemesi.
- Kasabada yeni bir bina: **"Posta Kulesi"** (arkadaşlar ve mesajlar), bildirim rozetiyle.

### Faz S2: Mesajlaşma 2.0
- Polling yerine anlık iletim (Realtime, yalnızca bana gelen mesajlar).
- Sohbet listesi: son mesaj, saat, okunmamış sayısı. Sohbet başına okundu bilgisi.
- Kasabada, Posta Kulesi'nde ve üst çubukta okunmamış rozeti. Zindandayken mesaj gelirse küçük bir bildirim çıkar ama pencere açılmaz (zindan kuralı korunur).
- Hız sınırı (ör. 10 saniyede 10 mesaj), küfür maskeleme, mesajı şikâyet etme.
- Gizlilik ayarı: "Bana kimler yazabilir: arkadaşlar / arkadaşlar + klan / kimse".
- Saklama: konuşma başına son 200 mesaj veya 90 gün.
- (İleride) Sohbete eşya bağlantısı: "[Kan Çığlığı · Çelik Kılıç]" yazısına tıklayınca eşyanın detayı açılır.

### Faz S3: Parti
- Arkadaşa ya da klan üyesine **parti daveti**. Kabul edilince parti kurulur (lider + üye) ve parti sohbeti açılır.
- Lider "Zindana gir" dediğinde ikisi birlikte co-op zindana girer; oda kodu gerekmez. Parti koşudan sonra da dağılmaz; "Hazır mısın?" kontrolü var.
- Arkadaşa **dostluk düellosu** daveti: derece ve ihanet bahsi olmayan bir PvP maçı.
- **Teknik sınır:** bugünkü co-op motoru 2 kişilik. Parti 2 kişiyle başlar. 3-4 kişilik parti co-op motorunda ayrı bir iştir (sıra, tahta paylaşımı, canavar gücü), bu yüzden ayrı faz olarak not edildi.
- Tablolar: `parties`, `party_members`, `party_invites` (süresi 2 dakika). Fonksiyonlar: davet et, kabul, ayrıl, at, liderliği devret.

### Faz S4: Klanlar (loncaların yerine)
- **Kurma:** karakter seviyesi en az 10 ve altın bedeli (öneri 2.000; aynı zamanda ekonomiden altın çeker). Ad 3-24 karakter, benzersiz. **Klan etiketi** 2-4 harf, ör. `[KRT]`; adların yanında görünür: `[KRT] Hakan#4821`.
- **Katılım:** açık / başvuruyla / sadece davetle (lider seçer). Başvurular bir listede onaylanır.
- **Rütbeler ve yetkiler:**

  | Rütbe | Davet / başvuru onayı | Üye atma | Duyuru | Rütbe verme | Klanı dağıtma |
  |---|---|---|---|---|---|
  | Lider | ✔ | ✔ | ✔ | ✔ | ✔ |
  | Subay | ✔ | Acemi/Üye | ✔ | - | - |
  | Üye | Davet | - | - | - | - |
  | Acemi (ilk 3 gün) | - | - | - | - | - |

- **Üye sınırı:** başlangıçta 20, klan seviyesiyle 50'ye çıkar.
- **Klan sohbeti** (anlık), **günün duyurusu**, üye listesi (çevrimiçi durumu, karakter seviyeleri, son aktiflik), **etkinlik kaydı** (katıldı, ayrıldı, terfi, kim ne bağışladı).
- **Klan seviyesi:** üyelerin zindan koşuları ve PvP galibiyetleri klana tecrübe kazandırır (kişi başı günlük sınırla). Seviye ödülleri:
  - Üye sınırının artması
  - Klan arması renkleri
  - **Klan armasının pelerin ve kalkanda görünmesi** (avatar ressamı zaten pelerin/tabard/kalkan çiziyor; Stil C'ye çok iyi oturur)
  - Haftalık klan sıralaması
- **Kasabada "Klan Salonu" binası.**
- **Klan bankası:** altın ve eşya bağışı, rütbeye göre çekme sınırı. Altın aklama ve hesap paylaşımı riski taşıdığı için **ayrı ve sonraki bir alt faz** olarak öneriyorum. **Karar sende.**
- **Göç:** mevcut loncalar klana dönüşür, sahip lider olur, etiket olarak adın ilk harfleri önerilir; lider sonradan değiştirebilir.
- **İleride:** klan savaşları ve klanlar arası turnuva (eşleştirme sistemiyle birlikte ele alınmalı).

### Faz S5: Güvenlik, moderasyon ve bildirim merkezi
- Engelleme listesi (bütün sosyal kanallarda geçerli), susturma.
- Mesaj, ad ve klan adı/etiketi şikâyeti; şikâyetleri ve tekrar edenleri listeleyen yönetici görünümleri (SQL).
- Hız sınırları: arkadaşlık isteği, davet, klan başvurusu ve mesaj.
- **Bildirim merkezi** (kasabada zil simgesi): arkadaşlık istekleri, parti/klan davetleri, müzayedede satılan eşyalar, yeni mesajlar.

### Faz S6: Test ve yayın
- SQL testleri: bütün fonksiyonların sınırları ve yetkileri (ör. subayın lideri atamaması, engellinin mesaj atamaması).
- İki "dünyalı" uçtan uca testler: davet, kabul, parti ile co-op, klan sohbeti, anlık mesaj.
- Mobil yerleşim, sürüm ve dokümantasyon. `schema.sql`'in her fazda senin çalıştırman gerekiyor; her seferinde neyin değiştiğini ayrıca yazacağım.

## 4. Senden gereken kararlar

1. Takma ad **hesaba** mı ait olsun (önerim), yoksa her karakterin kendi etiketi mi olsun?
2. Ad değişikliği: **30 günde bir ücretsiz** mi, altınla mı, ikisi birden mi?
3. Klan kurma: **seviye 10 + 2.000 altın** uygun mu?
4. Klan bankası **şimdi mi**, yoksa sonra mı?
5. Parti şimdilik **2 kişi** (co-op motoru sınırı) olsun mu? 3-4 kişiyi ayrı bir iş olarak mı planlayalım?
6. Varsayılan "bana kim yazabilir": **arkadaşlar + klan** mı?

## 5. Önerilen sıra ve kapsam
S0 → S1 → S2 → S3 → S4 → S5 → S6. S0 bir güvenlik açığını kapattığı için ilk yapılmalı. S1 ve S2 birlikte "sosyal temel"i oluşturuyor. Parti (S3) ve klan (S4) bu temele dayanıyor. Her fazın sonunda sen test et, sonra bir sonrakine geçelim; ya da önceki turlardaki gibi hepsini tek dalda yapıp en sonda tek `schema.sql` çalıştırırız.
