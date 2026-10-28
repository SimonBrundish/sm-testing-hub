-- Supermovers Growth & Maturation: database setup
-- Run once in the Supabase dashboard: SQL Editor > New query > paste all of this > Run.
-- Everything is prefixed gm_ so it sits alongside the existing StrengthLab tables
-- without touching them. Safe to run again.

-- 1. Who may see player data. Having a login is not enough: the email must be listed here.
create table if not exists public.gm_coaches (
  email      text primary key check (email = lower(email)),
  added_at   timestamptz not null default now()
);

-- 2. One row per player; measurements live in data.assessments.
create table if not exists public.gm_players (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- 3. Dashboard settings (one row, id = 'settings').
create table if not exists public.gm_settings (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- True when the signed-in user's email is on the coach list.
create or replace function public.gm_is_coach()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.gm_coaches where email = lower(auth.jwt() ->> 'email'));
$$;
revoke all on function public.gm_is_coach() from public, anon;
grant execute on function public.gm_is_coach() to authenticated;

-- Row level security: nothing is readable without a coach login.
alter table public.gm_coaches  enable row level security;
alter table public.gm_players  enable row level security;
alter table public.gm_settings enable row level security;

drop policy if exists gm_coaches_self on public.gm_coaches;
create policy gm_coaches_self on public.gm_coaches
  for select to authenticated using (email = lower(auth.jwt() ->> 'email'));

drop policy if exists gm_players_coach on public.gm_players;
create policy gm_players_coach on public.gm_players
  for all to authenticated using (public.gm_is_coach()) with check (public.gm_is_coach());

drop policy if exists gm_settings_coach on public.gm_settings;
create policy gm_settings_coach on public.gm_settings
  for all to authenticated using (public.gm_is_coach()) with check (public.gm_is_coach());

revoke all on public.gm_coaches, public.gm_players, public.gm_settings from anon;
grant select on public.gm_coaches to authenticated;
grant select, insert, update, delete on public.gm_players, public.gm_settings to authenticated;

-- Live updates, so every coach sees new measurements without reloading.
do $$ begin
  alter publication supabase_realtime add table public.gm_players;
exception when duplicate_object then null; end $$;

-- 4. Add coaches (lower-case emails). Repeat for each coach; delete a row to remove access.
-- insert into public.gm_coaches (email) values ('simon@example.com'), ('howard@example.com');
