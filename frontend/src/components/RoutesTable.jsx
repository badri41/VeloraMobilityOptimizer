import React from "react";
import { Truck, Navigation, Clock, Hash, Fuel, MapPin, TrendingDown, Gauge, Users } from "lucide-react";

function StopRow({ stop, requestMap }) {
  const formatTime = (minutes) => {
    if (!minutes && minutes !== 0) return "-";
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
  };

  const vehPref = stop.vehiclePreference || requestMap?.[stop.employeeId]?.vehiclePreference || "-";

  return (
    <tr>
      <td>
        <span className={`status-badge ${stop.type === 'depot' ? 'status-completed' : 'status-processing'}`}>
          {stop.type}
        </span>
      </td>
      <td>{stop.reqId ?? stop.req_id ?? "-"}</td>
      <td>{stop.employeeId ?? stop.employee_id ?? "-"}</td>
      <td>
        <div className="location-cell">
          <MapPin size={12} color="var(--primary)" />
          <span>{stop.lat?.toFixed?.(4)}, {stop.lon?.toFixed?.(4)}</span>
        </div>
      </td>
      <td>{formatTime(stop.arrivalTime ?? stop.arrival)}</td>
      <td><span className={`veh-pref-cell ${vehPref !== "any" && vehPref !== "-" ? "has-pref" : ""}`}>{vehPref}</span></td>
    </tr>
  );
}

export default function RoutesTable({ routes, inputData }) {
  if (!routes?.length) return <p className="muted-text">No routes calculated for this dataset.</p>;

  const vehicleMap = {};
  if (inputData?.vehicles) {
    inputData.vehicles.forEach((veh) => {
      vehicleMap[veh.vehicleId] = veh;
    });
  }

  // Build request map by employeeId for vehicle preference lookup
  const requestMap = {};
  if (inputData?.requests) {
    inputData.requests.forEach((req) => {
      requestMap[req.employeeId] = req;
    });
  }

  const formatTime = (minutes) => {
    if (!minutes && minutes !== 0) return "-";
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
  };

  return (
    <div className="routes-list-v2">
      {routes.map((route, index) => {
        const vId = route.vehicleIdStr || route.vehicleId;
        const vehicleInfo = vehicleMap[vId];

        // Vehicle biodata: prefer solver output, fallback to inputData
        const fuelType = route.fuelType || vehicleInfo?.fuelType || "";
        const category = route.category || vehicleInfo?.category || "";
        const capacity = route.capacity || vehicleInfo?.capacity || "-";
        const costPerKm = route.costPerKm || vehicleInfo?.costPerKm;
        const speed = route.speed || vehicleInfo?.speed || "-";
        const vehType = route.vehicleType || vehicleInfo?.type || "";
        const availTime = route.availabilityTime ?? vehicleInfo?.availabilityTime;

        // Baseline vs optimized
        const baselineCost = route.baselineCost || 0;
        const optimizedCost = route.totalCost || 0;
        const costSaving = baselineCost - optimizedCost;
        const costSavingPct = baselineCost > 0 ? (costSaving / baselineCost * 100) : 0;
        const hasBaseline = baselineCost > 0;

        return (
          <div className="glass-card route-card-v2" key={vId ?? index}>
            <div className="route-card-header-v2">
              <div className="route-id">
                <Truck size={18} color="var(--primary)" />
                <h4>Vehicle {vId || index}</h4>
                {vehType && <span className="veh-type-badge">{vehType}</span>}
                {fuelType && (
                  <span className={`fuel-type-badge fuel-${fuelType.toLowerCase()}`}>
                    <Fuel size={10} /> {fuelType}
                  </span>
                )}
              </div>
              <div className="route-quick-metrics">
                <div className="quick-metric"><Navigation size={14} /> <span>{(route.totalDist ?? 0).toFixed(1)} km</span></div>
                <div className="quick-metric"><Clock size={14} /> <span>{(route.totalTime ?? 0).toFixed(0)} min</span></div>
                <div className="quick-metric"><Hash size={14} /> <span>{route.stops?.length || 0} Stops</span></div>
              </div>
            </div>

            {/* Full vehicle biodata strip */}
            <div className="vehicle-details-strip">
              {costPerKm != null && <div className="detail-item"><Fuel size={14} /> <span>₹{Number(costPerKm).toFixed(2)}/km</span></div>}
              {category && <div className="detail-item"><span>Category: {category}</span></div>}
              <div className="detail-item"><Users size={14} /> <span>Capacity: {capacity}</span></div>
              {speed !== "-" && <div className="detail-item"><Gauge size={14} /> <span>{speed} km/h</span></div>}
              {availTime != null && availTime > 0 && <div className="detail-item"><Clock size={14} /> <span>Avail: {formatTime(availTime)}</span></div>}
              {(route.startLat || vehicleInfo?.startLocation?.lat) && (
                <div className="detail-item">
                  <MapPin size={14} />
                  <span>Start: {(route.startLat || vehicleInfo?.startLocation?.lat)?.toFixed(4)}, {(route.startLon || vehicleInfo?.startLocation?.lon)?.toFixed(4)}</span>
                </div>
              )}
            </div>

            {/* Baseline vs Optimized comparison */}
            {hasBaseline && (
              <div className="baseline-comparison">
                <div className="baseline-header">
                  <TrendingDown size={14} />
                  <span>Baseline vs Optimized</span>
                </div>
                <div className="baseline-metrics">
                  <div className="baseline-metric">
                    <span className="bl-label">Baseline Cost</span>
                    <span className="bl-value bl-old">₹{baselineCost.toFixed(0)}</span>
                  </div>
                  <div className="baseline-metric">
                    <span className="bl-label">Optimized Cost</span>
                    <span className="bl-value bl-new">₹{optimizedCost.toFixed(0)}</span>
                  </div>
                  <div className="baseline-metric">
                    <span className="bl-label">Savings</span>
                    <span className={`bl-value ${costSaving >= 0 ? "bl-positive" : "bl-negative"}`}>
                      ₹{Math.abs(costSaving).toFixed(0)} ({costSavingPct.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Req ID</th>
                    <th>Employee</th>
                    <th>Coordinates</th>
                    <th>Arrival</th>
                    <th>Veh Pref</th>
                  </tr>
                </thead>
                <tbody>
                  {route.stops?.map((stop, sIdx) => (
                    <StopRow key={sIdx} stop={stop} requestMap={requestMap} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <style>{`
        .routes-list-v2 { display: flex; flex-direction: column; gap: 24px; }
        .route-card-v2 { padding: 24px; }
        .route-card-header-v2 { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 16px; }
        .route-id { display: flex; align-items: center; gap: 12px; }
        .route-id h4 { font-size: 1.1rem; }
        .veh-type-badge { font-size: 0.65rem; padding: 2px 8px; background: var(--primary-glow); color: var(--primary); border: 1px solid var(--primary); border-radius: 4px; font-weight: 700; text-transform: uppercase; }
        .fuel-type-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 0.6rem; padding: 2px 8px; border-radius: 4px; font-weight: 700; text-transform: uppercase; }
        .fuel-ev, .fuel-electric { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); }
        .fuel-cng { background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3); }
        .fuel-diesel { background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }
        .fuel-petrol { background: rgba(168, 85, 247, 0.15); color: #a855f7; border: 1px solid rgba(168, 85, 247, 0.3); }
        .route-quick-metrics { display: flex; gap: 16px; }
        .quick-metric { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-dim); background: rgba(0,0,0,0.2); padding: 4px 10px; border-radius: 6px; }
        .vehicle-details-strip { display: flex; gap: 20px; padding: 10px 16px; background: rgba(255,255,255,0.02); border-radius: 8px; margin-bottom: 20px; font-size: 0.75rem; color: var(--text-dim); flex-wrap: wrap; }
        .detail-item { display: flex; align-items: center; gap: 6px; }
        .location-cell { display: flex; align-items: center; gap: 6px; }
        .muted-text { color: var(--text-dim); text-align: center; padding: 40px; }
        .veh-pref-cell { font-size: 0.75rem; color: var(--text-dim); }
        .veh-pref-cell.has-pref { color: var(--primary); font-weight: 600; }

        /* Baseline comparison */
        .baseline-comparison { padding: 12px 16px; background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.15); border-radius: 8px; margin-bottom: 20px; }
        .baseline-header { display: flex; align-items: center; gap: 8px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: #10b981; margin-bottom: 10px; }
        .baseline-metrics { display: flex; gap: 24px; flex-wrap: wrap; }
        .baseline-metric { display: flex; flex-direction: column; gap: 2px; }
        .bl-label { font-size: 0.65rem; font-weight: 600; text-transform: uppercase; color: var(--text-dim); }
        .bl-value { font-family: var(--font-display); font-size: 0.95rem; font-weight: 700; }
        .bl-old { color: var(--text-dim); text-decoration: line-through; }
        .bl-new { color: var(--text-bright); }
        .bl-positive { color: #10b981; }
        .bl-negative { color: #ef4444; }
      `}</style>
    </div>
  );
}
