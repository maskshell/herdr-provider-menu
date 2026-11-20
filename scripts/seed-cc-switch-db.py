#!/usr/bin/env python3
"""Seed a cc-switch SQLite DB on a headless machine (herdr-provider-menu T9).

cc-switch is GUI-only, but its provider store is a plain SQLite DB. This
script builds that DB exactly as a current install would leave it, so the
GUI can open it later with zero migrations: every table from
src-tauri/src/database/schema.rs (create_tables_on_conn_unbatched) with
PRAGMA user_version = SCHEMA_VERSION (27 at the time of writing; bump along
with schema.rs).

Usage:
  seed-cc-switch-db.py <db-path> --spec spec.json [--force]
  spec.json: {"providers": [{"name": "...", "settings": {...}, "meta": {...},
                             "current": true, "sort": 0}, ...],
             "common": {...}}          # optional common_config_claude

Why full DDL + current version (not a minimal seed): the GUI's migration
chain calls add_column_if_missing, which ERRORS when a table is missing, so
a providers+settings-only DB with user_version=0 would crash v0->v1.
"""
import argparse
import json
import os
import sqlite3
import sys
import time

SCHEMA_VERSION = 27

DDL = """
CREATE TABLE IF NOT EXISTS providers (
    id TEXT NOT NULL,
    app_type TEXT NOT NULL,
    name TEXT NOT NULL,
    settings_config TEXT NOT NULL,
    website_url TEXT,
    category TEXT,
    created_at INTEGER,
    sort_index INTEGER,
    notes TEXT,
    icon TEXT,
    icon_color TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    is_current BOOLEAN NOT NULL DEFAULT 0,
    in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
    PRIMARY KEY (id, app_type)
);
CREATE TABLE IF NOT EXISTS provider_endpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id TEXT NOT NULL,
    app_type TEXT NOT NULL,
    url TEXT NOT NULL,
    added_at INTEGER,
    FOREIGN KEY (provider_id, app_type) REFERENCES providers(id, app_type) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, server_config TEXT NOT NULL,
    description TEXT, homepage TEXT, docs TEXT, tags TEXT NOT NULL DEFAULT '[]',
    enabled_claude BOOLEAN NOT NULL DEFAULT 0, enabled_codex BOOLEAN NOT NULL DEFAULT 0,
    enabled_gemini BOOLEAN NOT NULL DEFAULT 0, enabled_grokbuild BOOLEAN NOT NULL DEFAULT 0,
    enabled_opencode BOOLEAN NOT NULL DEFAULT 0,
    enabled_mcode BOOLEAN NOT NULL DEFAULT 0,
    enabled_agy BOOLEAN NOT NULL DEFAULT 0,
    enabled_kimi BOOLEAN NOT NULL DEFAULT 0,
    enabled_dsh BOOLEAN NOT NULL DEFAULT 0,
    enabled_copilot BOOLEAN NOT NULL DEFAULT 0,
    enabled_workbuddy BOOLEAN NOT NULL DEFAULT 0,
    enabled_hermes BOOLEAN NOT NULL DEFAULT 0,
    enabled_pi BOOLEAN NOT NULL DEFAULT 0,
    enabled_omp BOOLEAN NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prompts (
    id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL,
    description TEXT, enabled BOOLEAN NOT NULL DEFAULT 1, created_at INTEGER, updated_at INTEGER,
    PRIMARY KEY (id, app_type)
);
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    directory TEXT NOT NULL,
    repo_owner TEXT,
    repo_name TEXT,
    repo_branch TEXT DEFAULT 'main',
    readme_url TEXT,
    enabled_claude BOOLEAN NOT NULL DEFAULT 0,
    enabled_codex BOOLEAN NOT NULL DEFAULT 0,
    enabled_gemini BOOLEAN NOT NULL DEFAULT 0,
    enabled_grokbuild BOOLEAN NOT NULL DEFAULT 0,
    enabled_opencode BOOLEAN NOT NULL DEFAULT 0,
    enabled_mcode BOOLEAN NOT NULL DEFAULT 0,
    enabled_agy BOOLEAN NOT NULL DEFAULT 0,
    enabled_kimi BOOLEAN NOT NULL DEFAULT 0,
    enabled_dsh BOOLEAN NOT NULL DEFAULT 0,
    enabled_copilot BOOLEAN NOT NULL DEFAULT 0,
    enabled_workbuddy BOOLEAN NOT NULL DEFAULT 0,
    enabled_hermes BOOLEAN NOT NULL DEFAULT 0,
    installed_at INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0,
    repo_host TEXT
);
CREATE TABLE IF NOT EXISTS skill_repos (
    owner TEXT NOT NULL, name TEXT NOT NULL, branch TEXT NOT NULL DEFAULT 'main',
    enabled BOOLEAN NOT NULL DEFAULT 1, host TEXT NOT NULL DEFAULT 'github.com',
    PRIMARY KEY (owner, name)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS proxy_config (
    app_type TEXT PRIMARY KEY CHECK (app_type IN ('claude','codex','gemini','grokbuild')),
    proxy_enabled INTEGER NOT NULL DEFAULT 0, listen_address TEXT NOT NULL DEFAULT '127.0.0.1',
    listen_port INTEGER NOT NULL DEFAULT 15721, enable_logging INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 0, auto_failover_enabled INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3, streaming_first_byte_timeout INTEGER NOT NULL DEFAULT 60,
    streaming_idle_timeout INTEGER NOT NULL DEFAULT 120, non_streaming_timeout INTEGER NOT NULL DEFAULT 600,
    circuit_failure_threshold INTEGER NOT NULL DEFAULT 4, circuit_success_threshold INTEGER NOT NULL DEFAULT 2,
    circuit_timeout_seconds INTEGER NOT NULL DEFAULT 60, circuit_error_rate_threshold REAL NOT NULL DEFAULT 0.6,
    circuit_min_requests INTEGER NOT NULL DEFAULT 10,
    default_cost_multiplier TEXT NOT NULL DEFAULT '1',
    pricing_model_source TEXT NOT NULL DEFAULT 'response',
    live_takeover_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS provider_health (
    provider_id TEXT NOT NULL, app_type TEXT NOT NULL, is_healthy INTEGER NOT NULL DEFAULT 1,
    consecutive_failures INTEGER NOT NULL DEFAULT 0, last_success_at TEXT, last_failure_at TEXT,
    last_error TEXT, updated_at TEXT NOT NULL,
    PRIMARY KEY (provider_id, app_type),
    FOREIGN KEY (provider_id, app_type) REFERENCES providers(id, app_type) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS proxy_request_logs (
    request_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, app_type TEXT NOT NULL, model TEXT NOT NULL,
    request_model TEXT,
    pricing_model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    input_token_semantics INTEGER NOT NULL DEFAULT 0,
    input_cost_usd TEXT NOT NULL DEFAULT '0', output_cost_usd TEXT NOT NULL DEFAULT '0',
    cache_read_cost_usd TEXT NOT NULL DEFAULT '0', cache_creation_cost_usd TEXT NOT NULL DEFAULT '0',
    total_cost_usd TEXT NOT NULL DEFAULT '0', latency_ms INTEGER NOT NULL, first_token_ms INTEGER,
    duration_ms INTEGER, status_code INTEGER NOT NULL, error_message TEXT, session_id TEXT,
    provider_type TEXT, is_streaming INTEGER NOT NULL DEFAULT 0,
    cost_multiplier TEXT NOT NULL DEFAULT '1.0', created_at INTEGER NOT NULL,
    data_source TEXT NOT NULL DEFAULT 'proxy'
);
CREATE INDEX IF NOT EXISTS idx_request_logs_provider ON proxy_request_logs(provider_id, app_type);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON proxy_request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_model ON proxy_request_logs(model);
CREATE INDEX IF NOT EXISTS idx_request_logs_session ON proxy_request_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_status ON proxy_request_logs(status_code);
CREATE TABLE IF NOT EXISTS model_pricing (
    model_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
    input_cost_per_million TEXT NOT NULL, output_cost_per_million TEXT NOT NULL,
    cache_read_cost_per_million TEXT NOT NULL DEFAULT '0',
    cache_creation_cost_per_million TEXT NOT NULL DEFAULT '0'
);
CREATE TABLE IF NOT EXISTS stream_check_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, provider_id TEXT NOT NULL, provider_name TEXT NOT NULL,
    app_type TEXT NOT NULL, status TEXT NOT NULL, success INTEGER NOT NULL, message TEXT NOT NULL,
    response_time_ms INTEGER, http_status INTEGER, model_used TEXT,
    retry_count INTEGER DEFAULT 0, tested_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stream_check_logs_provider
    ON stream_check_logs(app_type, provider_id, tested_at DESC);
CREATE TABLE IF NOT EXISTS proxy_live_backup (
    app_type TEXT PRIMARY KEY, original_config TEXT NOT NULL, backed_up_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_daily_rollups (
    date TEXT NOT NULL,
    app_type TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    request_model TEXT NOT NULL DEFAULT '',
    pricing_model TEXT NOT NULL DEFAULT '',
    request_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    input_token_semantics INTEGER NOT NULL DEFAULT 0,
    total_cost_usd TEXT NOT NULL DEFAULT '0',
    avg_latency_ms INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, app_type, provider_id, model, request_model, pricing_model)
);
CREATE TABLE IF NOT EXISTS session_log_sync (
    file_path TEXT PRIMARY KEY,
    last_modified INTEGER NOT NULL,
    last_line_offset INTEGER NOT NULL DEFAULT 0,
    last_synced_at INTEGER NOT NULL,
    last_byte_offset INTEGER,
    last_tail_fingerprint INTEGER,
    parser_state TEXT
);
CREATE TABLE IF NOT EXISTS session_usage_dedup (
    data_source TEXT NOT NULL,
    request_id TEXT NOT NULL,
    semantic_id TEXT NOT NULL,
    has_entry_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (data_source, request_id)
);
CREATE INDEX IF NOT EXISTS idx_session_usage_dedup_semantic
    ON session_usage_dedup(data_source, semantic_id, has_entry_id);
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    sort_order INTEGER,
    created_at INTEGER,
    updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_providers_failover
    ON providers(app_type, in_failover_queue, sort_index);
"""

PROXY_SEED = [
    ("claude", 6, 90, 180, 600, 8, 3, 90, 0.7, 15),
    ("codex", 3, 60, 120, 600, 4, 2, 60, 0.6, 10),
    ("gemini", 5, 60, 120, 600, 4, 2, 60, 0.6, 10),
    ("grokbuild", 3, 60, 120, 600, 4, 2, 60, 0.6, 10),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("db", help="database path, e.g. ~/.cc-switch/cc-switch.db")
    ap.add_argument("--spec", required=True, help="JSON: {providers: [...], common: {...}}")
    ap.add_argument("--force", action="store_true", help="overwrite an existing database")
    args = ap.parse_args()

    spec = json.load(open(args.spec))
    db = os.path.abspath(os.path.expanduser(args.db))
    if os.path.exists(db) and not args.force:
        sys.exit(f"refusing to overwrite {db} (use --force)")
    os.makedirs(os.path.dirname(db), exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(db + suffix)
        except FileNotFoundError:
            pass

    now = int(time.time() * 1000)
    conn = sqlite3.connect(db)
    conn.executescript(DDL)
    conn.executemany(
        "INSERT OR IGNORE INTO proxy_config (app_type, max_retries,"
        " streaming_first_byte_timeout, streaming_idle_timeout, non_streaming_timeout,"
        " circuit_failure_threshold, circuit_success_threshold, circuit_timeout_seconds,"
        " circuit_error_rate_threshold, circuit_min_requests)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)", PROXY_SEED)

    for i, p in enumerate(spec.get("providers", [])):
        conn.execute(
            "INSERT INTO providers (id, app_type, name, settings_config, website_url,"
            " category, created_at, sort_index, notes, icon, icon_color, meta,"
            " is_current, in_failover_queue)"
            " VALUES (?,?,?,?,NULL,NULL,?,?,NULL,NULL,NULL,?,?,0)",
            (f"seed-{i + 1}", "claude", p["name"], json.dumps(p.get("settings", {}),
             ensure_ascii=False), now, p.get("sort", i),
             json.dumps(p.get("meta", {}), ensure_ascii=False),
             1 if p.get("current") else 0))
    if spec.get("common"):
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('common_config_claude', ?)",
                     (json.dumps(spec["common"], ensure_ascii=False),))
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()
    conn.close()

    # The database holds provider tokens: owner-only, whatever the umask says
    # (a plain sqlite3.create lands world-readable 644 like cc-switch's own).
    for suffix in ("", "-wal", "-shm"):
        if os.path.exists(db + suffix):
            os.chmod(db + suffix, 0o600)

    # verify: reopen read-only like the mod does, run the mod's exact query
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    ok = conn.execute("PRAGMA integrity_check").fetchone()[0]
    ver = conn.execute("PRAGMA user_version").fetchone()[0]
    rows = conn.execute(
        "SELECT name, is_current FROM providers WHERE app_type='claude'"
        " ORDER BY is_current DESC, sort_index ASC, name ASC").fetchall()
    conn.close()
    print(f"integrity: {ok}, user_version: {ver}")
    for name, cur in rows:
        print(f"  provider: {name}{' (current)' if cur else ''}")
    if ok != "ok" or ver != SCHEMA_VERSION:
        sys.exit("verification FAILED")
    print(f"seeded {db}")


if __name__ == "__main__":
    main()
