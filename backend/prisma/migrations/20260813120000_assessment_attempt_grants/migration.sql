-- CreateTable
CREATE TABLE `assessment_attempt_grants` (
    `id` VARCHAR(191) NOT NULL,
    `grant_id` VARCHAR(191) NOT NULL,
    `assessment_id` VARCHAR(191) NOT NULL,
    `employee_id` VARCHAR(191) NOT NULL,
    `extra_attempts` INTEGER NOT NULL,
    `reason` TEXT NULL,
    `granted_by` VARCHAR(191) NOT NULL,
    `granted_by_name` VARCHAR(191) NOT NULL DEFAULT '',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `revoked_by` VARCHAR(191) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoke_reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `assessment_attempt_grants_grant_id_key`(`grant_id`),
    INDEX `assessment_attempt_grants_employee_id_assessment_id_idx`(`employee_id`, `assessment_id`),
    INDEX `assessment_attempt_grants_assessment_id_idx`(`assessment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `assessment_attempt_grants` ADD CONSTRAINT `assessment_attempt_grants_assessment_id_fkey`
    FOREIGN KEY (`assessment_id`) REFERENCES `assessment_master`(`assessment_id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
