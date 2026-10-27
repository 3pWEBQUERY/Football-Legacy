/** Spätere SQL-Migrationen (ausgelagert, damit migrations.ts unter der Zeilengrenze bleibt). */
export const LATE_MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "022_push_worker.sql",
    sql: `
-- Schlüssel, die der Server selbst erzeugt (z. B. VAPID für Push)
create table if not exists app_secrets (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);

-- Push-Abos je Gerät
create table if not exists push_subscriptions (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  topics text[] not null default '{online,jobs}',
  created_at timestamptz not null default now(),
  last_used timestamptz
);
create index if not exists push_subscriptions_account on push_subscriptions(account_id);

-- Warteschlange für Rechenaufträge (Hintergrunddienst)
create table if not exists sim_jobs (
  id bigserial primary key,
  kind text not null,
  account_id uuid references accounts(id) on delete cascade,
  career_id uuid,
  payload jsonb not null default '{}',
  status text not null default 'queued',
  result jsonb,
  error jsonb,
  worker text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  polled_at timestamptz
);
create index if not exists sim_jobs_queued on sim_jobs(id) where status = 'queued';
create index if not exists sim_jobs_finished on sim_jobs(finished_at);

create table if not exists sim_workers (
  id text primary key,
  host text,
  pid int,
  started_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  jobs int not null default 0
);
`,
  },
  {
    name: "023_terms_security.sql",
    sql: `
-- Nutzungsbedingungen, Altersbestätigung und E-Mail-Bestätigung
alter table accounts add column if not exists terms_version int not null default 0;
alter table accounts add column if not exists terms_accepted_at timestamptz;
alter table accounts add column if not exists age_confirmed boolean not null default false;
alter table accounts add column if not exists email_verified_at timestamptz;

create table if not exists email_verifications (
  id bigserial primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  token_hash text not null unique,
  email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Anmeldeversuche für Limits (Passwort-Raten, Massenregistrierung)
create table if not exists auth_attempts (
  id bigserial primary key,
  kind text not null,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_attempts_key on auth_attempts(kind, key, created_at);

-- Fehlerprotokoll (Server und Browser)
create table if not exists error_log (
  id bigserial primary key,
  source text not null,
  message text not null,
  stack text,
  path text,
  account_id uuid,
  user_agent text,
  fingerprint text not null,
  created_at timestamptz not null default now()
);
create index if not exists error_log_created on error_log(created_at);
create index if not exists error_log_fingerprint on error_log(fingerprint, created_at);

-- Moderation im Liga-Chat
alter table online_posts add column if not exists hidden boolean not null default false;
create table if not exists online_reports (
  post_id bigint not null,
  reporter_id uuid not null references accounts(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (post_id, reporter_id)
);
create table if not exists online_blocks (
  account_id uuid not null references accounts(id) on delete cascade,
  blocked_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, blocked_id)
);
`,
  },
  {
    name: "024_u19_council.sql",
    sql: `
-- U19-Liga der Akademie (eine Zeile pro Saison)
create table if not exists u19_seasons (
  career_id uuid not null references careers(id) on delete cascade,
  season int not null,
  data jsonb not null,
  primary key (career_id, season)
);
-- Mannschaftsrat: Sitzungen und offene Anliegen
create table if not exists council (
  career_id uuid primary key references careers(id) on delete cascade,
  data jsonb not null
);
`,
  },
  {
    name: "025_rivals_ai.sql",
    sql: `
-- Konkurrenzangebote anderer Vereine in laufenden Verhandlungen
alter table negotiations add column if not exists rival jsonb;
-- Von Claude geschriebene Artikel kennzeichnen
alter table media add column if not exists ai boolean not null default false;
-- Co-Trainer-Chat (letzte Nachrichten je Karriere)
create table if not exists ai_chats (
  career_id uuid primary key references careers(id) on delete cascade,
  messages jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
-- Nutzung der KI-Texte (Kosten, Fehler; 30 Tage)
create table if not exists ai_log (
  id bigserial primary key,
  account_id uuid references accounts(id) on delete cascade,
  feature text not null,
  input_tokens int,
  output_tokens int,
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_log_created on ai_log(created_at);
`,
  },
  {
    name: "026_admin.sql",
    sql: `
-- Sperren von Konten durch Administratoren
alter table accounts add column if not exists banned_until timestamptz;
alter table accounts add column if not exists ban_reason text;
-- Bearbeitung gemeldeter Nachrichten
alter table online_reports add column if not exists resolved_at timestamptz;
alter table online_reports add column if not exists resolution text;
-- Protokoll der Admin-Aktionen (nachvollziehbare Moderation)
create table if not exists admin_actions (
  id bigserial primary key,
  admin_email text not null,
  action text not null,
  target_account uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_actions_created on admin_actions(created_at desc);
`,
  },
];
