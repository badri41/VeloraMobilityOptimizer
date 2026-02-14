import React from "react";
import {
  User,
  MapPin,
  Clock,
  Star,
  Users,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Truck,
  Info,
} from "lucide-react";

export default function EmployeeResults({ solution, inputData, onEmployeeHover }) {
  if (!solution || solution.status !== "completed") return null;

  const data = solution.data;
  const routes = data.routes || [];
  const constraintAnalysis = data.constraintAnalysis || [];

  // Build constraint lookup by employeeId
  const constraintMap = {};
  constraintAnalysis.forEach((c) => {
    constraintMap[c.employeeId] = c;
  });

  // Build employee trips from routes
  const employeeTrips = {};

  routes.forEach((route) => {
    (route.stops || []).forEach((stop) => {
      const empId = stop.employeeId;
      if (!empId) return;

      if (!employeeTrips[empId]) {
        employeeTrips[empId] = {
          employeeId: empId,
          vehicleId: route.vehicleIdStr || route.vehicleId,
          pickupTime: null,
          dropoffTime: null,
          pickupWaitTime: null,
        };
      }

      if (stop.type?.toLowerCase() === "pickup") {
        employeeTrips[empId].pickupTime = stop.arrivalTime;
        employeeTrips[empId].pickupWaitTime = stop.waitTime;
      } else if (stop.type?.toLowerCase() === "dropoff") {
        employeeTrips[empId].dropoffTime = stop.arrivalTime;
      }
    });
  });

  const requestMap = {};
  inputData?.requests?.forEach((req) => (requestMap[req.employeeId] = req));

  const vehicleMap = {};
  inputData?.vehicles?.forEach((veh) => (vehicleMap[veh.vehicleId] = veh));

  const employeeList = Object.values(employeeTrips).sort((a, b) =>
    a.employeeId.toString().localeCompare(b.employeeId.toString()),
  );

  const formatTime = (minutes) => {
    if (!minutes && minutes !== 0) return "-";
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
  };

  // Status badge component
  const StatusBadge = ({ status }) => {
    if (status === "on_time") {
      return (
        <div className="constraint-badge badge-green">
          <CheckCircle size={14} />
          <span>On Time</span>
        </div>
      );
    }
    if (status === "within_tolerance") {
      return (
        <div className="constraint-badge badge-yellow">
          <AlertTriangle size={14} />
          <span>Within Tolerance</span>
        </div>
      );
    }
    if (status === "violated") {
      return (
        <div className="constraint-badge badge-red">
          <XCircle size={14} />
          <span>Constraint Violated</span>
        </div>
      );
    }
    return null;
  };

  // Note chip component
  const NoteChip = ({ note }) => {
    const typeClass = note.type === "error" ? "note-error" : note.type === "warning" ? "note-warning" : "note-info";
    const Icon = note.type === "error" ? XCircle : note.type === "warning" ? AlertTriangle : Info;
    return (
      <div className={`note-chip ${typeClass}`}>
        <Icon size={12} />
        <span>{note.text}</span>
      </div>
    );
  };

  return (
    <div className="employee-results-v2">
      <div className="grid grid-cols-3">
        {employeeList.map((emp, idx) => {
          const req = requestMap[emp.employeeId];
          const veh = vehicleMap[emp.vehicleId];
          const constraint = constraintMap[emp.employeeId];
          const travelTime =
            emp.pickupTime !== null && emp.dropoffTime !== null
              ? emp.dropoffTime - emp.pickupTime
              : null;

          const overallStatus = constraint?.overallStatus || "on_time";

          return (
            <div
              key={emp.employeeId}
              className={`glass-card employee-card-v2 card-status-${overallStatus}`}
              onMouseEnter={() => onEmployeeHover?.(emp.employeeId)}
              onMouseLeave={() => onEmployeeHover?.(null)}
            >
              {/* Header with status badge */}
              <div className="emp-card-header">
                <div className="emp-avatar">
                  <User size={20} color="var(--primary)" />
                </div>
                <div className="emp-info-main">
                  <h4>{emp.employeeId}</h4>
                  <div className="assigned-veh">
                    <Truck size={12} />
                    <span>Vehicle {emp.vehicleId}</span>
                    {veh?.fuelType && (
                      <span className="fuel-badge">{veh.fuelType}</span>
                    )}
                    {veh?.type && veh.type !== "normal" && (
                      <span className="type-badge">{veh.type}</span>
                    )}
                  </div>
                </div>
                <StatusBadge status={overallStatus} />
              </div>

              {/* Vehicle preference violation */}
              {constraint?.vehiclePrefViolated && (
                <div className="pref-violation-banner">
                  <AlertTriangle size={14} />
                  <span>
                    Requested: <strong>{constraint.requestedVehicleType}</strong> | Assigned: <strong>{constraint.assignedVehicleType}</strong>
                    {constraint.assignedVehicleCategory ? ` (${constraint.assignedVehicleCategory})` : ""}
                  </span>
                </div>
              )}

              {/* Sharing violation */}
              {constraint?.sharingViolated && (
                <div className="sharing-violation-banner">
                  <Users size={14} />
                  <span>
                    Sharing limit exceeded: wanted {constraint.sharingLimit === 1 ? "single (no sharing)" : `max ${constraint.sharingLimit}`},
                    but {constraint.maxConcurrentPassengers} passengers in vehicle
                  </span>
                </div>
              )}

              {/* Trip details */}
              <div className="emp-trip-details">
                {/* Wait time explanation */}
                {constraint?.vehicleWaitTime > 0 && (
                  <div className="wait-explanation">
                    <Clock size={14} />
                    <span>
                      Vehicle arrived at {formatTime(constraint.pickupArrival)} ({constraint.vehicleWaitTime.toFixed(1)} min early), waited for pickup window to open at {formatTime(constraint.earlyTime)}
                    </span>
                  </div>
                )}

                <div className="trip-point">
                  <div className="point-icon">
                    <MapPin size={14} />
                  </div>
                  <div className="point-info">
                    <span className="label">Pickup</span>
                    <span className={`value pickup-status-${constraint?.pickupStatus || "on_time"}`}>
                      {formatTime(emp.pickupTime)}
                    </span>
                    <span className="window">
                      Window: {formatTime(req?.earlyTime)} - {formatTime(req?.lateTime)}
                      {constraint?.maxDelay ? ` (tolerance: +${constraint.maxDelay} min)` : ""}
                    </span>
                  </div>
                </div>

                <div className="trip-point">
                  <div className="point-icon">
                    <MapPin size={14} style={{ transform: "rotate(180deg)" }} />
                  </div>
                  <div className="point-info">
                    <span className="label">Dropoff</span>
                    <span className={`value dropoff-status-${constraint?.dropoffStatus || "on_time"}`}>
                      {formatTime(emp.dropoffTime)}
                    </span>
                  </div>
                </div>

                <div className="trip-point">
                  <div className="point-icon">
                    <Clock size={14} />
                  </div>
                  <div className="point-info">
                    <span className="label">Trip Duration</span>
                    <span className="value">
                      {travelTime !== null ? `${travelTime.toFixed(1)} min` : "-"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Footer metrics */}
              <div className="emp-footer-metrics">
                <div className="footer-metric">
                  <Star size={12} />
                  <span>P{req?.priority || 1}</span>
                </div>
                <div className="footer-metric">
                  <Users size={12} />
                  <span>
                    Sharing: {req?.sharingLimit === 1 ? "Single" : req?.sharingLimit === 100 || req?.sharingLimit === 999 ? "Any" : `Max ${req?.sharingLimit}`}
                  </span>
                </div>
              </div>

              {/* Constraint notes (filter out wait-time info since it's shown inline above) */}
              {constraint?.notes?.filter((n) => !(n.type === "info" && n.text.includes("waited for pickup window"))).length > 0 && (
                <div className="constraint-notes">
                  {constraint.notes
                    .filter((n) => !(n.type === "info" && n.text.includes("waited for pickup window")))
                    .map((note, i) => (
                      <NoteChip key={i} note={note} />
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        .employee-results-v2 { padding: 8px; }
        .employee-card-v2 {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .employee-card-v2:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(59, 130, 246, 0.2);
        }

        /* Status border indicators */
        .card-status-on_time { border-left: 3px solid #10b981; }
        .card-status-within_tolerance { border-left: 3px solid #f59e0b; }
        .card-status-violated { border-left: 3px solid #ef4444; }

        /* Header */
        .emp-card-header { display: flex; align-items: center; gap: 14px; }
        .emp-avatar { width: 40px; height: 40px; border-radius: 12px; background: var(--bg-glass); display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-subtle); }
        .emp-info-main { flex: 1; }
        .emp-info-main h4 { font-size: 1rem; margin-bottom: 2px; }
        .assigned-veh { display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-dim); }
        .fuel-badge, .type-badge { padding: 2px 8px; background: rgba(59, 130, 246, 0.15); border-radius: 4px; font-size: 0.65rem; font-weight: 600; text-transform: uppercase; color: var(--primary); }
        .type-badge { background: rgba(168, 85, 247, 0.15); color: #a855f7; }

        /* Status badges */
        .constraint-badge { display: flex; align-items: center; gap: 4px; padding: 4px 10px; border-radius: 100px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; white-space: nowrap; }
        .badge-green { background: rgba(16, 185, 129, 0.15); color: #10b981; }
        .badge-yellow { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
        .badge-red { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

        /* Violation banners */
        .pref-violation-banner, .sharing-violation-banner {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 12px; border-radius: 8px;
          font-size: 0.75rem; font-weight: 500;
        }
        .pref-violation-banner {
          background: rgba(239, 68, 68, 0.1); color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }
        .sharing-violation-banner {
          background: rgba(239, 68, 68, 0.1); color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        /* Wait explanation */
        .wait-explanation {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 8px 12px; border-radius: 8px;
          background: rgba(59, 130, 246, 0.08);
          border: 1px solid rgba(59, 130, 246, 0.15);
          font-size: 0.75rem; color: var(--primary);
          line-height: 1.4;
        }
        .wait-explanation svg { flex-shrink: 0; margin-top: 1px; }

        /* Trip details */
        .emp-trip-details { display: flex; flex-direction: column; gap: 12px; padding: 16px; background: var(--bg-glass); border-radius: 12px; border: 1px solid var(--border-subtle); }
        .trip-point { display: flex; gap: 12px; }
        .point-icon { color: var(--primary); margin-top: 2px; }
        .point-info { display: flex; flex-direction: column; gap: 2px; }
        .point-info .label { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; color: var(--text-dim); }
        .point-info .value { font-family: var(--font-display); font-size: 0.95rem; font-weight: 700; color: var(--text-bright); }
        .point-info .window { font-size: 0.7rem; color: var(--text-dim); }

        /* Pickup/dropoff time color based on status */
        .pickup-status-on_time, .dropoff-status-on_time { color: #10b981 !important; }
        .pickup-status-within_tolerance, .dropoff-status-within_tolerance { color: #f59e0b !important; }
        .pickup-status-violated, .dropoff-status-violated { color: #ef4444 !important; }

        /* Footer */
        .emp-footer-metrics { display: flex; gap: 12px; }
        .footer-metric { display: flex; align-items: center; gap: 6px; font-size: 0.7rem; font-weight: 600; color: var(--text-dim); background: var(--bg-glass); padding: 4px 10px; border-radius: 6px; }

        /* Constraint notes */
        .constraint-notes { display: flex; flex-direction: column; gap: 6px; }
        .note-chip {
          display: flex; align-items: flex-start; gap: 6px;
          padding: 6px 10px; border-radius: 6px;
          font-size: 0.7rem; line-height: 1.4;
        }
        .note-chip svg { flex-shrink: 0; margin-top: 1px; }
        .note-error { background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.15); }
        .note-warning { background: rgba(245, 158, 11, 0.1); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.15); }
        .note-info { background: rgba(59, 130, 246, 0.08); color: var(--primary); border: 1px solid rgba(59, 130, 246, 0.1); }
      `}</style>
    </div>
  );
}
