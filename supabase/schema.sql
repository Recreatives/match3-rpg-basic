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
