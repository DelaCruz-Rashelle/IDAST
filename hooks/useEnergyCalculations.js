import { useMemo } from "react";

/**
 * Custom hook for calculating energy statistics from history data
 * @param {string} historyData - History CSV data
 * @param {Object} deviceStatsData - Device statistics from API (Solar Unit stats)
 * @param {Array} registeredDevices - Registered Solar Unit(s) (0 or 1 name)
 * @returns {Object} Calculated energy statistics
 */
export function useEnergyCalculations(historyData, deviceStatsData, registeredDevices) {
  // Calculate total energy for registered devices only (fallback - will be overridden by API data)
  const totalEnergyKWhFallback = useMemo(() => {
    if (!historyData) return 0;
    
    const lines = historyData.trim().split("\n").slice(1);
    if (registeredDevices.length === 0) {
      // If no registered devices, show all data
      return lines.reduce((acc, line) => {
        const parts = line.split(",");
        return acc + (parseFloat(parts[1]) || 0) / 1000.0;
      }, 0);
    }
    // Filter to registered devices only
    return lines.reduce((acc, line) => {
      const parts = line.split(",");
      const device = (parts[3] || "Unknown").trim();
      if (registeredDevices.includes(device)) {
        return acc + (parseFloat(parts[1]) || 0) / 1000.0;
      }
      return acc;
    }, 0);
  }, [historyData, registeredDevices]);

  // Calculate device statistics from history data, filtered to registered devices only (fallback - will be overridden by API data)
  const deviceStatsFallback = useMemo(() => {
    if (!historyData) return [];
    
    const lines = historyData.trim().split("\n").slice(1);
    const stats = {};
    
    lines.forEach((line) => {
      const parts = line.split(",");
      if (parts.length >= 4) {
        const device = (parts[3] || "Unknown").trim();
        const energyWh = parseFloat(parts[1]) || 0;
        const energyKWh = energyWh / 1000.0;
        const battery = parseFloat(parts[2]) || 0;
        const timestamp = parseInt(parts[0]) || 0;
        
        // Skip "Unknown" devices and only include registered devices
        if (device === "Unknown" || device === "" || !registeredDevices.includes(device)) return;
        
        if (!stats[device]) {
          stats[device] = {
            name: device,
            totalEnergyKWh: 0,
            totalEnergyWh: 0,
            sessionCount: 0,
            avgBattery: 0,
            batterySum: 0,
            batteryCount: 0,
            firstSeen: timestamp,
            lastSeen: timestamp
          };
        }
        
        stats[device].totalEnergyWh += energyWh;
        stats[device].totalEnergyKWh += energyKWh;
        stats[device].sessionCount += 1;
        
        if (!isNaN(battery) && battery > 0) {
          stats[device].batterySum += battery;
          stats[device].batteryCount += 1;
        }
        
        if (timestamp > 0) {
          if (stats[device].firstSeen === 0 || timestamp < stats[device].firstSeen) {
            stats[device].firstSeen = timestamp;
          }
          if (timestamp > stats[device].lastSeen) {
            stats[device].lastSeen = timestamp;
          }
        }
      }
    });
    
    // Calculate averages
    Object.values(stats).forEach((stat) => {
      if (stat.batteryCount > 0) {
        stat.avgBattery = stat.batterySum / stat.batteryCount;
      }
    });
    
    // Convert to array and sort by total energy (descending)
    return Object.values(stats)
      .sort((a, b) => b.totalEnergyKWh - a.totalEnergyKWh)
      .slice(0, 10); // Top 10 devices
  }, [historyData, registeredDevices]);

  // Use device statistics from API (fetched directly from device table)
  // This overrides the historyData-based calculations above
  const totalEnergyKWhFromAPI = deviceStatsData?.totalEnergyKWh || 0;
  const avgPerDayFromAPI = deviceStatsData?.avgPerDay || 0;
  
  // Filter device stats to registered devices only
  // If no registered devices, show all devices with data
  const deviceStatsFromAPI = useMemo(() => {
    if (!deviceStatsData?.deviceStats) return [];
    
    return deviceStatsData.deviceStats.filter(stat => {
      // If no registered devices, show all devices
      if (registeredDevices.length === 0) {
        return true;
      }
      // Otherwise, only show registered devices
      return registeredDevices.includes(stat.name);
    });
  }, [deviceStatsData, registeredDevices]);

  // Use API data if available, otherwise fall back to historyData calculations
  const totalEnergyKWh = totalEnergyKWhFromAPI > 0 ? totalEnergyKWhFromAPI : totalEnergyKWhFallback;
  const avgPerDay = avgPerDayFromAPI > 0 
    ? avgPerDayFromAPI 
    : (historyData ? (totalEnergyKWhFallback / Math.max(historyData.trim().split("\n").slice(1).length, 1)) : 0);
  const deviceStats = deviceStatsFromAPI.length > 0 ? deviceStatsFromAPI : deviceStatsFallback;

  return {
    totalEnergyKWh,
    avgPerDay,
    deviceStats
  };
}

