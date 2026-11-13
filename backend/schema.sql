-- ============================================================================
-- GIULIA BEAUTY STUDIO — DATABASE SCHEMA (MySQL 5.7+ / 8.0+ / MariaDB)
-- Full Studio Platform: Agenda, Multi-Operatore, CRM, Carte, Morfologia,
-- Privacy OTP Mobile, Magazzino, Centro Messaggi & AI Analytics
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+01:00';

CREATE TABLE IF NOT EXISTS `admin_users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(100) NOT NULL,
  `display_name` VARCHAR(120) NOT NULL DEFAULT 'Giulia',
  `role` VARCHAR(40) NOT NULL DEFAULT 'owner',
  `password_hash` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_admin_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `admin_sessions` (
  `token_hash` VARCHAR(64) NOT NULL,
  `admin_id` INT UNSIGNED NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token_hash`),
  KEY `idx_session_expires` (`expires_at`),
  CONSTRAINT `fk_session_admin` FOREIGN KEY (`admin_id`) REFERENCES `admin_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `operators` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `role` VARCHAR(120) NOT NULL DEFAULT 'Beauty Specialist',
  `color` VARCHAR(20) NOT NULL DEFAULT '#d47491',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `weekly_schedule_json` LONGTEXT NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `operator_absences` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `operator_id` INT UNSIGNED NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `start_time` TIME NULL DEFAULT NULL,
  `end_time` TIME NULL DEFAULT NULL,
  `type` VARCHAR(40) NOT NULL DEFAULT 'ferie',
  `notes` VARCHAR(300) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_abs_operator_dates` (`operator_id`, `start_date`, `end_date`),
  CONSTRAINT `fk_abs_operator` FOREIGN KEY (`operator_id`) REFERENCES `operators` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `clients` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `full_name` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(40) NOT NULL,
  `phone_normalized` VARCHAR(30) NOT NULL,
  `email` VARCHAR(150) NULL DEFAULT NULL,
  `birth_date` DATE NULL DEFAULT NULL,
  `allergies_notes` TEXT NULL,
  `preferences_notes` TEXT NULL,
  `privacy_accepted` TINYINT(1) NOT NULL DEFAULT 0,
  `privacy_accepted_at` DATETIME NULL DEFAULT NULL,
  `privacy_version` VARCHAR(40) NOT NULL DEFAULT 'v2.0-2026-11',
  `marketing_consent` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_client_phone_norm` (`phone_normalized`),
  KEY `idx_client_name` (`full_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `appointments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `booking_code` VARCHAR(24) NOT NULL,
  `client_id` INT UNSIGNED NOT NULL,
  `operator_id` INT UNSIGNED NULL DEFAULT NULL,
  `appointment_date` DATE NOT NULL,
  `start_time` TIME NOT NULL,
  `duration_minutes` INT UNSIGNED NOT NULL DEFAULT 60,
  `services_json` LONGTEXT NOT NULL,
  `services_summary` VARCHAR(500) NOT NULL,
  `total_price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `mode` ENUM('booking', 'voucher') NOT NULL DEFAULT 'booking',
  `payment_method` VARCHAR(40) NOT NULL DEFAULT 'studio',
  `status` ENUM('pending', 'confirmed', 'completed', 'cancelled') NOT NULL DEFAULT 'confirmed',
  `notes` TEXT NULL,
  `reminder_sent_at` DATETIME NULL DEFAULT NULL,
  `privacy_accepted` TINYINT(1) NOT NULL DEFAULT 1,
  `privacy_accepted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_booking_code` (`booking_code`),
  KEY `idx_appt_date_status` (`appointment_date`, `status`),
  KEY `idx_appt_client` (`client_id`),
  KEY `idx_appt_operator` (`operator_id`),
  CONSTRAINT `fk_appt_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `privacy_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `appointment_id` INT UNSIGNED NULL DEFAULT NULL,
  `consent_type` VARCHAR(40) NOT NULL DEFAULT 'privacy_terms',
  `consent_version` VARCHAR(40) NOT NULL DEFAULT 'v2.0-2026-11',
  `accepted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ip_hash` VARCHAR(64) NULL DEFAULT NULL,
  `user_agent` VARCHAR(255) NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_privacy_client` (`client_id`),
  CONSTRAINT `fk_privacy_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `privacy_signature_requests` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `token` VARCHAR(64) NOT NULL,
  `otp_code` VARCHAR(12) NOT NULL,
  `otp_attempts` INT UNSIGNED NOT NULL DEFAULT 0,
  `otp_expires_at` DATETIME NOT NULL,
  `privacy_version` VARCHAR(40) NOT NULL DEFAULT 'v2.0-2026-11',
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `signature_name` VARCHAR(150) NULL DEFAULT NULL,
  `signature_data` LONGTEXT NULL,
  `signed_at` DATETIME NULL DEFAULT NULL,
  `ip_hash` VARCHAR(64) NULL DEFAULT NULL,
  `user_agent` VARCHAR(255) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_priv_sign_token` (`token`),
  KEY `idx_priv_sign_client` (`client_id`),
  CONSTRAINT `fk_priv_sign_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_cards` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `title` VARCHAR(150) NOT NULL,
  `card_type` VARCHAR(40) NOT NULL DEFAULT 'package',
  `total_sessions` INT UNSIGNED NOT NULL DEFAULT 0,
  `used_sessions` INT UNSIGNED NOT NULL DEFAULT 0,
  `remaining_credit` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `expires_at` DATE NULL DEFAULT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'active',
  `notes` VARCHAR(300) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_card_client` (`client_id`),
  CONSTRAINT `fk_card_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `client_morpho_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NOT NULL,
  `recorded_at` DATE NOT NULL,
  `gender` VARCHAR(20) NOT NULL DEFAULT 'female',
  `weight_kg` DECIMAL(5,2) NULL DEFAULT NULL,
  `height_cm` DECIMAL(5,1) NULL DEFAULT NULL,
  `bmi` DECIMAL(4,1) NULL DEFAULT NULL,
  `measurements_json` LONGTEXT NOT NULL,
  `annotations_json` LONGTEXT NOT NULL,
  `photos_json` LONGTEXT NOT NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_morpho_client_date` (`client_id`, `recorded_at`),
  CONSTRAINT `fk_morpho_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `suppliers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `contact_name` VARCHAR(120) NULL DEFAULT NULL,
  `phone` VARCHAR(40) NULL DEFAULT NULL,
  `email` VARCHAR(150) NULL DEFAULT NULL,
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sku` VARCHAR(60) NULL DEFAULT NULL,
  `name` VARCHAR(150) NOT NULL,
  `category` VARCHAR(80) NOT NULL DEFAULT 'Rivendita',
  `supplier_id` INT UNSIGNED NULL DEFAULT NULL,
  `cost_price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `sell_price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `stock_qty` INT NOT NULL DEFAULT 0,
  `min_stock_qty` INT NOT NULL DEFAULT 2,
  `unit` VARCHAR(20) NOT NULL DEFAULT 'pz',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_prod_supplier` (`supplier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `product_movements` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NOT NULL,
  `movement_type` VARCHAR(30) NOT NULL DEFAULT 'sale',
  `quantity` INT NOT NULL,
  `unit_price` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `total_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `client_id` INT UNSIGNED NULL DEFAULT NULL,
  `operator_id` INT UNSIGNED NULL DEFAULT NULL,
  `notes` VARCHAR(300) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mov_product_date` (`product_id`, `created_at`),
  KEY `idx_mov_client` (`client_id`),
  CONSTRAINT `fk_mov_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `message_templates` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(60) NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `body_template` TEXT NOT NULL,
  `meta_template_name` VARCHAR(120) NULL DEFAULT NULL,
  `meta_template_lang` VARCHAR(20) NOT NULL DEFAULT 'it',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_msg_tpl_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `message_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `client_id` INT UNSIGNED NULL DEFAULT NULL,
  `appointment_id` INT UNSIGNED NULL DEFAULT NULL,
  `recipient_phone` VARCHAR(40) NULL DEFAULT NULL,
  `recipient_name` VARCHAR(150) NULL DEFAULT NULL,
  `channel` VARCHAR(30) NOT NULL DEFAULT 'whatsapp',
  `template_code` VARCHAR(60) NULL DEFAULT NULL,
  `message_text` TEXT NOT NULL,
  `status` VARCHAR(30) NOT NULL DEFAULT 'sent',
  `external_message_id` VARCHAR(120) NULL DEFAULT NULL,
  `error_message` VARCHAR(400) NULL DEFAULT NULL,
  `trigger_source` VARCHAR(40) NOT NULL DEFAULT 'manual',
  `meta_payload_type` VARCHAR(20) NOT NULL DEFAULT 'text',
  `sent_by_admin_id` INT UNSIGNED NULL DEFAULT NULL,
  `sent_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_msglog_sent_at` (`sent_at`),
  KEY `idx_msglog_client` (`client_id`),
  KEY `idx_msglog_tpl_status` (`template_code`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `studio_settings` (
  `setting_key` VARCHAR(80) NOT NULL,
  `setting_value` LONGTEXT NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `automation_runs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `job_name` VARCHAR(60) NOT NULL,
  `run_date` DATE NOT NULL,
  `trigger_mode` VARCHAR(30) NOT NULL DEFAULT 'scheduler',
  `status` VARCHAR(30) NOT NULL DEFAULT 'completed',
  `processed_count` INT NOT NULL DEFAULT 0,
  `sent_count` INT NOT NULL DEFAULT 0,
  `failed_count` INT NOT NULL DEFAULT 0,
  `skipped_count` INT NOT NULL DEFAULT 0,
  `summary_text` VARCHAR(500) NULL DEFAULT NULL,
  `started_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_auto_run_job_date` (`job_name`, `run_date`),
  KEY `idx_auto_run_started` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gift_cards` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(40) NOT NULL,
  `theme` VARCHAR(30) NOT NULL DEFAULT 'rose',
  `gift_mode` VARCHAR(20) NOT NULL DEFAULT 'amount',
  `amount` DECIMAL(10,2) NOT NULL DEFAULT 50.00,
  `remaining_amount` DECIMAL(10,2) NOT NULL DEFAULT 50.00,
  `hide_price` TINYINT(1) NOT NULL DEFAULT 0,
  `service_title` VARCHAR(180) NULL DEFAULT NULL,
  `recipient_name` VARCHAR(120) NOT NULL,
  `sender_name` VARCHAR(120) NULL DEFAULT NULL,
  `recipient_phone` VARCHAR(40) NULL DEFAULT NULL,
  `client_id` INT UNSIGNED NULL DEFAULT NULL,
  `message` VARCHAR(320) NULL DEFAULT NULL,
  `expires_at` DATE NULL DEFAULT NULL,
  `status` VARCHAR(25) NOT NULL DEFAULT 'active',
  `redeemed_at` DATETIME NULL DEFAULT NULL,
  `notes` VARCHAR(300) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_gift_card_code` (`code`),
  KEY `idx_gc_status` (`status`),
  KEY `idx_gc_client` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
