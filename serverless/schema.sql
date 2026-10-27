CREATE TABLE IF NOT EXISTS activity_state (key TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS activity_audiences (id TEXT PRIMARY KEY NOT NULL, identity_hash TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL DEFAULT 0, nickname TEXT NOT NULL, last_seen_at INTEGER NOT NULL, online_until INTEGER NOT NULL, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS activity_audiences_online_idx ON activity_audiences (online_until);
CREATE TABLE IF NOT EXISTS activity_admin_sessions (token_hash TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS activity_login_attempts (ip_hash TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS activity_connections (id TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS activity_connections_expiry_idx ON activity_connections (expires_at);
