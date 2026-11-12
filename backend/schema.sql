-- ============================================================================
-- GIULIA BEAUTY STUDIO — DATABASE SCHEMA (MySQL 5.7+ / 8.0+ / MariaDB)
-- Proprietary Booking Calendar, Client CRM & GDPR Consent Audit Log
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+01:00';

CREATE TABLE IF NOT EXISTS `admin_users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(100) NOT NULL,
  `display_name` VARCHAR(120) NOT NULL DEFAULT 'Giulia',
  `password_hash` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_admin_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `clients` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `full_name` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(40) NOT NULL,
  `phone_normalized` VARCHAR(30) NOT NULL,
  `email` VARCHAR(150) NULL DEFAULT NULL,
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
  `privacy_accepted` TINYINT(1) NOT NULL DEFAULT 1,
  `privacy_accepted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_booking_code` (`booking_code`),
  KEY `idx_appt_date_status` (`appointment_date`, `status`),
  KEY `idx_appt_client` (`client_id`),
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
