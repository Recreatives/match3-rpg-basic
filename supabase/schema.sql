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

-- NOTE - security boundary for later:
-- These policies let a player update their OWN gold/materials directly. That's
-- fine for "read my balance, spend at the shop" but NOT safe once the
-- betrayal PvP steals currency FROM the loser's wallet - a client should never
-- be able to write to someone else's row, which these policies correctly
-- block, but it also means the WINNER'S client can't be the one applying the
-- steal either. That transfer needs a single trusted place to happen -
-- almost certainly a Postgres function (security definer) called "resolve_pvp"
-- or similar that both clients invoke and Supabase runs with elevated rights,
-- rather than two clients each updating their own row and hoping they agree.
-- Left as a follow-up once the PvP screen itself exists (see the design doc's
-- "Sırada Ne Var" list) - flagging now so it isn't forgotten.
