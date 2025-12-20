-- MySQL schema for IDAST device data (Railway MySQL)
-- 
-- NOTE: This schema is now automatically applied when the backend starts.
-- The initSchema() function in backend/src/db.js creates these tables on startup.
-- 
-- This file is kept for reference/documentation purposes.
-- You can still use it manually if needed, but it's not required.
--
-- NOTE: The telemetry table has been removed. All device-related data is now stored in the device table.

-- Device table: stores device names and all device-related display data
CREATE TABLE IF NOT EXISTS device (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  device_name VARCHAR(64) NOT NULL UNIQUE,
  energy_wh DECIMAL(12,3) NULL,
  battery_pct DECIMAL(5,1) NULL,
  ts TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_updated_at (updated_at),
  INDEX idx_ts (ts),
  INDEX idx_device_name (device_name)
);

-- Grid price table: stores Batelec grid price from user input (with device connection)
CREATE TABLE IF NOT EXISTS grid_price (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  price DECIMAL(10,2) NOT NULL,
  device_name VARCHAR(64) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_updated_at (updated_at),
  INDEX idx_device_name (device_name)
);