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
];
