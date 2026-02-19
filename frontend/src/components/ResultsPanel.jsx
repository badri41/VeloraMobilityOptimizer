import React from "react";
import { motion } from "framer-motion";
import { List, Info, AlertTriangle, Cpu, Truck, UserCheck, CheckCircle, XCircle, Users, Shield, Clock, DollarSign, Route, TrendingDown } from "lucide-react";
import RoutesTable from "./RoutesTable.jsx";

export default function ResultsPanel({ solution, inputData }) {
  if (!solution) return null;

  if (solution.status === "failed") {
    return (
      <div className="glass-card error-card">
        <AlertTriangle size={32} color="#ef4444" />
        <h3>System Interruption</h3>
        <p>The optimization engine encountered an error: {solution.error}</p>
      </div>
    );
  }

  const data = solution.data;
  if (!data) return null;

  // Compute constraint health from constraintAnalysis
  const constraints = data.constraintAnalysis || [];
  const onTimeCount = constraints.filter((c) => c.overallStatus === "on_time").length;
  const toleranceCount = constraints.filter((c) => c.overallStatus === "within_tolerance").length;
  const violatedCount = constraints.filter((c) => c.overallStatus === "violated").length;
  const unassignedCount = constraints.filter((c) => c.overallStatus === "unassigned").length;
  const vehPrefViolations = constraints.filter((c) => c.vehiclePrefViolated).length;
  const sharingViolations = constraints.filter((c) => c.sharingViolated).length;
  const totalAssigned = constraints.filter((c) => c.overallStatus !== "unassigned").length;

  return (
    <div className="results-panel-v2">
      {/* Constraint Health Summary */}
      {constraints.length > 0 && (
        <div className="glass-card constraint-health-card">
          <div className="constraint-health-header">
            <Shield size={20} color="var(--primary)" />
            <h4>Constraint Compliance Report</h4>
          </div>

          <div className="health-grid">
            <div className="health-item health-green">
              <CheckCircle size={18} />
              <div className="health-info">
                <span className="health-value">{onTimeCount}</span>
                <span className="health-label">On Time</span>
              </div>
            </div>
            <div className="health-item health-yellow">
              <AlertTriangle size={18} />
              <div className="health-info">
                <span className="health-value">{toleranceCount}</span>
                <span className="health-label">Within Tolerance</span>
              </div>
            </div>
            <div className="health-item health-red">
              <XCircle size={18} />
              <div className="health-info">
                <span className="health-value">{violatedCount}</span>
                <span className="health-label">Time Violated</span>
              </div>
            </div>
            {unassignedCount > 0 && (
              <div className="health-item health-red">
                <UserCheck size={18} />
                <div className="health-info">
                  <span className="health-value">{unassignedCount}</span>
                  <span className="health-label">Unassigned</span>
                </div>
              </div>
            )}
            {vehPrefViolations > 0 && (
              <div className="health-item health-orange">
                <Truck size={18} />
                <div className="health-info">
                  <span className="health-value">{vehPrefViolations}</span>
                  <span className="health-label">Vehicle Pref Violated</span>
                </div>
              </div>
            )}
            {sharingViolations > 0 && (
              <div className="health-item health-orange">
                <Users size={18} />
                <div className="health-info">
                  <span className="health-value">{sharingViolations}</span>
                  <span className="health-label">Sharing Violated</span>
                </div>
              </div>
            )}
          </div>

          {violatedCount === 0 && toleranceCount === 0 && vehPrefViolations === 0 && sharingViolations === 0 && unassignedCount === 0 && (
            <div className="all-clear-banner">
              <CheckCircle size={16} />
              <span>All {totalAssigned} employees served within time windows, no constraint violations</span>
            </div>
          )}
        </div>
      )}

      <div className="glass-card summary-grid-v2">
        <div className="summary-header">
          <Cpu size={20} color="var(--primary)" />
          <h4>Operational Metrics</h4>
        </div>

        <div className="summary-stats-v2">
          {[
            { label: "Cost to Company (CTC)", value: `₹${data.summary.totalMoneyCost?.toFixed(0)}`, icon: DollarSign },
            { label: "Total Distance", value: `${data.summary.totalDistance?.toFixed(1)} km`, icon: Route },
            { label: "Vehicles Deployed", value: data.summary.vehiclesUsed || 0, icon: Truck },
            { label: "Employees Served", value: `${totalAssigned} / ${constraints.length}`, icon: UserCheck },
            { label: "Total Travel Time", value: data.summary.totalTime ? `${data.summary.totalTime.toFixed(0)} min` : "N/A", icon: Clock },
          ].filter(Boolean).map((stat, idx) => (
            <div key={idx} className="stat-item-v2">
              <span className="stat-label">{stat.label}</span>
              <span className="stat-value">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cost Savings Banner */}
      {data.summary.totalBaselineCost > 0 && (() => {
        const baseline = data.summary.totalBaselineCost;
        const optimized = data.summary.totalMoneyCost || 0;
        const saving = baseline - optimized;
        const pct = (saving / baseline * 100);
        const baselineTime = data.summary.totalBaselineTime || 0;
        const optTime = data.summary.totalTime || 0;
        const timeSaving = baselineTime - optTime;
        return (
          <div className={`glass-card savings-banner ${saving >= 0 ? "savings-positive" : "savings-negative"}`}>
            <div className="savings-icon">
              <TrendingDown size={28} />
            </div>
            <div className="savings-content">
              <h4>Cost Savings vs Baseline</h4>
              <div className="savings-figures">
                <div className="savings-figure">
                  <span className="savings-amount">{saving >= 0 ? "-" : "+"}₹{Math.abs(saving).toFixed(0)}</span>
                  <span className="savings-pct">({Math.abs(pct).toFixed(1)}% {saving >= 0 ? "saved" : "increase"})</span>
                </div>
                <div className="savings-detail">
                  <span>Baseline: ₹{baseline.toFixed(0)}</span>
                  <span>Optimized: ₹{optimized.toFixed(0)}</span>
                </div>
                {baselineTime > 0 && (
                  <div className="savings-detail">
                    <span>Time: {timeSaving >= 0 ? "-" : "+"}{Math.abs(timeSaving).toFixed(0)} min</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Distance method fallback notice */}
      {data.summary.distanceMethod && data.summary.distanceMethod.fallbackUsed && (
        <div className="glass-card fallback-notice">
          <AlertTriangle size={18} color="#f59e0b" />
          <div className="fallback-text">
            <strong>Distance Approximation Used</strong>
            <span>
              {data.summary.distanceMethod.errorFallbacks > 0
                ? `API errors occurred (${data.summary.distanceMethod.errorFallbacks} calls failed). `
                : `API timeouts occurred (${data.summary.distanceMethod.timeoutFallbacks} calls timed out). `}
              Distances were computed using 1.4 × Haversine as a fallback. Actual road distances may differ.
            </span>
          </div>
        </div>
      )}

      <div className="routes-table-container-v2">
        <div className="container-header">
          <Truck size={20} color="var(--primary)" />
          <h3>Vehicle Dispatch Manifest</h3>
        </div>
        <RoutesTable routes={data.routes} inputData={inputData} />
      </div>

      {((data.unassignedRequests?.length > 0) || (data.unassigned?.length > 0)) && (() => {
        const unassigned = data.unassignedRequests || data.unassigned || [];
        return (
          <div className="glass-card warning-card">
            <div className="warning-header">
              <AlertTriangle size={20} color="#fbbf24" />
              <h3>Unassigned Logistics Targets</h3>
            </div>
            <p>The following requests could not be optimized within current constraints:</p>
            <div className="unassigned-list">
              {unassigned.map((req, index) => {
                // Handle both enriched objects and plain integer IDs
                const label = typeof req === "object" && req !== null
                  ? (req.employeeId || `Req-${req.reqId ?? index}`)
                  : `Req-${req}`;
                return <span key={index} className="unassigned-chip">Target {label}</span>;
              })}
            </div>
          </div>
        );
      })()}

      <style>{`
        .results-panel-v2 { display: flex; flex-direction: column; gap: 24px; }

        /* Constraint Health Card */
        .constraint-health-card { padding: 24px; }
        .constraint-health-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
        .constraint-health-header h4 { font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); }
        .health-grid { display: flex; flex-wrap: wrap; gap: 16px; }
        .health-item { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-radius: 12px; min-width: 140px; }
        .health-green { background: rgba(16, 185, 129, 0.1); color: #10b981; }
        .health-yellow { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
        .health-red { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
        .health-orange { background: rgba(249, 115, 22, 0.1); color: #f97316; }
        .health-info { display: flex; flex-direction: column; }
        .health-value { font-family: var(--font-display); font-size: 1.5rem; font-weight: 700; line-height: 1; }
        .health-label { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-top: 2px; }
        .all-clear-banner { display: flex; align-items: center; gap: 8px; margin-top: 16px; padding: 10px 16px; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; color: #10b981; font-size: 0.8rem; font-weight: 600; }

        /* Summary */
        .summary-grid-v2 { padding: 24px; border-radius: var(--radius-lg); }
        .summary-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
        .summary-header h4 { font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); }
        .summary-stats-v2 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 24px; }
        .stat-item-v2 { display: flex; flex-direction: column; gap: 4px; }
        .stat-label { font-size: 0.7rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; }
        .stat-value { font-family: var(--font-display); font-size: 1.2rem; font-weight: 700; color: var(--text-bright); }

        .routes-table-container-v2 { margin-top: 12px; }
        .container-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding-left: 8px; }
        .container-header h3 { font-size: 1.1rem; }

        .warning-card { border-color: rgba(251, 191, 36, 0.2); background: rgba(251, 191, 36, 0.05); }
        .warning-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .unassigned-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        .unassigned-chip { padding: 4px 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 100px; font-size: 0.75rem; color: #f87171; }

        /* Cost Savings Banner */
        .savings-banner { display: flex; align-items: center; gap: 20px; padding: 20px 24px; }
        .savings-positive { background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); }
        .savings-negative { background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); }
        .savings-icon { width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .savings-positive .savings-icon { background: rgba(16, 185, 129, 0.15); color: #10b981; }
        .savings-negative .savings-icon { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
        .savings-content h4 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); margin-bottom: 8px; }
        .savings-figures { display: flex; align-items: baseline; gap: 20px; flex-wrap: wrap; }
        .savings-figure { display: flex; align-items: baseline; gap: 8px; }
        .savings-amount { font-family: var(--font-display); font-size: 1.8rem; font-weight: 800; }
        .savings-positive .savings-amount { color: #10b981; }
        .savings-negative .savings-amount { color: #ef4444; }
        .savings-pct { font-size: 0.85rem; font-weight: 600; color: var(--text-dim); }
        .savings-detail { display: flex; gap: 16px; font-size: 0.78rem; color: var(--text-dim); }

        /* Fallback notice */
        .fallback-notice { display: flex; align-items: flex-start; gap: 12px; padding: 16px 20px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.2); }
        .fallback-text { display: flex; flex-direction: column; gap: 4px; }
        .fallback-text strong { font-size: 0.85rem; color: #f59e0b; }
        .fallback-text span { font-size: 0.78rem; color: var(--text-dim); line-height: 1.5; }

        @media (max-width: 768px) {
          .summary-stats-v2 { grid-template-columns: repeat(2, 1fr); }
          .health-grid { gap: 8px; }
          .health-item { min-width: 120px; padding: 8px 14px; }
        }
      `}</style>
    </div>
  );
}
