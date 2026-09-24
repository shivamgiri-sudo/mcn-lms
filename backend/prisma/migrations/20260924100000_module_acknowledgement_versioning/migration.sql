-- AlterTable: content_master
-- Bumped only by the explicit "Publish New Version" admin action (never by a
-- plain content edit), so an already-acknowledged trainee's acknowledgement
-- can be recognised as stale against newer content without forcing
-- re-acknowledgement on every minor text/title fix.
ALTER TABLE `content_master` ADD COLUMN `content_version` INTEGER NOT NULL DEFAULT 1;

-- CreateTable: module_acknowledgements
-- Append-only audit trail of every acknowledgement event, including
-- re-acknowledgements after a content version bump and admin resets.
-- content_progress keeps the "current state" (acknowledgedAt/acknowledgedVersion)
-- for fast gating checks; this table is the immutable history behind it, so a
-- module version change or a reset never destroys prior acknowledgement
-- records. content_id may reference either content_master.content_id or a
-- content_repository_master.repository_content_id (independent/"nugget"
-- modules are a raw-SQL table, not Prisma-modeled) -- no FK, same
-- loosely-coupled convention as assigned_modules.
CREATE TABLE `module_acknowledgements` (
    `id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `content_id` VARCHAR(191) NOT NULL,
    `module_id` VARCHAR(191) NULL,
    `classroom_id` VARCHAR(191) NULL,
    `day_no` INTEGER NULL,
    `batch_no` VARCHAR(191) NULL,
    `process` VARCHAR(191) NULL,
    `branch` VARCHAR(191) NULL,
    `content_title` VARCHAR(500) NULL,
    `content_version` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(30) NOT NULL DEFAULT 'Acknowledged',
    `acknowledged_at` DATETIME(3) NULL,
    `acknowledged_ip` VARCHAR(64) NULL,
    `acknowledged_user_agent` TEXT NULL,
    `acknowledgement_text` TEXT NULL,
    `reset_reason` TEXT NULL,
    `reset_by` VARCHAR(191) NULL,
    `reset_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `module_acknowledgements_employee_id_content_id_idx`(`employee_id`, `content_id`),
    INDEX `module_acknowledgements_content_id_content_version_idx`(`content_id`, `content_version`),
    INDEX `module_acknowledgements_batch_no_idx`(`batch_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
