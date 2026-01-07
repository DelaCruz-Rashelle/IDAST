-- MySQL schema for IDAST device data (Railway MySQL)
-- 
-- NOTE: This schema is now automatically applied when the backend starts.
-- The initSchema() function in backend/src/db.js creates these tables on startup.
-- 
-- This file is kept for reference/documentation purposes.
-- You can still use it manually if needed, but it's not required.

-- Device registration table: stores registered device names
CREATE TABLE IF NOT EXISTS device_registration (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  device_name VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_device_name (device_name)
);

-- Device state table: stores telemetry data for graph display and Monthly Report stats
CREATE TABLE IF NOT EXISTS device_state (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  device_name VARCHAR(64) NOT NULL,
  energy_wh DECIMAL(12,3) NULL,
  battery_pct DECIMAL(5,1) NULL,
  ts TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_device_name (device_name),
  INDEX idx_ts (ts),
  INDEX idx_updated_at (updated_at)
);

-- Grid price table: stores Batelec grid price from user input (device-independent)
CREATE TABLE IF NOT EXISTS grid_price (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  price DECIMAL(10,2) NOT NULL,
  estimated_savings DECIMAL(12,2) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_updated_at (updated_at)
);