CREATE TABLE `password_reset_tokens` (
  `id` VARCHAR(191) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `user_type` VARCHAR(32) NOT NULL,
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `request_ip_hash` CHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `password_reset_tokens_token_hash_key`(`token_hash`),
  INDEX `password_reset_tokens_user_lookup_idx`(`user_type`, `user_id`, `created_at`),
  INDEX `password_reset_tokens_expiry_idx`(`expires_at`, `used_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
