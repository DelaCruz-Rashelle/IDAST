import { useEffect, useRef } from "react";

/**
 * Realtime sensor chart only (top/left/right). History chart removed.
 */
export function useCharts(sensorHistory, data) {
  const chartRef = useRef(null);

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

  return {
    chartRef,
    drawSensorGraph,
  };
}
