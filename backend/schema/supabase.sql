-- Run once in the Supabase SQL editor. The API uses the service key, so Row Level Security is enabled with no
-- public policies: the tables cannot be read or written with the anon key.
create table if not exists bg_profiles (
  version int primary key,
  data jsonb not null,
  created_by text,
  summary text,
  created_at timestamptz default now()
);
create table if not exists bg_submissions (
  id text primary key,
  seq int not null,
  status text not null check (status in ('in_review','changes_requested','approved','rejected')),
  data jsonb not null,           -- submission document: versions, findings, comments, activity
  updated_at timestamptz default now()
);
create index if not exists bg_submissions_status on bg_submissions(status);
create index if not exists bg_submissions_seq on bg_submissions(seq desc);
alter table bg_profiles enable row level security;
alter table bg_submissions enable row level security;
