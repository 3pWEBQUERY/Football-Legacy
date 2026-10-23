/** SQL-Migrationen, eingebettet, damit sie in jedem Build verfügbar sind. */
export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_init.sql",
    sql: `-- Football Legacy: Grundschema
create extension if not exists pgcrypto;

create table accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  settings jsonb not null default '{}',
  login_streak int not null default 0,
  best_login_streak int not null default 0,
  last_login_day date,
  created_at timestamptz not null default now()
);

create table sessions (
  token text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_account_idx on sessions(account_id);

create table careers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  manager_name text not null,
  seed int not null,
  club_id int,
  country_code text not null,
  season int not null,
  week int not null default 0,
  season_weeks int not null,
  status text not null default 'active',
  manager jsonb not null,
  board jsonb not null default '{}',
  training jsonb not null,
  staff jsonb not null,
  next_player_id int not null default 1,
  pending_match jsonb,
  job_offers jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index careers_account_idx on careers(account_id);

create table leagues (
  id serial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  key text not null,
  country_code text not null,
  tier int not null,
  name text not null,
  size int not null,
  promotion int not null,
  relegation int not null,
  active boolean not null default false,
  unique (career_id, key)
);
create index leagues_career_idx on leagues(career_id, country_code);

create table clubs (
  id serial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  league_id int not null references leagues(id) on delete cascade,
  country_code text not null,
  name text not null,
  short_name text not null,
  city text not null,
  reputation int not null,
  rating int not null,
  balance bigint not null default 0,
  transfer_budget bigint not null default 0,
  wage_budget bigint not null default 0,
  capacity int not null,
  colors jsonb not null,
  founded int not null,
  tactic jsonb,
  finance jsonb,
  players_generated boolean not null default false
);
create index clubs_league_idx on clubs(career_id, league_id);

create table players (
  career_id uuid not null references careers(id) on delete cascade,
  id int not null,
  club_id int,
  data jsonb not null,
  position text not null,
  rating int not null,
  potential int not null,
  age int not null,
  value bigint not null,
  nationality text not null,
  listed boolean not null default false,
  primary key (career_id, id)
);
create index players_club_idx on players(career_id, club_id);
create index players_market_idx on players(career_id, rating desc);

create table fixtures (
  id bigserial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  season int not null,
  league_id int not null,
  week int not null,
  round int not null,
  home_id int not null,
  away_id int not null,
  home_goals int,
  away_goals int,
  played boolean not null default false
);
create index fixtures_week_idx on fixtures(career_id, season, week);
create index fixtures_league_idx on fixtures(career_id, season, league_id);
create index fixtures_club_idx on fixtures(career_id, season, home_id, away_id);

create table match_reports (
  fixture_id bigint primary key references fixtures(id) on delete cascade,
  career_id uuid not null references careers(id) on delete cascade,
  data jsonb not null
);

create table transfers (
  id serial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  player_id int not null,
  player_name text not null,
  from_club int,
  to_club int,
  fee bigint not null default 0,
  wage int not null default 0,
  years int not null default 0,
  kind text not null,
  status text not null,
  counter_fee bigint,
  counter_wage int,
  message text,
  season int not null,
  week int not null,
  created_at timestamptz not null default now()
);
create index transfers_career_idx on transfers(career_id, season, status);

create table inbox (
  id serial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  season int not null,
  week int not null,
  category text not null,
  title text not null,
  body text not null,
  read boolean not null default false,
  action jsonb,
  created_at timestamptz not null default now()
);
create index inbox_career_idx on inbox(career_id, id desc);

create table finance_log (
  id bigserial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  club_id int not null,
  season int not null,
  week int not null,
  kind text not null,
  amount bigint not null,
  label text not null
);
create index finance_log_idx on finance_log(career_id, club_id, season);

create table shortlist (
  career_id uuid not null references careers(id) on delete cascade,
  player_id int not null,
  report jsonb,
  added_at timestamptz not null default now(),
  primary key (career_id, player_id)
);

create table season_results (
  id serial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  season int not null,
  club_name text not null,
  league_name text not null,
  country_code text not null,
  tier int not null,
  position int not null,
  points int not null,
  played int not null,
  ppg numeric(4,2) not null,
  champion boolean not null default false,
  promoted boolean not null default false,
  relegated boolean not null default false,
  created_at timestamptz not null default now()
);
create index season_results_ppg_idx on season_results(ppg desc);
`,
  },
];
