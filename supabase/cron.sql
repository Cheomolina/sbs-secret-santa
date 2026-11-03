-- Automatic draw: checks every 5 minutes whether the event date has passed and, if so, runs the draw.
-- Run once in the SQL Editor (pg_cron is included in Supabase; this enables it).
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'auto-start-event',
  '*/5 * * * *',
  $$ select public.auto_start_event(); $$
);
