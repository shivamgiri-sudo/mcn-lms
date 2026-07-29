-- Phase 15: secure browser sessions, CSRF-bound cookies, replay-safe HRMS SSO and emergency elevation.
-- MySQL 8.x; forward-only. Existing hashed bearer sessions remain valid only during the controlled compatibility window.

-- The Prisma model and branch-scoped authorization have always expected this
-- column, but the original baseline migration omitted it. Repair the legacy
-- schema without failing an environment that previously added the column.
SET @admin_branch_exists = (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'admin_user_master'
     AND column_name = 'branch'
);
SET @admin_branch_sql = IF(
  @admin_branch_exists = 0,
  'ALTER TABLE admin_user_master ADD COLUMN branch VARCHAR(191) NULL AFTER role',
  'SELECT 1'
);
PREPARE admin_branch_statement FROM @admin_branch_sql;
EXECUTE admin_branch_statement;
DEALLOCATE PREPARE admin_branch_statement;

ALTER TABLE portal_sessions
  ADD COLUMN session_family_id CHAR(36) NULL AFTER id,
  ADD COLUMN auth_method VARCHAR(40) NOT NULL DEFAULT 'PASSWORD' AFTER user_type,
  ADD COLUMN device_label VARCHAR(160) NULL AFTER auth_method,
  ADD COLUMN user_agent_hash CHAR(64) NULL AFTER device_label,
  ADD COLUMN ip_hash CHAR(64) NULL AFTER user_agent_hash,
  ADD COLUMN last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER ip_hash,
  ADD COLUMN absolute_expires_at DATETIME(3) NULL AFTER expires_at,
  ADD COLUMN revoked_at DATETIME(3) NULL AFTER absolute_expires_at,
  ADD COLUMN revoked_reason VARCHAR(500) NULL AFTER revoked_at,
  ADD COLUMN rotated_from_id VARCHAR(191) NULL AFTER revoked_reason,
  ADD COLUMN csrf_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER rotated_from_id,
  ADD COLUMN elevation_authenticated_at DATETIME(3) NULL AFTER csrf_version,
  ADD COLUMN elevation_expires_at DATETIME(3) NULL AFTER elevation_authenticated_at,
  ADD COLUMN elevation_reason TEXT NULL AFTER elevation_expires_at,
  ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at;

UPDATE portal_sessions
   SET session_family_id = id,
       auth_method = 'LEGACY_BEARER',
       last_seen_at = created_at,
       absolute_expires_at = expires_at
 WHERE session_family_id IS NULL;

ALTER TABLE portal_sessions
  MODIFY COLUMN session_family_id CHAR(36) NOT NULL,
  MODIFY COLUMN absolute_expires_at DATETIME(3) NOT NULL,
  ADD INDEX idx_portal_session_user_state (user_id, user_type, revoked_at, expires_at),
  ADD INDEX idx_portal_session_family (session_family_id, created_at),
  ADD INDEX idx_portal_session_last_seen (last_seen_at),
  ADD CONSTRAINT chk_portal_session_user_type CHECK (user_type IN ('trainee','coordinator','admin')),
  ADD CONSTRAINT chk_portal_session_expiry CHECK (absolute_expires_at >= expires_at),
  ADD CONSTRAINT chk_portal_session_elevation CHECK (
    (elevation_expires_at IS NULL AND elevation_authenticated_at IS NULL AND elevation_reason IS NULL)
    OR
    (elevation_expires_at IS NOT NULL AND elevation_authenticated_at IS NOT NULL AND CHAR_LENGTH(elevation_reason) >= 20)
  );

CREATE TABLE sso_replay_nonce (
  nonce_id CHAR(36) NOT NULL,
  jti_hash CHAR(64) NOT NULL,
  issuer VARCHAR(160) NOT NULL,
  audience VARCHAR(160) NOT NULL,
  subject_id VARCHAR(191) NOT NULL,
  subject_type VARCHAR(30) NOT NULL,
  issued_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  consumed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  request_ip_hash CHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (nonce_id),
  UNIQUE KEY uq_sso_replay_jti (jti_hash),
  KEY idx_sso_replay_expiry (expires_at),
  CONSTRAINT chk_sso_replay_subject_type CHECK (subject_type IN ('trainee','coordinator','admin')),
  CONSTRAINT chk_sso_replay_expiry CHECK (expires_at > issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE sso_handoff_code (
  handoff_id CHAR(36) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  user_type VARCHAR(30) NOT NULL,
  auth_method VARCHAR(40) NOT NULL DEFAULT 'HRMS_ASSERTION',
  assertion_jti_hash CHAR(64) NULL,
  redirect_path VARCHAR(500) NOT NULL DEFAULT '/',
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  request_ip_hash CHAR(64) NULL,
  user_agent_hash CHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (handoff_id),
  UNIQUE KEY uq_sso_handoff_code_hash (code_hash),
  KEY idx_sso_handoff_user (user_id, user_type, created_at),
  KEY idx_sso_handoff_expiry (expires_at, used_at),
  CONSTRAINT chk_sso_handoff_user_type CHECK (user_type IN ('trainee','coordinator','admin')),
  CONSTRAINT chk_sso_handoff_redirect CHECK (redirect_path LIKE '/%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE security_event (
  event_id CHAR(36) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'INFO',
  actor_user_id VARCHAR(191) NULL,
  actor_user_type VARCHAR(30) NULL,
  subject_user_id VARCHAR(191) NULL,
  subject_user_type VARCHAR(30) NULL,
  session_id VARCHAR(191) NULL,
  request_id VARCHAR(120) NULL,
  ip_hash CHAR(64) NULL,
  user_agent_hash CHAR(64) NULL,
  details_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id),
  KEY idx_security_event_actor (actor_user_id, actor_user_type, created_at),
  KEY idx_security_event_subject (subject_user_id, subject_user_type, created_at),
  KEY idx_security_event_type (event_type, severity, created_at),
  CONSTRAINT chk_security_event_severity CHECK (severity IN ('INFO','WATCH','HIGH','CRITICAL')),
  CONSTRAINT chk_security_event_actor_type CHECK (actor_user_type IS NULL OR actor_user_type IN ('trainee','coordinator','admin','system','hrms')),
  CONSTRAINT chk_security_event_subject_type CHECK (subject_user_type IS NULL OR subject_user_type IN ('trainee','coordinator','admin'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permission_master
  (permission_key, module_name, action_name, description, risk_level, active)
VALUES
  ('security.sessions.audit', 'Security', 'Audit Sessions', 'View scoped browser-session and authentication security evidence.', 'HIGH', 1),
  ('security.elevation.use', 'Security', 'Use Emergency Elevation', 'Re-authenticate with a mandatory reason for short-lived sensitive administration.', 'CRITICAL', 1);

INSERT IGNORE INTO role_permission
  (id, user_type, role_key, permission_key, allowed, data_scope, conditions_json, created_by)
VALUES
  (UUID(), 'admin', '*', 'security.sessions.audit', 1, 'branch', NULL, 'phase15-migration'),
  (UUID(), 'admin', 'Super Admin', 'security.sessions.audit', 1, 'company', NULL, 'phase15-migration'),
  (UUID(), 'admin', 'SuperAdmin', 'security.sessions.audit', 1, 'company', NULL, 'phase15-migration'),
  (UUID(), 'admin', 'Super Admin', 'security.elevation.use', 1, 'company', NULL, 'phase15-migration'),
  (UUID(), 'admin', 'SuperAdmin', 'security.elevation.use', 1, 'company', NULL, 'phase15-migration');
