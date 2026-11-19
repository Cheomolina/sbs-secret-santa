-- Secret Santa schema (v2).
-- Safe to run on a NEW project and on an EXISTING one (it upgrades v1 in place, keeping users, hints and photos).
-- Run in Supabase: SQL Editor -> New query -> paste the whole file -> Run. Running it again is harmless.

-- ───────────── Tables ─────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  username   text not null unique check (username ~ '^[a-z0-9_.-]{3,24}$'),
  role       text not null default 'user' check (role in ('user', 'admin')),
  photo_url  text,
  created_at timestamptz not null default now()
);
-- "Off" participants are skipped by the draw (or count as "left" once the draw is done).
alter table public.profiles add column if not exists active boolean not null default true;
-- Optional display name; the username (used to log in) is shown when there is no nickname.
alter table public.profiles add column if not exists nickname text
  check (nickname is null or char_length(nickname) between 1 and 40);

create table if not exists public.hints (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  image_url   text,
  description text check (char_length(description) <= 500),
  url         text check (url ~* '^https?://' and char_length(url) <= 500),
  created_at  timestamptz not null default now()
);
create index if not exists hints_owner_idx on public.hints (owner_id);

-- One row per edition (year). Exactly one edition is "current" (not archived).
create table if not exists public.events (
  id            int generated always as identity primary key,
  name          text not null default 'Secret Santa',
  status        text not null default 'draft' check (status in ('draft', 'started', 'archived')),
  draw_date     timestamptz,           -- when the automatic draw runs
  exchange_date timestamptz,           -- when gifts are exchanged
  place         text check (char_length(place) <= 200),
  budget        text check (char_length(budget) <= 100),
  notes         text check (char_length(notes) <= 1000),
  avoid_repeats boolean not null default true,  -- don't repeat last edition's pairs
  started_at    timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists events_one_current on public.events ((1)) where status <> 'archived';

-- Upgrade from v1: the old single-row "event" table becomes the first edition.
do $$
begin
  if to_regclass('public.event') is not null and not exists (select 1 from public.events) then
    insert into public.events (name, status, draw_date, started_at)
    select 'Secret Santa ' || extract(year from coalesce(event_date, now()))::int, status, event_date, started_at
    from public.event;
  end if;
end $$;
insert into public.events (name)
select 'Secret Santa ' || extract(year from now())::int
where not exists (select 1 from public.events);

create table if not exists public.assignments (
  event_id    int  not null references public.events on delete cascade,
  giver_id    uuid not null references public.profiles on delete cascade,
  receiver_id uuid not null references public.profiles on delete cascade,
  primary key (event_id, giver_id),
  unique (event_id, receiver_id),
  check (giver_id <> receiver_id)
);

-- Upgrade from v1: assignments gain an event_id.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'assignments' and column_name = 'event_id') then
    alter table public.assignments add column event_id int references public.events on delete cascade;
    update public.assignments set event_id = (select id from public.events where status <> 'archived');
    alter table public.assignments drop constraint assignments_pkey;
    alter table public.assignments drop constraint assignments_receiver_id_key;
    alter table public.assignments alter column event_id set not null;
    alter table public.assignments add primary key (event_id, giver_id);
    alter table public.assignments add unique (event_id, receiver_id);
  end if;
end $$;

drop table if exists public.event cascade;
drop function if exists public.set_event_date(timestamptz);

-- ───────────── Helpers ─────────────
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ───────────── Row level security ─────────────
alter table public.profiles    enable row level security;
alter table public.hints       enable row level security;
alter table public.events      enable row level security;
alter table public.assignments enable row level security;

revoke all on all tables in schema public from anon;

-- Everyone logged in can see participants and their hints.
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (true);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Admins may set anybody's photo (the grant below limits updates to photo_url).
drop policy if exists "admin profile photo update" on public.profiles;
create policy "admin profile photo update" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- Users may only change their photo (not role, username or on/off).
revoke update on public.profiles from authenticated;
grant update (photo_url) on public.profiles to authenticated;

drop policy if exists "hints readable" on public.hints;
create policy "hints readable" on public.hints for select to authenticated using (true);
drop policy if exists "hints insert own" on public.hints;
create policy "hints insert own" on public.hints for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "hints update own" on public.hints;
create policy "hints update own" on public.hints for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "hints delete own" on public.hints;
create policy "hints delete own" on public.hints for delete to authenticated using (owner_id = auth.uid());

drop policy if exists "events readable" on public.events;
create policy "events readable" on public.events for select to authenticated using (true);
revoke insert, update, delete on public.events from authenticated;

-- A user can only ever read the assignments where they are the giver. Nobody (admin included) sees the rest.
drop policy if exists "own assignment" on public.assignments;
create policy "own assignment" on public.assignments for select to authenticated using (giver_id = auth.uid());
revoke insert, update, delete on public.assignments from authenticated;

-- ───────────── The draw ─────────────
-- Random shuffle of ids; giver ids[i] gives to ids[i+1] (last gives to first).
-- One single loop: nobody draws themselves, and no 2-person swaps (with 3+ people).
create or replace function public._make_cycle(ids uuid[]) returns uuid[]
language sql volatile as $$
  select array_agg(id order by r) from (select id, random() as r from unnest(ids) as id) s;
$$;

-- Same, but rejects shuffles that repeat a pair from edition `prev` (null = no restriction).
-- Returns null if no valid shuffle is found.
create or replace function public._find_cycle(ids uuid[], prev int) returns uuid[]
language plpgsql volatile as $$
declare
  n int := array_length(ids, 1);
  cand uuid[];
  attempt int;
begin
  for attempt in 1..5000 loop
    cand := public._make_cycle(ids);
    if prev is null or not exists (
      select 1 from generate_series(1, n) i
      join public.assignments a
        on a.event_id = prev and a.giver_id = cand[i] and a.receiver_id = cand[i % n + 1]
    ) then
      return cand;
    end if;
  end loop;
  return null;
end $$;

-- The edition used for "don't repeat": the latest archived one, if the current event asks for it.
create or replace function public._prev_event(cur int) returns int
language sql stable as $$
  select case when (select avoid_repeats from public.events where id = cur)
    then (select id from public.events where status = 'archived' order by archived_at desc nulls last, id desc limit 1)
  end;
$$;

-- Internal: only callable by the database owner (admin RPC below and the cron job).
create or replace function public._do_draw() returns void
language plpgsql security definer set search_path = public as $$
declare
  cur int; st text; prev int; ids uuid[]; n int; i int;
begin
  select id, status into cur, st from public.events where status <> 'archived' for update;
  if st <> 'draft' then raise exception 'The event has already started'; end if;

  select array_agg(id) into ids from public.profiles where active;
  n := coalesce(array_length(ids, 1), 0);
  if n < 3 then raise exception 'At least 3 active participants are needed (found %)', n; end if;

  prev := public._prev_event(cur);
  ids := public._find_cycle(ids, prev);
  if ids is null then
    raise exception 'No valid draw exists that avoids last edition''s pairs. Turn off "avoid repeats" or add participants.';
  end if;

  delete from public.assignments where event_id = cur;
  for i in 1..n loop
    insert into public.assignments (event_id, giver_id, receiver_id) values (cur, ids[i], ids[i % n + 1]);
  end loop;
  update public.events set status = 'started', started_at = now() where id = cur;
end $$;

create or replace function public.start_event() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  perform public._do_draw();
end $$;

-- Called by the scheduled job (see cron.sql): runs the draw once the draw date has passed.
create or replace function public.auto_start_event() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.events where status = 'draft' and draw_date is not null and draw_date <= now())
     and (select count(*) from public.profiles where active) >= 3 then
    perform public._do_draw();
  end if;
end $$;

-- ───────────── Event details ─────────────
create or replace function public.set_event_details(
  p_name text, p_draw_date timestamptz, p_exchange_date timestamptz,
  p_place text, p_budget text, p_notes text, p_avoid_repeats boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.events set
    name = coalesce(nullif(trim(p_name), ''), name),
    exchange_date = p_exchange_date,
    place = nullif(trim(p_place), ''),
    budget = nullif(trim(p_budget), ''),
    notes = nullif(trim(p_notes), ''),
    -- the draw date and the repeat rule can only change before the draw
    draw_date = case when status = 'draft' then p_draw_date else draw_date end,
    avoid_repeats = case when status = 'draft' then p_avoid_repeats else avoid_repeats end
  where status <> 'archived';
end $$;

-- Wipes the draw and puts the event back to draft (admin, explicit action).
create or replace function public.reset_event() returns void
language plpgsql security definer set search_path = public as $$
declare cur int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select id into cur from public.events where status <> 'archived';
  delete from public.assignments where event_id = cur;
  update public.events set status = 'draft', started_at = null where id = cur;
end $$;

-- Closes the current edition (kept as history, used to avoid repeats) and opens next year's.
create or replace function public.start_next_event() returns void
language plpgsql security definer set search_path = public as $$
declare cur public.events;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into cur from public.events where status <> 'archived' for update;
  if cur.status <> 'started' then raise exception 'Only an event whose draw is done can be closed'; end if;

  update public.events set status = 'archived', archived_at = now() where id = cur.id;
  insert into public.events (name, place, budget, avoid_repeats)
  values ('Secret Santa ' || (extract(year from coalesce(cur.started_at, now()))::int + 1),
          cur.place, cur.budget, cur.avoid_repeats);
  update public.profiles set active = true;   -- everybody starts the new edition "on"
end $$;

-- ───────────── Nicknames ─────────────
-- Users change their own; admins can change anybody's. An empty value removes the nickname.
create or replace function public.set_nickname(uid uuid, nick text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if uid is distinct from auth.uid() and not public.is_admin() then
    raise exception 'You can only change your own nickname';
  end if;
  update public.profiles set nickname = nullif(trim(nick), '') where id = uid;
  if not found then raise exception 'User not found'; end if;
end $$;

-- ───────────── Participants on/off and replacements ─────────────
create or replace function public.set_participant_active(uid uuid, flag boolean) returns void
language plpgsql security definer set search_path = public as $$
declare cur int; st text;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select id, status into cur, st from public.events where status <> 'archived';
  if flag and st = 'started'
     and not exists (select 1 from public.assignments where event_id = cur and giver_id = uid) then
    raise exception 'This person was not part of the draw, so they can''t be turned on now';
  end if;
  update public.profiles set active = flag where id = uid;
  if not found then raise exception 'User not found'; end if;
end $$;

-- How many participants of the running draw have been turned off (= "left").
create or replace function public.leavers_count() returns int
language plpgsql stable security definer set search_path = public as $$
declare cur int; n int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select id into cur from public.events where status = 'started';
  select count(*) into n from public.assignments a join public.profiles p on p.id = a.giver_id
   where a.event_id = cur and not p.active;
  return coalesce(n, 0);
end $$;

-- Replace system: once at least 2 participants have left, the people left without a giftee/giver are
-- re-paired among themselves at random. Everybody else keeps their target.
create or replace function public.repair_event() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  min_leavers constant int := 2;
  cur int; st text; prev int; leavers int;
  g uuid[]; r uuid[]; rs uuid[]; k int; i int; attempt int; ok boolean := false; remaining int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select id, status into cur, st from public.events where status <> 'archived' for update;
  if st <> 'started' then raise exception 'The draw has not happened yet'; end if;

  select count(*) into leavers from public.assignments a join public.profiles p on p.id = a.giver_id
   where a.event_id = cur and not p.active;
  if leavers < min_leavers then
    raise exception 'The replace system needs at least % participants who left (currently %)', min_leavers, leavers;
  end if;

  -- active givers whose receiver left, and active receivers whose giver left
  select array_agg(a.giver_id) into g
    from public.assignments a
    join public.profiles pg on pg.id = a.giver_id
    join public.profiles pr on pr.id = a.receiver_id
   where a.event_id = cur and pg.active and not pr.active;
  select array_agg(a.receiver_id) into r
    from public.assignments a
    join public.profiles pg on pg.id = a.giver_id
    join public.profiles pr on pr.id = a.receiver_id
   where a.event_id = cur and pr.active and not pg.active;

  delete from public.assignments a
   where a.event_id = cur
     and (exists (select 1 from public.profiles p where p.id = a.giver_id and not p.active)
       or exists (select 1 from public.profiles p where p.id = a.receiver_id and not p.active));

  k := coalesce(array_length(g, 1), 0);
  select count(*) into remaining from public.assignments where event_id = cur;
  if remaining + k < 3 then raise exception 'Fewer than 3 participants would remain'; end if;
  if k = 0 then return jsonb_build_object('repaired', 0); end if;

  prev := public._prev_event(cur);
  for attempt in 1..3000 loop
    select array_agg(x order by random()) into rs from unnest(r) x;
    ok := true;
    for i in 1..k loop
      if g[i] = rs[i]
         or (prev is not null and exists (select 1 from public.assignments
               where event_id = prev and giver_id = g[i] and receiver_id = rs[i]))
         -- avoid creating a 2-person swap while there is still room to try
         or (attempt <= 1500 and exists (select 1 from public.assignments
               where event_id = cur and giver_id = rs[i] and receiver_id = g[i])) then
        ok := false; exit;
      end if;
    end loop;
    exit when ok;
  end loop;
  if not ok then raise exception 'Could not find a valid re-pairing'; end if;

  for i in 1..k loop
    insert into public.assignments (event_id, giver_id, receiver_id) values (cur, g[i], rs[i]);
  end loop;
  return jsonb_build_object('repaired', k);
end $$;

-- ───────────── Event test ─────────────
-- Runs the draw algorithm many times in memory on the real (active) participant list and verifies it,
-- and returns ONE sample draw so the admin can see what a draw looks like.
-- Writes nothing. The sample uses fresh randomness, so it says nothing about the real draw.
create or replace function public.test_draw() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ids uuid[]; shuffled uuid[]; n int; run int; cur int; prev int;
  runs constant int := 500;
  bad_self int; bad_recv int; bad_giver int; bad_swap int; bad_rep int;
  fail_self int := 0; fail_once int := 0; fail_swap int := 0; fail_rep int := 0; unfeasible boolean := false;
  checks jsonb := '[]'; warnings jsonb := '[]';
  st text; edate timestamptz; no_hints int; no_photo int; off int;
  sample jsonb := '[]';
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select id, status, draw_date into cur, st, edate from public.events where status <> 'archived';
  select array_agg(id) into ids from public.profiles where active;
  n := coalesce(array_length(ids, 1), 0);
  prev := public._prev_event(cur);

  checks := checks || jsonb_build_object('name', 'Event is still in draft', 'pass', st = 'draft');
  checks := checks || jsonb_build_object('name', 'At least 3 active participants (found ' || n || ')', 'pass', n >= 3);

  if n >= 3 then
    for run in 1..runs loop
      shuffled := public._find_cycle(ids, prev);
      if shuffled is null then unfeasible := true; exit; end if;
      with p as (
        select shuffled[i] as g, shuffled[i % n + 1] as r from generate_series(1, n) i
      )
      select count(*) filter (where g = r),
             n - count(distinct r),
             n - count(distinct g),
             (select count(*) from p a join p b on a.r = b.g and b.r = a.g),
             (select count(*) from p join public.assignments pa
                on pa.event_id = prev and pa.giver_id = p.g and pa.receiver_id = p.r)
        into bad_self, bad_recv, bad_giver, bad_swap, bad_rep
        from p;
      if bad_self > 0 then fail_self := fail_self + 1; end if;
      if bad_recv > 0 or bad_giver > 0 then fail_once := fail_once + 1; end if;
      if bad_swap > 0 then fail_swap := fail_swap + 1; end if;
      if bad_rep > 0 then fail_rep := fail_rep + 1; end if;
    end loop;

    if unfeasible then
      checks := checks || jsonb_build_object('name', 'A draw avoiding last edition''s pairs exists', 'pass', false);
    else
      checks := checks || jsonb_build_object('name', 'Nobody draws themselves (' || runs || ' simulated draws)', 'pass', fail_self = 0);
      checks := checks || jsonb_build_object('name', 'Everyone gives exactly once and receives exactly once', 'pass', fail_once = 0);
      checks := checks || jsonb_build_object('name', 'No two people draw each other', 'pass', fail_swap = 0);
      if prev is not null then
        checks := checks || jsonb_build_object('name', 'Nobody repeats last edition''s pair', 'pass', fail_rep = 0);
      end if;

      -- One extra, independent draw to show as a sample (never stored).
      shuffled := public._find_cycle(ids, prev);
      select jsonb_agg(jsonb_build_object('giver', coalesce(g.nickname, g.username),
                                          'receiver', coalesce(r.nickname, r.username))
                       order by coalesce(g.nickname, g.username))
        into sample
        from generate_series(1, n) i
        join public.profiles g on g.id = shuffled[i]
        join public.profiles r on r.id = shuffled[i % n + 1];
    end if;
  end if;

  checks := checks || jsonb_build_object('name', 'Draw date is set', 'pass', edate is not null);

  select count(*) into no_hints from public.profiles p
   where p.active and not exists (select 1 from public.hints h where h.owner_id = p.id);
  select count(*) into no_photo from public.profiles where active and photo_url is null;
  select count(*) into off from public.profiles where not active;
  if no_hints > 0 then warnings := warnings || to_jsonb(no_hints || ' participant(s) have no hints yet'); end if;
  if no_photo > 0 then warnings := warnings || to_jsonb(no_photo || ' participant(s) have no profile photo'); end if;
  if off > 0 then warnings := warnings || to_jsonb(off || ' participant(s) are turned off and excluded from the draw'); end if;

  return jsonb_build_object(
    'ok', not exists (select 1 from jsonb_array_elements(checks) c where (c->>'pass')::boolean = false),
    'participants', n,
    'sample', sample,
    'checks', checks,
    'warnings', warnings
  );
end $$;

-- ───────────── Games: The Dog Poll ─────────────
-- Every user says which colleague each dog looks like. Votes are private: nobody can read anybody
-- else's votes (admin included). When the admin reveals the results, only the winners are shown.
create table if not exists public.game_settings (
  id                int primary key default 1 check (id = 1),
  games_visible     boolean not null default false,   -- is the Games section open to regular users?
  dog_poll_revealed boolean not null default false    -- are the Dog Poll results public (voting closed)?
);

create table if not exists public.dogs (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 80),
  main_image_url text not null,
  gallery_urls   text[] not null default '{}' check (cardinality(gallery_urls) <= 12),
  is_example     boolean not null default false,
  created_at     timestamptz not null default now()
);

create table if not exists public.dog_votes (
  dog_id        uuid not null references public.dogs on delete cascade,
  voter_id      uuid not null references public.profiles on delete cascade,
  voted_user_id uuid not null references public.profiles on delete cascade,
  primary key (dog_id, voter_id),
  check (voter_id <> voted_user_id)
);

-- First install only: closed settings plus one example dog (the admin can delete it).
do $$
begin
  if not exists (select 1 from public.game_settings) then
    insert into public.game_settings (id) values (1);
    insert into public.dogs (name, main_image_url, is_example)
    values ('Example: Sir Barksalot',
      'data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' viewBox=''0 0 400 300''%3E%3Crect width=''400'' height=''300'' fill=''%23f6d9a8''/%3E%3Ctext x=''200'' y=''210'' font-size=''170'' text-anchor=''middle''%3E%F0%9F%90%B6%3C/text%3E%3C/svg%3E',
      true);
  end if;
end $$;

alter table public.game_settings enable row level security;
alter table public.dogs          enable row level security;
alter table public.dog_votes     enable row level security;
revoke all on public.game_settings, public.dogs, public.dog_votes from anon;

drop policy if exists "settings readable" on public.game_settings;
create policy "settings readable" on public.game_settings for select to authenticated using (true);
revoke insert, update, delete on public.game_settings from authenticated;

-- Dogs are invisible to regular users until the admin opens the Games section.
drop policy if exists "dogs readable" on public.dogs;
create policy "dogs readable" on public.dogs for select to authenticated
  using (public.is_admin() or (select games_visible from public.game_settings where id = 1));
drop policy if exists "dogs admin insert" on public.dogs;
create policy "dogs admin insert" on public.dogs for insert to authenticated with check (public.is_admin());
drop policy if exists "dogs admin update" on public.dogs;
create policy "dogs admin update" on public.dogs for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "dogs admin delete" on public.dogs;
create policy "dogs admin delete" on public.dogs for delete to authenticated using (public.is_admin());

-- You can only ever read your own votes; writes go through cast_vote().
drop policy if exists "own votes" on public.dog_votes;
create policy "own votes" on public.dog_votes for select to authenticated using (voter_id = auth.uid());
revoke insert, update, delete on public.dog_votes from authenticated;

-- Pick (or clear, with a null user) who a dog looks like.
create or replace function public.cast_vote(p_dog uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.game_settings;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into s from public.game_settings where id = 1;
  if not (s.games_visible or public.is_admin()) then raise exception 'Games are not open yet'; end if;
  if s.dog_poll_revealed then raise exception 'Voting is closed: the results have been revealed'; end if;
  if p_user is null then
    delete from public.dog_votes where dog_id = p_dog and voter_id = auth.uid();
    return;
  end if;
  if p_user = auth.uid() then raise exception 'You can''t pick yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'User not found'; end if;
  if not exists (select 1 from public.dogs where id = p_dog) then raise exception 'Dog not found'; end if;
  insert into public.dog_votes (dog_id, voter_id, voted_user_id) values (p_dog, auth.uid(), p_user)
  on conflict (dog_id, voter_id) do update set voted_user_id = excluded.voted_user_id;
end $$;

-- For each user who got votes: the dog(s) with the most votes for them (a tie returns all of them).
-- Only works after the admin reveals the results.
create or replace function public.dog_poll_results() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (select dog_poll_revealed from public.game_settings where id = 1) then
    raise exception 'The results have not been revealed yet';
  end if;
  return coalesce((
    with c as (select voted_user_id as u, dog_id as d, count(*) as n from public.dog_votes group by 1, 2),
         m as (select u, max(n) as mx from c group by u)
    select jsonb_agg(jsonb_build_object('user_id', x.u, 'dogs', x.dogs))
    from (
      select c.u, jsonb_agg(jsonb_build_object('dog_id', c.d, 'votes', c.n) order by c.n desc, c.d) as dogs
      from c join m on m.u = c.u and c.n = m.mx
      group by c.u
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function public.set_games_visible(flag boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.game_settings set games_visible = flag where id = 1;
end $$;

create or replace function public.set_dog_poll_revealed(flag boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.game_settings set dog_poll_revealed = flag where id = 1;
end $$;

-- Wipes every vote (e.g. after the admin has tried the game out).
create or replace function public.reset_dog_votes() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  delete from public.dog_votes where true;
  update public.game_settings set dog_poll_revealed = false where id = 1;
end $$;

-- Admin-only progress: how many dogs each person has voted on. Shows counts only, never WHO was picked.
create or replace function public.dog_poll_progress() returns table (user_id uuid, voted int, total int)
language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select count(*) into n from public.dogs;
  return query
    select p.id, (select count(*)::int from public.dog_votes v where v.voter_id = p.id), n
    from public.profiles p;
end $$;

revoke all on function public.cast_vote(uuid, uuid), public.dog_poll_results(),
  public.set_games_visible(boolean), public.set_dog_poll_revealed(boolean), public.reset_dog_votes(),
  public.dog_poll_progress()
  from public, anon;
grant execute on function public.cast_vote(uuid, uuid), public.dog_poll_results(),
  public.set_games_visible(boolean), public.set_dog_poll_revealed(boolean), public.reset_dog_votes(),
  public.dog_poll_progress()
  to authenticated;

-- ───────────── Keep-alive ─────────────
-- Free Supabase projects pause after a week without activity. A scheduled GitHub workflow calls this.
create or replace function public.ping() returns timestamptz
language sql stable as $$ select now(); $$;

-- ───────────── Function permissions ─────────────
revoke all on function public._make_cycle(uuid[]), public._find_cycle(uuid[], int),
  public._prev_event(int), public._do_draw(), public.auto_start_event()
  from public, anon, authenticated;

revoke all on function public.set_nickname(uuid, text) from public, anon;
grant execute on function public.set_nickname(uuid, text) to authenticated;

revoke all on function public.start_event(), public.set_event_details(text, timestamptz, timestamptz, text, text, text, boolean),
  public.reset_event(), public.start_next_event(), public.set_participant_active(uuid, boolean),
  public.leavers_count(), public.repair_event(), public.test_draw()
  from public, anon;
grant execute on function public.start_event(), public.set_event_details(text, timestamptz, timestamptz, text, text, text, boolean),
  public.reset_event(), public.start_next_event(), public.set_participant_active(uuid, boolean),
  public.leavers_count(), public.repair_event(), public.test_draw()
  to authenticated;

grant execute on function public.ping() to anon, authenticated;

-- ───────────── Photo storage ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "photos list" on storage.objects;
create policy "photos list" on storage.objects for select to authenticated using (bucket_id = 'photos');
drop policy if exists "photos insert own" on storage.objects;
create policy "photos insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos update own" on storage.objects;
create policy "photos update own" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "photos delete own" on storage.objects;
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
-- Admins can also remove any photo (e.g. when replacing another user's picture).
drop policy if exists "photos admin delete" on storage.objects;
create policy "photos admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());
