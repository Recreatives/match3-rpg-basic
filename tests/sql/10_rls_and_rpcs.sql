-- Security assertions against the REAL supabase/schema.sql (applied twice
-- by CI first, to prove it is re-runnable). Every check raises an
-- exception starting with 'FAIL' on failure; psql runs with ON_ERROR_STOP,
-- so the first failure fails the CI job with its message.
\set ON_ERROR_STOP on

-- expect_error(sql, fragment): the statement must raise, with fragment in
-- its message (so a statement failing for an unrelated reason can't pass).
create schema if not exists tst;
create or replace function tst.expect_error(p_sql text, p_fragment text) returns void
language plpgsql as $$
begin
    begin
        execute p_sql;
    exception when others then
        if position(p_fragment in sqlerrm) = 0 then
            raise exception 'FAIL: % raised "%", expected it to mention "%"', p_sql, sqlerrm, p_fragment;
        end if;
        return;
    end;
    raise exception 'FAIL: % was allowed, expected an error mentioning "%"', p_sql, p_fragment;
end $$;
grant usage on schema tst to authenticated;
grant execute on function tst.expect_error(text, text) to authenticated;

-- Two players, provisioned the way Supabase does it: a row in auth.users,
-- which handle_new_user() turns into a players row. Nobody has a
-- character (or a wallet) until they make one.
insert into auth.users (id) values
    ('11111111-1111-1111-1111-111111111111'),
    ('22222222-2222-2222-2222-222222222222')
on conflict do nothing;

do $$ begin
    if (select count(*) from public.players where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')) <> 2 then
        raise exception 'FAIL: handle_new_user did not provision players';
    end if;
    if exists (select 1 from public.wallets where player_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')) then
        raise exception 'FAIL: a wallet exists before any character';
    end if;
end $$;

-- player 2 makes a mage (so there's someone to steal from / trade with)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select public.create_character('Ayla', 'mage', 'f', '{"skin": 2, "hair": "long"}');
commit;
-- (player 1 can't read it, so remember its id for the checks below)
select set_config('tst.ayla', (select id::text from public.characters where name = 'Ayla'), false);

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

-- characters: bounded names, a class that exists, at most 6
select tst.expect_error($q$select public.create_character('X', 'warrior', 'm', '{}')$q$, '2-16');
select tst.expect_error($q$select public.create_character('Nobody', 'pirate', 'm', '{}')$q$, 'class_key');
do $$
declare c public.characters;
begin
    select * into c from public.create_character('Borin', 'warrior', 'm', '{"skin": 99, "hair": "<script>"}');
    if c.level <> 1 or c.gold <> 0 or c.class_key <> 'warrior' then raise exception 'FAIL: new character %', row_to_json(c); end if;
    if (c.appearance->>'skin')::int <> 4 or c.appearance->>'hair' <> 'short' then raise exception 'FAIL: appearance not sanitized %', c.appearance; end if;
    if (select active_character_id from public.players where id = auth.uid()) <> c.id then raise exception 'FAIL: new character not active'; end if;
end $$;
select tst.expect_error($q$select public.create_character('borin', 'rogue', 'm', '{}')$q$, 'already have');
-- characters can't be written directly
do $$
declare n integer;
begin
    update public.characters set level = 50, gold = 99999 where player_id = auth.uid();
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: direct character update changed % rows', n; end if;
end $$;
-- ...and player 1 can't see player 2's
do $$ begin
    if exists (select 1 from public.characters where player_id = '22222222-2222-2222-2222-222222222222') then
        raise exception 'FAIL: player 1 can read player 2''s characters';
    end if;
end $$;
select tst.expect_error($q$select public.select_character(current_setting('tst.ayla')::uuid)$q$, 'not found');

-- earn_currency: bounded grants only
do $$
declare r record;
begin
    select * into r from public.earn_currency(40, 3);
    if r.gold <> 40 or r.materials <> 3 then raise exception 'FAIL: earn_currency(40,3) -> %/%', r.gold, r.materials; end if;
end $$;
select tst.expect_error('select public.earn_currency(501, 0)', 'out of bounds');
select tst.expect_error('select public.earn_currency(0, 51)', 'out of bounds');
select tst.expect_error('select public.earn_currency(-5, 0)', 'out of bounds');

-- a client can't write its own wallet directly (the view refuses it)
select tst.expect_error($q$update public.wallets set gold = 999999 where player_id = auth.uid()$q$, 'read-only');
do $$ begin
    if (select gold from public.wallets where player_id = auth.uid()) <> 40 then raise exception 'FAIL: wallet gold changed'; end if;
end $$;

-- ...and can't even see someone else's
do $$ begin
    if exists (select 1 from public.wallets where player_id = '22222222-2222-2222-2222-222222222222') then
        raise exception 'FAIL: player 1 can read player 2''s wallet';
    end if;
end $$;

-- item inserts are validated against the items.js mirror tables
insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats)
    values (auth.uid(), 'blade', 'weapon', 'white', '{"sword": 7}');
select tst.expect_error($q$insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats) values (auth.uid(), 'blade', 'weapon', 'white', '{"sword": 99}')$q$, 'exceeds bound');
select tst.expect_error($q$insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats) values (auth.uid(), 'kite_shield', 'weapon', 'white', '{"shield": 3}')$q$, 'unknown base');
select tst.expect_error($q$insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats) values (auth.uid(), 'blade', 'weapon', 'grey', '{"sword": 2, "heart": 2}')$q$, 'exceeds bound');
select tst.expect_error($q$insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats) values (auth.uid(), 'uniq_nights_lament', 'weapon', 'orange', '{"sword": 80, "lifeSteal": 6}')$q$, 'mismatch');
select tst.expect_error($q$insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats) values (auth.uid(), 'uniq_fake', 'weapon', 'red', '{"sword": 1}')$q$, 'unknown fixed item');
-- item level: at most the character's level + 5; stats scale with it
select tst.expect_error($q$insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats, item_level) values (auth.uid(), 'blade', 'weapon', 'white', '{"sword": 3}', 7)$q$, 'item level');
insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats, item_level)
    values (auth.uid(), 'blade', 'weapon', 'white', '{"sword": 3}', 6);
-- a character can't be given someone else's character's items
select tst.expect_error($q$insert into public.player_items (player_id, character_id, base_id, slot, rarity, rolled_stats) values (auth.uid(), current_setting('tst.ayla')::uuid, 'blade', 'weapon', 'white', '{"sword": 3}')$q$, 'not your character');
-- and can't be planted in someone else's inventory
select tst.expect_error($q$insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats) values ('22222222-2222-2222-2222-222222222222', 'blade', 'weapon', 'white', '{"sword": 3}')$q$, 'row-level security');

-- purchase_item: right price, right rarity, shop rarities only
do $$
declare it public.player_items; g integer;
begin
    select * into it from public.purchase_item('weapon', 'white');
    select gold into g from public.wallets where player_id = auth.uid();
    if g <> 20 then raise exception 'FAIL: white purchase should cost 20 (40 -> 20), gold now %', g; end if;
    if it.rarity <> 'white' or it.slot <> 'weapon' or it.player_id <> auth.uid() then raise exception 'FAIL: purchased item %', row_to_json(it); end if;
end $$;
select tst.expect_error($q$select public.purchase_item('weapon', 'yellow')$q$, 'not shop-purchasable');
select tst.expect_error($q$select public.purchase_item('weapon', 'blue')$q$, 'insufficient gold');

-- items can't be changed directly any more (no update policy)
do $$
declare n integer;
begin
    update public.player_items set equipped_slot = 'weapon' where player_id = auth.uid();
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: direct item update changed % rows', n; end if;
end $$;

-- equip_item: class, level and slot rules
do $$
declare it public.player_items; r1 public.player_items; r2 public.player_items;
begin
    select * into it from public.player_items where player_id = auth.uid() and base_id = 'blade' and item_level = 1 limit 1;
    select * into it from public.equip_item(it.id, null);
    if it.equipped_slot <> 'weapon' then raise exception 'FAIL: equip -> %', it.equipped_slot; end if;
    select * into it from public.unequip_item(it.id);
    if it.equipped_slot is not null then raise exception 'FAIL: unequip'; end if;
    -- two rings fill ring1 then ring2
    insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats) values (auth.uid(), 'ring', 'ring', 'white', '{"lifeSteal": 2}') returning * into r1;
    insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats) values (auth.uid(), 'ring', 'ring', 'white', '{"lifeSteal": 2}') returning * into r2;
    select * into r1 from public.equip_item(r1.id, null);
    select * into r2 from public.equip_item(r2.id, null);
    if r1.equipped_slot <> 'ring1' or r2.equipped_slot <> 'ring2' then raise exception 'FAIL: rings -> % / %', r1.equipped_slot, r2.equipped_slot; end if;
end $$;
select tst.expect_error($q$select public.equip_item((select id from public.player_items where player_id = auth.uid() and item_level = 6 limit 1), null)$q$, 'requires level');
-- (no character_id = straight into the shared stash; this one goes in the bag)
insert into public.player_items (player_id, character_id, base_id, slot, rarity, rolled_stats) values (auth.uid(), public.my_active_character(), 'bow', 'weapon', 'white', '{"energy": 3}');
select tst.expect_error($q$select public.equip_item((select id from public.player_items where player_id = auth.uid() and base_id = 'bow' limit 1), null)$q$, 'class cannot');

-- stash, lock, sell
do $$
declare it public.player_items; g0 integer; g1 integer;
begin
    select * into it from public.player_items where player_id = auth.uid() and base_id = 'bow' limit 1;
    select * into it from public.move_item(it.id, 'stash');
    if it.character_id is not null then raise exception 'FAIL: move to stash'; end if;
    select * into it from public.move_item(it.id, 'bag');
    if it.character_id is null then raise exception 'FAIL: move to bag'; end if;
    perform public.lock_item(it.id, true);
    begin
        perform public.sell_item(it.id);
        raise exception 'FAIL: sold a locked item';
    exception when others then
        if sqlerrm not like '%locked%' then raise; end if;
    end;
    perform public.lock_item(it.id, false);
    select gold into g0 from public.wallets where player_id = auth.uid();
    perform public.sell_item(it.id);
    select gold into g1 from public.wallets where player_id = auth.uid();
    if g1 <> g0 + 15 then raise exception 'FAIL: sell white -> % (was %)', g1, g0; end if;
end $$;

-- experience: bounded, rate-limited, levels follow the curve
do $$
declare r record;
begin
    select * into r from public.award_run_xp(1, 2);
    -- 30 + 9 per floor + 3 per kill; level 2 needs 80
    if r.xp <> 45 or r.level <> 1 or r.leveled_up then raise exception 'FAIL: award_run_xp(1,2) -> %', row_to_json(r); end if;
end $$;
select tst.expect_error('select public.award_run_xp(1, 1)', 'too soon');
select tst.expect_error('select public.award_run_xp(0, 1)', 'out of bounds');
do $$ begin
    if public.xp_total_for(2) <> 80 or public.xp_total_for(1) <> 0 then raise exception 'FAIL: xp curve'; end if;
end $$;

-- dying costs exactly one worn item, once per death
do $$
declare lost jsonb; before integer; after integer;
begin
    select count(*) into before from public.player_items where character_id = public.my_active_character() and equipped_slot is not null;
    if before = 0 then raise exception 'FAIL: test needs a worn item'; end if;
    lost := public.lose_item_on_death('solo');
    select count(*) into after from public.player_items where character_id = public.my_active_character() and equipped_slot is not null;
    if lost is null or after <> before - 1 then raise exception 'FAIL: death loss % -> % (%)', before, after, lost; end if;
end $$;
select tst.expect_error($q$select public.lose_item_on_death('pvp')$q$, 'too soon');
select tst.expect_error($q$select public.lose_item_on_death('coop')$q$, 'unknown mode');

-- a second character has its own (empty) purse
do $$
declare c public.characters; first_id uuid;
begin
    first_id := (select active_character_id from public.players where id = auth.uid());
    select * into c from public.create_character('Kara', 'rogue', 'f', '{}');
    if (select gold from public.wallets where player_id = auth.uid()) <> 0 then raise exception 'FAIL: new character shares gold'; end if;
    perform public.select_character(first_id);
    if (select gold from public.wallets where player_id = auth.uid()) = 0 then raise exception 'FAIL: first character lost its gold'; end if;
    begin
        perform public.delete_character(c.id, 'wrong');
        raise exception 'FAIL: deleted with the wrong name';
    exception when others then
        if sqlerrm not like '%does not match%' then raise; end if;
    end;
    perform public.delete_character(c.id, 'kara');
end $$;

commit;

-- player 2 still has exactly what they started with
do $$ begin
    if (select gold from public.wallets where player_id = '22222222-2222-2222-2222-222222222222') <> 0 then
        raise exception 'FAIL: player 2''s wallet changed';
    end if;
end $$;

\echo 'ALL SQL ASSERTIONS PASSED'
