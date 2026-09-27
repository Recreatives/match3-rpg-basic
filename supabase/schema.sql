-- Pixel Dungeon: persistent economy layer
--
-- Identity: players use Supabase Anonymous Auth (supabase.auth.signInAnonymously()).
-- Each browser/device gets a real auth.uid() with no signup step, which is what
-- lets us write proper Row Level Security below instead of trusting the client.
--
-- Run this whole file once in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- on a fresh project. Safe to re-run: every statement is guarded.

-- Functions are created in file order, but some plpgsql functions declare
-- variables of a table's row type (e.g. resolve_betrayal's
-- `v_item public.player_items`) before that table's own section further
-- down. With body checking on, a FRESH project failed right there (an
-- existing project never noticed, because the table already existed) -
-- found by CI's real-Postgres run (.github/workflows/ci.yml, job "sql").
-- Same setting pg_dump emits; bodies are still fully checked when called.
set check_function_bodies = off;

-- 1. players ---------------------------------------------------------------
-- One row per auth identity. id matches auth.users.id exactly (1:1).
create table if not exists public.players (
    id           uuid primary key references auth.users(id) on delete cascade,
    display_name text,
    created_at   timestamptz not null default now()
);

-- 2. wallets -----------------------------------------------------------------
-- Currency that survives between runs. Separate from in-run TILE_STATS, which
-- stay client-side and reset every run (see game.js resetGame()).
-- (Created through `execute` on purpose: since v1.37 `wallets` ends this
-- file as a VIEW of the active character's purse (section 30), and the
-- Supabase SQL Editor's "Run and enable RLS" button appends
-- `alter table <t> enable row level security` for every `create table` it
-- spots in the text - which fails on a view. Only a brand new database
-- ever runs this; everywhere else `wallets` already exists.)
do $$
begin
    if to_regclass('public.wallets') is null and to_regclass('public.wallets_legacy') is null then
        execute 'create table public.wallets (
            player_id  uuid primary key references public.players(id) on delete cascade,
            gold       integer not null default 0 check (gold >= 0),
            materials  integer not null default 0 check (materials >= 0),
            updated_at timestamptz not null default now()
        )';
    end if;
end $$;

-- 3. auto-provision on first sign-in -----------------------------------------
-- A brand new anonymous session should never need a separate "create my
-- profile" round trip - the moment auth.users gets a new row, give it a
-- matching player + an empty wallet.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.players (id) values (new.id);
    insert into public.wallets (player_id) values (new.id);
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

-- 4. keep updated_at honest ---------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- (Only while wallets is still a table: section 30 turns it into a view of
-- the active character's purse, and a view can't carry this trigger.)
do $$
begin
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'wallets') then
        execute 'drop trigger if exists wallets_touch_updated_at on public.wallets';
        execute 'create trigger wallets_touch_updated_at before update on public.wallets for each row execute procedure public.touch_updated_at()';
    end if;
end $$;

-- 5. Row Level Security -------------------------------------------------------
-- A player can only ever see/touch their own row. This is the whole point of
-- anonymous auth over a hand-rolled device key: auth.uid() is set by Supabase
-- itself from the caller's session token, not something the client can spoof.
alter table public.players enable row level security;
do $$
begin
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'wallets') then
        execute 'alter table public.wallets enable row level security';
    end if;
end $$;

drop policy if exists "read own player row" on public.players;
create policy "read own player row" on public.players
    for select using (auth.uid() = id);

drop policy if exists "update own player row" on public.players;
create policy "update own player row" on public.players
    for update using (auth.uid() = id);

do $$
begin
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'wallets') then
        execute 'drop policy if exists "read own wallet" on public.wallets';
        execute 'create policy "read own wallet" on public.wallets for select using (auth.uid() = player_id)';
        execute 'drop policy if exists "update own wallet" on public.wallets';
    end if;
end $$;

-- NOTE - security boundary, resolved below:
-- The policies above let a player update their OWN gold/materials directly.
-- That's fine for "read my balance, spend at the shop" but not safe for the
-- betrayal PvP currency steal, where the WINNER'S client would otherwise need
-- to write to the LOSER'S row - which these policies correctly block. See
-- resolve_betrayal() below: a single trusted place (security definer) for
-- that specific transfer, instead of two clients each updating their own row
-- and hoping they agree.

-- 6. betrayal currency + item transfer ------------------------------------------
-- Called by the WINNING client only (see coop.js/pvp.js - the loser's client
-- never calls this, it just observes the resulting balance/inventory next
-- time it fetches them). Moves loss_percent of the loser's gold+materials to
-- the winner, AND (new) transfers one random EQUIPPED item from the loser to
-- the winner as a betrayal spoil - unequipped on arrival, since the winner
-- may not even play a class that slot suits; it just joins their bag like
-- any other loot. security definer is what lets this one function touch
-- rows that aren't the caller's own, despite the RLS policies above - every
-- other write path in this schema still goes through auth.uid() as normal.
-- Returns the stolen item's display-relevant columns (or null fields if the
-- loser had nothing equipped) so the winner's client can log what it got;
-- the loser's client only ever finds out via pvp.js's own betrayal-item-
-- stolen broadcast, not from this return value (it's the loser it never
-- reaches).
--
-- The DROP below is required, not just belt-and-suspenders: this function
-- used to `returns void`, and Postgres refuses `create or replace` across a
-- return-type change (42P13) - re-running this file against a database that
-- still has the old version fails here without it, aborting the whole
-- script partway through and silently leaving everything after this point
-- (including item_sell_values/sell_item further down) never applied.
drop function if exists public.resolve_betrayal(uuid, uuid, numeric);
create or replace function public.resolve_betrayal(winner_id uuid, loser_id uuid, loss_percent numeric)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
    lost_gold integer;
    lost_materials integer;
    v_item public.player_items;
begin
    if auth.uid() is null or auth.uid() <> winner_id then
        raise exception 'only the winner can resolve a betrayal payout';
    end if;
    if winner_id = loser_id then
        raise exception 'winner and loser must differ';
    end if;
    if loss_percent <= 0 or loss_percent > 1 then
        raise exception 'loss_percent must be between 0 and 1';
    end if;

    select floor(gold * loss_percent), floor(materials * loss_percent)
        into lost_gold, lost_materials
        from public.wallets where player_id = loser_id;

    update public.wallets set gold = gold - lost_gold, materials = materials - lost_materials
        where player_id = loser_id;
    update public.wallets set gold = gold + lost_gold, materials = materials + lost_materials
        where player_id = winner_id;

    select * into v_item from public.player_items
        where player_id = loser_id and equipped_slot is not null
        order by random() limit 1;

    if v_item.id is not null then
        update public.player_items set player_id = winner_id, equipped_slot = null
            where id = v_item.id;
    end if;

    return jsonb_build_object(
        'lost_gold', lost_gold,
        'lost_materials', lost_materials,
        'stolen_item', case when v_item.id is not null then jsonb_build_object(
            'base_id', v_item.base_id, 'slot', v_item.slot, 'rarity', v_item.rarity, 'set_key', v_item.set_key
        ) else null end
    );
end;
$$;

grant execute on function public.resolve_betrayal(uuid, uuid, numeric) to authenticated, anon;

-- 7. owned items (rarity/loot system) -----------------------------------------
-- Superseded shape: each row is one item INSTANCE (rolled stats and all),
-- not just "which item id a player owns" - a rarity/loot system means two
-- Blue swords can have completely different rolled stats, which a simple
-- (player_id, item_id) key can't represent. No real purchases exist yet
-- (this table was never live-used under its old shape), so this is a clean
-- replace rather than a column migration.
--
-- rolled_stats/base_id/set_key/rarity all come from items.js at the moment
-- the item is generated (shop purchase or a post-battle drop) - this table
-- just stores the result, same "database stores facts, items.js defines
-- what they mean" split every other table in this file follows.
--
-- equipped_slot (null or one of the 8 slots below): an item's stats only
-- apply while it's sitting in this slot - see items.js's
-- applyEquippedItemBonuses. Owning a pile of unequipped loot does nothing,
-- which is what keeps a growing item pool from letting stats climb forever.
--
-- The slot lists below are the original 8; section 30 migrates them to
-- the catalog's 11 slots (offhand / amulet / belt / legs / ring1-2) and
-- adds the character, level and lock columns.
-- NOT dropped on a re-run (it holds every player's items): created once,
-- then migrated in place by section 30.
create table if not exists public.player_items (
    id            uuid primary key default gen_random_uuid(),
    player_id     uuid not null references public.players(id) on delete cascade,
    base_id       text not null,
    slot          text not null check (slot in ('weapon', 'shield', 'helmet', 'chest', 'shoulder', 'gloves', 'boots', 'trinket')),
    rarity        text not null,
    rolled_stats  jsonb not null default '{}'::jsonb,
    set_key       text,
    equipped_slot text check (equipped_slot in ('weapon', 'shield', 'helmet', 'chest', 'shoulder', 'gloves', 'boots', 'trinket')),
    acquired_at   timestamptz not null default now()
);

alter table public.player_items enable row level security;

drop policy if exists "read own items" on public.player_items;
create policy "read own items" on public.player_items
    for select using (auth.uid() = player_id);

drop policy if exists "insert own items" on public.player_items;
create policy "insert own items" on public.player_items
    for insert with check (auth.uid() = player_id);

-- No update policy: equipping, moving and locking go through the
-- functions in section 30 (equip_item, unequip_item, move_item, lock_item).
drop policy if exists "update own items" on public.player_items;

-- 8. achievements ------------------------------------------------------------
-- Same shape as player_items above: a permanent (player, achievement) flag,
-- no update/delete path. The catalog (name, description, what unlocks it)
-- lives client-side in achievements.js - this table only stores WHICH
-- achievement ids a player has unlocked.
create table if not exists public.player_achievements (
    player_id       uuid not null references public.players(id) on delete cascade,
    achievement_id  text not null,
    unlocked_at     timestamptz not null default now(),
    primary key (player_id, achievement_id)
);

alter table public.player_achievements enable row level security;

drop policy if exists "read own achievements" on public.player_achievements;
create policy "read own achievements" on public.player_achievements
    for select using (auth.uid() = player_id);

drop policy if exists "insert own achievements" on public.player_achievements;
create policy "insert own achievements" on public.player_achievements
    for insert with check (auth.uid() = player_id);

-- 9. leaderboard ---------------------------------------------------------------
-- A player can only ever SELECT their own wallet row ("read own wallet"
-- above) - a leaderboard needs to compare across players, which is exactly
-- what that policy is supposed to prevent a client from doing directly.
-- security definer lets this one function read across every wallet, but it
-- only ever returns a display name and a gold total - never a player id,
-- never materials, never anything else in players/wallets a player hasn't
-- chosen to make public by setting their own display_name (players.
-- display_name is nullable and defaults to null - "update own player row"
-- already lets a client set it on their own row, no new policy needed for
-- that part).
drop function if exists public.get_leaderboard(integer);
create or replace function public.get_leaderboard(limit_count integer default 10)
returns table(display_name text, gold integer)
language sql
security definer set search_path = public
stable
as $$
    select coalesce(p.display_name, 'İsimsiz Kahraman'), w.gold
    from public.wallets w
    join public.players p on p.id = w.player_id
    order by w.gold desc
    limit greatest(1, least(limit_count, 50));
$$;

grant execute on function public.get_leaderboard(integer) to authenticated, anon;

-- 10. co-op session snapshots (reconnection support) --------------------------
-- Lets a player who reloads the page (or whose tab/connection drops) rejoin
-- the SAME room code and resume roughly where they left off, instead of the
-- whole run being lost. Scoped deliberately narrow: only the co-op dungeon
-- loop's level/enemy/hp state is saved - not mid-turn/mid-cascade detail,
-- not the betrayal vote, not PvP duels (those are short-lived enough that
-- losing one to a disconnect is a much smaller cost than losing a co-op run
-- that might be 20 levels deep).
--
-- Deliberate RLS exception: every other table in this file scopes access to
-- auth.uid() because each row belongs to one specific player. A co-op
-- session row belongs to a ROOM CODE that two arbitrary anonymous players
-- agreed on out of band (the same way joining the Realtime channel itself
-- already works) - there is no per-player ownership to check, and knowing
-- the room code is already this whole feature's access model. So: any
-- signed-in user (anonymous auth included) may read or write any row here.
-- This table intentionally holds nothing sensitive - no currency, no
-- identity beyond the two participants' own auth ids, which they already
-- know from being in the room's presence list.
create table if not exists public.coop_sessions (
    room_code  text primary key,
    state      jsonb not null,
    updated_at timestamptz not null default now()
);

alter table public.coop_sessions enable row level security;

drop policy if exists "read any coop session" on public.coop_sessions;
create policy "read any coop session" on public.coop_sessions
    for select using (true);

drop policy if exists "write any coop session" on public.coop_sessions;
create policy "write any coop session" on public.coop_sessions
    for all using (true) with check (true);

drop trigger if exists coop_sessions_touch_updated_at on public.coop_sessions;
create trigger coop_sessions_touch_updated_at
    before update on public.coop_sessions
    for each row execute procedure public.touch_updated_at();

-- 11. SERVER-SIDE ECONOMY GUARDS -------------------------------------------------
-- Until now, every currency/item change was a plain client-side
-- `.update()`/`.insert()` call (economy.js) - the "update own wallet"/
-- "insert own items" policies only ever checked WHOSE row it was, never
-- whether the new value made sense. A player's own browser console could
-- set their own gold to any non-negative number, or insert a "teal"
-- (Ethereal) item with hand-picked stats, and RLS would happily allow it -
-- it's their own row. This section closes both gaps: gold/materials can now
-- only change through earn_currency() (bounded, security definer) or the
-- existing resolve_betrayal()/purchase_item() paths, and every item insert
-- - however it gets there - is checked against reference data mirroring
-- items.js's own catalog before it's allowed to land.

-- Direct client writes to gold/materials are retired - every legitimate
-- path (kill rewards, betrayal payouts, shop purchases) now goes through a
-- security-definer function instead.
-- (the "update own wallet" policy is gone - see the guarded block in section 5)

-- Bounded gold/materials grant for anything that ISN'T a purchase or a
-- betrayal payout (those keep their own dedicated functions below/above) -
-- kill rewards (game.js/coop.js) and small flat bonuses (pvp.js's
-- loyal_survivor reward). The ceilings are deliberately well above any
-- reward this version of the game can produce (goldRewardForKill tops out
-- far below 500 even at very high levels) - raise them if the reward
-- formulas ever scale past that, but a client can never hand itself more
-- than these hard limits in one call regardless of what it claims earned it.
drop function if exists public.earn_currency(integer, integer);
create or replace function public.earn_currency(p_gold integer default 0, p_materials integer default 0)
returns table(gold integer, materials integer)
language plpgsql
security definer set search_path = public
as $$
begin
    if p_gold < 0 or p_gold > 500 then
        raise exception 'earn_currency: gold amount out of bounds';
    end if;
    if p_materials < 0 or p_materials > 50 then
        raise exception 'earn_currency: materials amount out of bounds';
    end if;

    -- `w` alias is load-bearing, not stylistic: this function's own
    -- `returns table(gold integer, materials integer)` declares OUT
    -- parameters named gold/materials, which shadow the bare column names
    -- inside this function's body - an unqualified `gold + p_gold` here
    -- fails at call time with "column reference is ambiguous" (a real bug
    -- caught only by actually running this against Postgres, not by static
    -- syntax checking - see the commit that added this fix).
    update public.wallets w
        set gold = w.gold + p_gold, materials = w.materials + p_materials, updated_at = now()
        where w.player_id = auth.uid();

    return query select w.gold, w.materials from public.wallets w where w.player_id = auth.uid();
end;
$$;

-- Reference data for the item-insert guard below - NOT a reimplementation
-- of items.js's random generation (that stays entirely client-side, for
-- responsiveness and to avoid a second source of truth for the roll
-- algorithm itself). This only describes the SHAPE a legitimate row is
-- allowed to have: which base_id belongs to which slot, and a generous
-- per-stat ceiling per rarity a real roll could never exceed. A client
-- bypassing items.js and inserting fabricated stats gets bounded to "at
-- best as good as a lucky legitimate roll," not "anything they type."
create table if not exists public.item_bases (
    slot         text not null,
    base_id      text not null,
    primary_stat text not null,
    primary key (slot, base_id)
);
-- Catalog columns (who may wear the base, its level band, and whether it
-- is a legacy base kept only so older items stay valid). The rows are
-- generated - see the GENERATED CATALOG block below.
alter table public.item_bases add column if not exists classes text[] not null default '{}';
alter table public.item_bases add column if not exists min_level integer not null default 1;
alter table public.item_bases add column if not exists max_level integer not null default 50;
alter table public.item_bases add column if not exists legacy boolean not null default false;

-- RLS here isn't about confidentiality (this table mirrors items.js's own
-- ITEM_BASES, already shipped in plaintext to every client) - it's that
-- Supabase grants anon/authenticated broad CRUD on public tables by default
-- and relies on RLS as the actual backstop. Without it, a client could
-- UPDATE/INSERT/DELETE rows here directly and rewrite the very allowlist
-- validate_player_item_insert checks against, defeating the whole point of
-- that trigger. Read is open to everyone (nothing secret); write has no
-- policy at all, which - once RLS is on - means no policy an anon/
-- authenticated role could ever need denies it implicitly.
alter table public.item_bases enable row level security;
drop policy if exists "read item bases" on public.item_bases;
create policy "read item bases" on public.item_bases for select using (true);

-- Procedural rarities (grey/white/blue/yellow) - affix count + per-stat
-- ceiling, derived from items.js's RARITY_DEFS.statMult and rollAffixValue's
-- baseRange at the top of their random range (mult * 1.2), rounded up with
-- headroom.
create table if not exists public.item_rarity_bounds (
    rarity          text primary key,
    max_affix_count integer not null,
    max_stat_value  integer not null
);
insert into public.item_rarity_bounds (rarity, max_affix_count, max_stat_value) values
    ('grey', 1, 5), ('white', 1, 8), ('blue', 2, 15), ('yellow', 4, 25)
on conflict (rarity) do update set max_affix_count = excluded.max_affix_count, max_stat_value = excluded.max_stat_value;

-- Same reasoning as item_bases above: without this, a client could widen
-- its own max_stat_value/max_affix_count row and then roll an item that
-- passes the (now-tampered) bound check.
alter table public.item_rarity_bounds enable row level security;
drop policy if exists "read item rarity bounds" on public.item_rarity_bounds;
create policy "read item rarity bounds" on public.item_rarity_bounds for select using (true);

-- Fixed-identity items (orange/red/teal uniques + green set pieces) - exact
-- rolled_stats allowlist, copied verbatim from items.js's UNIQUE_LEGENDARIES
-- and ITEM_SETS. These never roll, so an exact match is the correct check
-- (not a bound).
create table if not exists public.item_fixed_defs (
    rarity       text not null,
    base_id      text not null,
    rolled_stats jsonb not null,
    primary key (rarity, base_id)
);
-- Where a fixed item is worn, who may wear it and the level it needs.
alter table public.item_fixed_defs add column if not exists slot text;
alter table public.item_fixed_defs add column if not exists classes text[] not null default '{}';
alter table public.item_fixed_defs add column if not exists req_level integer not null default 1;

-- Same reasoning again: this is the exact-match allowlist for
-- orange/red/teal/green items - if a client could write to it, they could
-- insert their own row here first and then have any stats they want
-- rubber-stamped as "correct" for that rarity/base_id.
alter table public.item_fixed_defs enable row level security;
drop policy if exists "read item fixed defs" on public.item_fixed_defs;
create policy "read item fixed defs" on public.item_fixed_defs for select using (true);

-- BEGIN GENERATED CATALOG (tools/make_catalog.py - do not edit by hand)
delete from public.item_bases;
insert into public.item_bases (slot, base_id, primary_stat, classes, min_level, max_level, legacy) values
    ('helmet', 'plate_helmet_1', 'shield', array['warrior','paladin','berserker']::text[], 1, 10, false),
    ('shoulder', 'plate_shoulder_1', 'shield', array['warrior','paladin','berserker']::text[], 1, 10, false),
    ('chest', 'plate_chest_1', 'heart', array['warrior','paladin','berserker']::text[], 1, 10, false),
    ('gloves', 'plate_gloves_1', 'sword', array['warrior','paladin','berserker']::text[], 1, 10, false),
    ('legs', 'plate_legs_1', 'heart', array['warrior','paladin','berserker']::text[], 1, 10, false),
    ('boots', 'plate_boots_1', 'shield', array['warrior','paladin','berserker']::text[], 1, 10, false),
    ('helmet', 'plate_helmet_2', 'shield', array['warrior','paladin','berserker']::text[], 10, 20, false),
    ('shoulder', 'plate_shoulder_2', 'shield', array['warrior','paladin','berserker']::text[], 10, 20, false),
    ('chest', 'plate_chest_2', 'heart', array['warrior','paladin','berserker']::text[], 10, 20, false),
    ('gloves', 'plate_gloves_2', 'sword', array['warrior','paladin','berserker']::text[], 10, 20, false),
    ('legs', 'plate_legs_2', 'heart', array['warrior','paladin','berserker']::text[], 10, 20, false),
    ('boots', 'plate_boots_2', 'shield', array['warrior','paladin','berserker']::text[], 10, 20, false),
    ('helmet', 'plate_helmet_3', 'shield', array['warrior','paladin','berserker']::text[], 20, 30, false),
    ('shoulder', 'plate_shoulder_3', 'shield', array['warrior','paladin','berserker']::text[], 20, 30, false),
    ('chest', 'plate_chest_3', 'heart', array['warrior','paladin','berserker']::text[], 20, 30, false),
    ('gloves', 'plate_gloves_3', 'sword', array['warrior','paladin','berserker']::text[], 20, 30, false),
    ('legs', 'plate_legs_3', 'heart', array['warrior','paladin','berserker']::text[], 20, 30, false),
    ('boots', 'plate_boots_3', 'shield', array['warrior','paladin','berserker']::text[], 20, 30, false),
    ('helmet', 'plate_helmet_4', 'shield', array['warrior','paladin','berserker']::text[], 30, 40, false),
    ('shoulder', 'plate_shoulder_4', 'shield', array['warrior','paladin','berserker']::text[], 30, 40, false),
    ('chest', 'plate_chest_4', 'heart', array['warrior','paladin','berserker']::text[], 30, 40, false),
    ('gloves', 'plate_gloves_4', 'sword', array['warrior','paladin','berserker']::text[], 30, 40, false),
    ('legs', 'plate_legs_4', 'heart', array['warrior','paladin','berserker']::text[], 30, 40, false),
    ('boots', 'plate_boots_4', 'shield', array['warrior','paladin','berserker']::text[], 30, 40, false),
    ('helmet', 'plate_helmet_5', 'shield', array['warrior','paladin','berserker']::text[], 40, 50, false),
    ('shoulder', 'plate_shoulder_5', 'shield', array['warrior','paladin','berserker']::text[], 40, 50, false),
    ('chest', 'plate_chest_5', 'heart', array['warrior','paladin','berserker']::text[], 40, 50, false),
    ('gloves', 'plate_gloves_5', 'sword', array['warrior','paladin','berserker']::text[], 40, 50, false),
    ('legs', 'plate_legs_5', 'heart', array['warrior','paladin','berserker']::text[], 40, 50, false),
    ('boots', 'plate_boots_5', 'shield', array['warrior','paladin','berserker']::text[], 40, 50, false),
    ('helmet', 'leather_helmet_1', 'energy', array['rogue','archer','berserker']::text[], 1, 10, false),
    ('shoulder', 'leather_shoulder_1', 'energy', array['rogue','archer','berserker']::text[], 1, 10, false),
    ('chest', 'leather_chest_1', 'sword', array['rogue','archer','berserker']::text[], 1, 10, false),
    ('gloves', 'leather_gloves_1', 'lifeSteal', array['rogue','archer','berserker']::text[], 1, 10, false),
    ('legs', 'leather_legs_1', 'sword', array['rogue','archer','berserker']::text[], 1, 10, false),
    ('boots', 'leather_boots_1', 'energy', array['rogue','archer','berserker']::text[], 1, 10, false),
    ('helmet', 'leather_helmet_2', 'energy', array['rogue','archer','berserker']::text[], 10, 20, false),
    ('shoulder', 'leather_shoulder_2', 'energy', array['rogue','archer','berserker']::text[], 10, 20, false),
    ('chest', 'leather_chest_2', 'sword', array['rogue','archer','berserker']::text[], 10, 20, false),
    ('gloves', 'leather_gloves_2', 'lifeSteal', array['rogue','archer','berserker']::text[], 10, 20, false),
    ('legs', 'leather_legs_2', 'sword', array['rogue','archer','berserker']::text[], 10, 20, false),
    ('boots', 'leather_boots_2', 'energy', array['rogue','archer','berserker']::text[], 10, 20, false),
    ('helmet', 'leather_helmet_3', 'energy', array['rogue','archer','berserker']::text[], 20, 30, false),
    ('shoulder', 'leather_shoulder_3', 'energy', array['rogue','archer','berserker']::text[], 20, 30, false),
    ('chest', 'leather_chest_3', 'sword', array['rogue','archer','berserker']::text[], 20, 30, false),
    ('gloves', 'leather_gloves_3', 'lifeSteal', array['rogue','archer','berserker']::text[], 20, 30, false),
    ('legs', 'leather_legs_3', 'sword', array['rogue','archer','berserker']::text[], 20, 30, false),
    ('boots', 'leather_boots_3', 'energy', array['rogue','archer','berserker']::text[], 20, 30, false),
    ('helmet', 'leather_helmet_4', 'energy', array['rogue','archer','berserker']::text[], 30, 40, false),
    ('shoulder', 'leather_shoulder_4', 'energy', array['rogue','archer','berserker']::text[], 30, 40, false),
    ('chest', 'leather_chest_4', 'sword', array['rogue','archer','berserker']::text[], 30, 40, false),
    ('gloves', 'leather_gloves_4', 'lifeSteal', array['rogue','archer','berserker']::text[], 30, 40, false),
    ('legs', 'leather_legs_4', 'sword', array['rogue','archer','berserker']::text[], 30, 40, false),
    ('boots', 'leather_boots_4', 'energy', array['rogue','archer','berserker']::text[], 30, 40, false),
    ('helmet', 'leather_helmet_5', 'energy', array['rogue','archer','berserker']::text[], 40, 50, false),
    ('shoulder', 'leather_shoulder_5', 'energy', array['rogue','archer','berserker']::text[], 40, 50, false),
    ('chest', 'leather_chest_5', 'sword', array['rogue','archer','berserker']::text[], 40, 50, false),
    ('gloves', 'leather_gloves_5', 'lifeSteal', array['rogue','archer','berserker']::text[], 40, 50, false),
    ('legs', 'leather_legs_5', 'sword', array['rogue','archer','berserker']::text[], 40, 50, false),
    ('boots', 'leather_boots_5', 'energy', array['rogue','archer','berserker']::text[], 40, 50, false),
    ('helmet', 'cloth_helmet_1', 'ult_dmg', array['mage','necromancer']::text[], 1, 10, false),
    ('shoulder', 'cloth_shoulder_1', 'ult_dmg', array['mage','necromancer']::text[], 1, 10, false),
    ('chest', 'cloth_chest_1', 'heart', array['mage','necromancer']::text[], 1, 10, false),
    ('gloves', 'cloth_gloves_1', 'energy', array['mage','necromancer']::text[], 1, 10, false),
    ('legs', 'cloth_legs_1', 'heart', array['mage','necromancer']::text[], 1, 10, false),
    ('boots', 'cloth_boots_1', 'energy', array['mage','necromancer']::text[], 1, 10, false),
    ('helmet', 'cloth_helmet_2', 'ult_dmg', array['mage','necromancer']::text[], 10, 20, false),
    ('shoulder', 'cloth_shoulder_2', 'ult_dmg', array['mage','necromancer']::text[], 10, 20, false),
    ('chest', 'cloth_chest_2', 'heart', array['mage','necromancer']::text[], 10, 20, false),
    ('gloves', 'cloth_gloves_2', 'energy', array['mage','necromancer']::text[], 10, 20, false),
    ('legs', 'cloth_legs_2', 'heart', array['mage','necromancer']::text[], 10, 20, false),
    ('boots', 'cloth_boots_2', 'energy', array['mage','necromancer']::text[], 10, 20, false),
    ('helmet', 'cloth_helmet_3', 'ult_dmg', array['mage','necromancer']::text[], 20, 30, false),
    ('shoulder', 'cloth_shoulder_3', 'ult_dmg', array['mage','necromancer']::text[], 20, 30, false),
    ('chest', 'cloth_chest_3', 'heart', array['mage','necromancer']::text[], 20, 30, false),
    ('gloves', 'cloth_gloves_3', 'energy', array['mage','necromancer']::text[], 20, 30, false),
    ('legs', 'cloth_legs_3', 'heart', array['mage','necromancer']::text[], 20, 30, false),
    ('boots', 'cloth_boots_3', 'energy', array['mage','necromancer']::text[], 20, 30, false),
    ('helmet', 'cloth_helmet_4', 'ult_dmg', array['mage','necromancer']::text[], 30, 40, false),
    ('shoulder', 'cloth_shoulder_4', 'ult_dmg', array['mage','necromancer']::text[], 30, 40, false),
    ('chest', 'cloth_chest_4', 'heart', array['mage','necromancer']::text[], 30, 40, false),
    ('gloves', 'cloth_gloves_4', 'energy', array['mage','necromancer']::text[], 30, 40, false),
    ('legs', 'cloth_legs_4', 'heart', array['mage','necromancer']::text[], 30, 40, false),
    ('boots', 'cloth_boots_4', 'energy', array['mage','necromancer']::text[], 30, 40, false),
    ('helmet', 'cloth_helmet_5', 'ult_dmg', array['mage','necromancer']::text[], 40, 50, false),
    ('shoulder', 'cloth_shoulder_5', 'ult_dmg', array['mage','necromancer']::text[], 40, 50, false),
    ('chest', 'cloth_chest_5', 'heart', array['mage','necromancer']::text[], 40, 50, false),
    ('gloves', 'cloth_gloves_5', 'energy', array['mage','necromancer']::text[], 40, 50, false),
    ('legs', 'cloth_legs_5', 'heart', array['mage','necromancer']::text[], 40, 50, false),
    ('boots', 'cloth_boots_5', 'energy', array['mage','necromancer']::text[], 40, 50, false),
    ('helmet', 'shroud_helmet_1', 'skull_dmg', array['mage','necromancer']::text[], 1, 10, false),
    ('shoulder', 'shroud_shoulder_1', 'lifeSteal', array['mage','necromancer']::text[], 1, 10, false),
    ('chest', 'shroud_chest_1', 'heart', array['mage','necromancer']::text[], 1, 10, false),
    ('gloves', 'shroud_gloves_1', 'skull_dmg', array['mage','necromancer']::text[], 1, 10, false),
    ('legs', 'shroud_legs_1', 'heart', array['mage','necromancer']::text[], 1, 10, false),
    ('boots', 'shroud_boots_1', 'energy', array['mage','necromancer']::text[], 1, 10, false),
    ('helmet', 'shroud_helmet_2', 'skull_dmg', array['mage','necromancer']::text[], 10, 20, false),
    ('shoulder', 'shroud_shoulder_2', 'lifeSteal', array['mage','necromancer']::text[], 10, 20, false),
    ('chest', 'shroud_chest_2', 'heart', array['mage','necromancer']::text[], 10, 20, false),
    ('gloves', 'shroud_gloves_2', 'skull_dmg', array['mage','necromancer']::text[], 10, 20, false),
    ('legs', 'shroud_legs_2', 'heart', array['mage','necromancer']::text[], 10, 20, false),
    ('boots', 'shroud_boots_2', 'energy', array['mage','necromancer']::text[], 10, 20, false),
    ('helmet', 'shroud_helmet_3', 'skull_dmg', array['mage','necromancer']::text[], 20, 30, false),
    ('shoulder', 'shroud_shoulder_3', 'lifeSteal', array['mage','necromancer']::text[], 20, 30, false),
    ('chest', 'shroud_chest_3', 'heart', array['mage','necromancer']::text[], 20, 30, false),
    ('gloves', 'shroud_gloves_3', 'skull_dmg', array['mage','necromancer']::text[], 20, 30, false),
    ('legs', 'shroud_legs_3', 'heart', array['mage','necromancer']::text[], 20, 30, false),
    ('boots', 'shroud_boots_3', 'energy', array['mage','necromancer']::text[], 20, 30, false),
    ('helmet', 'shroud_helmet_4', 'skull_dmg', array['mage','necromancer']::text[], 30, 40, false),
    ('shoulder', 'shroud_shoulder_4', 'lifeSteal', array['mage','necromancer']::text[], 30, 40, false),
    ('chest', 'shroud_chest_4', 'heart', array['mage','necromancer']::text[], 30, 40, false),
    ('gloves', 'shroud_gloves_4', 'skull_dmg', array['mage','necromancer']::text[], 30, 40, false),
    ('legs', 'shroud_legs_4', 'heart', array['mage','necromancer']::text[], 30, 40, false),
    ('boots', 'shroud_boots_4', 'energy', array['mage','necromancer']::text[], 30, 40, false),
    ('helmet', 'shroud_helmet_5', 'skull_dmg', array['mage','necromancer']::text[], 40, 50, false),
    ('shoulder', 'shroud_shoulder_5', 'lifeSteal', array['mage','necromancer']::text[], 40, 50, false),
    ('chest', 'shroud_chest_5', 'heart', array['mage','necromancer']::text[], 40, 50, false),
    ('gloves', 'shroud_gloves_5', 'skull_dmg', array['mage','necromancer']::text[], 40, 50, false),
    ('legs', 'shroud_legs_5', 'heart', array['mage','necromancer']::text[], 40, 50, false),
    ('boots', 'shroud_boots_5', 'energy', array['mage','necromancer']::text[], 40, 50, false),
    ('weapon', 'sword_1', 'sword', array['warrior','paladin']::text[], 1, 10, false),
    ('weapon', 'sword_2', 'sword', array['warrior','paladin']::text[], 10, 20, false),
    ('weapon', 'sword_3', 'sword', array['warrior','paladin']::text[], 20, 30, false),
    ('weapon', 'sword_4', 'sword', array['warrior','paladin']::text[], 30, 40, false),
    ('weapon', 'sword_5', 'sword', array['warrior','paladin']::text[], 40, 50, false),
    ('weapon', 'axe_1', 'skull_dmg', array['warrior','berserker']::text[], 1, 10, false),
    ('weapon', 'axe_2', 'skull_dmg', array['warrior','berserker']::text[], 10, 20, false),
    ('weapon', 'axe_3', 'skull_dmg', array['warrior','berserker']::text[], 20, 30, false),
    ('weapon', 'axe_4', 'skull_dmg', array['warrior','berserker']::text[], 30, 40, false),
    ('weapon', 'axe_5', 'skull_dmg', array['warrior','berserker']::text[], 40, 50, false),
    ('weapon', 'greataxe_1', 'skull_dmg', array['berserker']::text[], 1, 10, false),
    ('weapon', 'greataxe_2', 'skull_dmg', array['berserker']::text[], 10, 20, false),
    ('weapon', 'greataxe_3', 'skull_dmg', array['berserker']::text[], 20, 30, false),
    ('weapon', 'greataxe_4', 'skull_dmg', array['berserker']::text[], 30, 40, false),
    ('weapon', 'greataxe_5', 'skull_dmg', array['berserker']::text[], 40, 50, false),
    ('weapon', 'mace_1', 'sword', array['warrior','paladin']::text[], 1, 10, false),
    ('weapon', 'mace_2', 'sword', array['warrior','paladin']::text[], 10, 20, false),
    ('weapon', 'mace_3', 'sword', array['warrior','paladin']::text[], 20, 30, false),
    ('weapon', 'mace_4', 'sword', array['warrior','paladin']::text[], 30, 40, false),
    ('weapon', 'mace_5', 'sword', array['warrior','paladin']::text[], 40, 50, false),
    ('weapon', 'hammer_1', 'heart', array['paladin']::text[], 1, 10, false),
    ('weapon', 'hammer_2', 'heart', array['paladin']::text[], 10, 20, false),
    ('weapon', 'hammer_3', 'heart', array['paladin']::text[], 20, 30, false),
    ('weapon', 'hammer_4', 'heart', array['paladin']::text[], 30, 40, false),
    ('weapon', 'hammer_5', 'heart', array['paladin']::text[], 40, 50, false),
    ('weapon', 'spear_1', 'skull_dmg', array['warrior']::text[], 1, 10, false),
    ('weapon', 'spear_2', 'skull_dmg', array['warrior']::text[], 10, 20, false),
    ('weapon', 'spear_3', 'skull_dmg', array['warrior']::text[], 20, 30, false),
    ('weapon', 'spear_4', 'skull_dmg', array['warrior']::text[], 30, 40, false),
    ('weapon', 'spear_5', 'skull_dmg', array['warrior']::text[], 40, 50, false),
    ('weapon', 'dagger_1', 'lifeSteal', array['rogue']::text[], 1, 10, false),
    ('weapon', 'dagger_2', 'lifeSteal', array['rogue']::text[], 10, 20, false),
    ('weapon', 'dagger_3', 'lifeSteal', array['rogue']::text[], 20, 30, false),
    ('weapon', 'dagger_4', 'lifeSteal', array['rogue']::text[], 30, 40, false),
    ('weapon', 'dagger_5', 'lifeSteal', array['rogue']::text[], 40, 50, false),
    ('weapon', 'bow_1', 'energy', array['archer']::text[], 1, 10, false),
    ('weapon', 'bow_2', 'energy', array['archer']::text[], 10, 20, false),
    ('weapon', 'bow_3', 'energy', array['archer']::text[], 20, 30, false),
    ('weapon', 'bow_4', 'energy', array['archer']::text[], 30, 40, false),
    ('weapon', 'bow_5', 'energy', array['archer']::text[], 40, 50, false),
    ('weapon', 'staff_1', 'ult_dmg', array['mage','necromancer']::text[], 1, 10, false),
    ('weapon', 'staff_2', 'ult_dmg', array['mage','necromancer']::text[], 10, 20, false),
    ('weapon', 'staff_3', 'ult_dmg', array['mage','necromancer']::text[], 20, 30, false),
    ('weapon', 'staff_4', 'ult_dmg', array['mage','necromancer']::text[], 30, 40, false),
    ('weapon', 'staff_5', 'ult_dmg', array['mage','necromancer']::text[], 40, 50, false),
    ('weapon', 'wand_1', 'energy', array['mage']::text[], 1, 10, false),
    ('weapon', 'wand_2', 'energy', array['mage']::text[], 10, 20, false),
    ('weapon', 'wand_3', 'energy', array['mage']::text[], 20, 30, false),
    ('weapon', 'wand_4', 'energy', array['mage']::text[], 30, 40, false),
    ('weapon', 'wand_5', 'energy', array['mage']::text[], 40, 50, false),
    ('weapon', 'scythe_1', 'skull_dmg', array['necromancer']::text[], 1, 10, false),
    ('weapon', 'scythe_2', 'skull_dmg', array['necromancer']::text[], 10, 20, false),
    ('weapon', 'scythe_3', 'skull_dmg', array['necromancer']::text[], 20, 30, false),
    ('weapon', 'scythe_4', 'skull_dmg', array['necromancer']::text[], 30, 40, false),
    ('weapon', 'scythe_5', 'skull_dmg', array['necromancer']::text[], 40, 50, false),
    ('offhand', 'kite_1', 'shield', array['warrior','paladin']::text[], 1, 10, false),
    ('offhand', 'kite_2', 'shield', array['warrior','paladin']::text[], 10, 20, false),
    ('offhand', 'kite_3', 'shield', array['warrior','paladin']::text[], 20, 30, false),
    ('offhand', 'kite_4', 'shield', array['warrior','paladin']::text[], 30, 40, false),
    ('offhand', 'kite_5', 'shield', array['warrior','paladin']::text[], 40, 50, false),
    ('offhand', 'tower_1', 'heart', array['warrior','paladin']::text[], 1, 10, false),
    ('offhand', 'tower_2', 'heart', array['warrior','paladin']::text[], 10, 20, false),
    ('offhand', 'tower_3', 'heart', array['warrior','paladin']::text[], 20, 30, false),
    ('offhand', 'tower_4', 'heart', array['warrior','paladin']::text[], 30, 40, false),
    ('offhand', 'tower_5', 'heart', array['warrior','paladin']::text[], 40, 50, false),
    ('offhand', 'orb_1', 'ult_dmg', array['mage']::text[], 1, 10, false),
    ('offhand', 'orb_2', 'ult_dmg', array['mage']::text[], 10, 20, false),
    ('offhand', 'orb_3', 'ult_dmg', array['mage']::text[], 20, 30, false),
    ('offhand', 'orb_4', 'ult_dmg', array['mage']::text[], 30, 40, false),
    ('offhand', 'orb_5', 'ult_dmg', array['mage']::text[], 40, 50, false),
    ('offhand', 'tome_1', 'energy', array['mage','necromancer']::text[], 1, 10, false),
    ('offhand', 'tome_2', 'energy', array['mage','necromancer']::text[], 10, 20, false),
    ('offhand', 'tome_3', 'energy', array['mage','necromancer']::text[], 20, 30, false),
    ('offhand', 'tome_4', 'energy', array['mage','necromancer']::text[], 30, 40, false),
    ('offhand', 'tome_5', 'energy', array['mage','necromancer']::text[], 40, 50, false),
    ('offhand', 'lantern_1', 'lifeSteal', array['necromancer']::text[], 1, 10, false),
    ('offhand', 'lantern_2', 'lifeSteal', array['necromancer']::text[], 10, 20, false),
    ('offhand', 'lantern_3', 'lifeSteal', array['necromancer']::text[], 20, 30, false),
    ('offhand', 'lantern_4', 'lifeSteal', array['necromancer']::text[], 30, 40, false),
    ('offhand', 'lantern_5', 'lifeSteal', array['necromancer']::text[], 40, 50, false),
    ('offhand', 'quiver_1', 'energy', array['archer']::text[], 1, 10, false),
    ('offhand', 'quiver_2', 'energy', array['archer']::text[], 10, 20, false),
    ('offhand', 'quiver_3', 'energy', array['archer']::text[], 20, 30, false),
    ('offhand', 'quiver_4', 'energy', array['archer']::text[], 30, 40, false),
    ('offhand', 'quiver_5', 'energy', array['archer']::text[], 40, 50, false),
    ('offhand', 'offdagger_1', 'sword', array['rogue']::text[], 1, 10, false),
    ('offhand', 'offdagger_2', 'sword', array['rogue']::text[], 10, 20, false),
    ('offhand', 'offdagger_3', 'sword', array['rogue']::text[], 20, 30, false),
    ('offhand', 'offdagger_4', 'sword', array['rogue']::text[], 30, 40, false),
    ('offhand', 'offdagger_5', 'sword', array['rogue']::text[], 40, 50, false),
    ('belt', 'belt_1', 'heart', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, false),
    ('belt', 'sash_1', 'energy', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, false),
    ('belt', 'belt_2', 'heart', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 10, 20, false),
    ('belt', 'sash_2', 'energy', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 10, 20, false),
    ('belt', 'belt_3', 'heart', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 20, 30, false),
    ('belt', 'sash_3', 'energy', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 20, 30, false),
    ('belt', 'belt_4', 'heart', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 30, 40, false),
    ('belt', 'sash_4', 'energy', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 30, 40, false),
    ('belt', 'belt_5', 'heart', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 40, 50, false),
    ('belt', 'sash_5', 'energy', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 40, 50, false),
    ('amulet', 'amulet_1', 'ult_dmg', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, false),
    ('ring', 'ring_1', 'lifeSteal', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, false),
    ('amulet', 'amulet_2', 'ult_dmg', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 10, 20, false),
    ('ring', 'ring_2', 'teamHeal', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 10, 20, false),
    ('amulet', 'amulet_3', 'ult_dmg', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 20, 30, false),
    ('ring', 'ring_3', 'lifeSteal', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 20, 30, false),
    ('amulet', 'amulet_4', 'ult_dmg', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 30, 40, false),
    ('ring', 'ring_4', 'teamHeal', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 30, 40, false),
    ('amulet', 'amulet_5', 'ult_dmg', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 40, 50, false),
    ('ring', 'ring_5', 'lifeSteal', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 40, 50, false),
    ('weapon', 'blade', 'sword', array['warrior','paladin']::text[], 1, 10, true),
    ('weapon', 'axe', 'skull_dmg', array['warrior','berserker']::text[], 1, 10, true),
    ('weapon', 'scepter', 'ult_dmg', array['mage','necromancer']::text[], 1, 10, true),
    ('weapon', 'dagger', 'lifeSteal', array['rogue']::text[], 1, 10, true),
    ('weapon', 'bow', 'energy', array['archer']::text[], 1, 10, true),
    ('weapon', 'spear', 'skull_dmg', array['warrior']::text[], 1, 10, true),
    ('weapon', 'mace', 'sword', array['warrior','paladin']::text[], 1, 10, true),
    ('offhand', 'kite_shield', 'shield', array['warrior','paladin']::text[], 1, 10, true),
    ('offhand', 'tower_shield', 'shield', array['warrior','paladin']::text[], 1, 10, true),
    ('offhand', 'buckler', 'shield', array['warrior','paladin']::text[], 1, 10, true),
    ('offhand', 'dragon_shield', 'heart', array['warrior','paladin']::text[], 1, 10, true),
    ('helmet', 'helm', 'shield', array['warrior','paladin','berserker']::text[], 1, 10, true),
    ('helmet', 'hood', 'energy', array['mage','necromancer','rogue','archer']::text[], 1, 10, true),
    ('helmet', 'crown', 'ult_dmg', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, true),
    ('helmet', 'skull_mask', 'skull_dmg', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, true),
    ('chest', 'breastplate', 'shield', array['warrior','paladin','berserker']::text[], 1, 10, true),
    ('chest', 'robe', 'heart', array['mage','necromancer']::text[], 1, 10, true),
    ('chest', 'leather_vest', 'sword', array['rogue','archer','berserker']::text[], 1, 10, true),
    ('chest', 'scale_armor', 'heart', array['warrior','paladin','berserker']::text[], 1, 10, true),
    ('shoulder', 'pauldron', 'shield', array['warrior','paladin','berserker']::text[], 1, 10, true),
    ('shoulder', 'spiked_pauldron', 'skull_dmg', array['warrior','paladin','berserker']::text[], 1, 10, true),
    ('shoulder', 'winged_pauldron', 'energy', array['rogue','archer','berserker']::text[], 1, 10, true),
    ('gloves', 'gauntlets', 'sword', array['warrior','paladin','berserker']::text[], 1, 10, true),
    ('gloves', 'assassin_gloves', 'lifeSteal', array['rogue','archer','berserker']::text[], 1, 10, true),
    ('gloves', 'healing_gloves', 'heart', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, true),
    ('boots', 'leather_boots', 'energy', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, true),
    ('boots', 'wind_boots', 'sword', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, true),
    ('boots', 'earth_boots', 'shield', array['warrior','paladin','berserker']::text[], 1, 10, true),
    ('amulet', 'amulet', 'energy', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, true),
    ('ring', 'ring', 'lifeSteal', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, true),
    ('amulet', 'charm', 'teamHeal', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, true),
    ('amulet', 'necklace', 'ult_dmg', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 1, 10, true);
delete from public.item_fixed_defs;
insert into public.item_fixed_defs (rarity, base_id, rolled_stats, slot, classes, req_level) values
    ('green', 'bloodied_gauntlet', '{"sword":3}', 'gloves', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 20),
    ('green', 'crimson_pauldron', '{"skull_dmg":8}', 'shoulder', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 20),
    ('green', 'iron_greaves', '{"shield":3}', 'boots', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 20),
    ('green', 'oak_shield_charm', '{"heart":2}', 'amulet', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 20),
    ('green', 'swift_boots', '{"energy":3}', 'boots', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 20),
    ('green', 'shadow_cloak', '{"energy":3}', 'chest', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 20),
    ('green', 'venom_vial', '{"skull_self_dmg":-3}', 'weapon', array['rogue']::text[], 20),
    ('green', 'frozen_crown', '{"shield":3}', 'helmet', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 20),
    ('green', 'glacier_ward', '{"heart":3}', 'offhand', array['warrior','paladin']::text[], 20),
    ('orange', 'uniq_nights_lament', '{"sword":8,"lifeSteal":6}', 'weapon', array['rogue']::text[], 30),
    ('orange', 'uniq_shield_of_eternity', '{"shield":7,"heart":7}', 'offhand', array['warrior','paladin']::text[], 30),
    ('orange', 'uniq_oracles_crown', '{"ult_dmg":16,"energy":10}', 'helmet', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 30),
    ('orange', 'uniq_dragonheart_plate', '{"shield":7,"heart":7}', 'chest', array['warrior','paladin','berserker']::text[], 30),
    ('orange', 'uniq_storm_eagle_pauldrons', '{"energy":10,"sword":8}', 'shoulder', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 30),
    ('orange', 'uniq_butchers_claws', '{"skull_dmg":14,"lifeSteal":6}', 'gloves', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 30),
    ('orange', 'uniq_windwalkers', '{"energy":10,"sword":8}', 'boots', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 30),
    ('orange', 'uniq_ring_of_ancient_wisdom', '{"ult_dmg":16,"teamHeal":6}', 'ring', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 30),
    ('teal', 'uniq_whisper_of_the_void', '{"ult_dmg":18,"lifeSteal":7}', 'weapon', array['mage','necromancer']::text[], 38),
    ('teal', 'uniq_shattered_time_aegis', '{"shield":8,"energy":12}', 'offhand', array['warrior','paladin']::text[], 38),
    ('teal', 'uniq_astral_sight', '{"energy":12,"ult_dmg":18}', 'helmet', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 38),
    ('teal', 'uniq_shroud_of_shadows', '{"shield":8,"lifeSteal":7}', 'chest', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 38),
    ('teal', 'uniq_cosmic_wings', '{"energy":12,"skull_dmg":16}', 'shoulder', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 38),
    ('teal', 'uniq_soul_rending_claws', '{"skull_dmg":16,"lifeSteal":7}', 'gloves', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 38),
    ('teal', 'uniq_voidstep', '{"energy":12,"sword":9}', 'boots', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 38),
    ('teal', 'uniq_eye_of_infinity', '{"ult_dmg":18,"teamHeal":7}', 'amulet', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 38),
    ('red', 'uniq_world_eater', '{"sword":10,"skull_dmg":18,"lifeSteal":8}', 'weapon', array['berserker']::text[], 45),
    ('red', 'uniq_the_last_wall', '{"shield":9,"heart":9,"energy":13}', 'offhand', array['warrior','paladin']::text[], 45),
    ('red', 'uniq_starfall_helm', '{"ult_dmg":20,"energy":13,"shield":9}', 'helmet', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 45),
    ('red', 'uniq_titans_hide', '{"shield":9,"heart":9,"sword":10}', 'chest', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 45),
    ('red', 'uniq_doomwings', '{"energy":13,"skull_dmg":18,"sword":10}', 'shoulder', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 45),
    ('red', 'uniq_the_throatreaver', '{"skull_dmg":18,"lifeSteal":8,"sword":10}', 'gloves', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 45),
    ('red', 'uniq_timestep_striders', '{"energy":13,"sword":10,"ult_dmg":20}', 'boots', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 45),
    ('red', 'uniq_eternity_core', '{"ult_dmg":20,"energy":13,"teamHeal":8}', 'amulet', array['warrior','paladin','berserker','rogue','archer','mage','necromancer']::text[], 45);
-- END GENERATED CATALOG

create or replace function public.validate_player_item_insert()
returns trigger
language plpgsql
as $$
declare
    v_bounds record;
    v_fixed record;
    v_base record;
    v_stat_count integer;
    v_stat_val numeric;
begin
    if new.rarity in ('orange', 'red', 'teal', 'green') then
        select * into v_fixed from public.item_fixed_defs
            where rarity = new.rarity and base_id = new.base_id;
        if not found then
            raise exception 'validate_player_item_insert: unknown fixed item %/%', new.rarity, new.base_id;
        end if;
        if new.rolled_stats <> v_fixed.rolled_stats then
            raise exception 'validate_player_item_insert: rolled_stats mismatch for %/%', new.rarity, new.base_id;
        end if;
    else
        select * into v_bounds from public.item_rarity_bounds where rarity = new.rarity;
        if not found then
            raise exception 'validate_player_item_insert: unknown rarity %', new.rarity;
        end if;
        select * into v_base from public.item_bases where slot = new.slot and base_id = new.base_id;
        if not found then
            raise exception 'validate_player_item_insert: unknown base %/%', new.slot, new.base_id;
        end if;

        select count(*) into v_stat_count from jsonb_object_keys(new.rolled_stats);
        if v_stat_count = 0 or v_stat_count > v_bounds.max_affix_count then
            raise exception 'validate_player_item_insert: % stats exceeds bound for rarity %', v_stat_count, new.rarity;
        end if;

        for v_stat_val in select abs((value)::numeric) from jsonb_each_text(new.rolled_stats) loop
            if v_stat_val > v_bounds.max_stat_value then
                raise exception 'validate_player_item_insert: stat value % exceeds bound for rarity %', v_stat_val, new.rarity;
            end if;
        end loop;
    end if;

    return new;
end;
$$;

drop trigger if exists validate_player_item_insert_trg on public.player_items;
create trigger validate_player_item_insert_trg
    before insert on public.player_items
    for each row execute function public.validate_player_item_insert();

-- Server-side purchase: was a client-side generateItem() + two separate
-- calls (adjustWallet then insert) - a client could always just skip the
-- deduction and insert the item directly, since "insert own items" only
-- ever checked identity. This does both atomically, and rolls the item
-- itself (grey/white/blue only - the only shop-purchasable rarities,
-- items.js RARITY_DEFS.shopAvailable) so the client never gets a chance to
-- supply its own stats for a purchase.
create or replace function public.purchase_item(p_slot text, p_rarity text)
returns public.player_items
language plpgsql
security definer set search_path = public
as $$
declare
    v_cost integer;
    v_affix_count integer;
    v_stat_mult numeric;
    v_base record;
    v_stats jsonb := '{}'::jsonb;
    v_row public.player_items;
    v_pool text[];
    v_pick text;
    v_base_range jsonb := '{"sword":2,"heart":2,"shield":2,"energy":3,"skull_dmg":4,"ult_dmg":5,"lifeSteal":2,"teamHeal":2,"skull_self_dmg":2}'::jsonb;
    v_i integer;
    v_rolled integer;
begin
    if p_rarity not in ('grey', 'white', 'blue') then
        raise exception 'purchase_item: rarity % is not shop-purchasable', p_rarity;
    end if;

    v_cost := round(20 * (case p_rarity when 'grey' then 0.4 when 'white' then 1 when 'blue' then 2.5 end));
    v_affix_count := case p_rarity when 'grey' then 1 when 'white' then 1 when 'blue' then 2 end;
    v_stat_mult := case p_rarity when 'grey' then 0.5 when 'white' then 1.0 when 'blue' then 1.6 end;

    update public.wallets set gold = gold - v_cost, updated_at = now()
        where player_id = auth.uid() and gold >= v_cost;
    if not found then
        raise exception 'purchase_item: insufficient gold';
    end if;

    select * into v_base from public.item_bases where slot = p_slot order by random() limit 1;
    if not found then
        raise exception 'purchase_item: unknown slot %', p_slot;
    end if;

    v_rolled := greatest(1, round((v_base_range->>v_base.primary_stat)::numeric * v_stat_mult * (0.8 + random() * 0.4)))::integer;
    v_stats := jsonb_build_object(v_base.primary_stat, v_rolled);

    select array_agg(s order by random()) into v_pool
        from unnest(array['sword','heart','shield','energy','skull_dmg','ult_dmg','lifeSteal','teamHeal','skull_self_dmg']) as s
        where s <> v_base.primary_stat;

    for v_i in 1..(v_affix_count - 1) loop
        exit when v_i > array_length(v_pool, 1);
        v_pick := v_pool[v_i];
        v_rolled := greatest(1, round((v_base_range->>v_pick)::numeric * v_stat_mult * 0.6 * (0.8 + random() * 0.4)))::integer;
        if v_pick = 'skull_self_dmg' then v_rolled := -v_rolled; end if;
        v_stats := v_stats || jsonb_build_object(v_pick, coalesce((v_stats->>v_pick)::integer, 0) + v_rolled);
    end loop;

    insert into public.player_items (player_id, base_id, slot, rarity, rolled_stats, set_key)
        values (auth.uid(), v_base.base_id, p_slot, p_rarity, v_stats, null)
        returning * into v_row;
    return v_row;
end;
$$;

-- 12. CLIENT ERROR REPORTS --------------------------------------------------
-- Write-only from the client's side (see index.html's logClientError,
-- registered before any other script loads so it also catches load-time
-- errors) - there is deliberately no SELECT policy, so the anon/authenticated
-- roles can insert a report but never read one back, including their own.
-- Reading these is a dashboard/service-role-only activity (Supabase Studio's
-- Table Editor, or a service-role query) - there is no in-app UI for it.
create table if not exists public.client_errors (
    id         uuid primary key default gen_random_uuid(),
    player_id  uuid references public.players(id) on delete set null,
    message    text not null,
    stack      text,
    url        text,
    user_agent text,
    created_at timestamptz not null default now()
);

alter table public.client_errors enable row level security;

drop policy if exists "insert error reports" on public.client_errors;
create policy "insert error reports" on public.client_errors
    for insert with check (true);

-- 13. DAILY LOGIN REWARD -----------------------------------------------------
-- Read-only from the client's side (claim_daily_reward is the only write
-- path, same "security-definer RPC, not a raw update" rule as the wallet -
-- see CLAUDE.md) - streak_count/last_claim_date could otherwise be
-- rewritten directly to fake an indefinitely long streak.
create table if not exists public.daily_login (
    player_id       uuid primary key references public.players(id) on delete cascade,
    last_claim_date date,
    streak_count    integer not null default 0,
    updated_at      timestamptz not null default now()
);

alter table public.daily_login enable row level security;

drop policy if exists "read own daily login" on public.daily_login;
create policy "read own daily login" on public.daily_login
    for select using (auth.uid() = player_id);

-- Streak logic: same calendar day as last claim -> reject (already
-- claimed); exactly the next day -> streak continues; anything else (first
-- ever claim, or a gap of 2+ days) -> streak restarts at 1. Reward grows
-- 10/15/20/25/30/35/40 through day 7 of a streak, then holds at 40 - not
-- open-ended, so a very long streak isn't worth more than a fresh one once
-- it's a week old.
--
-- Output columns are deliberately NOT named gold/materials/streak_count/
-- last_claim_date - RETURNS TABLE(...) declares those as OUT parameters in
-- this function's own scope, which would shadow the wallets/daily_login
-- columns of the same name and cause exactly the "column reference is
-- ambiguous" runtime error earn_currency shipped with initially (see that
-- function's own comment) - avoided here by construction instead of by a
-- table alias.
drop function if exists public.claim_daily_reward();
create or replace function public.claim_daily_reward()
returns table(new_gold integer, new_streak integer, reward_gold integer)
language plpgsql
security definer set search_path = public
as $$
declare
    v_row public.daily_login;
    v_today date := current_date;
    v_streak integer;
    v_reward integer;
begin
    select * into v_row from public.daily_login where player_id = auth.uid();

    if not found then
        v_streak := 1;
        insert into public.daily_login (player_id, last_claim_date, streak_count)
            values (auth.uid(), v_today, v_streak);
    elsif v_row.last_claim_date = v_today then
        raise exception 'claim_daily_reward: already claimed today';
    else
        v_streak := (case when v_row.last_claim_date = v_today - 1 then v_row.streak_count + 1 else 1 end);
        update public.daily_login set last_claim_date = v_today, streak_count = v_streak, updated_at = now()
            where player_id = auth.uid();
    end if;

    v_reward := 10 + (least(v_streak, 7) - 1) * 5;

    update public.wallets w set gold = w.gold + v_reward, updated_at = now() where w.player_id = auth.uid();

    return query select w.gold, v_streak, v_reward from public.wallets w where w.player_id = auth.uid();
end;
$$;

-- 14. DAILY QUESTS -----------------------------------------------------------
-- Three fixed daily quests (same for everyone, no rotation) - each is a
-- single-trigger "I just did the thing" claim rather than a cumulative
-- counter (e.g. "3 boss kills"), which would need real server-tracked game
-- state to validate honestly. A client can only ever claim a quest once per
-- calendar day regardless of how many times it calls this - the actual
-- trigger points (game.js/coop.js's boss-kill, pvp.js's match win, all
-- three modes' useUltimate) are each a real, already-happening event, not
-- something free to spam for reward.
create table if not exists public.daily_quests (
    player_id  uuid not null references public.players(id) on delete cascade,
    quest_date date not null,
    quest_key  text not null check (quest_key in ('kill_boss', 'win_pvp', 'use_ultimate')),
    claimed_at timestamptz not null default now(),
    primary key (player_id, quest_date, quest_key)
);

alter table public.daily_quests enable row level security;

drop policy if exists "read own daily quests" on public.daily_quests;
create policy "read own daily quests" on public.daily_quests
    for select using (auth.uid() = player_id);

-- Output column deliberately not named gold/reward_gold in a way that could
-- collide with a table column or another local var - see earn_currency's
-- own comment for why this matters (a real bug there, not a hypothetical).
drop function if exists public.claim_daily_quest(text);
create or replace function public.claim_daily_quest(p_quest_key text)
returns table(quest_gold integer, already_claimed boolean)
language plpgsql
security definer set search_path = public
as $$
declare
    v_reward integer;
    v_today date := current_date;
begin
    if p_quest_key not in ('kill_boss', 'win_pvp', 'use_ultimate') then
        raise exception 'claim_daily_quest: unknown quest %', p_quest_key;
    end if;

    insert into public.daily_quests (player_id, quest_date, quest_key)
        values (auth.uid(), v_today, p_quest_key)
        on conflict (player_id, quest_date, quest_key) do nothing;

    if not found then
        return query select 0, true;
        return;
    end if;

    v_reward := 15;
    update public.wallets w set gold = w.gold + v_reward, updated_at = now() where w.player_id = auth.uid();

    return query select v_reward, false;
end;
$$;

-- 15. CLOSE A GAP FOUND WHILE BUILDING THE NEXT SECTION -----------------------
-- "update own items" (section 7) only ever checked row OWNERSHIP, never
-- WHICH COLUMNS changed - it was written for equip/unequip
-- (economy.js's equipItem/unequipItem, the only client-side .update() call
-- on this table), but as written a client could just as easily
-- .update({ rarity: 'teal', rolled_stats: {...anything...} }) on their own
-- row and rewrite any item into anything, completely bypassing both the
-- shop and validate_player_item_insert (which - being BEFORE INSERT - never
-- runs on an UPDATE at all). Found while designing upgrade_item() below,
-- which legitimately DOES need to change rarity/rolled_stats - it marks
-- itself trusted via a transaction-local setting so this trigger lets it
-- through; every other caller (i.e. a direct client update) may only ever
-- change equipped_slot.
create or replace function public.validate_player_item_update()
returns trigger
language plpgsql
as $$
begin
    if current_setting('app.trusted_item_update', true) = 'true' then
        return new;
    end if;
    if new.base_id <> old.base_id or new.slot <> old.slot or new.rarity <> old.rarity
        or new.rolled_stats <> old.rolled_stats or coalesce(new.set_key, '') <> coalesce(old.set_key, '') then
        raise exception 'validate_player_item_update: only equipped_slot may be changed directly';
    end if;
    return new;
end;
$$;

drop trigger if exists validate_player_item_update_trg on public.player_items;
create trigger validate_player_item_update_trg
    before update on public.player_items
    for each row execute function public.validate_player_item_update();

-- 16. ITEM SCRAP & UPGRADE ----------------------------------------------------
-- `materials` existed since the very first version of this schema but had
-- no real source or sink beyond the tiny PvP loyalty bonus - scrapping an
-- unwanted item is now the main way to earn them, upgrading a procedural
-- item the main way to spend them.

create table if not exists public.item_scrap_values (
    rarity    text primary key,
    materials integer not null
);
insert into public.item_scrap_values (rarity, materials) values
    ('grey', 1), ('white', 2), ('blue', 4), ('yellow', 8),
    ('green', 15), ('orange', 15), ('red', 15), ('teal', 15)
on conflict (rarity) do update set materials = excluded.materials;

alter table public.item_scrap_values enable row level security;
drop policy if exists "read item scrap values" on public.item_scrap_values;
create policy "read item scrap values" on public.item_scrap_values for select using (true);

-- Deletes an owned, unequipped item and grants materials for it. There is
-- no DELETE policy on player_items at all - only this security-definer
-- function can remove a row (it runs as the table owner, bypassing RLS,
-- and enforces ownership itself via the player_id = auth.uid() check below
-- rather than relying on a policy).
create or replace function public.scrap_item(p_item_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
    v_item public.player_items;
    v_materials integer;
begin
    select * into v_item from public.player_items where id = p_item_id and player_id = auth.uid();
    if not found then
        raise exception 'scrap_item: item not found or not yours';
    end if;
    if v_item.equipped_slot is not null then
        raise exception 'scrap_item: unequip it first';
    end if;

    select materials into v_materials from public.item_scrap_values where rarity = v_item.rarity;
    v_materials := coalesce(v_materials, 1);

    delete from public.player_items where id = p_item_id and player_id = auth.uid();
    update public.wallets w set materials = w.materials + v_materials, updated_at = now() where w.player_id = auth.uid();

    return v_materials;
end;
$$;

-- Alternative to scrapping - converts an unwanted item to gold instead of
-- materials, so a player who's flush on materials but short on gold (or
-- vice versa) has a real choice instead of only ever getting materials back.
-- Values are flat per rarity rather than a fraction of purchase_item's cost,
-- since orange/red/teal/green are never purchasable at all (see items.js's
-- RARITY_DEFS) and still need a sensible sell price.
create table if not exists public.item_sell_values (
    rarity text primary key,
    gold   integer not null
);
insert into public.item_sell_values (rarity, gold) values
    ('grey', 5), ('white', 15), ('blue', 35), ('yellow', 80),
    ('green', 150), ('orange', 200), ('red', 300), ('teal', 400)
on conflict (rarity) do update set gold = excluded.gold;

alter table public.item_sell_values enable row level security;
drop policy if exists "read item sell values" on public.item_sell_values;
create policy "read item sell values" on public.item_sell_values for select using (true);

-- Mirrors scrap_item exactly, just paying gold from item_sell_values
-- instead of materials from item_scrap_values.
create or replace function public.sell_item(p_item_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
    v_item public.player_items;
    v_gold integer;
begin
    select * into v_item from public.player_items where id = p_item_id and player_id = auth.uid();
    if not found then
        raise exception 'sell_item: item not found or not yours';
    end if;
    if v_item.equipped_slot is not null then
        raise exception 'sell_item: unequip it first';
    end if;

    select gold into v_gold from public.item_sell_values where rarity = v_item.rarity;
    v_gold := coalesce(v_gold, 1);

    delete from public.player_items where id = p_item_id and player_id = auth.uid();
    update public.wallets w set gold = w.gold + v_gold, updated_at = now() where w.player_id = auth.uid();

    return v_gold;
end;
$$;

-- Procedural rarities only (grey/white/blue -> next tier up) - yellow is
-- the ceiling reached this way, never upgraded further; orange/red/teal/
-- green are fixed-identity and never roll (UNIQUE_LEGENDARIES/ITEM_SETS,
-- items.js), so "upgrading" one has no meaning. Rerolls the item's stats
-- fresh at the new tier (same shape as purchase_item's own roll) rather
-- than scaling the existing numbers - equip status carries over.
create table if not exists public.item_upgrade_costs (
    from_rarity   text primary key,
    to_rarity     text not null,
    gold_cost     integer not null,
    material_cost integer not null
);
insert into public.item_upgrade_costs (from_rarity, to_rarity, gold_cost, material_cost) values
    ('grey', 'white', 20, 2),
    ('white', 'blue', 50, 5),
    ('blue', 'yellow', 120, 12)
on conflict (from_rarity) do update set to_rarity = excluded.to_rarity, gold_cost = excluded.gold_cost, material_cost = excluded.material_cost;

alter table public.item_upgrade_costs enable row level security;
drop policy if exists "read item upgrade costs" on public.item_upgrade_costs;
create policy "read item upgrade costs" on public.item_upgrade_costs for select using (true);

create or replace function public.upgrade_item(p_item_id uuid)
returns public.player_items
language plpgsql
security definer set search_path = public
as $$
declare
    v_item public.player_items;
    v_cost public.item_upgrade_costs;
    v_base_range jsonb := '{"sword":2,"heart":2,"shield":2,"energy":3,"skull_dmg":4,"ult_dmg":5,"lifeSteal":2,"teamHeal":2,"skull_self_dmg":2}'::jsonb;
    v_affix_count integer;
    v_stat_mult numeric;
    v_stats jsonb := '{}'::jsonb;
    v_primary_stat text;
    v_pool text[];
    v_pick text;
    v_rolled integer;
    v_i integer;
    v_row public.player_items;
begin
    select * into v_item from public.player_items where id = p_item_id and player_id = auth.uid();
    if not found then
        raise exception 'upgrade_item: item not found or not yours';
    end if;

    select * into v_cost from public.item_upgrade_costs where from_rarity = v_item.rarity;
    if not found then
        raise exception 'upgrade_item: % cannot be upgraded', v_item.rarity;
    end if;

    update public.wallets w set gold = w.gold - v_cost.gold_cost, materials = w.materials - v_cost.material_cost, updated_at = now()
        where w.player_id = auth.uid() and w.gold >= v_cost.gold_cost and w.materials >= v_cost.material_cost;
    if not found then
        raise exception 'upgrade_item: insufficient gold or materials';
    end if;

    v_affix_count := case v_cost.to_rarity when 'white' then 1 when 'blue' then 2 when 'yellow' then 4 end;
    v_stat_mult := case v_cost.to_rarity when 'white' then 1.0 when 'blue' then 1.6 when 'yellow' then 2.4 end;

    select primary_stat into v_primary_stat from public.item_bases where slot = v_item.slot and base_id = v_item.base_id;
    if v_primary_stat is null then
        raise exception 'upgrade_item: unknown base %/%', v_item.slot, v_item.base_id;
    end if;

    v_rolled := greatest(1, round((v_base_range->>v_primary_stat)::numeric * v_stat_mult * (0.8 + random() * 0.4)))::integer;
    v_stats := jsonb_build_object(v_primary_stat, v_rolled);

    select array_agg(s order by random()) into v_pool
        from unnest(array['sword','heart','shield','energy','skull_dmg','ult_dmg','lifeSteal','teamHeal','skull_self_dmg']) as s
        where s <> v_primary_stat;

    for v_i in 1..(v_affix_count - 1) loop
        exit when v_i > array_length(v_pool, 1);
        v_pick := v_pool[v_i];
        v_rolled := greatest(1, round((v_base_range->>v_pick)::numeric * v_stat_mult * 0.6 * (0.8 + random() * 0.4)))::integer;
        if v_pick = 'skull_self_dmg' then v_rolled := -v_rolled; end if;
        v_stats := v_stats || jsonb_build_object(v_pick, coalesce((v_stats->>v_pick)::integer, 0) + v_rolled);
    end loop;

    perform set_config('app.trusted_item_update', 'true', true);
    update public.player_items
        set rarity = v_cost.to_rarity, rolled_stats = v_stats
        where id = p_item_id and player_id = auth.uid()
        returning * into v_row;

    return v_row;
end;
$$;

-- 17. ANALYTICS EVENTS ---------------------------------------------------------
-- Write-only from the client (trackEvent, economy.js) - same shape as
-- client_errors: no SELECT policy at all, so this is a dashboard/service-
-- role-only read (Supabase Studio's Table Editor or a service-role query),
-- never something the game itself displays. Exists so future roadmap
-- decisions (which class/mode gets played, where a run tends to end, which
-- items get bought) can be based on what players actually do instead of a
-- guess - see the roadmap's own Faz 5 "Analytics/telemetri" item.
create table if not exists public.analytics_events (
    id         uuid primary key default gen_random_uuid(),
    player_id  uuid references public.players(id) on delete set null,
    event_name text not null,
    event_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

alter table public.analytics_events enable row level security;

drop policy if exists "insert analytics events" on public.analytics_events;
create policy "insert analytics events" on public.analytics_events
    for insert with check (true);

-- 18. PvP ranked rating (ELO) ----------------------------------------------------
-- Every player starts at 1000. Only the WINNING client ever calls
-- resolve_pvp_match - the same "one authoritative caller" rule
-- pvpResolveBetrayalPayoutIfNeeded (pvp.js) already relies on for the
-- betrayal currency steal, so this doesn't introduce a new trust pattern.
-- A client can SELECT its own row directly (RLS below) but can never write
-- one - rating/wins/losses only ever change inside this security-definer
-- function, so a client cannot inflate its own rating or tamper with an
-- opponent's.
create table if not exists public.pvp_ratings (
    player_id  uuid primary key references public.players(id) on delete cascade,
    rating     integer not null default 1000,
    wins       integer not null default 0,
    losses     integer not null default 0,
    updated_at timestamptz not null default now()
);

alter table public.pvp_ratings enable row level security;

drop policy if exists "read own pvp rating" on public.pvp_ratings;
create policy "read own pvp rating" on public.pvp_ratings
    for select using (auth.uid() = player_id);

-- Standard ELO with K=32, floored at a minimum +1 gain for the winner (and
-- a matching loss for the loser) so a huge rating gap can never round down
-- to a 0-point match - every match has to move the needle a little.
drop function if exists public.resolve_pvp_match(uuid);
create or replace function public.resolve_pvp_match(p_loser_id uuid)
returns table(new_winner_rating integer, new_loser_rating integer, rating_delta integer)
language plpgsql
security definer set search_path = public
as $$
declare
    v_winner_id     uuid := auth.uid();
    v_winner_rating integer;
    v_loser_rating  integer;
    v_expected      numeric;
    v_delta         integer;
    k               constant integer := 32;
begin
    if v_winner_id is null or p_loser_id is null or v_winner_id = p_loser_id then
        raise exception 'invalid pvp match participants';
    end if;

    insert into public.pvp_ratings (player_id) values (v_winner_id)
        on conflict (player_id) do nothing;
    insert into public.pvp_ratings (player_id) values (p_loser_id)
        on conflict (player_id) do nothing;

    select pr.rating into v_winner_rating from public.pvp_ratings pr where pr.player_id = v_winner_id;
    select pr.rating into v_loser_rating from public.pvp_ratings pr where pr.player_id = p_loser_id;

    v_expected := 1.0 / (1.0 + power(10, (v_loser_rating - v_winner_rating) / 400.0));
    v_delta := greatest(1, round(k * (1 - v_expected)));

    update public.pvp_ratings pr set rating = pr.rating + v_delta, wins = pr.wins + 1, updated_at = now()
        where pr.player_id = v_winner_id;
    update public.pvp_ratings pr set rating = greatest(0, pr.rating - v_delta), losses = pr.losses + 1, updated_at = now()
        where pr.player_id = p_loser_id;

    return query select (v_winner_rating + v_delta), greatest(0, v_loser_rating - v_delta), v_delta;
end;
$$;

grant execute on function public.resolve_pvp_match(uuid) to authenticated;

-- Same "security definer function is the only cross-player read" pattern as
-- get_leaderboard above - never exposes a player id, just name + record.
drop function if exists public.get_pvp_leaderboard(integer);
create or replace function public.get_pvp_leaderboard(limit_count integer default 10)
returns table(display_name text, rating integer, wins integer, losses integer)
language sql
security definer set search_path = public
stable
as $$
    select coalesce(p.display_name, 'İsimsiz Kahraman'), r.rating, r.wins, r.losses
    from public.pvp_ratings r
    join public.players p on p.id = r.player_id
    order by r.rating desc
    limit greatest(1, least(limit_count, 50));
$$;

grant execute on function public.get_pvp_leaderboard(integer) to authenticated, anon;

-- 19. PvP quick-match queue -------------------------------------------------------
-- Until now, two players had to coordinate a room code out of band (Discord,
-- shouting across the room) to find each other for a PvP Test match. This
-- adds a lightweight polling-based matchmaker: a client calls find_pvp_match
-- every couple seconds; the function either pairs it with another currently-
-- waiting player (assigning both a freshly generated room code) or reports
-- "still waiting". No Realtime channel needed for the queue itself - once
-- matched, both clients join the assigned room exactly like a manually typed
-- code would, so this only replaces how the code is agreed on, not the
-- actual match connection (pvpConnectChannel, pvp.js).
create table if not exists public.pvp_queue (
    player_id    uuid primary key references public.players(id) on delete cascade,
    queued_at    timestamptz not null default now(),
    matched_room text
);

alter table public.pvp_queue enable row level security;

drop policy if exists "read own queue row" on public.pvp_queue;
create policy "read own queue row" on public.pvp_queue
    for select using (auth.uid() = player_id);

-- No insert/update/delete policy for clients - find_pvp_match and
-- leave_pvp_queue (both security definer) are the only writers, same "RLS
-- lets you read your own row, a trusted function is the only way to change
-- it" shape as pvp_ratings above.
create or replace function public.find_pvp_match()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
    v_me       uuid := auth.uid();
    v_room     text;
    v_opponent uuid;
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;

    -- A player who queued then closed the tab (or lost connection) without
    -- cancelling would otherwise sit in the queue forever, waiting to be
    -- matched with someone who'll never show up - drop anything stale before
    -- searching.
    delete from public.pvp_queue where queued_at < now() - interval '90 seconds';

    -- Someone else's call may have already matched me since my last poll -
    -- check my own row before doing anything else.
    select pq.matched_room into v_room from public.pvp_queue pq where pq.player_id = v_me;
    if v_room is not null then
        return v_room;
    end if;
    if not found then
        insert into public.pvp_queue (player_id) values (v_me);
    end if;

    -- "for update skip locked" so two players polling at the same instant
    -- can never both claim the same waiting opponent - the loser of that
    -- race just finds no one this poll and tries again next one.
    select pq.player_id into v_opponent
        from public.pvp_queue pq
        where pq.player_id != v_me and pq.matched_room is null
        order by pq.queued_at asc
        limit 1
        for update skip locked;

    if v_opponent is null then
        return null;
    end if;

    v_room := 'mm' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

    update public.pvp_queue set matched_room = v_room where player_id = v_me;
    update public.pvp_queue set matched_room = v_room where player_id = v_opponent;

    return v_room;
end;
$$;

grant execute on function public.find_pvp_match() to authenticated;

create or replace function public.leave_pvp_queue()
returns void
language sql
security definer set search_path = public
as $$
    delete from public.pvp_queue where player_id = auth.uid();
$$;

grant execute on function public.leave_pvp_queue() to authenticated;

-- 20. Friends list ------------------------------------------------------------------
-- Friend requests are looked up by display_name, so it has to actually be
-- unique from here on - it wasn't before (nothing needed it to be). Multiple
-- NULLs are still allowed (players who never set one), only non-null values
-- collide. If this fails, it means two existing players already share a
-- name - whoever set theirs more recently will need to change it (leaderboard
-- modal, "Kaydet") before this can be re-run.
--
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so a plain re-run of this
-- file fails with "already exists" (42P07) once this constraint has been
-- created once - drop-then-add, same idempotent shape as this file's
-- function definitions.
alter table public.players drop constraint if exists players_display_name_unique;
alter table public.players add constraint players_display_name_unique unique (display_name);

-- A client can only ever SELECT its own player row ("read own player row"),
-- so resolving a target's id from a typed display name - and letting a
-- client act on ANOTHER player's incoming request - both have to go through
-- a trusted function, same reasoning as get_leaderboard/resolve_pvp_match.
create table if not exists public.friendships (
    requester_id uuid not null references public.players(id) on delete cascade,
    addressee_id uuid not null references public.players(id) on delete cascade,
    status       text not null default 'pending' check (status in ('pending', 'accepted')),
    created_at   timestamptz not null default now(),
    primary key (requester_id, addressee_id),
    check (requester_id != addressee_id)
);

alter table public.friendships enable row level security;

drop policy if exists "read own friendships" on public.friendships;
create policy "read own friendships" on public.friendships
    for select using (auth.uid() = requester_id or auth.uid() = addressee_id);

create or replace function public.send_friend_request(p_display_name text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
    v_me     uuid := auth.uid();
    v_target uuid;
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;

    select id into v_target from public.players
        where display_name = trim(p_display_name) and id != v_me;

    if v_target is null then
        return 'not_found';
    end if;

    if exists (
        select 1 from public.friendships f
        where (f.requester_id = v_me and f.addressee_id = v_target)
           or (f.requester_id = v_target and f.addressee_id = v_me)
    ) then
        return 'already_exists';
    end if;

    insert into public.friendships (requester_id, addressee_id, status)
        values (v_me, v_target, 'pending');

    return 'sent';
end;
$$;

grant execute on function public.send_friend_request(text) to authenticated;

create or replace function public.respond_friend_request(p_requester_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;

    if p_accept then
        update public.friendships set status = 'accepted'
            where requester_id = p_requester_id and addressee_id = v_me and status = 'pending';
    else
        delete from public.friendships
            where requester_id = p_requester_id and addressee_id = v_me and status = 'pending';
    end if;
end;
$$;

grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

-- Projects the OTHER party's display name for each of my friendships
-- (direction-agnostic - I may be either requester or addressee), plus
-- whether a pending row is an incoming request (someone else waiting on ME)
-- so the client can tell "waiting for them to accept" apart from "they're
-- waiting on me to respond".
drop function if exists public.get_friends_list();
create or replace function public.get_friends_list()
returns table(friend_id uuid, display_name text, status text, is_incoming_request boolean)
language sql
security definer set search_path = public
stable
as $$
    select
        case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end,
        coalesce(p.display_name, 'İsimsiz Kahraman'),
        f.status,
        (f.status = 'pending' and f.addressee_id = auth.uid())
    from public.friendships f
    join public.players p
        on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
    where f.requester_id = auth.uid() or f.addressee_id = auth.uid()
    order by f.status desc, 2 asc;
$$;

grant execute on function public.get_friends_list() to authenticated;

-- 21. Guilds -------------------------------------------------------------------------
-- One guild per player at most (guild_members.player_id is its own primary
-- key, not part of a composite one) - simpler than supporting multiple
-- memberships, and matches how this feature is actually pitched to players
-- (join a team, not several).
create table if not exists public.guilds (
    id         uuid primary key default gen_random_uuid(),
    name       text not null unique,
    owner_id   uuid not null references public.players(id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.guilds enable row level security;

-- Guild names/rosters are meant to be browsable (so a player can find one to
-- join), unlike everything else in this file - open read, no auth.uid()
-- check at all.
drop policy if exists "read all guilds" on public.guilds;
create policy "read all guilds" on public.guilds
    for select using (true);

create table if not exists public.guild_members (
    player_id uuid primary key references public.players(id) on delete cascade,
    guild_id  uuid not null references public.guilds(id) on delete cascade,
    role      text not null default 'member' check (role in ('owner', 'member')),
    joined_at timestamptz not null default now()
);

alter table public.guild_members enable row level security;

-- A client can read its own membership row, or any row belonging to the
-- SAME guild it's in (self-referencing subquery) - so a member can see
-- their teammates, but not every other guild's roster.
drop policy if exists "read own guild roster" on public.guild_members;
create policy "read own guild roster" on public.guild_members
    for select using (
        player_id = auth.uid()
        or guild_id in (select gm.guild_id from public.guild_members gm where gm.player_id = auth.uid())
    );

create or replace function public.create_guild(p_name text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
    v_me       uuid := auth.uid();
    v_guild_id uuid;
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;

    if exists (select 1 from public.guild_members where player_id = v_me) then
        raise exception 'already in a guild';
    end if;

    insert into public.guilds (name, owner_id) values (trim(p_name), v_me)
        returning id into v_guild_id;

    insert into public.guild_members (player_id, guild_id, role) values (v_me, v_guild_id, 'owner');

    return v_guild_id;
end;
$$;

grant execute on function public.create_guild(text) to authenticated;

create or replace function public.join_guild(p_guild_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;

    if exists (select 1 from public.guild_members where player_id = v_me) then
        raise exception 'already in a guild';
    end if;

    if not exists (select 1 from public.guilds where id = p_guild_id) then
        raise exception 'guild not found';
    end if;

    insert into public.guild_members (player_id, guild_id, role) values (v_me, p_guild_id, 'member');
end;
$$;

grant execute on function public.join_guild(uuid) to authenticated;

-- If the owner leaves and teammates remain, ownership passes to whoever
-- joined earliest (simple, deterministic succession) - if no teammates
-- remain, the guild itself is deleted (its membership row is already gone
-- by this point, so there'd be nothing left in it anyway).
create or replace function public.leave_guild()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    v_me          uuid := auth.uid();
    v_guild_id    uuid;
    v_was_owner   boolean;
    v_next_owner  uuid;
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;

    select guild_id, (role = 'owner') into v_guild_id, v_was_owner
        from public.guild_members where player_id = v_me;

    if v_guild_id is null then
        return;
    end if;

    delete from public.guild_members where player_id = v_me;

    if v_was_owner then
        select gm.player_id into v_next_owner from public.guild_members gm
            where gm.guild_id = v_guild_id order by gm.joined_at asc limit 1;

        if v_next_owner is null then
            delete from public.guilds where id = v_guild_id;
        else
            update public.guild_members set role = 'owner' where player_id = v_next_owner;
            update public.guilds set owner_id = v_next_owner where id = v_guild_id;
        end if;
    end if;
end;
$$;

grant execute on function public.leave_guild() to authenticated;

-- players.display_name can't be joined directly against guild_members from
-- the client (RLS only allows reading your OWN player row), same reasoning
-- as get_friends_list above.
-- guild_name repeats on every row (denormalized) rather than needing a
-- second round trip - cheap for a roster that's realistically a handful of
-- rows, and keeps the client to one call for the whole guild panel.
drop function if exists public.get_my_guild_roster();
create or replace function public.get_my_guild_roster()
returns table(player_id uuid, display_name text, role text, joined_at timestamptz, guild_name text)
language sql
security definer set search_path = public
stable
as $$
    select gm.player_id, coalesce(p.display_name, 'İsimsiz Kahraman'), gm.role, gm.joined_at, g.name
    from public.guild_members gm
    join public.players p on p.id = gm.player_id
    join public.guilds g on g.id = gm.guild_id
    where gm.guild_id = (select guild_id from public.guild_members where player_id = auth.uid())
    order by gm.role asc, gm.joined_at asc;
$$;

grant execute on function public.get_my_guild_roster() to authenticated;

drop function if exists public.get_guild_list(integer);
create or replace function public.get_guild_list(limit_count integer default 20)
returns table(guild_id uuid, name text, member_count bigint)
language sql
security definer set search_path = public
stable
as $$
    select g.id, g.name, count(gm.player_id)
    from public.guilds g
    left join public.guild_members gm on gm.guild_id = g.id
    group by g.id, g.name
    order by count(gm.player_id) desc, g.name asc
    limit greatest(1, least(limit_count, 50));
$$;

grant execute on function public.get_guild_list(integer) to authenticated, anon;

-- 22. Direct messages (friends only) --------------------------------------------------
-- Deliberately scoped to accepted friends only, not an open global chat -
-- an unmoderated public chat between anonymous players is a real abuse
-- vector (harassment, spam) this project has no moderation tooling for yet;
-- gating on mutual friendship (already itself a two-sided opt-in) keeps the
-- blast radius of a bad actor to people who already chose to connect with
-- them, and gives a target an existing, obvious remedy (remove the friend).
create table if not exists public.direct_messages (
    id          uuid primary key default gen_random_uuid(),
    sender_id   uuid not null references public.players(id) on delete cascade,
    receiver_id uuid not null references public.players(id) on delete cascade,
    body        text not null check (char_length(body) between 1 and 500),
    created_at  timestamptz not null default now()
);

alter table public.direct_messages enable row level security;

drop policy if exists "read own messages" on public.direct_messages;
create policy "read own messages" on public.direct_messages
    for select using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- No insert policy for clients - RLS alone can only check row ownership,
-- never "does a friendship exist between these two", so send_direct_message
-- (security definer) is the only way a row gets created.
create or replace function public.send_direct_message(p_receiver_id uuid, p_body text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    v_me   uuid := auth.uid();
    v_body text := trim(p_body);
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;
    if v_body = '' or char_length(v_body) > 500 then
        raise exception 'invalid message';
    end if;
    if v_me = p_receiver_id then
        raise exception 'cannot message yourself';
    end if;

    if not exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and ((f.requester_id = v_me and f.addressee_id = p_receiver_id)
            or (f.requester_id = p_receiver_id and f.addressee_id = v_me))
    ) then
        raise exception 'not friends';
    end if;

    insert into public.direct_messages (sender_id, receiver_id, body) values (v_me, p_receiver_id, v_body);
end;
$$;

grant execute on function public.send_direct_message(uuid, text) to authenticated;

-- Plain SECURITY INVOKER (the default - no "security definer" here), unlike
-- every other cross-player function in this file: "read own messages"
-- above already scopes this correctly for the calling user, so there's
-- nothing to bypass and no reason to widen the trusted surface.
drop function if exists public.get_conversation(uuid, integer);
create or replace function public.get_conversation(p_friend_id uuid, limit_count integer default 50)
returns table(sender_id uuid, body text, created_at timestamptz)
language sql
stable
as $$
    select dm.sender_id, dm.body, dm.created_at
    from public.direct_messages dm
    where (dm.sender_id = auth.uid() and dm.receiver_id = p_friend_id)
       or (dm.sender_id = p_friend_id and dm.receiver_id = auth.uid())
    order by dm.created_at desc
    limit greatest(1, least(limit_count, 200));
$$;

grant execute on function public.get_conversation(uuid, integer) to authenticated;

-- 23. Cosmetic titles (Phase 3) --------------------------------------------------------
-- No dedicated "unlocked titles" tracking table - eligibility is computed
-- live off data that already exists (pvp_ratings, wallets, friendships,
-- guild_members), so there's nothing new to keep in sync as a player's
-- progress changes over time. Only the currently EQUIPPED title is actually
-- stored, on players itself.
alter table public.players add column if not exists equipped_title text;

drop function if exists public.get_available_titles();
create or replace function public.get_available_titles()
returns table(title text, description text, unlocked boolean)
language sql
security definer set search_path = public
stable
as $$
    with mine as (
        select
            coalesce((select r.rating from public.pvp_ratings r where r.player_id = auth.uid()), 0) as pvp_rating,
            coalesce((select r.wins from public.pvp_ratings r where r.player_id = auth.uid()), 0) as pvp_wins,
            coalesce((select w.gold from public.wallets w where w.player_id = auth.uid()), 0) as gold,
            exists(select 1 from public.friendships f where f.status = 'accepted' and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())) as has_friend,
            exists(select 1 from public.guild_members gm where gm.player_id = auth.uid() and gm.role = 'owner') as is_guild_owner,
            exists(select 1 from public.seasonal_event_claims sec where sec.player_id = auth.uid() and sec.event_key = 'pioneer_launch') as claimed_pioneer
    )
    select 'Şampiyon', 'PvP derecen 1200+ olsun', (pvp_rating >= 1200) from mine
    union all
    select 'Gazi', '10+ PvP galibiyeti kazan', (pvp_wins >= 10) from mine
    union all
    select 'Zengin', '1000+ altına sahip ol', (gold >= 1000) from mine
    union all
    select 'Sadık Dost', 'En az bir arkadaş edin', has_friend from mine
    union all
    select 'Lonca Lideri', 'Bir loncanın lideri ol', is_guild_owner from mine
    union all
    select 'Öncü', 'Açılış Kutlaması etkinliğine katıl', claimed_pioneer from mine;
$$;

grant execute on function public.get_available_titles() to authenticated;

create or replace function public.set_equipped_title(p_title text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    v_me       uuid := auth.uid();
    v_unlocked boolean;
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;

    if p_title is null then
        update public.players set equipped_title = null where id = v_me;
        return;
    end if;

    select t.unlocked into v_unlocked from public.get_available_titles() t where t.title = p_title;

    if not coalesce(v_unlocked, false) then
        raise exception 'title not unlocked';
    end if;

    update public.players set equipped_title = p_title where id = v_me;
end;
$$;

grant execute on function public.set_equipped_title(text) to authenticated;

-- Existing leaderboard/friends functions now also surface equipped_title -
-- Postgres can't change a function's return shape via CREATE OR REPLACE
-- (errors with "cannot change return type of existing function"), so each
-- has to be dropped first. Safe to run even on a fresh database where these
-- don't exist yet, since DROP FUNCTION IF EXISTS is a no-op in that case.
drop function if exists public.get_leaderboard(integer);
create or replace function public.get_leaderboard(limit_count integer default 10)
returns table(display_name text, gold integer, equipped_title text)
language sql
security definer set search_path = public
stable
as $$
    select coalesce(p.display_name, 'İsimsiz Kahraman'), w.gold, p.equipped_title
    from public.wallets w
    join public.players p on p.id = w.player_id
    order by w.gold desc
    limit greatest(1, least(limit_count, 50));
$$;

grant execute on function public.get_leaderboard(integer) to authenticated, anon;

drop function if exists public.get_pvp_leaderboard(integer);
create or replace function public.get_pvp_leaderboard(limit_count integer default 10)
returns table(display_name text, rating integer, wins integer, losses integer, equipped_title text)
language sql
security definer set search_path = public
stable
as $$
    select coalesce(p.display_name, 'İsimsiz Kahraman'), r.rating, r.wins, r.losses, p.equipped_title
    from public.pvp_ratings r
    join public.players p on p.id = r.player_id
    order by r.rating desc
    limit greatest(1, least(limit_count, 50));
$$;

grant execute on function public.get_pvp_leaderboard(integer) to authenticated, anon;

drop function if exists public.get_friends_list();
create or replace function public.get_friends_list()
returns table(friend_id uuid, display_name text, status text, is_incoming_request boolean, equipped_title text)
language sql
security definer set search_path = public
stable
as $$
    select
        case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end,
        coalesce(p.display_name, 'İsimsiz Kahraman'),
        f.status,
        (f.status = 'pending' and f.addressee_id = auth.uid()),
        p.equipped_title
    from public.friendships f
    join public.players p
        on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
    where f.requester_id = auth.uid() or f.addressee_id = auth.uid()
    order by f.status desc, 2 asc;
$$;

grant execute on function public.get_friends_list() to authenticated;

-- 24. Item trading (friends only) -------------------------------------------------------
-- Same "friends only" scoping as direct messages/guilds - trading with
-- strangers is a classic scam vector (fake/bait-and-switch offers), and
-- gating on mutual friendship keeps this to people who already chose to
-- connect. 1-for-1 item trades only, each side optionally sweetening with
-- gold - no multi-item bundles in this first cut.
create table if not exists public.trade_offers (
    id              uuid primary key default gen_random_uuid(),
    from_player     uuid not null references public.players(id) on delete cascade,
    to_player       uuid not null references public.players(id) on delete cascade,
    offer_item_id   uuid references public.player_items(id) on delete cascade,
    offer_gold      integer not null default 0 check (offer_gold >= 0),
    request_item_id uuid references public.player_items(id) on delete cascade,
    request_gold    integer not null default 0 check (request_gold >= 0),
    status          text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
    created_at      timestamptz not null default now(),
    check (offer_item_id is not null or offer_gold > 0),
    check (from_player != to_player)
);

alter table public.trade_offers enable row level security;

drop policy if exists "read own trade offers" on public.trade_offers;
create policy "read own trade offers" on public.trade_offers
    for select using (auth.uid() = from_player or auth.uid() = to_player);

-- No insert/update policy - create/respond/cancel (all security definer)
-- are the only writers, since accepting one has to atomically move an item
-- and/or gold between two DIFFERENT players' rows, something RLS (which
-- only ever reasons about ONE row's ownership) fundamentally can't express.
create or replace function public.create_trade_offer(
    p_to_player      uuid,
    p_offer_item_id  uuid,
    p_request_item_id uuid,
    p_offer_gold     integer default 0,
    p_request_gold   integer default 0
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
    v_me       uuid := auth.uid();
    v_offer_id uuid;
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;
    if v_me = p_to_player then
        raise exception 'cannot trade with yourself';
    end if;
    if p_offer_item_id is null and coalesce(p_offer_gold, 0) <= 0 then
        raise exception 'offer must include an item or gold';
    end if;

    if not exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and ((f.requester_id = v_me and f.addressee_id = p_to_player)
            or (f.requester_id = p_to_player and f.addressee_id = v_me))
    ) then
        raise exception 'not friends';
    end if;

    if p_offer_item_id is not null and not exists (
        select 1 from public.player_items where id = p_offer_item_id and player_id = v_me
    ) then
        raise exception 'you do not own that item';
    end if;

    insert into public.trade_offers (from_player, to_player, offer_item_id, offer_gold, request_item_id, request_gold)
        values (v_me, p_to_player, p_offer_item_id, coalesce(p_offer_gold, 0), p_request_item_id, coalesce(p_request_gold, 0))
        returning id into v_offer_id;

    return v_offer_id;
end;
$$;

grant execute on function public.create_trade_offer(uuid, uuid, uuid, integer, integer) to authenticated;

-- The trickiest part of this whole feature: two concurrent calls on the
-- SAME offer (a double-click, a retry after a slow response) must never
-- both execute the swap below. Fixed by claiming the offer FIRST, with a
-- single atomic `update ... where status = 'pending' returning *` - under
-- concurrent access, Postgres serializes that update per-row, so only the
-- very first caller ever sees a returned row; every other caller (racing
-- or retried) hits `if not found` and stops before touching any item or
-- gold. Every validation below the claim runs in the SAME transaction the
-- claim happened in, so if any of them fails, the raised exception rolls
-- back EVERYTHING - including the claim itself - leaving the offer exactly
-- back at 'pending' as if this call never happened, safe to retry.
create or replace function public.respond_trade_offer(p_offer_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    v_me    uuid := auth.uid();
    v_offer public.trade_offers;
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;

    if not p_accept then
        update public.trade_offers set status = 'declined'
            where id = p_offer_id and to_player = v_me and status = 'pending';
        return;
    end if;

    update public.trade_offers
        set status = 'accepted'
        where id = p_offer_id and to_player = v_me and status = 'pending'
        returning * into v_offer;

    if not found then
        raise exception 'offer not found or already resolved';
    end if;

    if v_offer.offer_item_id is not null and not exists (
        select 1 from public.player_items where id = v_offer.offer_item_id and player_id = v_offer.from_player
    ) then
        raise exception 'offered item no longer available';
    end if;

    if v_offer.request_item_id is not null and not exists (
        select 1 from public.player_items where id = v_offer.request_item_id and player_id = v_me
    ) then
        raise exception 'requested item no longer available';
    end if;

    if v_offer.offer_gold > 0 and not exists (
        select 1 from public.wallets where player_id = v_offer.from_player and gold >= v_offer.offer_gold
    ) then
        raise exception 'offerer no longer has enough gold';
    end if;

    if v_offer.request_gold > 0 and not exists (
        select 1 from public.wallets where player_id = v_me and gold >= v_offer.request_gold
    ) then
        raise exception 'you do not have enough gold';
    end if;

    -- equipped_slot is always cleared on transfer - it's meaningless in the
    -- new owner's build context, and leaving it set would silently give
    -- them a "pre-equipped" item outside the normal equip flow.
    if v_offer.offer_item_id is not null then
        update public.player_items set player_id = v_me, equipped_slot = null where id = v_offer.offer_item_id;
    end if;
    if v_offer.request_item_id is not null then
        update public.player_items set player_id = v_offer.from_player, equipped_slot = null where id = v_offer.request_item_id;
    end if;
    if v_offer.offer_gold > 0 then
        update public.wallets set gold = gold - v_offer.offer_gold, updated_at = now() where player_id = v_offer.from_player;
        update public.wallets set gold = gold + v_offer.offer_gold, updated_at = now() where player_id = v_me;
    end if;
    if v_offer.request_gold > 0 then
        update public.wallets set gold = gold - v_offer.request_gold, updated_at = now() where player_id = v_me;
        update public.wallets set gold = gold + v_offer.request_gold, updated_at = now() where player_id = v_offer.from_player;
    end if;
end;
$$;

grant execute on function public.respond_trade_offer(uuid, boolean) to authenticated;

create or replace function public.cancel_trade_offer(p_offer_id uuid)
returns void
language sql
security definer set search_path = public
as $$
    update public.trade_offers set status = 'cancelled'
        where id = p_offer_id and from_player = auth.uid() and status = 'pending';
$$;

grant execute on function public.cancel_trade_offer(uuid) to authenticated;

-- Denormalizes enough of each item's raw columns (base_id/slot/rarity/
-- rolled_stats/set_key) for the client to render it with its own existing
-- item-display logic, itemDisplayInfo() (items.js) - the same "server has
-- no item-rendering code, client already does" split every other item-
-- related feature here uses. itemDisplayInfo needs ALL FIVE of these
-- (it branches on set_key first, then rarity, then does
-- ITEM_BASES[item.slot].find(...)) - leaving any one of them out isn't a
-- SQL error, it's a client-side crash the first time a real row comes back
-- (caught by testing this with synthetic data before the real RPC existed
-- to test against).
drop function if exists public.get_my_trade_offers();
create or replace function public.get_my_trade_offers()
returns table(
    id uuid, direction text, counterparty_name text,
    offer_item_id uuid, offer_base_id text, offer_slot text, offer_rarity text, offer_rolled_stats jsonb, offer_set_key text,
    offer_gold integer,
    request_item_id uuid, request_base_id text, request_slot text, request_rarity text, request_rolled_stats jsonb, request_set_key text,
    request_gold integer,
    status text, created_at timestamptz
)
language sql
security definer set search_path = public
stable
as $$
    select
        t.id,
        case when t.from_player = auth.uid() then 'outgoing' else 'incoming' end,
        coalesce(p.display_name, 'İsimsiz Kahraman'),
        oi.id, oi.base_id, oi.slot, oi.rarity, oi.rolled_stats, oi.set_key,
        t.offer_gold,
        ri.id, ri.base_id, ri.slot, ri.rarity, ri.rolled_stats, ri.set_key,
        t.request_gold,
        t.status, t.created_at
    from public.trade_offers t
    join public.players p on p.id = (case when t.from_player = auth.uid() then t.to_player else t.from_player end)
    left join public.player_items oi on oi.id = t.offer_item_id
    left join public.player_items ri on ri.id = t.request_item_id
    where (t.from_player = auth.uid() or t.to_player = auth.uid())
      and t.status = 'pending'
    order by t.created_at desc;
$$;

grant execute on function public.get_my_trade_offers() to authenticated;

-- "read own items" (player_items' only select policy) blocks a client from
-- browsing anyone else's inventory, including a friend's - which makes
-- proposing an item-for-item trade impossible without SOME way to see what
-- a friend actually has. This opens that up, but ONLY between accepted
-- friends (re-checked here, not just trusted from the client) - the same
-- opt-in-mutual-connection gating as chat/guilds/trading itself.
drop function if exists public.get_friend_items(uuid);
create or replace function public.get_friend_items(p_friend_id uuid)
returns table(id uuid, base_id text, slot text, rarity text, rolled_stats jsonb)
language sql
security definer set search_path = public
stable
as $$
    select pi.id, pi.base_id, pi.slot, pi.rarity, pi.rolled_stats
    from public.player_items pi
    where pi.player_id = p_friend_id
      and exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and ((f.requester_id = auth.uid() and f.addressee_id = p_friend_id)
            or (f.requester_id = p_friend_id and f.addressee_id = auth.uid()))
      );
$$;

grant execute on function public.get_friend_items(uuid) to authenticated;

-- 25. Seasonal events (Phase 3, third item) ---------------------------------------------
-- No admin UI exists anywhere in this project (schema.sql IS the only
-- "config" mechanism), so an event's window is a literal timestamp
-- constant inside the claim function itself rather than a row in a table
-- somewhere - to run a second event later, add a new elsif branch here
-- with its own key and dates, the same way REWARD_POOL entries get added
-- in game.js.
create table if not exists public.seasonal_event_claims (
    player_id  uuid not null references public.players(id) on delete cascade,
    event_key  text not null,
    claimed_at timestamptz not null default now(),
    primary key (player_id, event_key)
);

alter table public.seasonal_event_claims enable row level security;

drop policy if exists "read own seasonal claims" on public.seasonal_event_claims;
create policy "read own seasonal claims" on public.seasonal_event_claims
    for select using (auth.uid() = player_id);

-- Bounded, one-time gold grant per event per player - re-validates the
-- date window server-side on every call, same "never trust the client's
-- clock" reasoning as everything else that pays out currency in this file.
create or replace function public.claim_seasonal_event(p_event_key text)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
    v_me    uuid := auth.uid();
    v_gold  integer;
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;

    if p_event_key = 'pioneer_launch' then
        if now() < timestamptz '2026-09-05 00:00:00+00' or now() > timestamptz '2026-09-19 00:00:00+00' then
            raise exception 'event not active';
        end if;
        v_gold := 100;
    else
        raise exception 'unknown event';
    end if;

    insert into public.seasonal_event_claims (player_id, event_key) values (v_me, p_event_key)
        on conflict (player_id, event_key) do nothing;

    if not found then
        raise exception 'already claimed';
    end if;

    update public.wallets set gold = gold + v_gold, updated_at = now() where player_id = v_me;

    return v_gold;
end;
$$;

grant execute on function public.claim_seasonal_event(text) to authenticated;

-- Lets the client show/hide the event banner without hardcoding the dates
-- twice (once here, once in the UI) - still just a display hint though,
-- claim_seasonal_event above is what actually enforces the window.
drop function if exists public.get_active_seasonal_events();
create or replace function public.get_active_seasonal_events()
returns table(event_key text, name text, description text, ends_at timestamptz, already_claimed boolean)
language sql
security definer set search_path = public
stable
as $$
    select 'pioneer_launch', 'Açılış Kutlaması', 'Bu ilk 2 haftada katıl, +100 altın ve "Öncü" unvanını kazan!',
        timestamptz '2026-09-19 00:00:00+00',
        exists(select 1 from public.seasonal_event_claims where player_id = auth.uid() and event_key = 'pioneer_launch')
    where now() between timestamptz '2026-09-05 00:00:00+00' and timestamptz '2026-09-19 00:00:00+00';
$$;

grant execute on function public.get_active_seasonal_events() to authenticated;

-- 26. Talent tree (Phase 1, final item) --------------------------------------------------
-- Points earned = pvp_ratings.wins + count(daily_quests) - both already
-- protected by a trusted RPC (resolve_pvp_match / claim_daily_quest), so
-- there's nothing new to validate here. Deliberately NOT
-- player_achievements: that table's own insert policy only checks row
-- ownership, not that the achievement was actually earned (a real,
-- pre-existing gap, flagged separately rather than built on top of here).
create table if not exists public.player_talents (
    player_id  uuid not null references public.players(id) on delete cascade,
    talent_id  text not null,
    learned_at timestamptz not null default now(),
    primary key (player_id, talent_id)
);

alter table public.player_talents enable row level security;

drop policy if exists "read own talents" on public.player_talents;
create policy "read own talents" on public.player_talents
    for select using (auth.uid() = player_id);

-- Mirrors game.js's TALENT_CATALOG keys - same "reference table the client
-- catalog has to be kept in sync with by hand" tradeoff as item_bases.
-- learn_talent rejects any id not in here, so a client can't invent one.
create table if not exists public.talent_defs (
    id text primary key
);
insert into public.talent_defs (id) values
    ('iron_will'), ('sharp_blade'), ('healing_touch'),
    ('energy_flow'), ('lethal_strike'), ('ultimate_power')
on conflict (id) do nothing;

alter table public.talent_defs enable row level security;

drop policy if exists "read talent defs" on public.talent_defs;
create policy "read talent defs" on public.talent_defs
    for select using (true);

drop function if exists public.get_talent_status();
create or replace function public.get_talent_status()
returns table(earned_points integer, spent_points integer, learned_ids text[])
language sql
security definer set search_path = public
stable
as $$
    select
        (coalesce((select r.wins from public.pvp_ratings r where r.player_id = auth.uid()), 0)
            + coalesce((select count(*)::integer from public.daily_quests dq where dq.player_id = auth.uid()), 0)),
        coalesce((select count(*)::integer from public.player_talents pt where pt.player_id = auth.uid()), 0),
        coalesce((select array_agg(pt.talent_id) from public.player_talents pt where pt.player_id = auth.uid()), array[]::text[]);
$$;

grant execute on function public.get_talent_status() to authenticated;

create or replace function public.learn_talent(p_talent_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    v_me     uuid := auth.uid();
    v_earned integer;
    v_spent  integer;
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;

    if not exists (select 1 from public.talent_defs where id = p_talent_id) then
        raise exception 'unknown talent';
    end if;

    select
        (coalesce((select r.wins from public.pvp_ratings r where r.player_id = v_me), 0)
            + coalesce((select count(*)::integer from public.daily_quests dq where dq.player_id = v_me), 0)),
        coalesce((select count(*)::integer from public.player_talents pt where pt.player_id = v_me), 0)
    into v_earned, v_spent;

    if v_spent >= v_earned then
        raise exception 'not enough talent points';
    end if;

    insert into public.player_talents (player_id, talent_id) values (v_me, p_talent_id)
        on conflict (player_id, talent_id) do nothing;

    if not found then
        raise exception 'talent already learned';
    end if;
end;
$$;

grant execute on function public.learn_talent(text) to authenticated;

-- 27. Prestige (Phase 1, final item) -----------------------------------------------------
-- Resets gold to 0 (materials and items are untouched - a full wipe would
-- be needlessly punishing for what's meant as a voluntary, repeatable
-- choice) in exchange for a permanent +5%/level gold income multiplier,
-- applied client-side in goldRewardForKill (game.js) - earn_currency's
-- existing 500-gold-per-call bound is still the hard ceiling no matter how
-- high this ever grows, so there's no new amount to validate here.
-- "read own player row" (players' existing policy) already lets a client
-- read its own prestige_level directly - no new read function needed.
alter table public.players add column if not exists prestige_level integer not null default 0;

create or replace function public.prestige_reset()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
    v_me    uuid := auth.uid();
    v_gold  integer;
    v_level integer;
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;

    select w.gold into v_gold from public.wallets w where w.player_id = v_me;

    if coalesce(v_gold, 0) < 1000 then
        raise exception 'not enough gold to prestige';
    end if;

    update public.wallets set gold = 0, updated_at = now() where player_id = v_me;
    update public.players set prestige_level = prestige_level + 1 where id = v_me
        returning prestige_level into v_level;

    return v_level;
end;
$$;

grant execute on function public.prestige_reset() to authenticated;

-- 28. Self-service account deletion (privacy) -----------------------------------------
-- Players can now attach a real email (see the account-upgrade auth work), which makes
-- "let me delete my account" a real privacy expectation, not just a nice-to-have, before
-- this project opens to any wider audience. security definer means this runs with the
-- FUNCTION OWNER's privileges (the project's postgres role, which does have rights on
-- auth.users) - a regular authenticated client can trigger a delete of their OWN
-- auth.users row without a service-role key anywhere near the client. Every other table
-- (players, wallets, player_items, friendships, guild_members, direct_messages,
-- pvp_ratings, trade_offers, ...) already references players.id - itself referencing
-- auth.users.id - with `on delete cascade`, so this one delete quietly takes the
-- player's entire footprint with it; no per-table cleanup needed here.
--
-- Caveat worth knowing: this does not invalidate an access token already issued (Supabase
-- tokens are stateless JWTs) - the client-side call pairs this with an immediate
-- auth.signOut(), but a token issued earlier in the same session technically remains
-- valid until it expires (normally well under an hour) even after the row is gone.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;

    delete from auth.users where id = v_me;
end;
$$;

grant execute on function public.delete_own_account() to authenticated;

-- 29. Basic content filter for public-facing names (display_name, guild name) -----------
-- Nowhere near a complete profanity filter - a determined bad actor can still get past a
-- fixed blocklist with l33t-speak or spacing tricks - but it catches the obvious,
-- unmodified cases for free, at the one layer that actually enforces anything: RLS's
-- "update own player row" / create_guild only ever check OWNERSHIP, never CONTENT, so
-- without this a player could set literally any string. This trigger is the sole
-- authority (no client-side mirror of the list, unlike e.g. item rarity bounds) - a
-- rejected name surfaces as a normal Postgres error, mapped to a friendly message in
-- economy.js's setDisplayName()/createGuild() exactly like the existing "name taken"
-- (23505) case already is, so it costs one extra round-trip rather than two lists to
-- keep in sync.
create or replace function public.contains_banned_word(p_text text)
returns boolean
language sql
immutable
as $$
    select exists (
        select 1 from unnest(array[
            'amk', 'aq', 'oç', 'yavşak', 'piç', 'siktir', 'orospu', 'göt',
            'fuck', 'shit', 'nigger', 'cunt', 'faggot', 'retard'
        ]) as banned
        where lower(p_text) like '%' || banned || '%'
    );
$$;

create or replace function public.validate_public_name()
returns trigger
language plpgsql
as $$
begin
    if new.display_name is not null and public.contains_banned_word(new.display_name) then
        raise exception 'inappropriate display name';
    end if;
    return new;
end;
$$;

drop trigger if exists players_validate_display_name on public.players;
create trigger players_validate_display_name
    before insert or update of display_name on public.players
    for each row execute procedure public.validate_public_name();

create or replace function public.validate_guild_name()
returns trigger
language plpgsql
as $$
begin
    if public.contains_banned_word(new.name) then
        raise exception 'inappropriate guild name';
    end if;
    return new;
end;
$$;

drop trigger if exists guilds_validate_name on public.guilds;
create trigger guilds_validate_name
    before insert or update of name on public.guilds
    for each row execute procedure public.validate_guild_name();

-- 30. Report a player (basic moderation) -------------------------------------------------
-- Deliberately write-only from the client's side, same as client_errors above - no SELECT
-- policy at all, so reports are only ever readable from the Supabase dashboard (Table
-- Editor, which runs as service role and bypasses RLS) until this project has an actual
-- admin surface worth building. That's enough for a first cut: the point right now is
-- giving a harassed player somewhere to go beyond "just remove the friend" (see the
-- direct_messages comment above for why DMs are friends-only in the first place), not
-- building a full moderation queue/workflow.
create table if not exists public.reports (
    id          uuid primary key default gen_random_uuid(),
    reporter_id uuid not null references public.players(id) on delete cascade,
    reported_id uuid not null references public.players(id) on delete cascade,
    reason      text not null check (char_length(reason) between 1 and 500),
    context     text, -- where the 🚩 button was clicked: 'arkadaş' / 'lonca' / 'mesaj'
    created_at  timestamptz not null default now()
);

alter table public.reports enable row level security;
-- No policies at all is intentional here (unlike every table above, which at least has a
-- "read own row" policy) - a report shouldn't be readable by the reporter OR the reported
-- player through the client, only ever through report_player() below (which only ever
-- INSERTs, security definer, never returns rows) or the dashboard.

create or replace function public.report_player(p_target_id uuid, p_reason text, p_context text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'not authenticated';
    end if;
    if v_me = p_target_id then
        raise exception 'cannot report yourself';
    end if;
    if p_reason is null or char_length(trim(p_reason)) = 0 then
        raise exception 'reason required';
    end if;

    insert into public.reports (reporter_id, reported_id, reason, context)
    values (v_me, p_target_id, trim(p_reason), p_context);
end;
$$;

grant execute on function public.report_player(uuid, text, text) to authenticated;

-- =====================================================================================
-- 30. CHARACTERS: per-character progression, gold and gear
-- =====================================================================================
-- A player (an auth account) owns up to 6 characters. Each character has
-- its own class, look, level / xp, gold / materials, bag and equipment;
-- items with no character sit in the player's shared stash, but every
-- item carries a required level, so a fresh character can't simply wear
-- an old one's end-game gear. See docs/ROADMAP-characters.md.
--
-- Safe to re-run: every step below is create-if-missing / add-if-missing,
-- and the one-time migration (existing players' gold, items and talents
-- into a first character) only runs while `wallets` is still a table.

-- 30.1 characters ----------------------------------------------------------------------
create table if not exists public.characters (
    id             uuid primary key default gen_random_uuid(),
    player_id      uuid not null references public.players(id) on delete cascade,
    name           text not null check (char_length(name) between 2 and 16),
    class_key      text not null check (class_key in ('warrior', 'paladin', 'berserker', 'rogue', 'archer', 'mage', 'necromancer')),
    gender         text not null default 'm' check (gender in ('m', 'f')),
    appearance     jsonb not null default '{}'::jsonb,
    level          integer not null default 1 check (level between 1 and 50),
    xp             integer not null default 0 check (xp >= 0),
    mastery        integer not null default 0 check (mastery >= 0),
    gold           integer not null default 0 check (gold >= 0),
    materials      integer not null default 0 check (materials >= 0),
    needs_setup    boolean not null default false,
    xp_awarded_at  timestamptz,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    last_played_at timestamptz not null default now()
);
create index if not exists characters_player_idx on public.characters (player_id);

alter table public.characters enable row level security;
drop policy if exists "read own characters" on public.characters;
create policy "read own characters" on public.characters
    for select using (auth.uid() = player_id);
-- no insert / update / delete policy: characters change only through the
-- functions below

alter table public.players add column if not exists active_character_id uuid references public.characters(id) on delete set null;

-- talents belong to a character now
create table if not exists public.character_talents (
    character_id uuid not null references public.characters(id) on delete cascade,
    talent_id    text not null,
    learned_at   timestamptz not null default now(),
    primary key (character_id, talent_id)
);
alter table public.character_talents enable row level security;
drop policy if exists "read own character talents" on public.character_talents;
create policy "read own character talents" on public.character_talents
    for select using (exists (select 1 from public.characters c where c.id = character_id and c.player_id = auth.uid()));

-- the caller's active character (null if none)
create or replace function public.my_active_character()
returns uuid
language sql
security definer set search_path = public
stable
as $$
    select p.active_character_id from public.players p
    join public.characters c on c.id = p.active_character_id and c.player_id = p.id
    where p.id = auth.uid();
$$;

-- 30.2 items: character, level, lock; the 11 catalog slots ----------------------------
alter table public.player_items add column if not exists character_id uuid references public.characters(id) on delete cascade;
alter table public.player_items add column if not exists item_level integer not null default 1;
alter table public.player_items add column if not exists req_level integer not null default 1;
alter table public.player_items add column if not exists locked boolean not null default false;
create index if not exists player_items_character_idx on public.player_items (character_id);

alter table public.player_items drop constraint if exists player_items_slot_check;
alter table public.player_items drop constraint if exists player_items_equipped_slot_check;
alter table public.player_items drop constraint if exists player_items_slot_check2;
alter table public.player_items drop constraint if exists player_items_equipped_slot_check2;
alter table public.player_items drop constraint if exists player_items_level_check;

-- items saved before the catalog used "shield" and "trinket"
do $$
begin
    perform set_config('app.trusted_item_update', 'true', true);
    update public.player_items set slot = 'offhand' where slot = 'shield';
    update public.player_items set slot = case when base_id in ('ring', 'uniq_ring_of_ancient_wisdom') then 'ring' else 'amulet' end where slot = 'trinket';
    update public.player_items set equipped_slot = 'offhand' where equipped_slot = 'shield';
    update public.player_items set equipped_slot = case when slot = 'ring' then 'ring1' else 'amulet' end where equipped_slot = 'trinket';
    -- items that existed before levels keep level 1 (grandfathered): a
    -- migrated character can still wear what it had
    perform set_config('app.trusted_item_update', 'false', true);
end $$;

alter table public.player_items add constraint player_items_slot_check2
    check (slot in ('weapon', 'offhand', 'helmet', 'shoulder', 'amulet', 'chest', 'gloves', 'belt', 'legs', 'boots', 'ring'));
alter table public.player_items add constraint player_items_equipped_slot_check2
    check (equipped_slot is null or equipped_slot in ('weapon', 'offhand', 'helmet', 'shoulder', 'amulet', 'chest', 'gloves', 'belt', 'legs', 'boots', 'ring1', 'ring2'));
alter table public.player_items add constraint player_items_level_check
    check (item_level between 1 and 50 and req_level between 1 and 50);

-- no direct client updates any more: equip / unequip / move / lock go
-- through the functions below
drop policy if exists "update own items" on public.player_items;

-- 30.3 one-time migration: existing players become a first character ------------------
-- Everyone who already has something (gold, materials, items or talents)
-- gets a character carrying all of it, flagged needs_setup: on the next
-- login they pick its class, look and name (setup_character). Then the old
-- wallets table is renamed out of the way and replaced by a view.
do $$
declare
    r record;
    v_char uuid;
begin
    if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'wallets') then
        return; -- already migrated
    end if;
    for r in
        select p.id, p.display_name, coalesce(w.gold, 0) as gold, coalesce(w.materials, 0) as materials
        from public.players p
        left join public.wallets w on w.player_id = p.id
        where not exists (select 1 from public.characters c where c.player_id = p.id)
          and (coalesce(w.gold, 0) > 0 or coalesce(w.materials, 0) > 0
               or exists (select 1 from public.player_items i where i.player_id = p.id)
               or exists (select 1 from public.player_talents t where t.player_id = p.id))
    loop
        insert into public.characters (player_id, name, class_key, gold, materials, needs_setup)
            values (r.id, left(coalesce(nullif(trim(r.display_name), ''), 'Kahraman'), 16), 'warrior', r.gold, r.materials, true)
            returning id into v_char;
        update public.players set active_character_id = v_char where id = r.id;
        perform set_config('app.trusted_item_update', 'true', true);
        update public.player_items set character_id = v_char where player_id = r.id and character_id is null;
        perform set_config('app.trusted_item_update', 'false', true);
        insert into public.character_talents (character_id, talent_id)
            select v_char, t.talent_id from public.player_talents t where t.player_id = r.id
            on conflict do nothing;
    end loop;
    alter table public.wallets rename to wallets_legacy;
end $$;

-- 30.4 wallets = the active character's purse (a view) --------------------------------
-- Every existing function that reads or updates public.wallets (shop,
-- scrap / sell / upgrade, daily rewards, quests, trades, betrayal,
-- leaderboards, prestige) keeps working unchanged - it now reads and pays
-- the caller's (or the named player's) ACTIVE character. Clients can read
-- their own row (security_invoker + the RLS above); writes only go through
-- security-definer functions: a direct client update is refused.
create or replace view public.wallets with (security_invoker = true) as
    select p.id as player_id, c.id as character_id, c.gold, c.materials, c.updated_at
    from public.players p
    join public.characters c on c.id = p.active_character_id and c.player_id = p.id;

create or replace function public.wallets_view_write()
returns trigger
language plpgsql
as $$
begin
    if current_user in ('anon', 'authenticated') then
        raise exception 'wallets are read-only: gold and materials only change through the game''s functions';
    end if;
    update public.characters set gold = new.gold, materials = new.materials, updated_at = now() where id = old.character_id;
    return new;
end;
$$;
drop trigger if exists wallets_view_write_trg on public.wallets;
create trigger wallets_view_write_trg
    instead of update on public.wallets
    for each row execute function public.wallets_view_write();

-- new accounts start with no character (the game asks them to make one)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.players (id) values (new.id);
    return new;
end;
$$;

-- 30.5 levels --------------------------------------------------------------------------
-- Total xp needed to reach a level (the client mirrors this curve in
-- characters.js): level 2 at 60 xp, level 10 at ~6.7k, level 50 at ~400k.
-- Past 50, every 8000 xp is a mastery point.
create or replace function public.xp_total_for(p_level integer)
returns integer
language sql
immutable
as $$
    select coalesce(sum(round(60 * power(i, 1.5))), 0)::integer from generate_series(1, greatest(p_level, 1) - 1) as i;
$$;

-- 30.6 character management ------------------------------------------------------------
create or replace function public.character_appearance_clean(p jsonb)
returns jsonb
language sql
immutable
as $$
    select jsonb_build_object(
        'skin', greatest(0, least(4, coalesce((p->>'skin')::integer, 1))),
        'hair', case when p->>'hair' in ('short', 'long', 'topknot', 'shaved', 'braid', 'bun', 'bob') then p->>'hair' else 'short' end,
        'hairColor', greatest(0, least(5, coalesce((p->>'hairColor')::integer, 1))),
        'beard', case when p->>'beard' in ('none', 'stubble', 'full', 'braided') then p->>'beard' else 'none' end);
$$;

create or replace function public.create_character(p_name text, p_class text, p_gender text, p_appearance jsonb)
returns public.characters
language plpgsql
security definer set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_row public.characters;
    v_name text := trim(coalesce(p_name, ''));
begin
    if v_me is null then raise exception 'not authenticated'; end if;
    if (select count(*) from public.characters where player_id = v_me) >= 6 then
        raise exception 'character limit reached (6)';
    end if;
    if char_length(v_name) < 2 or char_length(v_name) > 16 then raise exception 'name must be 2-16 characters'; end if;
    if public.contains_banned_word(v_name) then raise exception 'name not allowed'; end if;
    if exists (select 1 from public.characters where player_id = v_me and lower(name) = lower(v_name)) then
        raise exception 'you already have a character with that name';
    end if;
    insert into public.characters (player_id, name, class_key, gender, appearance)
        values (v_me, v_name, p_class, case when p_gender = 'f' then 'f' else 'm' end, public.character_appearance_clean(p_appearance))
        returning * into v_row;
    update public.players set active_character_id = v_row.id where id = v_me;
    return v_row;
end;
$$;
grant execute on function public.create_character(text, text, text, jsonb) to authenticated;

-- A migrated (needs_setup) character picks its class, look and name once.
-- Anything it wears that the chosen class can't use goes back to its bag.
create or replace function public.setup_character(p_id uuid, p_name text, p_class text, p_gender text, p_appearance jsonb)
returns public.characters
language plpgsql
security definer set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_row public.characters;
    v_name text := trim(coalesce(p_name, ''));
begin
    if char_length(v_name) < 2 or char_length(v_name) > 16 then raise exception 'name must be 2-16 characters'; end if;
    if public.contains_banned_word(v_name) then raise exception 'name not allowed'; end if;
    update public.characters set name = v_name, class_key = p_class, gender = case when p_gender = 'f' then 'f' else 'm' end,
            appearance = public.character_appearance_clean(p_appearance), needs_setup = false, updated_at = now()
        where id = p_id and player_id = v_me and needs_setup
        returning * into v_row;
    if not found then raise exception 'character not found or already set up'; end if;
    update public.player_items pi set equipped_slot = null
        where pi.character_id = p_id and pi.equipped_slot is not null
          and not (p_class = any(coalesce((select b.classes from public.item_bases b where b.base_id = pi.base_id limit 1),
                                          (select f.classes from public.item_fixed_defs f where f.base_id = pi.base_id limit 1),
                                          array[p_class])));
    return v_row;
end;
$$;
grant execute on function public.setup_character(uuid, text, text, text, jsonb) to authenticated;

create or replace function public.select_character(p_id uuid)
returns public.characters
language plpgsql
security definer set search_path = public
as $$
declare
    v_row public.characters;
begin
    update public.characters set last_played_at = now() where id = p_id and player_id = auth.uid() returning * into v_row;
    if not found then raise exception 'character not found'; end if;
    update public.players set active_character_id = p_id where id = auth.uid();
    return v_row;
end;
$$;
grant execute on function public.select_character(uuid) to authenticated;

-- Deleting a character deletes its bag and equipment with it (the shared
-- stash stays). The player types the name to confirm.
create or replace function public.delete_character(p_id uuid, p_confirm_name text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
    delete from public.characters
        where id = p_id and player_id = auth.uid() and lower(name) = lower(trim(coalesce(p_confirm_name, '')));
    if not found then raise exception 'character not found or name does not match'; end if;
end;
$$;
grant execute on function public.delete_character(uuid, text) to authenticated;

-- 30.7 experience ----------------------------------------------------------------------
-- Called after each dungeon level cleared (solo / co-op) and after a PvP
-- match. Bounded per call and rate-limited, so a client can't hand its
-- character more than a real clear could earn.
create or replace function public.award_run_xp(p_floor integer, p_kills integer default 1)
returns table(level integer, xp integer, mastery integer, leveled_up boolean)
language plpgsql
security definer set search_path = public
as $$
declare
    v_char public.characters;
    v_gain integer;
    v_level integer;
    v_xp integer;
begin
    select * into v_char from public.characters c where c.id = public.my_active_character() for update;
    if not found then raise exception 'no active character'; end if;
    if p_floor < 1 or p_floor > 500 or p_kills < 0 or p_kills > 50 then raise exception 'award_run_xp: out of bounds'; end if;
    if v_char.xp_awarded_at is not null and v_char.xp_awarded_at > now() - interval '3 seconds' then
        raise exception 'award_run_xp: too soon';
    end if;
    v_gain := least(40 + p_floor * 12 + least(p_kills, 10) * 4, 800);
    v_xp := v_char.xp + v_gain;
    v_level := v_char.level;
    while v_level < 50 and v_xp >= public.xp_total_for(v_level + 1) loop
        v_level := v_level + 1;
    end loop;
    update public.characters c
        set xp = v_xp, level = v_level, xp_awarded_at = now(), updated_at = now(),
            mastery = case when v_level >= 50 then greatest(0, (v_xp - public.xp_total_for(50)) / 8000) else 0 end
        where c.id = v_char.id;
    return query select c.level, c.xp, c.mastery, (c.level > v_char.level) from public.characters c where c.id = v_char.id;
end;
$$;
grant execute on function public.award_run_xp(integer, integer) to authenticated;

-- 30.8 wearing, carrying and locking items ---------------------------------------------
create or replace function public.item_classes_of(p_base_id text)
returns text[]
language sql
stable
as $$
    select coalesce((select b.classes from public.item_bases b where b.base_id = p_base_id limit 1),
                    (select f.classes from public.item_fixed_defs f where f.base_id = p_base_id limit 1));
$$;
create or replace function public.item_slot_of(p_base_id text)
returns text
language sql
stable
as $$
    select coalesce((select b.slot from public.item_bases b where b.base_id = p_base_id limit 1),
                    (select f.slot from public.item_fixed_defs f where f.base_id = p_base_id limit 1));
$$;

-- Wears an item on the active character (from its bag or the stash):
-- the class must be allowed, the level high enough, and the slot right
-- (a ring goes in ring1 / ring2: p_slot, or the free one). Whatever was in
-- that slot goes back to the bag.
create or replace function public.equip_item(p_item_id uuid, p_slot text default null)
returns public.player_items
language plpgsql
security definer set search_path = public
as $$
declare
    v_char public.characters;
    v_item public.player_items;
    v_slot text;
    v_target text;
    v_classes text[];
    v_row public.player_items;
begin
    select * into v_char from public.characters c where c.id = public.my_active_character();
    if not found then raise exception 'no active character'; end if;
    select * into v_item from public.player_items where id = p_item_id and player_id = auth.uid()
        and (character_id = v_char.id or character_id is null);
    if not found then raise exception 'equip_item: item not found or not yours'; end if;
    v_classes := public.item_classes_of(v_item.base_id);
    if v_classes is not null and not (v_char.class_key = any(v_classes)) then
        raise exception 'equip_item: your class cannot use this';
    end if;
    if v_item.req_level > v_char.level then raise exception 'equip_item: requires level %', v_item.req_level; end if;
    v_slot := coalesce(public.item_slot_of(v_item.base_id), v_item.slot);
    if v_slot = 'ring' then
        if p_slot in ('ring1', 'ring2') then v_target := p_slot;
        elsif not exists (select 1 from public.player_items where character_id = v_char.id and equipped_slot = 'ring1' and id <> p_item_id) then v_target := 'ring1';
        elsif not exists (select 1 from public.player_items where character_id = v_char.id and equipped_slot = 'ring2' and id <> p_item_id) then v_target := 'ring2';
        else v_target := 'ring1';
        end if;
    else
        v_target := v_slot;
    end if;
    update public.player_items set equipped_slot = null
        where character_id = v_char.id and equipped_slot = v_target and id <> p_item_id;
    update public.player_items set equipped_slot = v_target, character_id = v_char.id
        where id = p_item_id returning * into v_row;
    return v_row;
end;
$$;
grant execute on function public.equip_item(uuid, text) to authenticated;

create or replace function public.unequip_item(p_item_id uuid)
returns public.player_items
language plpgsql
security definer set search_path = public
as $$
declare
    v_row public.player_items;
begin
    update public.player_items set equipped_slot = null
        where id = p_item_id and player_id = auth.uid() and character_id = public.my_active_character()
        returning * into v_row;
    if not found then raise exception 'unequip_item: item not found'; end if;
    return v_row;
end;
$$;
grant execute on function public.unequip_item(uuid) to authenticated;

-- Bag <-> shared stash. The bag holds 60 items, the stash 120.
create or replace function public.move_item(p_item_id uuid, p_to text)
returns public.player_items
language plpgsql
security definer set search_path = public
as $$
declare
    v_char uuid := public.my_active_character();
    v_row public.player_items;
begin
    if v_char is null then raise exception 'no active character'; end if;
    if p_to = 'stash' then
        if (select count(*) from public.player_items where player_id = auth.uid() and character_id is null) >= 120 then
            raise exception 'move_item: the stash is full';
        end if;
        update public.player_items set character_id = null
            where id = p_item_id and player_id = auth.uid() and character_id = v_char and equipped_slot is null
            returning * into v_row;
    elsif p_to = 'bag' then
        if (select count(*) from public.player_items where character_id = v_char and equipped_slot is null) >= 60 then
            raise exception 'move_item: the bag is full';
        end if;
        update public.player_items set character_id = v_char
            where id = p_item_id and player_id = auth.uid() and character_id is null
            returning * into v_row;
    else
        raise exception 'move_item: unknown destination';
    end if;
    if not found then raise exception 'move_item: item not found (or it is worn)'; end if;
    return v_row;
end;
$$;
grant execute on function public.move_item(uuid, text) to authenticated;

-- A locked item can't be sold, scrapped or traded by accident.
create or replace function public.lock_item(p_item_id uuid, p_locked boolean)
returns public.player_items
language plpgsql
security definer set search_path = public
as $$
declare
    v_row public.player_items;
begin
    update public.player_items set locked = coalesce(p_locked, false)
        where id = p_item_id and player_id = auth.uid() returning * into v_row;
    if not found then raise exception 'lock_item: item not found'; end if;
    return v_row;
end;
$$;
grant execute on function public.lock_item(uuid, boolean) to authenticated;

-- 30.9 the item guards, with levels and characters -------------------------------------
-- Inserts (loot drops): the base must exist in its slot; a rolled item's
-- level may be at most the character's level + 5; stats are bounded by
-- the rarity bound scaled by the item level (the same 3%/level curve as
-- items.js); fixed items must match exactly and carry their catalog
-- level; the item goes to the caller's active character or the stash.
create or replace function public.validate_player_item_insert()
returns trigger
language plpgsql
as $$
declare
    v_bounds record;
    v_fixed record;
    v_base record;
    v_stat_count integer;
    v_stat_val numeric;
    v_char public.characters;
    v_level_cap integer;
    v_scale numeric;
begin
    if new.character_id is not null then
        select * into v_char from public.characters where id = new.character_id and player_id = new.player_id;
        if not found then raise exception 'validate_player_item_insert: not your character'; end if;
    else
        select c.* into v_char from public.characters c join public.players p on p.active_character_id = c.id where p.id = new.player_id;
    end if;
    v_level_cap := least(50, coalesce(v_char.level, 1) + 5);

    if new.rarity in ('orange', 'red', 'teal', 'green') then
        select * into v_fixed from public.item_fixed_defs
            where rarity = new.rarity and base_id = new.base_id;
        if not found then
            raise exception 'validate_player_item_insert: unknown fixed item %/%', new.rarity, new.base_id;
        end if;
        if new.rolled_stats <> v_fixed.rolled_stats then
            raise exception 'validate_player_item_insert: rolled_stats mismatch for %/%', new.rarity, new.base_id;
        end if;
        if v_fixed.slot is not null and new.slot <> v_fixed.slot then
            raise exception 'validate_player_item_insert: wrong slot for %', new.base_id;
        end if;
        new.item_level := v_fixed.req_level;
        new.req_level := v_fixed.req_level;
    else
        select * into v_bounds from public.item_rarity_bounds where rarity = new.rarity;
        if not found then
            raise exception 'validate_player_item_insert: unknown rarity %', new.rarity;
        end if;
        select * into v_base from public.item_bases where slot = new.slot and base_id = new.base_id;
        if not found then
            raise exception 'validate_player_item_insert: unknown base %/%', new.slot, new.base_id;
        end if;
        if new.item_level < 1 or new.item_level > v_level_cap then
            raise exception 'validate_player_item_insert: item level % out of range', new.item_level;
        end if;
        new.req_level := new.item_level;
        v_scale := 1 + (new.item_level - 1) * 0.03;

        select count(*) into v_stat_count from jsonb_object_keys(new.rolled_stats);
        if v_stat_count = 0 or v_stat_count > v_bounds.max_affix_count then
            raise exception 'validate_player_item_insert: % stats exceeds bound for rarity %', v_stat_count, new.rarity;
        end if;

        for v_stat_val in select abs((value)::numeric) from jsonb_each_text(new.rolled_stats) loop
            if v_stat_val > ceil(v_bounds.max_stat_value * v_scale) then
                raise exception 'validate_player_item_insert: stat value % exceeds bound for rarity %', v_stat_val, new.rarity;
            end if;
        end loop;
    end if;
    new.equipped_slot := null;
    new.locked := false;
    return new;
end;
$$;

-- Updates: only the functions above may change anything; even they may
-- never rewrite what an item IS (base, rarity, stats, level) except
-- upgrade_item, which marks itself trusted.
create or replace function public.validate_player_item_update()
returns trigger
language plpgsql
as $$
begin
    if current_setting('app.trusted_item_update', true) = 'true' then
        return new;
    end if;
    if new.base_id <> old.base_id or new.slot <> old.slot or new.rarity <> old.rarity
        or new.rolled_stats <> old.rolled_stats or coalesce(new.set_key, '') <> coalesce(old.set_key, '')
        or new.item_level <> old.item_level or new.req_level <> old.req_level then
        raise exception 'validate_player_item_update: an item''s identity cannot be changed';
    end if;
    return new;
end;
$$;

-- 30.10 selling, scrapping, upgrading and buying - per character -----------------------
-- Only the active character's own (unworn, unlocked) items or stash items
-- it could wear by level; the gold / materials go to the active character.
create or replace function public.scrap_item(p_item_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
    v_item public.player_items;
    v_char public.characters;
    v_materials integer;
begin
    select * into v_char from public.characters c where c.id = public.my_active_character();
    if not found then raise exception 'no active character'; end if;
    select * into v_item from public.player_items where id = p_item_id and player_id = auth.uid()
        and (character_id = v_char.id or character_id is null);
    if not found then raise exception 'scrap_item: item not found or not yours'; end if;
    if v_item.equipped_slot is not null then raise exception 'scrap_item: unequip it first'; end if;
    if v_item.locked then raise exception 'scrap_item: the item is locked'; end if;
    if v_item.req_level > v_char.level then raise exception 'scrap_item: requires level %', v_item.req_level; end if;
    select materials into v_materials from public.item_scrap_values where rarity = v_item.rarity;
    v_materials := coalesce(v_materials, 1) + v_item.item_level / 10;
    delete from public.player_items where id = p_item_id;
    update public.characters set materials = materials + v_materials, updated_at = now() where id = v_char.id;
    return v_materials;
end;
$$;

create or replace function public.sell_item(p_item_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
    v_item public.player_items;
    v_char public.characters;
    v_gold integer;
begin
    select * into v_char from public.characters c where c.id = public.my_active_character();
    if not found then raise exception 'no active character'; end if;
    select * into v_item from public.player_items where id = p_item_id and player_id = auth.uid()
        and (character_id = v_char.id or character_id is null);
    if not found then raise exception 'sell_item: item not found or not yours'; end if;
    if v_item.equipped_slot is not null then raise exception 'sell_item: unequip it first'; end if;
    if v_item.locked then raise exception 'sell_item: the item is locked'; end if;
    if v_item.req_level > v_char.level then raise exception 'sell_item: requires level %', v_item.req_level; end if;
    select gold into v_gold from public.item_sell_values where rarity = v_item.rarity;
    v_gold := round(coalesce(v_gold, 1) * (1 + (v_item.item_level - 1) * 0.03));
    delete from public.player_items where id = p_item_id;
    update public.characters set gold = gold + v_gold, updated_at = now() where id = v_char.id;
    return v_gold;
end;
$$;

create or replace function public.upgrade_item(p_item_id uuid)
returns public.player_items
language plpgsql
security definer set search_path = public
as $$
declare
    v_item public.player_items;
    v_char public.characters;
    v_cost public.item_upgrade_costs;
    v_base_range jsonb := '{"sword":2,"heart":2,"shield":2,"energy":3,"skull_dmg":4,"ult_dmg":5,"lifeSteal":2,"teamHeal":2,"skull_self_dmg":2}'::jsonb;
    v_affix_count integer;
    v_stat_mult numeric;
    v_stats jsonb := '{}'::jsonb;
    v_primary_stat text;
    v_pool text[];
    v_pick text;
    v_rolled integer;
    v_i integer;
    v_row public.player_items;
begin
    select * into v_char from public.characters c where c.id = public.my_active_character();
    if not found then raise exception 'no active character'; end if;
    select * into v_item from public.player_items where id = p_item_id and player_id = auth.uid()
        and (character_id = v_char.id or character_id is null);
    if not found then raise exception 'upgrade_item: item not found or not yours'; end if;
    if v_item.req_level > v_char.level then raise exception 'upgrade_item: requires level %', v_item.req_level; end if;
    select * into v_cost from public.item_upgrade_costs where from_rarity = v_item.rarity;
    if not found then raise exception 'upgrade_item: % cannot be upgraded', v_item.rarity; end if;

    update public.characters set gold = gold - v_cost.gold_cost, materials = materials - v_cost.material_cost, updated_at = now()
        where id = v_char.id and gold >= v_cost.gold_cost and materials >= v_cost.material_cost;
    if not found then raise exception 'upgrade_item: insufficient gold or materials'; end if;

    v_affix_count := case v_cost.to_rarity when 'white' then 1 when 'blue' then 2 when 'yellow' then 4 end;
    v_stat_mult := (case v_cost.to_rarity when 'white' then 1.0 when 'blue' then 1.6 when 'yellow' then 2.4 end) * (1 + (v_item.item_level - 1) * 0.03);

    select primary_stat into v_primary_stat from public.item_bases where slot = v_item.slot and base_id = v_item.base_id;
    if v_primary_stat is null then raise exception 'upgrade_item: unknown base %/%', v_item.slot, v_item.base_id; end if;

    v_rolled := greatest(1, round((v_base_range->>v_primary_stat)::numeric * v_stat_mult * (0.8 + random() * 0.4)))::integer;
    v_stats := jsonb_build_object(v_primary_stat, v_rolled);
    select array_agg(s order by random()) into v_pool
        from unnest(array['sword','heart','shield','energy','skull_dmg','ult_dmg','lifeSteal','teamHeal','skull_self_dmg']) as s
        where s <> v_primary_stat;
    for v_i in 1..(v_affix_count - 1) loop
        exit when v_i > array_length(v_pool, 1);
        v_pick := v_pool[v_i];
        v_rolled := greatest(1, round((v_base_range->>v_pick)::numeric * v_stat_mult * 0.6 * (0.8 + random() * 0.4)))::integer;
        if v_pick = 'skull_self_dmg' then v_rolled := -v_rolled; end if;
        v_stats := v_stats || jsonb_build_object(v_pick, coalesce((v_stats->>v_pick)::integer, 0) + v_rolled);
    end loop;

    perform set_config('app.trusted_item_update', 'true', true);
    update public.player_items set rarity = v_cost.to_rarity, rolled_stats = v_stats where id = p_item_id returning * into v_row;
    perform set_config('app.trusted_item_update', 'false', true);
    return v_row;
end;
$$;

-- The shop sells a fresh roll for the active character: a base its class
-- can wear, from its level's band, at its level. Price grows with level.
create or replace function public.purchase_item(p_slot text, p_rarity text)
returns public.player_items
language plpgsql
security definer set search_path = public
as $$
declare
    v_char public.characters;
    v_cost integer;
    v_affix_count integer;
    v_stat_mult numeric;
    v_base record;
    v_stats jsonb := '{}'::jsonb;
    v_row public.player_items;
    v_pool text[];
    v_pick text;
    v_base_range jsonb := '{"sword":2,"heart":2,"shield":2,"energy":3,"skull_dmg":4,"ult_dmg":5,"lifeSteal":2,"teamHeal":2,"skull_self_dmg":2}'::jsonb;
    v_i integer;
    v_rolled integer;
begin
    if p_rarity not in ('grey', 'white', 'blue') then
        raise exception 'purchase_item: rarity % is not shop-purchasable', p_rarity;
    end if;
    select * into v_char from public.characters c where c.id = public.my_active_character() for update;
    if not found then raise exception 'no active character'; end if;

    v_cost := round(20 * (case p_rarity when 'grey' then 0.4 when 'white' then 1 when 'blue' then 2.5 end) * (1 + (v_char.level - 1) * 0.05));
    v_affix_count := case p_rarity when 'grey' then 1 when 'white' then 1 when 'blue' then 2 end;
    v_stat_mult := (case p_rarity when 'grey' then 0.5 when 'white' then 1.0 when 'blue' then 1.6 end) * (1 + (v_char.level - 1) * 0.03);

    update public.characters set gold = gold - v_cost, updated_at = now() where id = v_char.id and gold >= v_cost;
    if not found then raise exception 'purchase_item: insufficient gold'; end if;

    select * into v_base from public.item_bases
        where slot = p_slot and not legacy and v_char.class_key = any(classes)
          and v_char.level >= min_level and v_char.level <= max_level
        order by random() limit 1;
    if not found then raise exception 'purchase_item: nothing for your class in slot %', p_slot; end if;

    v_rolled := greatest(1, round((v_base_range->>v_base.primary_stat)::numeric * v_stat_mult * (0.8 + random() * 0.4)))::integer;
    v_stats := jsonb_build_object(v_base.primary_stat, v_rolled);
    select array_agg(s order by random()) into v_pool
        from unnest(array['sword','heart','shield','energy','skull_dmg','ult_dmg','lifeSteal','teamHeal','skull_self_dmg']) as s
        where s <> v_base.primary_stat;
    for v_i in 1..(v_affix_count - 1) loop
        exit when v_i > array_length(v_pool, 1);
        v_pick := v_pool[v_i];
        v_rolled := greatest(1, round((v_base_range->>v_pick)::numeric * v_stat_mult * 0.6 * (0.8 + random() * 0.4)))::integer;
        if v_pick = 'skull_self_dmg' then v_rolled := -v_rolled; end if;
        v_stats := v_stats || jsonb_build_object(v_pick, coalesce((v_stats->>v_pick)::integer, 0) + v_rolled);
    end loop;

    insert into public.player_items (player_id, character_id, base_id, slot, rarity, rolled_stats, set_key, item_level, req_level)
        values (auth.uid(), v_char.id, v_base.base_id, p_slot, p_rarity, v_stats, null, v_char.level, v_char.level)
        returning * into v_row;
    return v_row;
end;
$$;

-- 30.11 trades and betrayal: transferred items land in the receiver's stash -------------
create or replace function public.resolve_betrayal(winner_id uuid, loser_id uuid, loss_percent numeric)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
    lost_gold integer;
    lost_materials integer;
    v_item public.player_items;
    v_loser_char uuid;
begin
    if auth.uid() is null or auth.uid() <> winner_id then
        raise exception 'only the winner can resolve a betrayal payout';
    end if;
    if winner_id = loser_id then raise exception 'winner and loser must differ'; end if;
    if loss_percent <= 0 or loss_percent > 1 then raise exception 'loss_percent must be between 0 and 1'; end if;

    select floor(gold * loss_percent), floor(materials * loss_percent) into lost_gold, lost_materials
        from public.wallets where player_id = loser_id;
    update public.wallets set gold = gold - coalesce(lost_gold, 0), materials = materials - coalesce(lost_materials, 0) where player_id = loser_id;
    update public.wallets set gold = gold + coalesce(lost_gold, 0), materials = materials + coalesce(lost_materials, 0) where player_id = winner_id;

    select active_character_id into v_loser_char from public.players where id = loser_id;
    select * into v_item from public.player_items
        where player_id = loser_id and character_id = v_loser_char and equipped_slot is not null and not locked
        order by random() limit 1;
    if v_item.id is not null then
        update public.player_items set player_id = winner_id, character_id = null, equipped_slot = null where id = v_item.id;
    end if;

    return jsonb_build_object(
        'lost_gold', coalesce(lost_gold, 0), 'lost_materials', coalesce(lost_materials, 0),
        'stolen_item', case when v_item.id is not null then jsonb_build_object(
            'base_id', v_item.base_id, 'slot', v_item.slot, 'rarity', v_item.rarity, 'set_key', v_item.set_key
        ) else null end
    );
end;
$$;

create or replace function public.respond_trade_offer(p_offer_id uuid, p_accept boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    v_me    uuid := auth.uid();
    v_offer public.trade_offers;
begin
    if v_me is null then raise exception 'not authenticated'; end if;
    if not p_accept then
        update public.trade_offers set status = 'declined' where id = p_offer_id and to_player = v_me and status = 'pending';
        return;
    end if;
    update public.trade_offers set status = 'accepted'
        where id = p_offer_id and to_player = v_me and status = 'pending' returning * into v_offer;
    if not found then raise exception 'offer not found or already resolved'; end if;
    if v_offer.offer_item_id is not null and not exists (
        select 1 from public.player_items where id = v_offer.offer_item_id and player_id = v_offer.from_player and not locked
    ) then raise exception 'offered item no longer available'; end if;
    if v_offer.request_item_id is not null and not exists (
        select 1 from public.player_items where id = v_offer.request_item_id and player_id = v_me and not locked
    ) then raise exception 'requested item no longer available'; end if;
    if v_offer.offer_gold > 0 and not exists (
        select 1 from public.wallets where player_id = v_offer.from_player and gold >= v_offer.offer_gold
    ) then raise exception 'offerer no longer has enough gold'; end if;
    if v_offer.request_gold > 0 and not exists (
        select 1 from public.wallets where player_id = v_me and gold >= v_offer.request_gold
    ) then raise exception 'you do not have enough gold'; end if;

    if v_offer.offer_item_id is not null then
        update public.player_items set player_id = v_me, character_id = null, equipped_slot = null where id = v_offer.offer_item_id;
    end if;
    if v_offer.request_item_id is not null then
        update public.player_items set player_id = v_offer.from_player, character_id = null, equipped_slot = null where id = v_offer.request_item_id;
    end if;
    if v_offer.offer_gold > 0 then
        update public.wallets set gold = gold - v_offer.offer_gold where player_id = v_offer.from_player;
        update public.wallets set gold = gold + v_offer.offer_gold where player_id = v_me;
    end if;
    if v_offer.request_gold > 0 then
        update public.wallets set gold = gold - v_offer.request_gold where player_id = v_me;
        update public.wallets set gold = gold + v_offer.request_gold where player_id = v_offer.from_player;
    end if;
end;
$$;

-- 30.12 talents belong to the character -------------------------------------------------
-- One talent point every 5 levels, plus every mastery point.
create or replace function public.get_talent_status()
returns table(earned_points integer, spent_points integer, learned_ids text[])
language sql
security definer set search_path = public
stable
as $$
    select
        -- a migrated character keeps the talents it had even at level 1
        greatest(coalesce((select c.level / 5 + c.mastery from public.characters c where c.id = public.my_active_character()), 0),
                 coalesce((select count(*)::integer from public.character_talents t where t.character_id = public.my_active_character()), 0)),
        coalesce((select count(*)::integer from public.character_talents t where t.character_id = public.my_active_character()), 0),
        coalesce((select array_agg(t.talent_id) from public.character_talents t where t.character_id = public.my_active_character()), array[]::text[]);
$$;

create or replace function public.learn_talent(p_talent_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    v_char public.characters;
    v_spent integer;
begin
    select * into v_char from public.characters c where c.id = public.my_active_character();
    if not found then raise exception 'no active character'; end if;
    if not exists (select 1 from public.talent_defs where id = p_talent_id) then raise exception 'unknown talent'; end if;
    select count(*) into v_spent from public.character_talents where character_id = v_char.id;
    if v_spent >= v_char.level / 5 + v_char.mastery then raise exception 'not enough talent points'; end if;
    insert into public.character_talents (character_id, talent_id) values (v_char.id, p_talent_id) on conflict do nothing;
    if not found then raise exception 'talent already learned'; end if;
end;
$$;

-- 30.13 leaderboard by character level -------------------------------------------------
create or replace function public.get_character_leaderboard(limit_count integer default 20)
returns table(name text, class_key text, level integer, mastery integer, player_name text)
language sql
security definer set search_path = public
stable
as $$
    select c.name, c.class_key, c.level, c.mastery, coalesce(p.display_name, 'İsimsiz Kahraman')
    from public.characters c join public.players p on p.id = c.player_id
    order by c.level desc, c.mastery desc, c.xp desc
    limit least(greatest(limit_count, 1), 100);
$$;
grant execute on function public.get_character_leaderboard(integer) to authenticated, anon;
