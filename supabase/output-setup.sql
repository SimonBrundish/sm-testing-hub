-- Supermovers Growth & Maturation: Output Sports sync tables
-- Run after setup.sql: SQL Editor > New query > paste all of this > Run. Safe to run again.
-- The output-sync edge function fills these with the service role key. Coaches can only read them;
-- the dashboard copies the results it is told to use into gm_players.

-- Athletes as Output knows them. Matched to dashboard players by name and date of birth.
create table if not exists public.gm_output_athletes (
  id          text primary key,
  external_id text,
  first_name  text,
  last_name   text,
  full_name   text,
  dob         date,
  synced_at   timestamptz not null default now()
);

-- Exercise and circuit definitions: names, metric fields and units.
create table if not exists public.gm_output_exercises (
  id        text primary key,
  kind      text not null check (kind in ('exercise', 'circuit')),
  name      text,
  data      jsonb not null,
  synced_at timestamptz not null default now()
);

-- One row per Output test. metrics is {field: value}; data is the whole record as Output sent it.
create table if not exists public.gm_output_measurements (
  id           text primary key,
  athlete_id   text not null,
  exercise_id  text not null,
  completed_at timestamptz not null,
  variant      text,
  metrics      jsonb not null default '{}',
  data         jsonb not null,
  synced_at    timestamptz not null default now()
);
create index if not exists gm_output_measurements_athlete on public.gm_output_measurements (athlete_id, completed_at);

-- Sync status (one row, id = 'state').
create table if not exists public.gm_output_sync (
  id         text primary key,
  synced_to  timestamptz,
  last_run   timestamptz,
  last_ok    timestamptz,
  last_error text,
  counts     jsonb
);

alter table public.gm_output_athletes     enable row level security;
alter table public.gm_output_exercises    enable row level security;
alter table public.gm_output_measurements enable row level security;
alter table public.gm_output_sync         enable row level security;

drop policy if exists gm_output_athletes_coach on public.gm_output_athletes;
create policy gm_output_athletes_coach on public.gm_output_athletes for select to authenticated using (public.gm_is_coach());
drop policy if exists gm_output_exercises_coach on public.gm_output_exercises;
create policy gm_output_exercises_coach on public.gm_output_exercises for select to authenticated using (public.gm_is_coach());
drop policy if exists gm_output_measurements_coach on public.gm_output_measurements;
create policy gm_output_measurements_coach on public.gm_output_measurements for select to authenticated using (public.gm_is_coach());
drop policy if exists gm_output_sync_coach on public.gm_output_sync;
create policy gm_output_sync_coach on public.gm_output_sync for select to authenticated using (public.gm_is_coach());

revoke all on public.gm_output_athletes, public.gm_output_exercises, public.gm_output_measurements, public.gm_output_sync from anon;
revoke insert, update, delete on public.gm_output_athletes, public.gm_output_exercises, public.gm_output_measurements, public.gm_output_sync from authenticated;
grant select on public.gm_output_athletes, public.gm_output_exercises, public.gm_output_measurements, public.gm_output_sync to authenticated;

-- Daily sync at 05:00 UTC. Needs the pg_cron and pg_net extensions (Database > Extensions) and two Vault secrets
-- (Project Settings > Vault, or the SQL below with your own values filled in):
--   select vault.create_secret('https://msnazqefuanyodfzxlwl.supabase.co', 'gm_project_url');
--   select vault.create_secret('<the same SYNC_SECRET you gave the edge function>', 'gm_output_sync_secret');
-- Then uncomment and run:
-- select cron.schedule('gm-output-sync', '0 5 * * *', $$
--   select net.http_post(
--     url     := (select decrypted_secret from vault.decrypted_secrets where name = 'gm_project_url') || '/functions/v1/output-sync',
--     headers := jsonb_build_object('Content-Type', 'application/json',
--                  'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gm_output_sync_secret')),
--     body    := '{}'::jsonb,
--     timeout_milliseconds := 120000);
-- $$);
