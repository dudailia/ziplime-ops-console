-- ziplime Ops Console: the integration schema (PLAN.md section 15.2 and 15.3).
-- Plain Postgres. The same file runs on PGlite in development and tests, and
-- on a Supabase project with `supabase db push`.

-- Roles. Supabase already has these; PGlite and a bare Postgres don't.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

-- Claims, read the way Supabase's auth.jwt() reads them. nullif because a
-- custom setting that was set once on a pooled connection reads back as ''.
create schema if not exists app;

create or replace function app.claims() returns jsonb
  language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

create or replace function app.is_ops() returns boolean
  language sql stable
  as $$ select coalesce(app.claims() ->> 'app_role', '') = 'ops' $$;

create or replace function app.account_id() returns text
  language sql stable
  as $$ select app.claims() ->> 'account_id' $$;

-- Secrets live outside public, with no grants to any client role.
create schema if not exists private;

-- A slug: lowercase letters, digits and dashes.
create domain public.slug as text check (value ~ '^[a-z0-9][a-z0-9-]{0,63}$');

create table public.accounts (
  id             public.slug primary key,
  trader         text not null check (length(trader) between 1 and 200),
  company        text,
  email          text not null check (email ~ '^[^@\s]+@[^@\s]+$'),
  account_number text not null default '',
  plan           text not null check (plan in ('beta', 'bronze', 'silver', 'gold')),
  joined         date not null,
  created_at     timestamptz not null default now()
);
-- Intake accounts have no Lime account yet (''); every real number is unique.
create unique index accounts_account_number_key on public.accounts (account_number) where account_number <> '';

create table public.signups (
  id         public.slug primary key,
  email      text not null check (email ~ '^[^@\s]+@[^@\s]+$'),
  ts         timestamptz not null,
  page       text not null,
  trade      text[] not null default '{}',
  style      text[] not null default '{}',
  funded     text[] not null default '{}',
  pain       text[] not null default '{}',
  wants_pod  boolean not null default false,
  note       text,
  decision   text check (decision in ('approved', 'dismissed')),
  decided_by text,
  decided_at timestamptz,
  account_id public.slug unique references public.accounts (id) on delete restrict,
  check (decision is null or (decided_by is not null and decided_at is not null)),
  check ((decision = 'approved') = (account_id is not null))
);

create table public.deployments (
  id              public.slug primary key,
  account_id      public.slug not null references public.accounts (id) on delete restrict,
  strategy        text not null,
  description     text not null default '',
  symbols         text[] not null default '{}',
  -- null: the deployment ran without the fail-closed risk profile.
  risk_env        jsonb check (risk_env is null or jsonb_typeof(risk_env) = 'object'),
  validate_orders boolean not null,
  deadlines       jsonb not null default '{}' check (jsonb_typeof(deadlines) = 'object'),
  -- One past the highest line number ever received for this deployment.
  next_line       integer not null default 1 check (next_line >= 1),
  created_at      timestamptz not null default now()
);
create index deployments_account_idx on public.deployments (account_id);

create table private.ingest_keys (
  deployment_id public.slug primary key references public.deployments (id) on delete restrict,
  secret        bytea not null check (octet_length(secret) = 32),
  created_at    timestamptz not null default now()
);

create table public.ingest_batches (
  id            uuid primary key,
  deployment_id public.slug not null references public.deployments (id) on delete restrict,
  received_at   timestamptz not null default now(),
  status        text not null check (status in ('stored', 'replay', 'stale', 'bad_request', 'gap')),
  file          text,
  body_sha256   text check (body_sha256 ~ '^[0-9a-f]{64}$'),
  first_line    integer check (first_line > 0),
  line_count    integer not null default 0 check (line_count >= 0),
  accepted      integer not null default 0 check (accepted >= 0),
  duplicate     integer not null default 0 check (duplicate >= 0),
  rejected      integer not null default 0 check (rejected >= 0),
  ignored       integer not null default 0 check (ignored >= 0),
  replay_of     uuid references public.ingest_batches (id) on delete restrict,
  -- The exact response body, so a replay can return it unchanged.
  result        jsonb,
  check ((status = 'replay') = (replay_of is not null)),
  check (status <> 'stored' or (body_sha256 is not null and result is not null and first_line is not null))
);
-- One stored batch per body: the same batch sent twice is a replay.
create unique index ingest_batches_body_key on public.ingest_batches (deployment_id, body_sha256) where status = 'stored';
create index ingest_batches_recent_idx on public.ingest_batches (deployment_id, received_at desc);

-- One row per line received: accepted lines with their parsed fields, and
-- rejected lines with the reason, so the console can rebuild the file exactly.
create table public.dry_run_events (
  id               bigint generated always as identity primary key,
  deployment_id    public.slug not null references public.deployments (id) on delete restrict,
  batch_id         uuid not null references public.ingest_batches (id) on delete restrict,
  line_no          integer not null check (line_no > 0),
  raw_line         text not null,
  content_hash     text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  status           text not null check (status in ('accepted', 'rejected')),
  reject_reason    text,
  event            text check (event in ('place', 'refuse', 'skip', 'cancel')),
  recorded_at      timestamptz,
  order_dt         timestamptz,
  symbol           text,
  ziplime_order_id text,
  dry_run_id       text,
  client_order_id  text,
  requested_amount numeric,
  side             text check (side in ('buy', 'sell')),
  quantity         numeric check (quantity >= 0),
  order_type       text check (order_type in ('market', 'limit')),
  limit_price      numeric check (limit_price > 0),
  reason           text,
  broker_validated boolean,
  known_order      boolean,
  account_masked   text,
  session_date     date,
  -- A re-sent line is never stored twice.
  unique (deployment_id, content_hash),
  unique (deployment_id, line_no),
  check (
    (status = 'rejected' and reject_reason is not null and event is null and session_date is null)
    or (status = 'accepted' and reject_reason is null and event is not null and recorded_at is not null and session_date is not null)
  ),
  check (event is distinct from 'place' or (dry_run_id is not null and client_order_id is not null and ziplime_order_id is not null
    and symbol is not null and side is not null and quantity is not null and order_type is not null and broker_validated is not null)),
  check (event not in ('refuse', 'skip') or event is null or (reason is not null and ziplime_order_id is not null and symbol is not null
    and requested_amount is not null)),
  check (event is distinct from 'cancel' or (dry_run_id is not null and known_order is not null and order_dt is null))
);
create index dry_run_events_session_idx on public.dry_run_events (deployment_id, session_date) where status = 'accepted';

-- Derived from accepted events, replaced inside every ingest transaction. No
-- foreign key from events to here, so the recompute can delete and insert.
create table public.sessions (
  deployment_id public.slug not null references public.deployments (id) on delete restrict,
  date          date not null,
  place         integer not null default 0 check (place >= 0),
  refuse        integer not null default 0 check (refuse >= 0),
  skip          integer not null default 0 check (skip >= 0),
  cancel        integer not null default 0 check (cancel >= 0),
  updated_at    timestamptz not null default now(),
  primary key (deployment_id, date)
);

create table public.tickets (
  -- Ticket ids are uppercase ("T-1041", "A-wen-rebalance-streak").
  id         text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,63}$'),
  account_id public.slug not null references public.accounts (id) on delete restrict,
  subject    text not null,
  created_at timestamptz not null,
  messages   jsonb not null default '[]' check (jsonb_typeof(messages) = 'array'),
  links      jsonb not null default '[]' check (jsonb_typeof(links) = 'array'),
  draft      jsonb check (draft is null or jsonb_typeof(draft) = 'object'),
  rule       jsonb check (rule is null or jsonb_typeof(rule) = 'object')
);
create index tickets_account_idx on public.tickets (account_id);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      text not null,
  action     text not null check (action in ('ingest.stored', 'ingest.replay', 'ingest.rejected', 'ingest.refused',
               'signup.approved', 'key.issued', 'key.rotated', 'seed.loaded')),
  target     text not null,
  detail     jsonb not null default '{}' check (jsonb_typeof(detail) = 'object'),
  request_id text,
  -- Refused calls (before authentication) are counted per minute, not one row each.
  bucket     timestamptz,
  count      integer not null default 1 check (count >= 1),
  check ((bucket is null) = (action <> 'ingest.refused'))
);
create unique index audit_log_bucket_key on public.audit_log (action, target, bucket) where bucket is not null;
create index audit_log_target_idx on public.audit_log (target, at desc);

-- Grants. Supabase gives anon and authenticated access to new tables in
-- public by default, so take everything away first, then grant select one
-- table at a time. Writes happen only through the owner (service) connection.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on schema private from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;
grant usage on schema app to authenticated;
grant usage on schema public to authenticated;
grant select on public.accounts, public.signups, public.deployments, public.ingest_batches, public.dry_run_events,
  public.sessions, public.tickets, public.audit_log to authenticated;

-- Row-level security on every table in public.
alter table public.accounts enable row level security;
alter table public.signups enable row level security;
alter table public.deployments enable row level security;
alter table public.ingest_batches enable row level security;
alter table public.dry_run_events enable row level security;
alter table public.sessions enable row level security;
alter table public.tickets enable row level security;
alter table public.audit_log enable row level security;
alter table private.ingest_keys enable row level security;

create policy accounts_read on public.accounts for select to authenticated
  using (app.is_ops() or id = app.account_id());

create policy tickets_read on public.tickets for select to authenticated
  using (app.is_ops() or account_id = app.account_id());

create policy deployments_read on public.deployments for select to authenticated
  using (app.is_ops() or account_id = app.account_id());

create policy sessions_read on public.sessions for select to authenticated
  using (app.is_ops() or exists (
    select 1 from public.deployments d where d.id = sessions.deployment_id and d.account_id = app.account_id()));

create policy events_read on public.dry_run_events for select to authenticated
  using (app.is_ops() or exists (
    select 1 from public.deployments d where d.id = dry_run_events.deployment_id and d.account_id = app.account_id()));

create policy batches_read on public.ingest_batches for select to authenticated
  using (app.is_ops() or exists (
    select 1 from public.deployments d where d.id = ingest_batches.deployment_id and d.account_id = app.account_id()));

create policy signups_read on public.signups for select to authenticated using (app.is_ops());

create policy audit_read on public.audit_log for select to authenticated using (app.is_ops());
