-- World-class LMS Phase 10: production runtime leases, instance telemetry and scoped rollout controls.
-- MySQL 8.x; forward-only and trigger-free.

CREATE TABLE IF NOT EXISTS platform_runtime_lease (
  lease_key VARCHAR(120) NOT NULL,
  owner_id VARCHAR(240) NOT NULL,
  lease_until DATETIME(3) NOT NULL,
  acquired_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  heartbeat_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  generation BIGINT UNSIGNED NOT NULL DEFAULT 1,
  metadata_json JSON NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (lease_key),
  KEY idx_platform_runtime_lease_expiry (lease_until),
  KEY idx_platform_runtime_lease_owner (owner_id, lease_until),
  CONSTRAINT chk_platform_runtime_lease_key CHECK (CHAR_LENGTH(TRIM(lease_key)) >= 3),
  CONSTRAINT chk_platform_runtime_lease_owner CHECK (CHAR_LENGTH(TRIM(owner_id)) >= 3),
  CONSTRAINT chk_platform_runtime_lease_generation CHECK (generation >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_runtime_instance (
  instance_id VARCHAR(240) NOT NULL,
  instance_role VARCHAR(30) NOT NULL DEFAULT 'WEB',
  hostname VARCHAR(240) NOT NULL,
  process_id INT UNSIGNED NOT NULL,
  app_version VARCHAR(120) NOT NULL DEFAULT '',
  deployment_id VARCHAR(160) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'HEALTHY',
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_ready_at DATETIME(3) NULL,
  last_error_at DATETIME(3) NULL,
  last_error VARCHAR(2000) NULL,
  metadata_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (instance_id),
  KEY idx_platform_runtime_instance_status (status, last_seen_at),
  KEY idx_platform_runtime_instance_role (instance_role, last_seen_at),
  CONSTRAINT chk_platform_runtime_instance_role CHECK (instance_role IN ('WEB','WORKER','HYBRID','CI')),
  CONSTRAINT chk_platform_runtime_instance_status CHECK (status IN ('STARTING','HEALTHY','DEGRADED','DRAINING','STOPPED')),
  CONSTRAINT chk_platform_runtime_instance_process CHECK (process_id >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_feature_flag (
  flag_id CHAR(36) NOT NULL,
  feature_key VARCHAR(160) NOT NULL,
  display_name VARCHAR(240) NOT NULL,
  description TEXT NULL,
  scope_type VARCHAR(20) NOT NULL DEFAULT 'GLOBAL',
  scope_value VARCHAR(240) NOT NULL DEFAULT '',
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  kill_switch TINYINT(1) NOT NULL DEFAULT 0,
  rollout_percentage DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  starts_at DATETIME(3) NULL,
  ends_at DATETIME(3) NULL,
  config_json JSON NULL,
  version_no INT UNSIGNED NOT NULL DEFAULT 1,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NOT NULL,
  updated_by VARCHAR(120) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (flag_id),
  UNIQUE KEY uq_platform_feature_scope (feature_key, scope_type, scope_value),
  KEY idx_platform_feature_active (feature_key, active, starts_at, ends_at),
  KEY idx_platform_feature_scope (scope_type, scope_value, active),
  CONSTRAINT chk_platform_feature_key CHECK (CHAR_LENGTH(TRIM(feature_key)) >= 3),
  CONSTRAINT chk_platform_feature_scope CHECK (scope_type IN ('GLOBAL','BRANCH','PROCESS','LOB','USER')),
  CONSTRAINT chk_platform_feature_scope_value CHECK ((scope_type = 'GLOBAL' AND scope_value = '') OR (scope_type <> 'GLOBAL' AND CHAR_LENGTH(TRIM(scope_value)) >= 1)),
  CONSTRAINT chk_platform_feature_enabled CHECK (enabled IN (0,1)),
  CONSTRAINT chk_platform_feature_kill CHECK (kill_switch IN (0,1)),
  CONSTRAINT chk_platform_feature_rollout CHECK (rollout_percentage BETWEEN 0 AND 100),
  CONSTRAINT chk_platform_feature_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CONSTRAINT chk_platform_feature_version CHECK (version_no >= 1),
  CONSTRAINT chk_platform_feature_active CHECK (active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permission_master
  (permission_key, module_name, action_name, description, risk_level)
VALUES
  ('runtime.view', 'Platform Runtime', 'View production runtime', 'View readiness, worker leases, instance heartbeats, backlog and rollout decisions.', 'SENSITIVE'),
  ('runtime.manage', 'Platform Runtime', 'Manage production rollout', 'Create and update scoped feature rollouts and production kill switches.', 'CRITICAL');

INSERT IGNORE INTO role_permission
  (id, user_type, role_key, permission_key, allowed, data_scope, created_by)
VALUES
  (UUID(), 'admin', '*', 'runtime.view', 1, 'branch', 'migration'),
  (UUID(), 'admin', '*', 'runtime.manage', 1, 'branch', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'runtime.view', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'runtime.view', 1, 'company', 'migration'),
  (UUID(), 'admin', 'Super Admin', 'runtime.manage', 1, 'company', 'migration'),
  (UUID(), 'admin', 'SuperAdmin', 'runtime.manage', 1, 'company', 'migration');

INSERT IGNORE INTO platform_feature_flag
  (flag_id, feature_key, display_name, description, scope_type, scope_value,
   enabled, kill_switch, rollout_percentage, version_no, active, created_by)
VALUES
  (UUID(), 'evaluator_quality', 'Evaluator Quality Workspace', 'Calibration, authorization, reliability, certificates and evaluator-quality operations.', 'GLOBAL', '', 1, 0, 100.00, 1, 1, 'migration'),
  (UUID(), 'calibration_appeals', 'Calibration Appeals', 'Evaluator appeal, reviewer SLA and governance evidence-pack workflows.', 'GLOBAL', '', 1, 0, 100.00, 1, 1, 'migration');
