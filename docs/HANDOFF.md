# Durum notu (devir) - 2026-11-01

Proje başka bir bilgisayara taşınıyor. Bu dosya kaldığımız yeri anlatır.

## Nerede kaldık
- `main` = v1.41: eşya çeşitliliği (962 eşya), kasaba, müzayede, karakter
  çeşitliliği ve sosyal sistem (Ad#1234 takma adlar, Posta Kulesi: arkadaşlar /
  mesajlar / parti, Klan Salonu ve arma, bildirim zili).
- GitHub Pages `main`'den yayınlanıyor.
- Eski dallar silinmedi (`feature/item-variety`, `feature/social`, ...).
- `claude/admiring-shtern-9f47bb` dalında eski bir oturumdan kalan YARIM bir iş
  var (başarım kataloğu tablosu). Test edilmedi, main'e alınmadı.

## Yapılması gerekenler
1. Supabase projesi duraklatılmış görünüyor (canlı oyun açılmıyor, haftalık yedek
   başarısız). Supabase panelinden projeyi **Restore** et.
2. Sonra `supabase/schema.sql`'in tamamını Supabase SQL Editor'da **Run** et
   (takma ad göçü, eski lonca → klan göçü, oyuncu satırı güvenlik açığının
   kapanması). Çalıştırılmazsa takma ad ve sosyal pencereler çalışmaz.

## Sıradaki geliştirmeler
- `docs/ROADMAP-social.md`: sonraki fazlar, sırada klan bankası (ayrı faz).

## Yeni bilgisayarda
- `git clone https://github.com/Recreatives/match3-rpg-basic.git`
- Oyunu yerelde açmak: proje klasöründe `python3 -m http.server 8262`, sonra
  `http://localhost:8262/` (testler: `/tests/index.html`).
- Claude'un notları: `docs/claude-memory/` (README'ye bak). Kurallar `CLAUDE.md`'de.
