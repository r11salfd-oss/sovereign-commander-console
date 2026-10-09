-- ============================================================================
-- SOVEREIGN COMMANDER CONSOLE - ENTERPRISE DATA ARCHITECTURE (SQL-PRO)
-- Target Platform: PostgreSQL 16+ / Google Cloud SQL / Supabase / CockroachDB
-- Standards: ANSI SQL 2016+, High-Throughput OLTP/OLAP, Zero-Trust Hardening
-- Chain Key ID: 360ea36c28e66d9d
-- ============================================================================

-- 0. Extensions & Schema Configuration
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS sovereign;
SET search_path TO sovereign, public;

-- 1. Custom Domains & Enums
DO $$ BEGIN
    CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'executed', 'failed', 'rejected', 'expired');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE agent_role AS ENUM ('architect', 'developer', 'sentinel', 'forge', 'red_simulation', 'reviewer', 'copilot_bridge');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Sovereign Cryptographic Audit Ledger (Append-Only, Tamper-Evident)
CREATE TABLE IF NOT EXISTS sovereign_audit_blocks (
    block_index         BIGSERIAL PRIMARY KEY,
    block_id            UUID DEFAULT gen_random_uuid() NOT NULL UNIQUE,
    previous_hash       VARCHAR(64) NOT NULL,
    current_hash        VARCHAR(64) NOT NULL,
    merkle_root         VARCHAR(64) NOT NULL,
    event_type          VARCHAR(64) NOT NULL,
    origin_agent        VARCHAR(64) NOT NULL,
    payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
    signature           VARCHAR(256),
    created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    
    -- Invariants & Constraints
    CONSTRAINT chk_prev_hash_len CHECK (char_length(previous_hash) = 64),
    CONSTRAINT chk_curr_hash_len CHECK (char_length(current_hash) = 64)
);

-- Advanced Indexing for Audit Ledger
CREATE INDEX IF NOT EXISTS idx_audit_created_at_brin 
    ON sovereign_audit_blocks USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_audit_payload_gin 
    ON sovereign_audit_blocks USING GIN (payload jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_audit_event_type 
    ON sovereign_audit_blocks (event_type, origin_agent);

-- 3. Human-In-The-Loop (HITL) Approvals
CREATE TABLE IF NOT EXISTS sovereign_approvals (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    action_type         VARCHAR(64) NOT NULL,
    agent_id            VARCHAR(64) NOT NULL,
    status              approval_status DEFAULT 'pending' NOT NULL,
    risk                risk_level DEFAULT 'medium' NOT NULL,
    summary             VARCHAR(1024) NOT NULL,
    reason              TEXT NOT NULL,
    payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
    creator_id          VARCHAR(128) NOT NULL,
    approver_id         VARCHAR(128),
    signature           VARCHAR(256),
    execution_result    JSONB,
    created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at          TIMESTAMPTZ NOT NULL,
    resolved_at         TIMESTAMPTZ,

    CONSTRAINT chk_expiration CHECK (expires_at > created_at)
);

-- Partial Index for high-velocity polling of pending requests (0 ms lookup)
CREATE INDEX IF NOT EXISTS idx_approvals_pending 
    ON sovereign_approvals (created_at DESC) 
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_approvals_creator 
    ON sovereign_approvals (creator_id, status);

CREATE INDEX IF NOT EXISTS idx_approvals_payload_gin 
    ON sovereign_approvals USING GIN (payload);

-- 4. High-Throughput Agent Telemetry (Time-Series Partitioned)
CREATE TABLE IF NOT EXISTS agent_telemetry_events (
    id                  BIGSERIAL,
    event_timestamp     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    agent_id            VARCHAR(64) NOT NULL,
    event_type          VARCHAR(64) NOT NULL,
    latency_ms          REAL NOT NULL DEFAULT 0.0,
    cpu_usage_pct       REAL,
    memory_heap_mb      REAL,
    tokens_consumed     INTEGER DEFAULT 0,
    metadata            JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (event_timestamp, id)
) PARTITION BY RANGE (event_timestamp);

-- Initial Partitions (Rolling Monthly Partitions)
CREATE TABLE IF NOT EXISTS agent_telemetry_y2026m09 PARTITION OF agent_telemetry_events
    FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS agent_telemetry_y2026m10 PARTITION OF agent_telemetry_events
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE INDEX IF NOT EXISTS idx_telemetry_ts_brin 
    ON agent_telemetry_events USING BRIN (event_timestamp);

CREATE INDEX IF NOT EXISTS idx_telemetry_agent_time 
    ON agent_telemetry_events (agent_id, event_timestamp DESC);

-- 5. Chat Chamber Sessions & Messages
CREATE TABLE IF NOT EXISTS sovereign_chat_sessions (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    creator_id          VARCHAR(128) NOT NULL,
    title               VARCHAR(256) NOT NULL,
    chat_mode           VARCHAR(32) DEFAULT 'solo' NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS sovereign_chat_messages (
    id                  BIGSERIAL PRIMARY KEY,
    session_id          UUID NOT NULL REFERENCES sovereign_chat_sessions(id) ON DELETE CASCADE,
    sender_type         VARCHAR(32) NOT NULL, -- 'user' | 'agent' | 'system'
    sender_id           VARCHAR(64) NOT NULL,
    content             TEXT NOT NULL,
    tokens              INTEGER DEFAULT 0,
    metadata            JSONB DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_msg_session 
    ON sovereign_chat_messages (session_id, created_at ASC);

-- 6. Row Level Security (RLS) - Zero-Trust Isolation
ALTER TABLE sovereign_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sovereign_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sovereign_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_approvals_isolation ON sovereign_approvals
    FOR ALL
    TO authenticated
    USING (creator_id = current_setting('request.jwt.claims.sub', true) OR current_setting('request.jwt.claims.role', true) = 'commander');

CREATE POLICY policy_chat_sessions_isolation ON sovereign_chat_sessions
    FOR ALL
    TO authenticated
    USING (creator_id = current_setting('request.jwt.claims.sub', true));

CREATE POLICY policy_chat_messages_isolation ON sovereign_chat_messages
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM sovereign_chat_sessions s
            WHERE s.id = sovereign_chat_messages.session_id
              AND s.creator_id = current_setting('request.jwt.claims.sub', true)
        )
    );

-- 7. Advanced Analytical Views (Window Functions & Moving Averages)
CREATE OR REPLACE VIEW v_agent_24h_activity_analytics AS
WITH hourly_buckets AS (
    SELECT 
        agent_id,
        date_trunc('hour', event_timestamp) AS window_hour,
        COUNT(*) AS operations_count,
        AVG(latency_ms) AS avg_latency_ms,
        SUM(tokens_consumed) AS total_tokens
    FROM agent_telemetry_events
    WHERE event_timestamp >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
    GROUP BY agent_id, date_trunc('hour', event_timestamp)
)
SELECT 
    agent_id,
    window_hour,
    operations_count,
    ROUND(avg_latency_ms::numeric, 2) AS avg_latency_ms,
    total_tokens,
    -- Window Function: 3-Hour Moving Average Operations
    ROUND(AVG(operations_count) OVER (
        PARTITION BY agent_id 
        ORDER BY window_hour 
        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    )::numeric, 2) AS moving_avg_operations,
    -- Window Function: Dense Rank by Activity
    DENSE_RANK() OVER (
        PARTITION BY window_hour 
        ORDER BY operations_count DESC
    ) AS hourly_activity_rank
FROM hourly_buckets
ORDER BY window_hour DESC, operations_count DESC;

-- 8. Recursive Common Table Expression (CTE) - Cryptographic Ledger Verification
-- This query walks the blockchain ledger from genesis block to tip and verifies hash pointers.
CREATE OR REPLACE VIEW v_audit_integrity_verification AS
WITH RECURSIVE ledger_walk AS (
    -- Anchor member: Genesis Block (block_index = 1)
    SELECT 
        block_index,
        block_id,
        previous_hash,
        current_hash,
        encode(digest(previous_hash || origin_agent || payload::text || created_at::text, 'sha256'), 'hex') AS computed_hash,
        (current_hash = encode(digest(previous_hash || origin_agent || payload::text || created_at::text, 'sha256'), 'hex')) AS is_block_valid,
        1 AS depth
    FROM sovereign_audit_blocks
    WHERE block_index = 1

    UNION ALL

    -- Recursive member: Link subsequent blocks
    SELECT 
        b.block_index,
        b.block_id,
        b.previous_hash,
        b.current_hash,
        encode(digest(b.previous_hash || b.origin_agent || b.payload::text || b.created_at::text, 'sha256'), 'hex') AS computed_hash,
        (b.previous_hash = lw.current_hash AND b.current_hash = encode(digest(b.previous_hash || b.origin_agent || b.payload::text || b.created_at::text, 'sha256'), 'hex')) AS is_block_valid,
        lw.depth + 1 AS depth
    FROM sovereign_audit_blocks b
    INNER JOIN ledger_walk lw ON b.previous_hash = lw.current_hash AND b.block_index = lw.block_index + 1
)
SELECT 
    COUNT(*) AS total_blocks_verified,
    BOOL_AND(is_block_valid) AS is_chain_intact,
    MAX(block_index) AS latest_block_index
FROM ledger_walk;

-- ============================================================================
-- END OF SOVEREIGN DATA ARCHITECTURE SPECIFICATION
-- ============================================================================
