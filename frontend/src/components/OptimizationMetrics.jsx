export default function OptimizationMetrics({ solution }) {
  if (!solution || solution.status !== "completed") {
    return null;
  }

  const data = solution.data;
  const summary = data.summary || {};
  const metrics = data.metrics || {};

  // Calculate values from summary or metrics
  const vehiclesUsed = summary.vehiclesUsed || metrics.vehiclesUsed || 0;
  const requestsServed = (data.routes || []).reduce((count, route) => {
    const pickups = (route.stops || []).filter(
      (s) => s.type === "pickup" || s.type === "PICKUP",
    );
    return count + pickups.length;
  }, 0);
  const totalDistance = summary.totalDistance || metrics.totalDistance || 0;
  const totalTime = summary.totalTime || metrics.totalTime || 0;
  const totalCost =
    summary.globalCost || summary.totalCost || metrics.totalCost || 0;
  const avgCostPerRequest = requestsServed > 0 ? totalCost / requestsServed : 0;

  const cards = [
    {
      icon: "🚗",
      label: "Vehicles Used",
      value: vehiclesUsed,
      suffix: "",
    },
    {
      icon: "👥",
      label: "Requests Served",
      value: requestsServed,
      suffix: "",
    },
    {
      icon: "📏",
      label: "Total Distance",
      value: totalDistance.toFixed(2),
      suffix: "km",
    },
    {
      icon: "⏱️",
      label: "Total Time",
      value: totalTime.toFixed(0),
      suffix: "min",
    },
    {
      icon: "💵",
      label: "Avg Cost/Request",
      value: avgCostPerRequest.toFixed(2),
      suffix: "",
    },
    {
      icon: "⚡",
      label: "Execution Time",
      value: data.executionTime || 0,
      suffix: "ms",
    },
  ];

  return (
    <div className="metrics-section">
      <h3>📊 Optimization Metrics</h3>
      <div className="metrics-grid">
        {cards.map((card, idx) => (
          <div className="metric-card" key={idx}>
            <div className="metric-icon">{card.icon}</div>
            <div className="metric-content">
              <div className="metric-label">{card.label}</div>
              <div className="metric-value">
                {card.value}{" "}
                <span className="metric-suffix">{card.suffix}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
