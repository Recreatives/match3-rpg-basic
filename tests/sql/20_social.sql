-- Social systems (supabase/schema.sql sections 35-40), run after
-- 10_rls_and_rpcs.sql on the same database (players 1111... and 2222...).
\set ON_ERROR_STOP on

-- the old "update own player row" hole is closed
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ declare n integer; begin
    update public.players set prestige_level = 99 where id = auth.uid();
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: players row is still client-writable'; end if;
end $$;
-- handles: Name#1234, rules, 30 days between free changes
do $$ declare h text; begin
    h := public.set_handle('Hakan');
    if h !~ '^Hakan#[0-9]{4}$' then raise exception 'FAIL: handle %', h; end if;
    perform set_config('tst.h1', h, false);
end $$;
select tst.expect_error($q$select public.set_handle('Yeni')$q$, 'next free change');
select tst.expect_error($q$select public.set_handle('Yeni', true)$q$, 'insufficient gold');
select tst.expect_error($q$select public.set_handle('ab')$q$, 'invalid');
select tst.expect_error($q$select public.set_handle('Admin')$q$, 'invalid');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$ declare h text; begin
    h := public.set_handle('hakan');
    if lower(h) = lower(current_setting('tst.h1')) then raise exception 'FAIL: the same handle twice'; end if;
    perform set_config('tst.h2', h, false);
end $$;
-- not friends, not clan mates: can't write
select tst.expect_error($q$select public.send_direct_message('11111111-1111-1111-1111-111111111111'::uuid, 'selam')$q$, 'not allowed');
do $$ begin
    if public.send_friend_request(current_setting('tst.h1')) <> 'sent' then raise exception 'FAIL: friend request by handle'; end if;
    if public.send_friend_request('Hakan#0000') <> 'not_found' then raise exception 'FAIL: unknown handle'; end if;
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
    if public.send_friend_request(upper(current_setting('tst.h2'))) <> 'accepted' then raise exception 'FAIL: a request back should accept'; end if;
    if (select count(*) from public.get_social_list() where status = 'accepted') <> 1 then raise exception 'FAIL: friend list'; end if;
end $$;
select public.send_direct_message('22222222-2222-2222-2222-222222222222'::uuid, 'selam');
select tst.expect_error($q$select public.send_direct_message('22222222-2222-2222-2222-222222222222'::uuid, 'x') from generate_series(1, 9)$q$, 'slow down');
-- blocking ends the friendship and the messages
select public.block_player('22222222-2222-2222-2222-222222222222'::uuid);
select tst.expect_error($q$select public.send_direct_message('22222222-2222-2222-2222-222222222222'::uuid, 'hey')$q$, 'not allowed');
do $$ begin if (select count(*) from public.get_social_list()) <> 0 then raise exception 'FAIL: blocking should end the friendship'; end if; end $$;
select public.unblock_player('22222222-2222-2222-2222-222222222222'::uuid);
-- clans: a level 20 character and 5,000 gold
select tst.expect_error($q$select public.create_clan('Kurtlar', 'KRT')$q$, 'level 20');
reset role;
update public.characters set level = 20, gold = gold + 6000 where id = (select active_character_id from public.players where id = '11111111-1111-1111-1111-111111111111');
set local role authenticated;
do $$ declare c public.clans; g0 integer; begin
    select gold into g0 from public.wallets where player_id = auth.uid();
    c := public.create_clan('Kurtlar', 'krt');
    if c.tag <> 'KRT' then raise exception 'FAIL: tag %', c.tag; end if;
    if (select gold from public.wallets where player_id = auth.uid()) <> g0 - 5000 then raise exception 'FAIL: founding should cost 5000'; end if;
    perform set_config('tst.clan', c.id::text, false);
end $$;
select tst.expect_error($q$select public.create_clan('Baska Klan', 'BSK')$q$, 'already in a clan');
select public.set_clan_settings('Hoş geldiniz', 'apply', '{"c1": "#123456", "c2": "zzz", "sym": "wolf"}'::jsonb);
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$ begin if public.join_clan(current_setting('tst.clan')::uuid, 'beni alın') <> 'applied' then raise exception 'FAIL: apply'; end if; end $$;
select tst.expect_error($q$select public.send_clan_message('merhaba')$q$, 'not in a clan');
select tst.expect_error($q$select public.review_clan_application('22222222-2222-2222-2222-222222222222'::uuid, true)$q$, 'not allowed');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select public.review_clan_application('22222222-2222-2222-2222-222222222222'::uuid, true);
do $$ declare j jsonb; begin
    j := public.get_my_clan();
    if jsonb_array_length(j->'members') <> 2 then raise exception 'FAIL: members %', j->'members'; end if;
    if j->'clan'->'crest'->>'c2' <> '#d4a84a' or j->'clan'->'crest'->>'sym' <> 'wolf' then raise exception 'FAIL: crest not sanitized %', j->'clan'->'crest'; end if;
end $$;
select public.send_clan_message('hoş geldin');
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select tst.expect_error($q$select public.kick_clan_member('11111111-1111-1111-1111-111111111111'::uuid)$q$, 'not allowed');
do $$ begin if (select count(*) from public.get_clan_messages(10)) <> 1 then raise exception 'FAIL: clan chat'; end if; end $$;
-- clan mates may write (default privacy: friends + clan)
select public.send_direct_message('11111111-1111-1111-1111-111111111111'::uuid, 'klandan selam');
-- party: invite a clan mate
do $$ begin perform set_config('tst.inv', public.invite_to_party('11111111-1111-1111-1111-111111111111'::uuid)::text, false); end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin if (public.get_notifications()->'party_invites') = '[]'::jsonb then raise exception 'FAIL: the invite should show up'; end if; end $$;
select public.respond_party_invite(current_setting('tst.inv')::uuid, true);
do $$ begin if jsonb_array_length(public.get_my_party()->'members') <> 2 then raise exception 'FAIL: party of two'; end if; end $$;
select tst.expect_error($q$select public.party_start_coop()$q$, 'only the party leader');
select public.leave_party();
do $$ begin if public.get_my_party() is not null then raise exception 'FAIL: left the party'; end if; end $$;
-- the leader leaving hands the clan over
select public.leave_clan();
commit;
do $$ begin
    if (select rank from public.clan_members where player_id = '22222222-2222-2222-2222-222222222222') <> 'leader' then raise exception 'FAIL: succession'; end if;
end $$;

\echo 'SOCIAL ASSERTIONS PASSED'
