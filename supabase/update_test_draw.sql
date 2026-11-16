-- Update for an existing database: the event test now also returns one sample draw.
-- Run this in the SQL Editor (safe to run more than once). Do NOT re-run schema.sql.

-- Event test: runs the draw algorithm many times in memory on the real participant list and
-- verifies it, and returns ONE sample draw so the admin can see what a draw looks like.
-- Writes nothing. The sample uses fresh randomness, so it says nothing about the real draw.
create or replace function public.test_draw() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ids uuid[]; shuffled uuid[]; n int; run int;
  runs constant int := 500;
  bad_self int; bad_recv int; bad_giver int; bad_swap int;
  fail_self int := 0; fail_once int := 0; fail_swap int := 0;
  checks jsonb := '[]'; warnings jsonb := '[]';
  st text; edate timestamptz; no_hints int; no_photo int;
  sample jsonb := '[]';
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

    -- One extra, independent draw to show as a sample (never stored).
    shuffled := public._make_cycle(ids);
    select jsonb_agg(jsonb_build_object('giver', g.username, 'receiver', r.username) order by g.username)
      into sample
      from generate_series(1, n) i
      join public.profiles g on g.id = shuffled[i]
      join public.profiles r on r.id = shuffled[i % n + 1];
  end if;

  checks := checks || jsonb_build_object('name', 'Event date is set', 'pass', edate is not null);

  select count(*) into no_hints from public.profiles p where not exists (select 1 from public.hints h where h.owner_id = p.id);
  select count(*) into no_photo from public.profiles where photo_url is null;
  if no_hints > 0 then warnings := warnings || to_jsonb(no_hints || ' participant(s) have no hints yet'); end if;
  if no_photo > 0 then warnings := warnings || to_jsonb(no_photo || ' participant(s) have no profile photo'); end if;

  return jsonb_build_object(
    'ok', not exists (select 1 from jsonb_array_elements(checks) c where (c->>'pass')::boolean = false),
    'participants', n,
    'sample', sample,
    'checks', checks,
    'warnings', warnings
  );
end $$;

grant execute on function public.test_draw() to authenticated;
