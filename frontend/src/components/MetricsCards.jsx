export default function MetricsCards({ metrics, costs, executionTime }) {
  const items = [
    { label: "Total distance", value: metrics?.totalDistance },
    { label: "Total time", value: metrics?.totalTime },
    { label: "Vehicles used", value: metrics?.vehiclesUsed },
    { label: "Requests served", value: metrics?.requestsServed },
    { label: "Avg cost/request", value: metrics?.averageCostPerRequest },
    { label: "Total cost", value: costs?.total },
    { label: "Penalty cost", value: costs?.penalty },
    { label: "Execution time (ms)", value: executionTime },
  ];

  return (
    <div className="grid">
      {items.map((item) => (
        <div className="card" key={item.label}>
          <h4 className="section-title">{item.label}</h4>
          <div>{item.value ?? "-"}</div>
        </div>
      ))}
    </div>
  );
}
