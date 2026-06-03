-- CreateTable: assigned_modules (broadcast assignments for learners)
CREATE TABLE IF NOT EXISTS `assigned_modules` (
    `id`               VARCHAR(36)   NOT NULL,
    `module_id`        VARCHAR(191)  NOT NULL,
    `module_name`      VARCHAR(191)  NOT NULL,
    `broadcast_title`  VARCHAR(191)  NULL,
    `assigned_to`      VARCHAR(191)  NOT NULL,
    `assigned_to_type` VARCHAR(191)  NOT NULL,
    `assignment_type`  VARCHAR(191)  NOT NULL DEFAULT 'Optional',
    `message`          TEXT          NULL,
    `assigned_by`      VARCHAR(191)  NULL,
    `due_date`         DATETIME(3)   NULL,
    `active`           TINYINT(1)    NOT NULL DEFAULT 1,
    `created_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`),
    INDEX `assigned_modules_assigned_to_type_idx` (`assigned_to_type`),
    INDEX `assigned_modules_assigned_to_idx` (`assigned_to`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

-- CreateTable: communication_config (admin-managed provider settings)
CREATE TABLE IF NOT EXISTS `communication_config` (
    `id`                                  VARCHAR(36)  NOT NULL DEFAULT 'default',
    `smtp_host`                           VARCHAR(191) NOT NULL DEFAULT 'smtp.gmail.com',
    `smtp_port`                           INT          NOT NULL DEFAULT 587,
    `smtp_user`                           VARCHAR(191) NOT NULL DEFAULT '',
    `smtp_pass`                           VARCHAR(500) NOT NULL DEFAULT '',
    `email_from`                          VARCHAR(191) NOT NULL DEFAULT '',
    `smtp_enabled`                        TINYINT(1)   NOT NULL DEFAULT 0,
    `msg91_auth_key`                      VARCHAR(500) NOT NULL DEFAULT '',
    `msg91_sender_id`                     VARCHAR(191) NOT NULL DEFAULT 'MCNLMS',
    `msg91_template_id`                   VARCHAR(191) NOT NULL DEFAULT '',
    `sms_enabled`                         TINYINT(1)   NOT NULL DEFAULT 0,
    `msg91_whatsapp_token`                VARCHAR(500) NOT NULL DEFAULT '',
    `msg91_whatsapp_integrated_number`    VARCHAR(191) NOT NULL DEFAULT '',
    `whatsapp_enabled`                    TINYINT(1)   NOT NULL DEFAULT 0,
    `updated_at`                          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    `updated_by`                          VARCHAR(191) NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

-- Seed default row so the config page always has data
INSERT IGNORE INTO `communication_config` (`id`) VALUES ('default');
