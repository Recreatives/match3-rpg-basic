-- Run between the frozen v1.36 schema (tests/sql/legacy/) and the current
-- one: a player the way production has them today - gold in `wallets`,
-- items in the old slots (shield / trinket), a learned talent - so CI
-- proves section 30's migration carries all of it into a first character.
\set ON_ERROR_STOP on
insert into auth.users (id) values ('33333333-3333-3333-3333-333333333333'), ('44444444-4444-4444-4444-444444444444');
update public.wallets set gold = 1234, materials = 56 where player_id = '33333333-3333-3333-3333-333333333333';
insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats, equipped_slot) values
    ('33333333-3333-3333-3333-333333333333', 'blade', 'weapon', 'white', '{"sword": 3}', 'weapon'),
    ('33333333-3333-3333-3333-333333333333', 'kite_shield', 'shield', 'white', '{"shield": 3}', 'shield'),
    ('33333333-3333-3333-3333-333333333333', 'ring', 'trinket', 'white', '{"lifeSteal": 2}', 'trinket'),
    ('33333333-3333-3333-3333-333333333333', 'amulet', 'trinket', 'white', '{"energy": 2}', null);
insert into public.player_talents (player_id, talent_id) values ('33333333-3333-3333-3333-333333333333', 'iron_will');
