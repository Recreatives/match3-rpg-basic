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

    update public.wallets
        set gold = gold + p_gold, materials = materials + p_materials, updated_at = now()
        where player_id = auth.uid();

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
