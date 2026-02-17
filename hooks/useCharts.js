import { useEffect, useState, useRef } from "react";

export function useCharts(sensorHistory, historyData, registeredDevices, data) {
  const chartRef = useRef(null);
  const historyChartRef = useRef(null);
  const historyPointsRef = useRef([]);
  const [tooltip, setTooltip] = useState(null);

  const drawSensorGraph = () => {
    if (!chartRef.current) return;
    const canvas = chartRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sensors = ["top", "left", "right"];
    const colors = { top: "#ff6b6b", left: "#2fd27a", right: "#4db5ff" };

    sensors.forEach((sensor) => {
      const history = sensorHistory.current[sensor];
      if (history.length === 0) return;

      ctx.beginPath();
      ctx.strokeStyle = colors[sensor];
      ctx.lineWidth = 2;
      history.forEach((val, idx) => {
        const x = idx * (canvas.width / 120);
        const y = canvas.height - (val / 4095) * canvas.height;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  };

  // History chart filtered to registered Solar Unit (registeredDevices[0])
  const drawHistoryChart = (csvData) => {
    if (!historyChartRef.current || !csvData) return;
    const canvas = historyChartRef.current;
    const ctx = canvas.getContext("2d");
    const w = canvas.width - 40;
    const h = canvas.height - 40;

    ctx.fillStyle = "#0e1833";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const lines = csvData.trim().split("\n").slice(1).filter((l) => l);
    if (lines.length === 0) return;

    const allPoints = lines.map((l, idx) => {
      const p = l.split(",");
      const timestamp = parseInt(p[0]) || 0;

      let date;
      if (timestamp > 1e12) date = new Date(timestamp);
      else if (timestamp > 1e9) date = new Date(timestamp * 1000);
      else {
        const daysAgo = lines.length - idx - 1;
        date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      }

      // Back-compat: device column used as Solar Unit identifier
      const rawName = (p[3] || "Unknown").trim();

      return {
        index: idx,
        timestamp,
        energyWh: parseFloat(p[1]) || 0,
        battery: parseFloat(p[2]) || 0,
        solarName: rawName, // renamed for display meaning
        date,
      };
    });

    const points =
      registeredDevices.length > 0
        ? allPoints.filter((p) => registeredDevices.includes(p.solarName))
        : allPoints;

    if (points.length === 0) {
      ctx.fillStyle = "#9fb3d1";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText("No energy data for registered Solar Unit", canvas.width / 2, canvas.height / 2);
      ctx.textAlign = "left";
      ctx.fillText("Energy Harvested (kWh)", 20, 20);
      ctx.textAlign = "right";
      ctx.fillText("Time →", canvas.width - 20, canvas.height - 10);
      historyPointsRef.current = [];
      return;
    }

    points.forEach((p) => {
      p.energyKWh = p.energyWh / 1000.0;
    });
    const maxEnergyKWh = Math.max(...points.map((p) => p.energyKWh), 0.001);

    historyPointsRef.current = points.map((p, i) => {
      const x = 20 + (i / (points.length - 1 || 1)) * w;
      const y = 20 + h - (p.energyKWh / maxEnergyKWh) * h;
      return { ...p, screenX: x, screenY: y };
    });

    ctx.strokeStyle = "#2fd27a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    historyPointsRef.current.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.screenX, p.screenY);
      else ctx.lineTo(p.screenX, p.screenY);
    });
    ctx.stroke();

    ctx.fillStyle = "#2fd27a";
    historyPointsRef.current.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.screenX, p.screenY, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = "#9fb3d1";
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillText("Energy Harvested (kWh)", 20, 20);
    ctx.textAlign = "right";
    ctx.fillText("Time →", canvas.width - 20, canvas.height - 10);
  };

  useEffect(() => {
    if (typeof window !== "undefined" && chartRef.current) {
      const canvas = chartRef.current;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width || 720;
        canvas.height = 210;
        drawSensorGraph();
      }
    }
  }, [data]);

  useEffect(() => {
    if (typeof window !== "undefined" && historyChartRef.current) {
      const canvas = historyChartRef.current;
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (rect) {
        canvas.width = rect.width || 800;
        canvas.height = 300;
        if (historyData) drawHistoryChart(historyData);
      }

      const handleMouseMove = (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        let closestPoint = null;
        let minDist = Infinity;

        historyPointsRef.current.forEach((point) => {
          const dist = Math.sqrt((x - point.screenX) ** 2 + (y - point.screenY) ** 2);
          if (dist < 10 && dist < minDist) {
            minDist = dist;
            closestPoint = point;
          }
        });

        if (closestPoint) {
          const dateStr = closestPoint.date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          setTooltip({
            x: e.clientX,
            y: e.clientY,
            date: dateStr,
            energy: closestPoint.energyKWh.toFixed(3),
            battery: closestPoint.battery.toFixed(1),
            device: closestPoint.solarName, // keep tooltip field name for existing UI
          });
        } else {
          setTooltip(null);
        }
      };

      const handleMouseLeave = () => setTooltip(null);

      canvas.addEventListener("mousemove", handleMouseMove);
      canvas.addEventListener("mouseleave", handleMouseLeave);

      return () => {
        canvas.removeEventListener("mousemove", handleMouseMove);
        canvas.removeEventListener("mouseleave", handleMouseLeave);
      };
    }
  }, [historyData, registeredDevices]);

  return {
    chartRef,
    historyChartRef,
    tooltip,
    drawSensorGraph,
    drawHistoryChart,
  };
}