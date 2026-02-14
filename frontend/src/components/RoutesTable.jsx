import React from "react";
import { Truck, Navigation, Ruler, Clock, Hash, Fuel, MapPin } from "lucide-react";

function StopRow({ stop }) {
  const formatTime = (minutes) => {
    if (!minutes && minutes !== 0) return "-";
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
  };

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
      <td>{typeof stop.waitTime === "number" ? stop.waitTime.toFixed(2) : "0"}m</td>
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

  return (
    <div className="routes-list-v2">
      {routes.map((route, index) => {
        const vId = route.vehicleIdStr || route.vehicleId;
        const vehicleInfo = vehicleMap[vId];

        return (
          <div className="glass-card route-card-v2" key={vId ?? index}>
            <div className="route-card-header-v2">
              <div className="route-id">
                <Truck size={18} color="var(--primary)" />
                <h4>Vehicle {vId || index}</h4>
                {vehicleInfo?.type && <span className="veh-type-badge">{vehicleInfo.type}</span>}
              </div>
              <div className="route-quick-metrics">
                <div className="quick-metric"><Navigation size={14} /> <span>{(route.totalDist ?? 0).toFixed(1)} km</span></div>
                <div className="quick-metric"><Clock size={14} /> <span>{(route.totalTime ?? 0).toFixed(0)} min</span></div>
                <div className="quick-metric"><Hash size={14} /> <span>{route.stops?.length || 0} Stops</span></div>
              </div>
            </div>

            {vehicleInfo && (
              <div className="vehicle-details-strip">
                <div className="detail-item"><Fuel size={14} /> <span>₹{vehicleInfo.costPerKm?.toFixed(2)}/km</span></div>
                {vehicleInfo.category && <div className="detail-item"><span>Category: {vehicleInfo.category}</span></div>}
                <div className="detail-item"><span>Capacity: {vehicleInfo.capacity}</span></div>
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
                    <th>Wait</th>
                  </tr>
                </thead>
                <tbody>
                  {route.stops?.map((stop, sIdx) => (
                    <StopRow key={sIdx} stop={stop} />
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
        .route-quick-metrics { display: flex; gap: 16px; }
        .quick-metric { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-dim); background: rgba(0,0,0,0.2); padding: 4px 10px; border-radius: 6px; }
        .vehicle-details-strip { display: flex; gap: 20px; padding: 10px 16px; background: rgba(255,255,255,0.02); border-radius: 8px; margin-bottom: 20px; font-size: 0.75rem; color: var(--text-dim); }
        .detail-item { display: flex; align-items: center; gap: 6px; }
        .location-cell { display: flex; align-items: center; gap: 6px; }
        .muted-text { color: var(--text-dim); text-align: center; padding: 40px; }
      `}</style>
    </div>
  );
}
