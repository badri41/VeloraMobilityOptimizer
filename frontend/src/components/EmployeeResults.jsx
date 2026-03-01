import React, { useState } from "react";
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
  ChevronDown,
  ChevronUp,
  TrendingDown,
  DollarSign,
} from "lucide-react";

export default function EmployeeResults({ solution, inputData, onEmployeeHover }) {
  const [expandedCard, setExpandedCard] = useState(null);

  if (!solution || solution.status !== "completed") return null;

  const data = solution.data;
  const routes = data.routes || [];
  const constraintAnalysis = data.constraintAnalysis || [];

  // Build constraint lookup by employeeId
  const constraintMap = {};
  constraintAnalysis.forEach((c) => {
    constraintMap[c.employeeId] = c;
  });

  // Build baseline lookup by employeeId from inputData
  const baselineMap = {};
  (inputData?.baseline || []).forEach((b) => {
    const empId = b.employee_id || b.employeeId;
    if (empId) baselineMap[empId] = b;
  });

  // Compute per-employee optimized cost (equal share of route cost among passengers)
  const empOptCostMap = {};
  routes.forEach((route) => {
    const uniqueEmps = new Set(
      (route.stops || [])
        .filter((s) => s.type?.toLowerCase() === "pickup")
        .map((s) => s.employeeId)
        .filter(Boolean)
    );
    const count = uniqueEmps.size;
    if (count === 0) return;
    const share = (route.totalCost || 0) / count;
    uniqueEmps.forEach((empId) => {
      empOptCostMap[empId] = (empOptCostMap[empId] || 0) + share;
    });
  });

  // Build employee trips from routes
  const employeeTrips = {};
  // Also track forceAssigned
  const forceAssignedEmps = new Set();

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
        if (stop.forceAssigned) forceAssignedEmps.add(empId);
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

  // Unassigned employees: in inputData.requests but not in any route
  const assignedEmpIds = new Set(Object.keys(employeeTrips));
  const unassignedList = (inputData?.requests || []).filter(
    (req) => !assignedEmpIds.has(req.employeeId)
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

  const toggleCard = (empId) => {
    setExpandedCard(expandedCard === empId ? null : empId);
  };

  return (
    <div className="employee-results-v2">

      {/* ── Assigned Employees ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-3" style={{ alignItems: "start" }}>
        {employeeList.map((emp) => {
          const req = requestMap[emp.employeeId];
          const veh = vehicleMap[emp.vehicleId];
          const constraint = constraintMap[emp.employeeId];
          const travelTime =
            emp.pickupTime !== null && emp.dropoffTime !== null
              ? emp.dropoffTime - emp.pickupTime
              : null;

          // Cost / time metrics
          const bl = baselineMap[emp.employeeId];
          const baselineCost = bl?.baseline_cost ?? null;
          const baselineTime = bl?.baseline_time_min ?? null;
          const optimizedCost = empOptCostMap[emp.employeeId] ?? null;
          const optimizedTime = travelTime;
          const costSaved = baselineCost != null && optimizedCost != null ? baselineCost - optimizedCost : null;
          const pctSaved = baselineCost != null && baselineCost > 0 && costSaved != null ? (costSaved / baselineCost) * 100 : null;
          const timeSaved = baselineTime != null && optimizedTime != null ? baselineTime - optimizedTime : null;
          const timeSavedPct = baselineTime != null && baselineTime > 0 && timeSaved != null ? (timeSaved / baselineTime) * 100 : null;

          const overallStatus = constraint?.overallStatus || "on_time";
          const isExpanded = expandedCard === emp.employeeId;
          const isForceAssigned = forceAssignedEmps.has(emp.employeeId);

          return (
            <div
              key={emp.employeeId}
              className={`glass-card employee-card-v2 card-status-${overallStatus}${isExpanded ? " card-expanded" : ""}`}
              onMouseEnter={() => onEmployeeHover?.(emp.employeeId)}
              onMouseLeave={() => onEmployeeHover?.(null)}
              onClick={() => toggleCard(emp.employeeId)}
              style={{ cursor: "pointer" }}
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
                <div className="card-chevron">
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </div>

              {/* Force-assigned warning */}
              {isForceAssigned && (
                <div className="force-assign-banner">
                  <AlertTriangle size={14} />
                  <span>Force-assigned: time window constraints could not be fully met</span>
                </div>
              )}

              {/* Expanded content — click to reveal */}
              {isExpanded && (
                <>
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
                    {req?.vehiclePreference && req.vehiclePreference !== "any" && (
                      <div className="footer-metric footer-metric-pref">
                        <Truck size={12} />
                        <span>Pref: {req.vehiclePreference}</span>
                      </div>
                    )}
                  </div>

                  {/* Cost & Time Metrics */}
                  {(baselineCost != null || optimizedCost != null) && (
                    <div className="emp-cost-metrics">
                      <div className="cost-metrics-header">Cost &amp; Time Summary</div>
                      <div className="cost-metrics-grid">
                        {baselineCost != null && (
                          <div className="cost-metric-item">
                            <span className="cm-label">Baseline Cost</span>
                            <span className="cm-value cm-baseline">₹{baselineCost.toFixed(0)}</span>
                          </div>
                        )}
                        {optimizedCost != null && (
                          <div className="cost-metric-item">
                            <span className="cm-label">Optimized Cost</span>
                            <span className="cm-value cm-optimized">₹{optimizedCost.toFixed(0)}</span>
                          </div>
                        )}
                        {baselineTime != null && (
                          <div className="cost-metric-item">
                            <span className="cm-label">Baseline Time</span>
                            <span className="cm-value">{baselineTime.toFixed(0)} min</span>
                          </div>
                        )}
                        {optimizedTime != null && (
                          <div className="cost-metric-item">
                            <span className="cm-label">Optimized Time</span>
                            <span className="cm-value">{optimizedTime.toFixed(0)} min</span>
                          </div>
                        )}
                        {pctSaved != null && (
                          <div className="cost-metric-item cost-metric-savings">
                            <span className="cm-label">% Cost Saved</span>
                            <span className={`cm-value ${pctSaved >= 0 ? "cm-positive" : "cm-negative"}`}>
                              {pctSaved >= 0 ? "▼" : "▲"} {Math.abs(pctSaved).toFixed(1)}%
                            </span>
                          </div>
                        )}
                        {timeSaved != null && (
                          <div className="cost-metric-item cost-metric-savings">
                            <span className="cm-label">{timeSaved >= 0 ? "Time Saved" : "No Time Saving"}</span>
                            <span className={`cm-value ${timeSaved >= 0 ? "cm-positive" : "cm-negative"}`}>
                              {timeSaved >= 0
                                ? `▼ ${timeSaved.toFixed(0)} min (${timeSavedPct != null ? timeSavedPct.toFixed(1) : "0.0"}%)`
                                : `▲ ${Math.abs(timeSaved).toFixed(0)} min longer`}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* CTC Without Us — what they'd pay via Ola/Uber */}
                      {/* {bl && (
                        <div className="ctc-without-us">
                          <div className="ctc-without-header">
                            <DollarSign size={13} />
                            <span>Without our Engine (Baseline) </span>
                          </div>
                          <div className="ctc-without-grid">
                            <div className="ctc-item">
                              <span className="ctc-label">Individual Cost</span>
                              <span className="ctc-val">₹{bl.baseline_cost?.toFixed(0) ?? "N/A"}</span>
                            </div>
                            <div className="ctc-item">
                              <span className="ctc-label">Estimated Time</span>
                              <span className="ctc-val">{bl.baseline_time_min?.toFixed(0) ?? "N/A"} min</span>
                            </div>
                            {costSaved != null && (
                              <div className="ctc-item ctc-item-savings">
                                <span className="ctc-label">You save per trip</span>
                                <span className={`ctc-val ${costSaved >= 0 ? "ctc-positive" : "ctc-negative"}`}>
                                  {costSaved >= 0 ? `₹${costSaved.toFixed(0)} (${pctSaved?.toFixed(1)}%)` : `₹${Math.abs(costSaved).toFixed(0)} more`}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )} */}
                    </div>
                  )}

                  {/* Constraint notes */}
                  {constraint?.notes?.filter((n) => !(n.type === "info" && n.text.includes("waited for pickup window"))).length > 0 && (
                    <div className="constraint-notes">
                      {constraint.notes
                        .filter((n) => !(n.type === "info" && n.text.includes("waited for pickup window")))
                        .map((note, i) => (
                          <NoteChip key={i} note={note} />
                        ))}
                    </div>
                  )}
                </>
              )}

              {/* Collapsed summary: show key stats inline */}
              {!isExpanded && (
                <div className="collapsed-summary">
                  <span className="cs-item">
                    <Clock size={11} />
                    {formatTime(emp.pickupTime)} → {formatTime(emp.dropoffTime)}
                  </span>
                  {optimizedCost != null && baselineCost != null && (
                    <span className={`cs-item cs-saving ${costSaved >= 0 ? "cs-pos" : "cs-neg"}`}>
                      <TrendingDown size={11} />
                      {costSaved >= 0 ? `Save ₹${costSaved.toFixed(0)}` : `₹${Math.abs(costSaved).toFixed(0)} over market`}
                    </span>
                  )}
                  <span className="cs-hint">Click for details</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Unassigned Employees ───────────────────────────────────────────── */}
      {unassignedList.length > 0 && (
        <div className="unassigned-section">
          <div className="unassigned-section-header">
            <XCircle size={18} color="#ef4444" />
            <span>{unassignedList.length} Employee{unassignedList.length > 1 ? "s" : ""} Could Not Be Scheduled</span>
          </div>
          <div className="grid grid-cols-3" style={{ alignItems: "start" }}>
            {unassignedList.map((req) => {
              const bl = baselineMap[req.employeeId];
              const isExpanded = expandedCard === `unassigned-${req.employeeId}`;
              return (
                <div
                  key={req.employeeId}
                  className="glass-card employee-card-v2 card-status-violated card-unassigned"
                  onClick={() => toggleCard(`unassigned-${req.employeeId}`)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="emp-card-header">
                    <div className="emp-avatar emp-avatar-unassigned">
                      <User size={20} color="#ef4444" />
                    </div>
                    <div className="emp-info-main">
                      <h4>{req.employeeId}</h4>
                      <div className="assigned-veh" style={{ color: "#ef4444" }}>
                        <XCircle size={12} />
                        <span>No vehicle assigned</span>
                      </div>
                    </div>
                    <div className="constraint-badge badge-red">
                      <XCircle size={14} />
                      <span>Unassigned</span>
                    </div>
                    <div className="card-chevron">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>

                  {isExpanded && (
                    <>
                      <div className="emp-trip-details">
                        <div className="trip-point">
                          <div className="point-icon"><MapPin size={14} /></div>
                          <div className="point-info">
                            <span className="label">Requested Window</span>
                            <span className="value">{formatTime(req.earlyTime)} – {formatTime(req.lateTime)}</span>
                          </div>
                        </div>
                        <div className="trip-point">
                          <div className="point-icon"><Star size={14} /></div>
                          <div className="point-info">
                            <span className="label">Priority</span>
                            <span className="value">P{req.priority}</span>
                          </div>
                        </div>
                        {req.vehiclePreference && req.vehiclePreference !== "any" && (
                          <div className="trip-point">
                            <div className="point-icon"><Truck size={14} /></div>
                            <div className="point-info">
                              <span className="label">Vehicle Preference</span>
                              <span className="value">{req.vehiclePreference}</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* CTC if unassigned — what they'd pay via market */}
                      {bl && (
                        <div className="ctc-without-us ctc-unassigned-box">
                          <div className="ctc-without-header">
                            <DollarSign size={13} />
                            <span>If served via Ola / Uber / Rapido individually</span>
                          </div>
                          <div className="ctc-without-grid">
                            <div className="ctc-item">
                              <span className="ctc-label">Market Cost</span>
                              <span className="ctc-val">₹{bl.baseline_cost?.toFixed(0) ?? "N/A"}</span>
                            </div>
                            <div className="ctc-item">
                              <span className="ctc-label">Estimated Time</span>
                              <span className="ctc-val">{bl.baseline_time_min?.toFixed(0) ?? "N/A"} min</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {!isExpanded && (
                    <div className="collapsed-summary">
                      <span className="cs-item">
                        Window: {formatTime(req.earlyTime)} – {formatTime(req.lateTime)}
                      </span>
                      {bl && (
                        <span className="cs-item" style={{ color: "#ef4444" }}>
                          Market rate: ₹{bl.baseline_cost?.toFixed(0)}
                        </span>
                      )}
                      <span className="cs-hint">Click for details</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        .employee-results-v2 { padding: 8px; display: flex; flex-direction: column; gap: 24px; }
        .employee-card-v2 {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          transition: transform 0.18s, box-shadow 0.18s;
          user-select: none;
        }
        .employee-card-v2:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(59, 130, 246, 0.18);
        }
        .card-expanded {
          box-shadow: 0 8px 32px rgba(59, 130, 246, 0.25);
        }

        /* Status border indicators */
        .card-status-on_time { border-left: 3px solid #10b981; }
        .card-status-within_tolerance { border-left: 3px solid #f59e0b; }
        .card-status-violated { border-left: 3px solid #ef4444; }
        .card-unassigned { border-left: 3px solid #ef4444; background: rgba(239,68,68,0.04); }

        /* Header */
        .emp-card-header { display: flex; align-items: center; gap: 12px; }
        .emp-avatar { width: 38px; height: 38px; border-radius: 12px; background: var(--bg-glass); display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-subtle); flex-shrink: 0; }
        .emp-avatar-unassigned { border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.08); }
        .emp-info-main { flex: 1; min-width: 0; }
        .emp-info-main h4 { font-size: 0.95rem; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .assigned-veh { display: flex; align-items: center; gap: 5px; font-size: 0.72rem; color: var(--text-dim); flex-wrap: wrap; }
        .fuel-badge, .type-badge { padding: 1px 6px; background: rgba(59, 130, 246, 0.15); border-radius: 4px; font-size: 0.62rem; font-weight: 600; text-transform: uppercase; color: var(--primary); }
        .type-badge { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
        .card-chevron { color: var(--text-dim); flex-shrink: 0; transition: color 0.15s; }
        .employee-card-v2:hover .card-chevron { color: var(--primary); }

        /* Status badges */
        .constraint-badge { display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 100px; font-size: 0.68rem; font-weight: 700; text-transform: uppercase; white-space: nowrap; }
        .badge-green { background: rgba(16, 185, 129, 0.15); color: #10b981; }
        .badge-yellow { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
        .badge-red { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

        /* Force-assign banner */
        .force-assign-banner {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 10px; border-radius: 8px;
          background: rgba(245, 158, 11, 0.1); color: #f59e0b;
          border: 1px solid rgba(245, 158, 11, 0.2);
          font-size: 0.72rem; font-weight: 500;
        }

        /* Violation banners */
        .pref-violation-banner, .sharing-violation-banner {
          display: flex; align-items: center; gap: 8px;
          padding: 7px 10px; border-radius: 8px;
          font-size: 0.72rem; font-weight: 500;
        }
        .pref-violation-banner { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }
        .sharing-violation-banner { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.2); }

        /* Wait explanation */
        .wait-explanation {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 7px 10px; border-radius: 8px;
          background: rgba(59, 130, 246, 0.08);
          border: 1px solid rgba(59, 130, 246, 0.15);
          font-size: 0.72rem; color: var(--primary); line-height: 1.4;
        }
        .wait-explanation svg { flex-shrink: 0; margin-top: 1px; }

        /* Trip details */
        .emp-trip-details { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: var(--bg-glass); border-radius: 10px; border: 1px solid var(--border-subtle); }
        .trip-point { display: flex; gap: 10px; }
        .point-icon { color: var(--primary); margin-top: 2px; }
        .point-info { display: flex; flex-direction: column; gap: 2px; }
        .point-info .label { font-size: 0.62rem; font-weight: 700; text-transform: uppercase; color: var(--text-dim); }
        .point-info .value { font-family: var(--font-display); font-size: 0.92rem; font-weight: 700; color: var(--text-bright); }
        .point-info .window { font-size: 0.68rem; color: var(--text-dim); }

        /* Pickup/dropoff time color based on status */
        .pickup-status-on_time, .dropoff-status-on_time { color: #10b981 !important; }
        .pickup-status-within_tolerance, .dropoff-status-within_tolerance { color: #f59e0b !important; }
        .pickup-status-violated, .dropoff-status-violated { color: #ef4444 !important; }

        /* Footer */
        .emp-footer-metrics { display: flex; gap: 8px; flex-wrap: wrap; }
        .footer-metric { display: flex; align-items: center; gap: 5px; font-size: 0.68rem; font-weight: 600; color: var(--text-dim); background: var(--bg-glass); padding: 3px 8px; border-radius: 6px; }
        .footer-metric-pref { background: rgba(168, 85, 247, 0.1); color: #a855f7; }

        /* Cost & Time Metrics */
        .emp-cost-metrics { padding: 12px 14px; background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.15); border-radius: 10px; display: flex; flex-direction: column; gap: 10px; }
        .cost-metrics-header { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); }
        .cost-metrics-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .cost-metric-item { display: flex; flex-direction: column; gap: 2px; }
        .cost-metric-savings { grid-column: 1 / -1; }
        .cm-label { font-size: 0.58rem; font-weight: 600; text-transform: uppercase; color: var(--text-dim); }
        .cm-value { font-family: var(--font-display); font-size: 0.85rem; font-weight: 700; color: var(--text-bright); }
        .cm-baseline { color: var(--text-dim); text-decoration: line-through; }
        .cm-optimized { color: var(--primary); }
        .cm-positive { color: #10b981; }
        .cm-negative { color: #ef4444; }

        /* CTC Without Us */
        .ctc-without-us {
          padding: 10px 12px; border-radius: 8px;
          background: rgba(16, 185, 129, 0.06);
          border: 1px solid rgba(16, 185, 129, 0.2);
        }
        .ctc-unassigned-box {
          background: rgba(239, 68, 68, 0.06);
          border: 1px solid rgba(239, 68, 68, 0.2);
        }
        .ctc-without-header {
          display: flex; align-items: center; gap: 6px;
          font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
          color: var(--text-dim); margin-bottom: 8px; letter-spacing: 0.05em;
        }
        .ctc-without-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
        .ctc-item { display: flex; flex-direction: column; gap: 2px; }
        .ctc-item-savings { grid-column: 1 / -1; }
        .ctc-label { font-size: 0.58rem; font-weight: 600; text-transform: uppercase; color: var(--text-dim); }
        .ctc-val { font-family: var(--font-display); font-size: 0.82rem; font-weight: 700; color: var(--text-bright); }
        .ctc-positive { color: #10b981 !important; }
        .ctc-negative { color: #ef4444 !important; }

        /* Constraint notes */
        .constraint-notes { display: flex; flex-direction: column; gap: 5px; }
        .note-chip { display: flex; align-items: flex-start; gap: 6px; padding: 5px 8px; border-radius: 6px; font-size: 0.68rem; line-height: 1.4; }
        .note-chip svg { flex-shrink: 0; margin-top: 1px; }
        .note-error { background: rgba(239,68,68,0.1); color: #f87171; border: 1px solid rgba(239,68,68,0.15); }
        .note-warning { background: rgba(245,158,11,0.1); color: #f59e0b; border: 1px solid rgba(245,158,11,0.15); }
        .note-info { background: rgba(59,130,246,0.08); color: var(--primary); border: 1px solid rgba(59,130,246,0.1); }

        /* Collapsed summary */
        .collapsed-summary {
          display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
          font-size: 0.72rem; color: var(--text-dim);
          padding: 4px 0;
        }
        .cs-item { display: flex; align-items: center; gap: 4px; }
        .cs-pos { color: #10b981; font-weight: 600; }
        .cs-neg { color: #ef4444; font-weight: 600; }
        .cs-hint { margin-left: auto; font-size: 0.65rem; color: var(--text-faded); font-style: italic; }

        /* Unassigned section */
        .unassigned-section { display: flex; flex-direction: column; gap: 12px; }
        .unassigned-section-header {
          display: flex; align-items: center; gap: 10px;
          font-size: 0.85rem; font-weight: 700; color: #ef4444;
          padding: 10px 16px; background: rgba(239,68,68,0.08);
          border: 1px solid rgba(239,68,68,0.2); border-radius: 10px;
        }
      `}</style>
    </div>
  );
}
