-- Phase 16: mobile/PWA preferences, accessibility assets, governed offline grants and validated sync evidence.
-- MySQL 8.x; forward-only and additive.

CREATE TABLE IF NOT EXISTS user_accessibility_preference (
  preference_id CHAR(36) NOT NULL,
  user_id VARCHAR(191) NOT NULL,
  user_type VARCHAR(30) NOT NULL,
  language_code VARCHAR(20) NOT NULL DEFAULT 'en-IN',
  text_scale DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  high_contrast TINYINT(1) NOT NULL DEFAULT 0,
  reduce_motion TINYINT(1) NOT NULL DEFAULT 0,
  captions_enabled TINYINT(1) NOT NULL DEFAULT 1,
  transcript_preferred TINYINT(1) NOT NULL DEFAULT 0,
  low_data_mode TINYINT(1) NOT NULL DEFAULT 0,
  focus_highlight TINYINT(1) NOT NULL DEFAULT 1,
  updated_by VARCHAR(191) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (preference_id),
  UNIQUE KEY uq_user_accessibility_preference (user_id, user_type),
  KEY idx_accessibility_language (language_code, user_type),
  CONSTRAINT chk_accessibility_user_type CHECK (user_type IN ('trainee','coordinator','admin')),
  CONSTRAINT chk_accessibility_text_scale CHECK (text_scale BETWEEN 0.85 AND 1.50),
  CONSTRAINT chk_accessibility_language CHECK (CHAR_LENGTH(language_code) BETWEEN 2 AND 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_accessibility_asset (
  asset_id CHAR(36) NOT NULL,
  content_id VARCHAR(191) NOT NULL,
  language_code VARCHAR(20) NOT NULL DEFAULT 'en-IN',
  asset_type VARCHAR(40) NOT NULL,
  asset_format VARCHAR(30) NOT NULL DEFAULT 'TEXT',
  storage_reference TEXT NULL,
  content_text LONGTEXT NULL,
  source_hash CHAR(64) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  version_no INT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(191) NOT NULL,
  reviewed_by VARCHAR(191) NULL,
  reviewed_at DATETIME(3) NULL,
  retired_by VARCHAR(191) NULL,
  retired_at DATETIME(3) NULL,
  retirement_reason TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  active_asset_key VARCHAR(500) GENERATED ALWAYS AS (
    CASE WHEN status IN ('DRAFT','IN_REVIEW','APPROVED')
      THEN CONCAT(content_id, ':', language_code, ':', asset_type)
      ELSE NULL END
  ) STORED,
  PRIMARY KEY (asset_id),
  UNIQUE KEY uq_content_accessibility_version (content_id, language_code, asset_type, version_no),
  UNIQUE KEY uq_content_accessibility_active (active_asset_key),
  KEY idx_content_accessibility_lookup (content_id, status, language_code),
  CONSTRAINT fk_content_accessibility_content FOREIGN KEY (content_id)
    REFERENCES content_master(content_id) ON DELETE CASCADE,
  CONSTRAINT chk_content_accessibility_type CHECK (asset_type IN ('CAPTION','TRANSCRIPT','AUDIO_DESCRIPTION','EASY_READ','ALT_TEXT')),
  CONSTRAINT chk_content_accessibility_format CHECK (asset_format IN ('TEXT','VTT','SRT','URL','FILE_REFERENCE')),
  CONSTRAINT chk_content_accessibility_status CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','RETIRED','REJECTED')),
  CONSTRAINT chk_content_accessibility_source CHECK (
    (content_text IS NOT NULL AND CHAR_LENGTH(TRIM(content_text)) > 0)
    OR (storage_reference IS NOT NULL AND CHAR_LENGTH(TRIM(storage_reference)) > 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS offline_content_grant (
  grant_id CHAR(36) NOT NULL,
  employee_id VARCHAR(191) NOT NULL,
  content_id VARCHAR(191) NOT NULL,
  device_id_hash CHAR(64) NOT NULL,
  permit_hash CHAR(64) NOT NULL,
  issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  max_offline_seconds INT UNSIGNED NOT NULL DEFAULT 21600,
  accepted_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  revoked_at DATETIME(3) NULL,
  revoked_by VARCHAR(191) NULL,
  revocation_reason TEXT NULL,
  last_synced_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  active_grant_key VARCHAR(500) GENERATED ALWAYS AS (
    CASE WHEN status = 'ACTIVE'
      THEN CONCAT(employee_id, ':', content_id, ':', device_id_hash)
      ELSE NULL END
  ) STORED,
  PRIMARY KEY (grant_id),
  UNIQUE KEY uq_offline_permit_hash (permit_hash),
  UNIQUE KEY uq_offline_active_device_content (active_grant_key),
  KEY idx_offline_grant_employee (employee_id, status, expires_at),
  KEY idx_offline_grant_content (content_id, status),
  CONSTRAINT fk_offline_grant_content FOREIGN KEY (content_id)
    REFERENCES content_master(content_id) ON DELETE CASCADE,
  CONSTRAINT chk_offline_grant_status CHECK (status IN ('ACTIVE','EXPIRED','REVOKED','CONSUMED')),
  CONSTRAINT chk_offline_grant_expiry CHECK (expires_at > issued_at),
  CONSTRAINT chk_offline_grant_seconds CHECK (max_offline_seconds BETWEEN 60 AND 259200 AND accepted_seconds <= max_offline_seconds)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS offline_learning_event (
  event_id CHAR(36) NOT NULL,
  event_hash CHAR(64) NOT NULL,
  grant_id CHAR(36) NOT NULL,
  employee_id VARCHAR(191) NOT NULL,
  content_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(30) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  seconds_delta INT UNSIGNED NOT NULL DEFAULT 0,
  position_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  duration_seconds INT UNSIGNED NOT NULL DEFAULT 0,
  client_sequence INT UNSIGNED NOT NULL,
  accepted TINYINT(1) NOT NULL DEFAULT 0,
  rejection_reason VARCHAR(500) NULL,
  synced_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id),
  UNIQUE KEY uq_offline_event_hash (event_hash),
  UNIQUE KEY uq_offline_event_sequence (grant_id, client_sequence),
  KEY idx_offline_event_employee (employee_id, synced_at),
  KEY idx_offline_event_content (content_id, event_type, synced_at),
  CONSTRAINT fk_offline_event_grant FOREIGN KEY (grant_id)
    REFERENCES offline_content_grant(grant_id) ON DELETE CASCADE,
  CONSTRAINT fk_offline_event_content FOREIGN KEY (content_id)
    REFERENCES content_master(content_id) ON DELETE CASCADE,
  CONSTRAINT chk_offline_event_type CHECK (event_type IN ('OPEN','HEARTBEAT','PAUSE','CLOSE')),
  CONSTRAINT chk_offline_event_seconds CHECK (seconds_delta <= 120),
  CONSTRAINT chk_offline_event_position CHECK (duration_seconds = 0 OR position_seconds <= duration_seconds)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permission_master
  (permission_key, module_name, action_name, description, risk_level, active)
VALUES
  ('accessibility.assets.manage', 'Accessibility', 'Manage Assets', 'Create, review, publish and retire captions, transcripts and accessible alternatives in scope.', 'HIGH', 1),
  ('accessibility.analytics.view', 'Accessibility', 'View Analytics', 'View scoped accessibility preference, asset coverage and offline-learning evidence.', 'STANDARD', 1);

INSERT IGNORE INTO role_permission
  (id, user_type, role_key, permission_key, allowed, data_scope, conditions_json, created_by)
VALUES
  (UUID(), 'admin', '*', 'accessibility.assets.manage', 1, 'branch', NULL, 'phase16-migration'),
  (UUID(), 'admin', 'Super Admin', 'accessibility.assets.manage', 1, 'company', NULL, 'phase16-migration'),
  (UUID(), 'admin', 'SuperAdmin', 'accessibility.assets.manage', 1, 'company', NULL, 'phase16-migration'),
  (UUID(), 'admin', '*', 'accessibility.analytics.view', 1, 'branch', NULL, 'phase16-migration'),
  (UUID(), 'admin', 'Super Admin', 'accessibility.analytics.view', 1, 'company', NULL, 'phase16-migration'),
  (UUID(), 'admin', 'SuperAdmin', 'accessibility.analytics.view', 1, 'company', NULL, 'phase16-migration'),
  (UUID(), 'coordinator', '*', 'accessibility.analytics.view', 1, 'own_batch', NULL, 'phase16-migration');
