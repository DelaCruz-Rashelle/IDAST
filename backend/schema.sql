-- MySQL schema for ESP32 telemetry snapshots (Railway MySQL)
-- 
-- NOTE: This schema is now automatically applied when the backend starts.
-- The initSchema() function in backend/src/db.js creates these tables on startup.
-- 
-- This file is kept for reference/documentation purposes.
-- You can still use it manually if needed, but it's not required.

CREATE TABLE IF NOT EXISTS telemetry (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ts TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  device_name VARCHAR(64) NULL,

  top INT NULL,
  `left` INT NULL,
  `right` INT NULL,
  `avg` INT NULL,
  horizontal_error INT NULL,
  vertical_error INT NULL,

  tilt_angle INT NULL,
  pan_angle INT NULL,
  pan_target INT NULL,
  `manual` TINYINT(1) NULL,
  steady TINYINT(1) NULL,

  power_w DECIMAL(10,2) NULL,
  power_actual_w DECIMAL(10,2) NULL,
  temp_c DECIMAL(10,1) NULL,

  battery_pct DECIMAL(5,1) NULL,
  battery_v DECIMAL(6,2) NULL,
  efficiency DECIMAL(6,1) NULL,

  energy_wh DECIMAL(12,3) NULL,
  energy_kwh DECIMAL(12,6) NULL,

  co2_kg DECIMAL(12,4) NULL,
  trees DECIMAL(12,4) NULL,
  phones DECIMAL(12,3) NULL,
  phone_minutes DECIMAL(12,0) NULL,
  pesos DECIMAL(12,2) NULL,
  grid_price DECIMAL(12,2) NULL,

  raw_json JSON NULL,

  INDEX idx_ts (ts)
);

-- Device table: stores device names from user input
CREATE TABLE IF NOT EXISTS device (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  device_name VARCHAR(24) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_updated_at (updated_at)
);

-- Grid price table: stores Batelec grid price from user input
CREATE TABLE IF NOT EXISTS grid_price (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_updated_at (updated_at)
);