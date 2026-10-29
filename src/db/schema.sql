-- Schéma SQLite FAWONE (cahier de projet §7).
-- Montants en centimes (INTEGER). Dates en ISO 8601 UTC.
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  title TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT 'Membre',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('super_admin','branch_admin','treasurer','member','donor')),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  location TEXT NOT NULL DEFAULT '',
  phone TEXT,
  email TEXT UNIQUE COLLATE NOCASE,
  joined_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','inactive')),
  privacy TEXT NOT NULL DEFAULT 'private' CHECK (privacy IN ('members','branch','private')),
  is_minor INTEGER NOT NULL DEFAULT 0,
  bio TEXT,
  password_hash TEXT,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_members_branch ON members(branch_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_member ON sessions(member_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  sponsor_id TEXT NOT NULL REFERENCES members(id),
  invitee_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  contact TEXT NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id),
  consent_confirmed INTEGER NOT NULL DEFAULT 0,
  is_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','accepted','expired')),
  reviewed_by TEXT REFERENCES members(id),
  note TEXT,
  token_hash TEXT UNIQUE,
  token_expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitations_branch ON invitations(branch_id, status);

CREATE TABLE IF NOT EXISTS family_links (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  related_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  branch_id TEXT REFERENCES branches(id),
  status TEXT NOT NULL CHECK (status IN ('upcoming','active','completed')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  budget_cents INTEGER NOT NULL DEFAULT 0,
  target_cents INTEGER NOT NULL DEFAULT 0,
  spent_cents INTEGER NOT NULL DEFAULT 0,
  manager_id TEXT REFERENCES members(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_updates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  donor_name TEXT NOT NULL,
  donor_email TEXT,
  donor_id TEXT REFERENCES members(id),
  project_id TEXT REFERENCES projects(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'XAF',
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed','refunded','cancelled')),
  recurrence TEXT NOT NULL DEFAULT 'once' CHECK (recurrence IN ('once','monthly')),
  receipt_number TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_donations_project ON donations(project_id, status);

CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('news','project','announcement')),
  project_id TEXT REFERENCES projects(id),
  branch_id TEXT REFERENCES branches(id),
  status TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
  published_at TEXT NOT NULL,
  author_id TEXT REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL,
  online INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  branch_id TEXT REFERENCES branches(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channels TEXT NOT NULL,
  audience TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  sent_by TEXT REFERENCES members(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- Journal des messages WhatsApp envoyés au groupe de l'association.
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- project | event | news | donation | manual | test
  entity_id TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','sent','failed')),
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_created ON whatsapp_messages(created_at);
