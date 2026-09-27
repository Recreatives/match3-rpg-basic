-- After the current schema ran (twice) over tests/sql/05_legacy_seed.sql.
\set ON_ERROR_STOP on
do $$
declare c public.characters;
begin
    select * into c from public.characters where player_id = '33333333-3333-3333-3333-333333333333';
    if not found then raise exception 'FAIL: legacy player got no character'; end if;
    if c.gold <> 1234 or c.materials <> 56 or not c.needs_setup then raise exception 'FAIL: legacy character %', row_to_json(c); end if;
    if (select count(*) from public.characters where player_id = '33333333-3333-3333-3333-333333333333') <> 1 then raise exception 'FAIL: migration ran twice'; end if;
    if (select active_character_id from public.players where id = c.player_id) <> c.id then raise exception 'FAIL: legacy character not active'; end if;
    if (select count(*) from public.player_items where character_id = c.id) <> 4 then raise exception 'FAIL: items not moved to the character'; end if;
    if (select equipped_slot from public.player_items where base_id = 'kite_shield' and character_id = c.id) <> 'offhand' then raise exception 'FAIL: shield slot not migrated'; end if;
    if (select slot || '/' || equipped_slot from public.player_items where base_id = 'ring' and character_id = c.id) <> 'ring/ring1' then raise exception 'FAIL: ring not migrated'; end if;
    if (select slot from public.player_items where base_id = 'amulet' and character_id = c.id) <> 'amulet' then raise exception 'FAIL: amulet not migrated'; end if;
    if not exists (select 1 from public.character_talents where character_id = c.id and talent_id = 'iron_will') then raise exception 'FAIL: talent not moved'; end if;
    if (select gold from public.wallets where player_id = c.player_id) <> 1234 then raise exception 'FAIL: wallet view'; end if;
    -- a player with nothing gets no character (they'll make one)
    if exists (select 1 from public.characters where player_id = '44444444-4444-4444-4444-444444444444') then raise exception 'FAIL: empty player got a character'; end if;
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'wallets_legacy') then raise exception 'FAIL: no wallets_legacy backup'; end if;
end $$;
\echo 'LEGACY MIGRATION PASSED'
