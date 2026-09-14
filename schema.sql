-- GENERATED from docs/data-model.md §1 — do not edit by hand

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  handle         TEXT NOT NULL UNIQUE,   -- display name; a real name never enters the database
  password_hash  TEXT,                   -- NULL means this identity has no password (see below)
  created_at     TIMESTAMP NOT NULL
);

CREATE TABLE videos (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  storage_key TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL
  -- Note: no EXIF or GPS. Stripped on the client before upload; the server never gets it
);

CREATE TABLE storyboards (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  title         TEXT,
  status        TEXT NOT NULL CHECK (status IN ('active','readonly','archived')),
  last_entry_at TIMESTAMP,               -- 30 days without an update → readonly (see user-flow §9)
  closed_note   TEXT,                    -- the closing line when an owner ends it deliberately
  created_at    TIMESTAMP NOT NULL
);

CREATE TABLE entries (
  id             TEXT PRIMARY KEY,
  storyboard_id  TEXT NOT NULL REFERENCES storyboards(id),
  author_id      TEXT NOT NULL REFERENCES users(id),
  video_id       TEXT REFERENCES videos(id),
  species        TEXT NOT NULL CHECK (species IN ('brushtail','ringtail','other','unknown')),
  fun_fact       TEXT,
  story          TEXT,
  created_at     TIMESTAMP NOT NULL,
  deleted_at     TIMESTAMP                -- soft delete; must be filtered out when assembling context
);

CREATE TABLE access_grants (
  id            TEXT PRIMARY KEY,
  storyboard_id TEXT NOT NULL REFERENCES storyboards(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  level         TEXT NOT NULL CHECK (level IN ('view','contribute','reshare')),
  granted_by    TEXT NOT NULL REFERENCES users(id),
  granted_at    TIMESTAMP NOT NULL,
  revoked_at    TIMESTAMP,                -- non-null means revoked, effective immediately
  UNIQUE (storyboard_id, user_id)
);

CREATE TABLE share_links (             -- what sits behind a QR code
  id            TEXT PRIMARY KEY,
  storyboard_id TEXT NOT NULL REFERENCES storyboards(id),
  token_hash    TEXT NOT NULL UNIQUE,   -- the hash only, never the plaintext token
  created_by    TEXT NOT NULL REFERENCES users(id),
  level         TEXT NOT NULL CHECK (level IN ('view','contribute','reshare')),
  expires_at    TIMESTAMP,
  max_uses      INTEGER,
  used_count    INTEGER NOT NULL DEFAULT 0,
  revoked_at    TIMESTAMP
);

CREATE TABLE chat_messages (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  storyboard_id  TEXT NOT NULL REFERENCES storyboards(id),  -- partition key; a conversation never spans storyboards
  role           TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content        TEXT NOT NULL,
  model          TEXT,
  prompt_version TEXT,                   -- see §3
  created_at     TIMESTAMP NOT NULL
);

CREATE TABLE screening_results (
  id             TEXT PRIMARY KEY,
  -- Points at whatever was screened. No entry_id foreign key: a rejected submission
  -- never created an entry, and forum posts are not in entries either. The cost is no
  -- foreign-key constraint; the CHECK below covers half of it.
  subject_type   TEXT NOT NULL CHECK (subject_type IN ('entry','forum_post','submission')),
  subject_id     TEXT,                   -- empty when subject_type='submission': no row to point at yet
  author_id      TEXT REFERENCES users(id),  -- who wrote it; a refused submission has no entry, so this is how it is found
  field          TEXT NOT NULL CHECK (field IN ('fun_fact','story','forum_post')),
  verdict        TEXT NOT NULL CHECK (verdict IN ('ok','review','reject')),
  codes          TEXT NOT NULL DEFAULT '[]',   -- JSON array
  note           TEXT,
  original_text  TEXT,                   -- left empty when verdict='ok' (see operations §1)
  model          TEXT,
  prompt_version TEXT,
  fail_open      BOOLEAN NOT NULL DEFAULT 0,   -- marks a fallback publish after a model timeout
  downgraded_non_english BOOLEAN NOT NULL DEFAULT 0,  -- the non-English floor pushed a reject down to review
  disposition    TEXT CHECK (disposition IN ('kept','labelled','removed')),  -- how the review queue ended
  disposed_at    TIMESTAMP,              -- disposal time; operations §1 measures its 30-day delete from this
  created_at     TIMESTAMP NOT NULL,
  CHECK (subject_type = 'submission' OR subject_id IS NOT NULL)
);

CREATE TABLE forum_threads (        -- discussion threads hanging off a storyboard
  id            TEXT PRIMARY KEY,
  storyboard_id TEXT NOT NULL REFERENCES storyboards(id),
  author_id     TEXT NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL,
  deleted_at    TIMESTAMP
);

CREATE TABLE forum_posts (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES forum_threads(id),
  author_id   TEXT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL,
  deleted_at  TIMESTAMP
);

CREATE TABLE rate_limits (          -- the three ceilings from operations §3
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  scope       TEXT NOT NULL CHECK (scope IN ('chat','vision','submission','login')),
  used_at     TIMESTAMP NOT NULL
  -- One row per call, so counting means counting rows inside the window. Expired rows
  -- are cleared in passing on the next count, with no scheduled job. This table is what
  -- several serverless instances share.
);

CREATE INDEX rate_limits_lookup ON rate_limits (user_id, scope, used_at);

CREATE TABLE review_votes (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT NOT NULL REFERENCES entries(id),
  voter_id    TEXT NOT NULL REFERENCES users(id),
  vote        TEXT NOT NULL CHECK (vote IN ('looks_right','worth_checking')),
  created_at  TIMESTAMP NOT NULL,
  UNIQUE (entry_id, voter_id)            -- one vote each
);
