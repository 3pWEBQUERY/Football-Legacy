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
  {
    name: "002_cup.sql",
    sql: `
alter table fixtures add column if not exists cup_id int;
alter table fixtures add column if not exists cup_round int;
alter table fixtures add column if not exists pen_home int;
alter table fixtures add column if not exists pen_away int;
create table if not exists cups (
  id serial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  season int not null,
  country_code text not null,
  name text not null,
  rounds jsonb not null,
  byes jsonb not null default '[]',
  current_round int not null default 1,
  winner_club_id int,
  runner_up_club_id int
);
create index if not exists cups_career_idx on cups(career_id, season);
create index if not exists fixtures_cup_idx on fixtures(career_id, cup_id);
`,
  },
  {
    name: "003_reviews_loans.sql",
    sql: `
create table if not exists season_reviews (
  career_id uuid not null references careers(id) on delete cascade,
  season int not null,
  data jsonb not null,
  primary key (career_id, season)
);
`,
  },
  {
    name: "004_calendar.sql",
    sql: `
alter table careers add column if not exists day int not null default 0;
alter table careers add column if not exists calendar jsonb;
alter table inbox add column if not exists day int;
`,
  },
  {
    name: "005_continental.sql",
    sql: `
alter table cups add column if not exists kind text not null default 'national';
alter table cups add column if not exists groups jsonb;
alter table fixtures add column if not exists group_no int;
alter table careers add column if not exists qualifiers jsonb;
`,
  },
  {
    name: "006_academy_facilities.sql",
    sql: `
create table if not exists academy (
  career_id uuid not null references careers(id) on delete cascade,
  id int not null,
  data jsonb not null,
  primary key (career_id, id)
);
alter table careers add column if not exists facilities jsonb;
`,
  },
  {
    name: "007_scouting.sql",
    sql: `
alter table careers add column if not exists scouting jsonb;
`,
  },
  {
    name: "008_monthly_awards.sql",
    sql: `
create table if not exists monthly_awards (
  id serial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  season int not null,
  month int not null,
  league_id int not null,
  data jsonb not null
);
create index if not exists monthly_awards_career on monthly_awards(career_id, season, month);
`,
  },
  {
    name: "009_media.sql",
    sql: `
create table if not exists media (
  id serial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  season int not null,
  day int not null,
  kind text not null,
  title text not null,
  body text not null,
  club_id int,
  player_id int,
  own boolean not null default false,
  importance int not null default 1
);
create index if not exists media_career on media(career_id, id desc);
`,
  },
  {
    name: "010_national.sql",
    sql: `
create table if not exists national_teams (
  career_id uuid primary key references careers(id) on delete cascade,
  data jsonb not null
);
create table if not exists national_matches (
  id serial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  season int not null,
  day int not null,
  kind text not null,
  stage text not null,
  home text not null,
  away text not null,
  home_goals int,
  away_goals int,
  pen_home int,
  pen_away int,
  played boolean not null default false,
  user_match boolean not null default false,
  data jsonb
);
create index if not exists national_matches_day on national_matches(career_id, season, day);
`,
  },
  {
    name: "011_staff_team.sql",
    sql: `
alter table careers add column if not exists staff_team jsonb;
`,
  },
  {
    name: "012_club_mgmt.sql",
    sql: `
alter table careers add column if not exists club_mgmt jsonb;
`,
  },
  {
    name: "013_online_leagues.sql",
    sql: `
create table if not exists online_leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  owner_id uuid not null references accounts(id) on delete cascade,
  status text not null default 'open',
  max_members int not null default 8,
  public boolean not null default true,
  rhythm text not null default 'manual',
  season int not null default 1,
  round int not null default 0,
  rounds int not null default 0,
  next_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists online_members (
  id serial primary key,
  league_id uuid not null references online_leagues(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  career_id uuid references careers(id) on delete set null,
  club_id int,
  bot boolean not null default false,
  manager text not null,
  team jsonb not null,
  snapshot jsonb,
  ready boolean not null default false,
  joined_at timestamptz not null default now()
);
create unique index if not exists online_members_human on online_members(league_id, account_id) where not bot;
create table if not exists online_fixtures (
  id serial primary key,
  league_id uuid not null references online_leagues(id) on delete cascade,
  season int not null,
  round int not null,
  home_id int not null references online_members(id) on delete cascade,
  away_id int not null references online_members(id) on delete cascade,
  home_goals int,
  away_goals int,
  played boolean not null default false,
  report jsonb
);
create index if not exists online_fixtures_league on online_fixtures(league_id, season, round);
create table if not exists online_posts (
  id serial primary key,
  league_id uuid not null references online_leagues(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  author text not null,
  system boolean not null default false,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists online_posts_league on online_posts(league_id, id desc);
`,
  },
  {
    name: "014_jobs.sql",
    sql: `
alter table careers add column if not exists jobs jsonb;
`,
  },
  {
    name: "015_tactics.sql",
    sql: `
alter table careers add column if not exists tactics jsonb;
`,
  },
  {
    name: "016_inbox_rich.sql",
    sql: `
alter table inbox add column if not exists sender jsonb;
alter table inbox add column if not exists blocks jsonb;
alter table inbox add column if not exists priority int not null default 1;
alter table inbox add column if not exists kind text;
create index if not exists inbox_kind on inbox(career_id, kind, id desc);
`,
  },
  {
    name: "017_negotiations.sql",
    sql: `
create table if not exists negotiations (
  id serial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  player_id int not null,
  player_name text not null,
  from_club int,
  to_club int not null,
  stage text not null,
  status text not null,
  offer jsonb,
  counter jsonb,
  demand jsonb,
  terms jsonb,
  patience int not null default 3,
  respond_season int,
  respond_day int,
  season int not null,
  day int not null,
  message text,
  log jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
create index if not exists negotiations_career on negotiations(career_id, id desc);
create table if not exists transfer_payments (
  id serial primary key,
  career_id uuid not null references careers(id) on delete cascade,
  from_club int not null,
  to_club int,
  amount bigint not null,
  due_season int not null,
  label text not null,
  paid boolean not null default false
);
create index if not exists transfer_payments_due on transfer_payments(career_id, due_season) where not paid;
`,
  },
  {
    name: "018_negotiation_kinds.sql",
    sql: `
alter table negotiations add column if not exists kind text not null default 'buy';
create index if not exists negotiations_active on negotiations(career_id, kind) where stage in ('club', 'contract');
`,
  },
  {
    name: "019_history.sql",
    sql: `
create table if not exists club_seasons (
  career_id uuid not null references careers(id) on delete cascade,
  season int not null,
  club_id int not null,
  league_id int not null,
  league_name text not null,
  tier int not null,
  position int not null,
  played int not null,
  won int not null,
  drawn int not null,
  lost int not null,
  gf int not null,
  ga int not null,
  points int not null,
  champion boolean not null default false,
  promoted boolean not null default false,
  relegated boolean not null default false,
  cup text,
  continental text,
  manager text,
  user_managed boolean not null default false,
  top_scorer jsonb,
  best_win jsonb,
  worst_loss jsonb,
  primary key (career_id, club_id, season)
);
create index if not exists club_seasons_season on club_seasons(career_id, season);
create table if not exists player_careers (
  career_id uuid not null references careers(id) on delete cascade,
  player_id int not null,
  club_id int not null,
  name text not null,
  position text not null,
  nationality text not null,
  seasons int not null default 0,
  apps int not null default 0,
  goals int not null default 0,
  assists int not null default 0,
  rating_sum real not null default 0,
  first_season int not null,
  last_season int not null,
  peak_rating int not null default 0,
  retired_season int,
  primary key (career_id, player_id, club_id)
);
create index if not exists player_careers_club on player_careers(career_id, club_id);
`,
  },
  {
    name: "020_password_resets.sql",
    sql: `
create table if not exists password_resets (
  id serial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists password_resets_account on password_resets(account_id, created_at);
create index if not exists password_resets_ip on password_resets(ip, created_at);
`,
  },
];
