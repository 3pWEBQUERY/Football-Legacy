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
  {
    name: "027_betrieb.sql",
    sql: `
-- Schlankere Indizes für Spiele: (Karriere, Verein) lässt sich komprimieren, der alte Index war fast eindeutig
create index if not exists fixtures_home_idx on fixtures(career_id, home_id);
create index if not exists fixtures_away_idx on fixtures(career_id, away_id);
drop index if exists fixtures_club_idx;
-- Aufräumen inaktiver Konten: Zeitpunkt der Vorwarnung per E-Mail
alter table accounts add column if not exists inactivity_warned_at timestamptz;
create index if not exists accounts_last_login on accounts(last_login_day);
-- Zwei-Faktor-Anmeldung (TOTP) für Administratoren
alter table accounts add column if not exists totp_secret text;
alter table accounts add column if not exists totp_enabled_at timestamptz;
alter table accounts add column if not exists totp_last_step bigint;
alter table sessions add column if not exists mfa_at timestamptz;
create index if not exists sessions_expires on sessions(expires_at);
`,
  },
  {
    name: "028_neuigkeiten.sql",
    sql: `
-- Neuigkeiten auf der Startseite (verfasst im Admin-Bereich)
create table if not exists site_images (
  id bigserial primary key,
  mime text not null,
  data bytea not null,
  bytes int not null,
  created_at timestamptz not null default now()
);
create table if not exists site_news (
  id bigserial primary key,
  slug text not null unique,
  category text not null default 'update',
  title text not null,
  teaser text not null default '',
  body text not null default '',
  title_en text,
  teaser_en text,
  body_en text,
  image_id bigint references site_images(id) on delete set null,
  featured boolean not null default false,
  published boolean not null default false,
  published_at timestamptz not null default now(),
  author text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists site_news_public on site_news(published_at desc) where published;
`,
  },
  {
    name: "029_weltnachrichten.sql",
    sql: `
-- Weltnachrichten: strukturierte Angaben zu Medienartikeln (Wechsel, Interesse, Leihe) und gelesen-Markierung je Karriere
alter table media add column if not exists data jsonb;
alter table careers add column if not exists media_seen_id bigint not null default 0;
update careers c set media_seen_id = coalesce((select max(id) from media m where m.career_id = c.id), 0);
-- Neuigkeiten: mitgeliefertes Titelbild aus public/ (wird durch ein hochgeladenes ersetzt)
alter table site_news add column if not exists cover text;
-- Erste Meldung zum Start
insert into site_news(slug, category, title, teaser, body, title_en, teaser_en, body_en, cover, featured, published, published_at, author)
values ('football-legacy-ist-live', 'event',
  $t$Football Legacy ist live!$t$,
  $t$Der Anpfiff ist erfolgt: Football Legacy ist ab sofort für alle spielbar – kostenlos, im Browser und auf dem Smartphone.$t$,
  $t$Der Anpfiff ist erfolgt: Ab heute ist Football Legacy für alle spielbar. Kostenlos, direkt im Browser und ohne Download – am Computer genauso wie auf dem Smartphone.

## Was dich erwartet

- **155 Fussballnationen** mit eigenen Ligapyramiden und über 3.000 frei erfundenen Vereinen
- **Eine Matchengine mit 540 Spielzügen pro Partie**, live in der 2D-Ansicht – mit Zurufen von der Seitenlinie und Halbzeitansprache
- **Taktik bis ins Detail:** Formationen, Rollen, Pressing, Abwehrlinie und Standards
- **Transfermarkt mit echten Verhandlungen:** Gegenangebote, Ausstiegsklauseln, Leihen und KI-Vereine, die um dieselben Spieler bieten
- **Vereinsführung:** Training, Jugendakademie, Finanzen, Vorstand, Fans und Trainerstab
- **Online-Ligen**, in denen du gegen Freunde antrittst

## So startest du

- Kostenloses Konto anlegen
- Land, Liga und Verein wählen
- Erste Trainingswoche planen – und los geht's

> Jede Saison schreibt ihre eigene Geschichte. Wir sind gespannt, welche du schreibst.

## Wie geht es weiter?

Football Legacy wird laufend weiterentwickelt. Neue Funktionen, Updates und Wartungsfenster kündigen wir hier in den Neuigkeiten an. Du hast einen Fehler gefunden oder eine Idee? Die Kontaktadresse findest du im [Impressum](/impressum).

Viel Erfolg an der Seitenlinie!$t$,
  $t$Football Legacy is live!$t$,
  $t$Kick-off: Football Legacy is now open to everyone – free, in your browser and on your phone.$t$,
  $t$Kick-off: from today, Football Legacy is open to everyone. Free, right in your browser and without a download – on your computer as well as on your phone.

## What to expect

- **155 football nations** with their own league pyramids and more than 3,000 fictional clubs
- **A match engine with 540 moves per match**, live in the 2D view – with touchline shouts and half-time team talks
- **Tactics in detail:** formations, roles, pressing, defensive line and set pieces
- **A transfer market with real negotiations:** counter-offers, release clauses, loans and AI clubs bidding for the same players
- **Club management:** training, youth academy, finances, board, fans and coaching staff
- **Online leagues** where you take on your friends

## How to start

- Create a free account
- Pick a country, league and club
- Plan your first training week – and off you go

> Every season writes its own story. We can't wait to see yours.

## What's next?

Football Legacy is under active development. We announce new features, updates and maintenance windows here in the news. Found a bug or have an idea? You'll find our contact address in the [legal notice](/impressum).

Good luck on the touchline!$t$,
  '/news/launch.webp', true, true, now(), 'Football Legacy Team')
on conflict (slug) do nothing;
`,
  },
];
