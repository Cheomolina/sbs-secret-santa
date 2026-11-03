-- Secret Santa schema. Run once in Supabase: SQL Editor -> New query -> paste -> Run.

-- ───────────── Tables ─────────────
create table public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  username   text not null unique check (username ~ '^[a-z0-9_.-]{3,24}$'),
  role       text not null default 'user' check (role in ('user', 'admin')),
  photo_url  text,
  created_at timestamptz not null default now()
);

create table public.hints (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  image_url   text,
  description text check (char_length(description) <= 500),
  url         text check (url ~* '^https?://' and char_length(url) <= 500),
  created_at  timestamptz not null default now()
);
create index hints_owner_idx on public.hints (owner_id);

-- Single-row table holding the event state.
create table public.event (
  id         int primary key default 1 check (id = 1),
  status     text not null default 'draft' check (status in ('draft', 'started')),
  event_date timestamptz,
  started_at timestamptz
);
insert into public.event (id) values (1);

create table public.assignments (
  giver_id    uuid primary key references public.profiles on delete cascade,
  receiver_id uuid not null unique references public.profiles on delete cascade,
  check (giver_id <> receiver_id)
);

-- ───────────── Helpers ─────────────
create function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ───────────── Row level security ─────────────
alter table public.profiles    enable row level security;
alter table public.hints       enable row level security;
alter table public.event       enable row level security;
alter table public.assignments enable row level security;

revoke all on all tables in schema public from anon;

-- Everyone logged in can see participants and their hints.
create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "own profile update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Users may only change their photo (not role or username).
revoke update on public.profiles from authenticated;
grant update (photo_url) on public.profiles to authenticated;

create policy "hints readable" on public.hints for select to authenticated using (true);
create policy "hints insert own" on public.hints for insert to authenticated with check (owner_id = auth.uid());
create policy "hints update own" on public.hints for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "hints delete own" on public.hints for delete to authenticated using (owner_id = auth.uid());

create policy "event readable" on public.event for select to authenticated using (true);
revoke insert, update, delete on public.event from authenticated;

-- A user can only ever read the assignment where they are the giver. Nobody (admin included) sees the rest.
create policy "own assignment" on public.assignments for select to authenticated using (giver_id = auth.uid());
revoke insert, update, delete on public.assignments from authenticated;

-- ───────────── The draw ─────────────
-- Random shuffle of ids; giver ids[i] gives to ids[i+1] (last gives to first).
-- One single loop: nobody draws themselves, and no 2-person swaps (with 3+ people).
create function public._make_cycle(ids uuid[]) returns uuid[]
language sql volatile as $$
  select array_agg(id order by r) from (select id, random() as r from unnest(ids) as id) s;
$$;

-- Internal: only callable by the database owner (admin RPC below and the cron job).
create function public._do_draw() returns void
language plpgsql security definer set search_path = public as $$
declare
  ids uuid[]; n int; i int; st text;
begin
  select status into st from public.event where id = 1 for update;
  if st <> 'draft' then raise exception 'The event has already started'; end if;

  select array_agg(id) into ids from public.profiles;
  n := coalesce(array_length(ids, 1), 0);
  if n < 3 then raise exception 'At least 3 participants are needed (found %)', n; end if;

  ids := public._make_cycle(ids);
  delete from public.assignments;
  for i in 1..n loop
    insert into public.assignments (giver_id, receiver_id) values (ids[i], ids[i % n + 1]);
  end loop;
  update public.event set status = 'started', started_at = now() where id = 1;
end $$;
revoke all on function public._do_draw() from public, anon, authenticated;

create function public.start_event() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  perform public._do_draw();
end $$;

-- Called by the scheduled job (see cron.sql): runs the draw once the event date has passed.
create function public.auto_start_event() returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.event where id = 1 and status = 'draft' and event_date is not null and event_date <= now())
     and (select count(*) from public.profiles) >= 3 then
    perform public._do_draw();
  end if;
end $$;
revoke all on function public.auto_start_event() from public, anon, authenticated;

create function public.set_event_date(d timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if (select status from public.event where id = 1) <> 'draft' then
    raise exception 'The event has already started';
  end if;
  update public.event set event_date = d where id = 1;
end $$;

-- Wipes the draw and puts the event back to draft (admin, explicit action).
create function public.reset_event() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  delete from public.assignments;
  update public.event set status = 'draft', started_at = null where id = 1;
end $$;

-- Event test: runs the draw algorithm many times in memory on the real participant list and
-- verifies it. Writes nothing and returns no names, so the admin learns nothing about the real draw.
create function public.test_draw() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ids uuid[]; shuffled uuid[]; n int; run int;
  runs constant int := 500;
  bad_self int; bad_recv int; bad_giver int; bad_swap int;
  fail_self int := 0; fail_once int := 0; fail_swap int := 0;
  checks jsonb := '[]'; warnings jsonb := '[]';
  st text; edate timestamptz; no_hints int; no_photo int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;

  select array_agg(id) into ids from public.profiles;
  n := coalesce(array_length(ids, 1), 0);
  select status, event_date into st, edate from public.event where id = 1;

  checks := checks || jsonb_build_object('name', 'Event is still in draft', 'pass', st = 'draft');
  checks := checks || jsonb_build_object('name', 'At least 3 participants (found ' || n || ')', 'pass', n >= 3);

  if n >= 3 then
    for run in 1..runs loop
      shuffled := public._make_cycle(ids);
      with p as (
        select shuffled[i] as g, shuffled[i % n + 1] as r from generate_series(1, n) i
      )
      select count(*) filter (where g = r),
             n - count(distinct r),
             n - count(distinct g),
             (select count(*) from p a join p b on a.r = b.g and b.r = a.g)
        into bad_self, bad_recv, bad_giver, bad_swap
        from p;
      if bad_self > 0 then fail_self := fail_self + 1; end if;
      if bad_recv > 0 or bad_giver > 0 then fail_once := fail_once + 1; end if;
      if bad_swap > 0 then fail_swap := fail_swap + 1; end if;
    end loop;
    checks := checks || jsonb_build_object('name', 'Nobody draws themselves (' || runs || ' simulated draws)', 'pass', fail_self = 0);
    checks := checks || jsonb_build_object('name', 'Everyone gives exactly once and receives exactly once', 'pass', fail_once = 0);
    checks := checks || jsonb_build_object('name', 'No two people draw each other', 'pass', fail_swap = 0);
  end if;

  checks := checks || jsonb_build_object('name', 'Event date is set', 'pass', edate is not null);

  select count(*) into no_hints from public.profiles p where not exists (select 1 from public.hints h where h.owner_id = p.id);
  select count(*) into no_photo from public.profiles where photo_url is null;
  if no_hints > 0 then warnings := warnings || to_jsonb(no_hints || ' participant(s) have no hints yet'); end if;
  if no_photo > 0 then warnings := warnings || to_jsonb(no_photo || ' participant(s) have no profile photo'); end if;

  return jsonb_build_object(
    'ok', not exists (select 1 from jsonb_array_elements(checks) c where (c->>'pass')::boolean = false),
    'participants', n,
    'checks', checks,
    'warnings', warnings
  );
end $$;

revoke all on function public.start_event(), public.set_event_date(timestamptz),
  public.reset_event(), public.test_draw() from public, anon;
grant execute on function public.start_event(), public.set_event_date(timestamptz),
  public.reset_event(), public.test_draw() to authenticated;

-- ───────────── Photo storage ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "photos list" on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy "photos insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos update own" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
