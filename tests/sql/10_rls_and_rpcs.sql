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
-- which handle_new_user() turns into players + wallets rows.
insert into auth.users (id) values
    ('11111111-1111-1111-1111-111111111111'),
    ('22222222-2222-2222-2222-222222222222')
on conflict do nothing;

do $$ begin
    if (select count(*) from public.wallets where player_id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')) <> 2 then
        raise exception 'FAIL: handle_new_user did not provision wallets';
    end if;
end $$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

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

-- a client can't write its own wallet directly (no UPDATE policy)
do $$
declare n integer; g integer;
begin
    update public.wallets set gold = 999999 where player_id = auth.uid();
    get diagnostics n = row_count;
    select gold into g from public.wallets where player_id = auth.uid();
    if n <> 0 or g <> 40 then raise exception 'FAIL: direct wallet update changed % rows, gold now %', n, g; end if;
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

commit;

-- player 2 still has exactly what they started with
do $$ begin
    if (select gold from public.wallets where player_id = '22222222-2222-2222-2222-222222222222') <> 0 then
        raise exception 'FAIL: player 2''s wallet changed';
    end if;
end $$;

\echo 'ALL SQL ASSERTIONS PASSED'
