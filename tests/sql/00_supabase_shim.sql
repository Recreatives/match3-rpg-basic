-- Minimal stand-in for what a Supabase project provides before
-- supabase/schema.sql runs, so CI can apply the real schema to a plain
-- Postgres (.github/workflows/ci.yml, job "sql"): the auth schema +
-- auth.users + auth.uid(), the anon/authenticated/service_role roles, and
-- Supabase's default grants on the public schema (RLS policies - not table
-- grants - are what actually restrict clients there, same as production).
--
-- auth.uid() reads request.jwt.claim.sub exactly like Supabase's own
-- implementation, so a test impersonates a player with:
--   set local role authenticated;
--   select set_config('request.jwt.claim.sub', '<uuid>', true);

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text,
    is_anonymous       boolean not null default true,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at         timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
    select nullif(current_setting('request.jwt.claim.role', true), '')
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
