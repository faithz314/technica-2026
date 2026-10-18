/**
 * Database schema. Every statement is idempotent so `npm run migrate` can be
 * re-run safely against an existing database.
 *
 * Tiger Data services ship with TimescaleDB, so `play_sessions` becomes a
 * hypertable partitioned on `played_at`. On a plain Postgres without the
 * extension the table simply stays a regular table.
 */
export const SCHEMA_SQL = /* sql */ `
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  display_name  text not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists auth_sessions (
  token_hash text primary key,
  user_id    uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists auth_sessions_user_idx on auth_sessions (user_id);

create table if not exists reference_tracks (
  video_id      text primary key,
  playlist_id   text,
  title         text,
  sample_rate_hz real not null,
  duration_ms   integer not null,
  frame_count   integer not null,
  frames        jsonb not null,
  recorded_by   uuid references users (id) on delete set null,
  updated_at    timestamptz not null default now()
);

create table if not exists play_sessions (
  id            uuid not null default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  video_id      text not null,
  playlist_id   text,
  title         text,
  points        integer not null,
  accuracy      real not null,
  grade         text not null,
  max_combo     integer not null,
  scored_frames integer not null,
  tier_counts   jsonb not null,
  duration_ms   integer not null,
  played_at     timestamptz not null default now(),
  -- Hypertables need the partitioning column in every unique index.
  primary key (id, played_at)
);
create index if not exists play_sessions_user_idx
  on play_sessions (user_id, played_at desc);

create table if not exists user_totals (
  user_id       uuid primary key references users (id) on delete cascade,
  total_points  bigint not null default 0,
  total_plays   integer not null default 0,
  best_points   integer not null default 0,
  best_accuracy real not null default 0
);

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'timescaledb') then
    create extension if not exists timescaledb;
    perform create_hypertable('play_sessions', by_range('played_at'), if_not_exists => true);
  end if;
end
$$;
`;
