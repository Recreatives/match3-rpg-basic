-- Pixel Dungeon: persistent economy layer
--
-- Identity: players use Supabase Anonymous Auth (supabase.auth.signInAnonymously()).
-- Each browser/device gets a real auth.uid() with no signup step, which is what
-- lets us write proper Row Level Security below instead of trusting the client.
--
-- Run this whole file once in the Supabase SQL Editor (Dashboard -> SQL Editor)
-- on a fresh project. Safe to re-run: every statement is guarded.

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
create table if not exists public.wallets (
    player_id  uuid primary key references public.players(id) on delete cascade,
    gold       integer not null default 0 check (gold >= 0),
    materials  integer not null default 0 check (materials >= 0),
    updated_at timestamptz not null default now()
);

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

drop trigger if exists wallets_touch_updated_at on public.wallets;
create trigger wallets_touch_updated_at
    before update on public.wallets
    for each row execute procedure public.touch_updated_at();

-- 5. Row Level Security -------------------------------------------------------
-- A player can only ever see/touch their own row. This is the whole point of
-- anonymous auth over a hand-rolled device key: auth.uid() is set by Supabase
-- itself from the caller's session token, not something the client can spoof.
alter table public.players enable row level security;
alter table public.wallets enable row level security;

drop policy if exists "read own player row" on public.players;
create policy "read own player row" on public.players
    for select using (auth.uid() = id);

drop policy if exists "update own player row" on public.players;
create policy "update own player row" on public.players
    for update using (auth.uid() = id);

drop policy if exists "read own wallet" on public.wallets;
create policy "read own wallet" on public.wallets
    for select using (auth.uid() = player_id);

drop policy if exists "update own wallet" on public.wallets;
create policy "update own wallet" on public.wallets
    for update using (auth.uid() = player_id);

-- NOTE - security boundary, resolved below:
-- The policies above let a player update their OWN gold/materials directly.
-- That's fine for "read my balance, spend at the shop" but not safe for the
-- betrayal PvP currency steal, where the WINNER'S client would otherwise need
-- to write to the LOSER'S row - which these policies correctly block. See
-- resolve_betrayal() below: a single trusted place (security definer) for
-- that specific transfer, instead of two clients each updating their own row
-- and hoping they agree.

-- 6. betrayal currency transfer ------------------------------------------------
-- Called by the WINNING client only (see coop.js/pvp.js - the loser's client
-- never calls this, it just observes the resulting balance next time it
-- fetches its own wallet). Moves loss_percent of the loser's gold+materials
-- to the winner. security definer is what lets this one function touch a
-- row that isn't the caller's own, despite the RLS policies above - every
-- other write path in this schema still goes through auth.uid() as normal.
create or replace function public.resolve_betrayal(winner_id uuid, loser_id uuid, loss_percent numeric)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    lost_gold integer;
    lost_materials integer;
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
-- The 8-value list (weapon/shield/helmet/chest/shoulder/gloves/boots/
-- trinket) replaces an earlier 3-slot version (weapon/armor/trinket) - a
-- real RPG loadout instead of one vague "armor" bucket. Re-running this
-- file wipes existing player_items rows the same way every other table
-- replace here does; there's no migration path for old rows using the
-- retired 'armor' slot value.
drop table if exists public.player_items cascade;
create table public.player_items (
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

-- Equipping/unequipping updates a row the player already owns - the one
-- update path this table needs, still always scoped to the caller's own
-- items only.
drop policy if exists "update own items" on public.player_items;
create policy "update own items" on public.player_items
    for update using (auth.uid() = player_id) with check (auth.uid() = player_id);

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
drop policy if exists "update own wallet" on public.wallets;

-- Bounded gold/materials grant for anything that ISN'T a purchase or a
-- betrayal payout (those keep their own dedicated functions below/above) -
-- kill rewards (game.js/coop.js) and small flat bonuses (pvp.js's
-- loyal_survivor reward). The ceilings are deliberately well above any
-- reward this version of the game can produce (goldRewardForKill tops out
-- far below 500 even at very high levels) - raise them if the reward
-- formulas ever scale past that, but a client can never hand itself more
-- than these hard limits in one call regardless of what it claims earned it.
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
insert into public.item_bases (slot, base_id, primary_stat) values
    ('weapon','blade','sword'), ('weapon','axe','skull_dmg'), ('weapon','scepter','ult_dmg'),
    ('weapon','dagger','lifeSteal'), ('weapon','bow','energy'), ('weapon','spear','skull_dmg'), ('weapon','mace','sword'),
    ('shield','kite_shield','shield'), ('shield','tower_shield','shield'), ('shield','buckler','shield'), ('shield','dragon_shield','heart'),
    ('helmet','helm','shield'), ('helmet','hood','energy'), ('helmet','crown','ult_dmg'), ('helmet','skull_mask','skull_dmg'),
    ('chest','breastplate','shield'), ('chest','robe','heart'), ('chest','leather_vest','sword'), ('chest','scale_armor','heart'),
    ('shoulder','pauldron','shield'), ('shoulder','spiked_pauldron','skull_dmg'), ('shoulder','winged_pauldron','energy'),
    ('gloves','gauntlets','sword'), ('gloves','assassin_gloves','lifeSteal'), ('gloves','healing_gloves','heart'),
    ('boots','leather_boots','energy'), ('boots','wind_boots','sword'), ('boots','earth_boots','shield'),
    ('trinket','amulet','energy'), ('trinket','ring','lifeSteal'), ('trinket','charm','teamHeal'), ('trinket','necklace','ult_dmg')
on conflict (slot, base_id) do update set primary_stat = excluded.primary_stat;

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
insert into public.item_fixed_defs (rarity, base_id, rolled_stats) values
    ('green', 'bloodied_gauntlet', '{"sword":3}'),
    ('green', 'crimson_pauldron', '{"skull_dmg":8}'),
    ('green', 'iron_greaves', '{"shield":3}'),
    ('green', 'oak_shield_charm', '{"heart":2}'),
    ('green', 'swift_boots', '{"energy":3}'),
    ('green', 'shadow_cloak', '{"energy":3}'),
    ('green', 'venom_vial', '{"skull_self_dmg":-3}'),
    ('green', 'frozen_crown', '{"shield":3}'),
    ('green', 'glacier_ward', '{"heart":3}'),
    ('orange', 'uniq_nights_lament', '{"sword":8,"lifeSteal":6}'),
    ('orange', 'uniq_shield_of_eternity', '{"shield":7,"heart":7}'),
    ('orange', 'uniq_oracles_crown', '{"ult_dmg":16,"energy":10}'),
    ('orange', 'uniq_dragonheart_plate', '{"shield":7,"heart":7}'),
    ('orange', 'uniq_storm_eagle_pauldrons', '{"energy":10,"sword":8}'),
    ('orange', 'uniq_butchers_claws', '{"skull_dmg":14,"lifeSteal":6}'),
    ('orange', 'uniq_windwalkers', '{"energy":10,"sword":8}'),
    ('orange', 'uniq_ring_of_ancient_wisdom', '{"ult_dmg":16,"teamHeal":6}'),
    ('red', 'uniq_world_eater', '{"sword":10,"skull_dmg":18,"lifeSteal":8}'),
    ('red', 'uniq_the_last_wall', '{"shield":9,"heart":9,"energy":13}'),
    ('red', 'uniq_starfall_helm', '{"ult_dmg":20,"energy":13,"shield":9}'),
    ('red', 'uniq_titans_hide', '{"shield":9,"heart":9,"sword":10}'),
    ('red', 'uniq_doomwings', '{"energy":13,"skull_dmg":18,"sword":10}'),
    ('red', 'uniq_the_throatreaver', '{"skull_dmg":18,"lifeSteal":8,"sword":10}'),
    ('red', 'uniq_timestep_striders', '{"energy":13,"sword":10,"ult_dmg":20}'),
    ('red', 'uniq_eternity_core', '{"ult_dmg":20,"energy":13,"teamHeal":8}'),
    ('teal', 'uniq_whisper_of_the_void', '{"ult_dmg":18,"lifeSteal":7}'),
    ('teal', 'uniq_shattered_time_aegis', '{"shield":8,"energy":12}'),
    ('teal', 'uniq_astral_sight', '{"energy":12,"ult_dmg":18}'),
    ('teal', 'uniq_shroud_of_shadows', '{"shield":8,"lifeSteal":7}'),
    ('teal', 'uniq_cosmic_wings', '{"energy":12,"skull_dmg":16}'),
    ('teal', 'uniq_soul_rending_claws', '{"skull_dmg":16,"lifeSteal":7}'),
    ('teal', 'uniq_voidstep', '{"energy":12,"sword":9}'),
    ('teal', 'uniq_eye_of_infinity', '{"ult_dmg":18,"teamHeal":7}')
on conflict (rarity, base_id) do update set rolled_stats = excluded.rolled_stats;

-- Same reasoning again: this is the exact-match allowlist for
-- orange/red/teal/green items - if a client could write to it, they could
-- insert their own row here first and then have any stats they want
-- rubber-stamped as "correct" for that rarity/base_id.
alter table public.item_fixed_defs enable row level security;
drop policy if exists "read item fixed defs" on public.item_fixed_defs;
create policy "read item fixed defs" on public.item_fixed_defs for select using (true);

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
