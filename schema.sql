-- GENERATED from docs/data-model.md §1 — do not edit by hand

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  handle      TEXT NOT NULL UNIQUE,      -- 展示名；真名不进库
  created_at  TIMESTAMP NOT NULL
);

CREATE TABLE videos (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  storage_key TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL
  -- 注意: 不存 EXIF/GPS。上传前在客户端剥离，服务端不接收
);

CREATE TABLE storyboards (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  title         TEXT,
  status        TEXT NOT NULL CHECK (status IN ('active','readonly','archived')),
  last_entry_at TIMESTAMP,               -- 30 天无更新 → readonly（见 user-flow §9）
  closed_note   TEXT,                    -- owner 主动完结时的结语
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
  deleted_at     TIMESTAMP                -- 软删；组装上下文时必须过滤
);

CREATE TABLE access_grants (
  id            TEXT PRIMARY KEY,
  storyboard_id TEXT NOT NULL REFERENCES storyboards(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  level         TEXT NOT NULL CHECK (level IN ('view','contribute','reshare')),
  granted_by    TEXT NOT NULL REFERENCES users(id),
  granted_at    TIMESTAMP NOT NULL,
  revoked_at    TIMESTAMP,                -- 非空即失效，立即生效
  UNIQUE (storyboard_id, user_id)
);

CREATE TABLE share_links (             -- QR 背后的东西
  id            TEXT PRIMARY KEY,
  storyboard_id TEXT NOT NULL REFERENCES storyboards(id),
  token_hash    TEXT NOT NULL UNIQUE,   -- 只存哈希，不存明文 token
  created_by    TEXT NOT NULL REFERENCES users(id),
  expires_at    TIMESTAMP,
  max_uses      INTEGER,
  used_count    INTEGER NOT NULL DEFAULT 0,
  revoked_at    TIMESTAMP
);

CREATE TABLE chat_messages (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  storyboard_id  TEXT NOT NULL REFERENCES storyboards(id),  -- 分区键，会话不跨故事版
  role           TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content        TEXT NOT NULL,
  model          TEXT,
  prompt_version TEXT,                   -- 见 §3
  created_at     TIMESTAMP NOT NULL
);

CREATE TABLE screening_results (
  id             TEXT PRIMARY KEY,
  -- 指向被筛查的东西。不用 entry_id 外键：被 reject 的提交根本没建 entry，
  -- forum 贴文也不在 entries 里。代价是没有外键约束，靠下面那条 CHECK 兜一半。
  subject_type   TEXT NOT NULL CHECK (subject_type IN ('entry','forum_post','submission')),
  subject_id     TEXT,                   -- subject_type='submission' 时为空：还没有行可指
  field          TEXT NOT NULL CHECK (field IN ('fun_fact','story','forum_post')),
  verdict        TEXT NOT NULL CHECK (verdict IN ('ok','review','reject')),
  codes          TEXT NOT NULL DEFAULT '[]',   -- JSON 数组
  note           TEXT,
  original_text  TEXT,                   -- verdict='ok' 时留空（见 operations §1）
  model          TEXT,
  prompt_version TEXT,
  fail_open      BOOLEAN NOT NULL DEFAULT 0,   -- 模型超时兜底放行的标记
  downgraded_non_english BOOLEAN NOT NULL DEFAULT 0,  -- 非英语地板把 reject 压成了 review
  created_at     TIMESTAMP NOT NULL,
  CHECK (subject_type = 'submission' OR subject_id IS NOT NULL)
);

CREATE TABLE review_votes (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT NOT NULL REFERENCES entries(id),
  voter_id    TEXT NOT NULL REFERENCES users(id),
  vote        TEXT NOT NULL CHECK (vote IN ('looks_right','worth_checking')),
  created_at  TIMESTAMP NOT NULL,
  UNIQUE (entry_id, voter_id)            -- 一人一票
);
