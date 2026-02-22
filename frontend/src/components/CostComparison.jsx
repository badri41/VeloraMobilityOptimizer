import React, { useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, DollarSign, Activity, PieChart, BarChart3, ShieldCheck, ChevronDown, ChevronUp, Info } from "lucide-react";

export default function CostComparison({ solution, inputData }) {
  const [showPenaltyBreakdown, setShowPenaltyBreakdown] = useState(false);

  if (!solution || solution.status !== "completed") return null;

  const data = solution.data;
  const optimizedCost = data.summary?.totalMoneyCost || 0;
  
  let baselineCost = 0;
  if (inputData?.baseline?.length) {
    baselineCost = inputData.baseline.reduce((sum, b) => sum + (b.baseline_cost || 0), 0);
  }

  const hasBaseline = baselineCost > 0;
  const savings = hasBaseline ? baselineCost - optimizedCost : 0;
  const savingsPercent = hasBaseline ? ((savings / baselineCost) * 100).toFixed(1) : 0;

  const totalPenaltyCost = data.summary?.totalPenaltyCost || 0;
  const constraints = data.constraintAnalysis || [];
  const unassignedConstraints = constraints.filter((c) => c.overallStatus === "unassigned");
  const violatedConstraints = constraints.filter((c) => c.overallStatus === "violated");
  const vehPrefConstraints = constraints.filter((c) => c.vehiclePrefViolated);
  const sharingConstraints = constraints.filter((c) => c.sharingViolated);
  const unassignedCount = unassignedConstraints.length;
  const violatedCount = violatedConstraints.length;
  const vehPrefViolations = vehPrefConstraints.length;
  const sharingViolations = sharingConstraints.length;

  // Use solver-reported penalty weights if available, otherwise fall back to defaults
  const solverWeights = data.summary?.penaltyWeightsUsed || {};

  // Objective function weights
  const objWeights = data.summary?.objectiveWeightsUsed || { wCost: 0.7, wTime: 0.3 };
  const wCostPct = Math.round(objWeights.wCost * 100);
  const wTimePct = Math.round(objWeights.wTime * 100);
  const UNASSIGNED_PENALTY = solverWeights.unassignedPenalty ?? 100000;
  const LATE_VIOLATION_PENALTY = solverWeights.maxDelayViolationPenalty ?? 50000;
  const SHARING_PENALTY = solverWeights.sharingViolationPenalty ?? 0;
  const VEH_PREF_PENALTY = solverWeights.vehiclePrefViolationPenalty ?? 0;
  const LATE_PER_MIN = solverWeights.lateArrivalPenaltyPerMin ?? 0;

  // Exact per-employee violation penalty using the solver's formula:
  //   excessMinutes × (maxDelayViolationPenalty / 100) × priorityWeight
  //   where priorityWeight = (6 - priority) × 10  (P1→50, P2→40, P3→30, P4→20, P5→10)
  const getPriorityWeight = (p) => (6 - Math.max(1, Math.min(5, p))) * 10;
  const violatedDetails = violatedConstraints.map((c) => {
    const toleranceDeadline = (c.lateTime ?? 0) + (c.maxDelay ?? 0);
    const excessMinutes = Math.max(0, (c.dropoffArrival ?? 0) - toleranceDeadline);
    const rate = LATE_VIOLATION_PENALTY / 100;
    const pw = getPriorityWeight(c.priority ?? 3);
    const amount = excessMinutes * rate * pw;
    return { employeeId: c.employeeId, excessMinutes, rate, pw, amount, priority: c.priority };
  });
  const violatedSubtotal = violatedDetails.reduce((s, d) => s + d.amount, 0);

  const penaltyBreakdown = [
    { label: "Unassigned employees", count: unassignedCount, weight: UNASSIGNED_PENALTY, subtotal: unassignedCount * UNASSIGNED_PENALTY, color: "#ef4444" },
    violatedCount > 0 && { label: "Hard time window violations", count: violatedCount, subtotal: violatedSubtotal, color: "#f87171", details: violatedDetails },
    { label: "Sharing limit violations", count: sharingViolations, weight: SHARING_PENALTY, subtotal: sharingViolations * SHARING_PENALTY, color: "#f97316", note: "≈ per-event; may differ from solver" },
    { label: "Vehicle pref. violations", count: vehPrefViolations, weight: VEH_PREF_PENALTY, subtotal: vehPrefViolations * VEH_PREF_PENALTY, color: "#a855f7" },
  ].filter(Boolean).filter((p) => p.count > 0);

  return (
    <div className="cost-comparison-v2">
      <div className="grid grid-cols-2">
        <div className="glass-card cost-analysis-card">
          <div className="card-header">
            <PieChart size={20} color="var(--primary)" />
            <h3>Economic Efficiency</h3>
          </div>
          
          <div className="cost-visual-grid">
            {hasBaseline && (
              <div className="cost-stat baseline">
                <span className="label">Baseline (Estimated)</span>
                <span className="value">₹{baselineCost.toLocaleString()}</span>
              </div>
            )}
            <div className="cost-stat optimized">
              <span className="label">Velora Optimized</span>
              <span className="value">₹{optimizedCost.toLocaleString()}</span>
            </div>
          </div>

          {hasBaseline && (
            <div className="savings-infographic">
              <div className="savings-circle">
                <TrendingUp size={24} />
                <span className="percent">{savingsPercent}%</span>
                <span className="label">Saved</span>
              </div>
              <div className="savings-details">
                <p>Reduced logistics overhead by <strong>₹{savings.toLocaleString()}</strong> through intelligent routing.</p>
              </div>
            </div>
          )}
        </div>

        <div className="glass-card breakdown-card">
          <div className="card-header">
            <Activity size={20} color="var(--secondary)" />
            <h3>Operational Metrics</h3>
          </div>
          <div className="breakdown-list-v2">
            {[
              { label: "Fuel & Distance", value: `₹${(data.summary?.totalMoneyCost || 0).toFixed(0)}`, icon: DollarSign },
              { label: "Fleet Utilization", value: `${data.summary?.vehiclesUsed || 0} active`, icon: BarChart3 },
              { label: "Unassigned Assets", value: data.summary?.unassignedCount || 0, icon: Activity }
            ].map((item, idx) => (
              <div key={idx} className="breakdown-item-v2">
                <div className="item-left">
                  <item.icon size={16} />
                  <span>{item.label}</span>
                </div>
                <span className="item-value">{item.value}</span>
              </div>
            ))}

            {/* Constraint Penalties — expandable */}
            <div className="breakdown-item-v2 penalty-row" onClick={() => setShowPenaltyBreakdown(!showPenaltyBreakdown)} style={{ cursor: "pointer" }}>
              <div className="item-left">
                <ShieldCheck size={16} />
                <span>Constraint Penalties</span>
                <span style={{ fontSize: "0.65rem", color: "var(--text-dim)", fontStyle: "italic" }}>Contributing Factors</span>
                <span className="penalty-info-tag">
                  <Info size={11} /> What's this?
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="item-value" style={{ color: totalPenaltyCost > 0 ? "#f87171" : "var(--text-bright)" }}>
                  ₹{totalPenaltyCost.toLocaleString()}
                </span>
                {showPenaltyBreakdown ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </div>
            </div>

            {showPenaltyBreakdown && (
              <div className="penalty-breakdown-panel">
                <p className="penalty-explanation">
                  The optimizer adds <strong>virtual penalty costs</strong> to discourage soft constraint violations — they guide the algorithm towards better solutions but are not real monetary charges. Only the <em>Fuel &amp; Distance</em> cost above represents actual spend.
                </p>
                {penaltyBreakdown.length === 0 ? (
                  <p className="penalty-all-clear">No constraint violations — all penalties are zero.</p>
                ) : (
                  <>
                    <div className="penalty-items">
                      {penaltyBreakdown.map((p, i) => (
                        <div key={i} className="penalty-item-block">
                          <div className="penalty-item">
                            <div className="penalty-item-left">
                              <span className="penalty-dot" style={{ background: p.color }} />
                              <span className="penalty-item-label">{p.label}</span>
                              <span className="penalty-item-count">×{p.count}</span>
                            </div>
                            <div className="penalty-item-right">
                              {p.details ? (
                                <span className="penalty-subtotal" style={{ color: p.color }}>≈ ₹{p.subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                              ) : (
                                <>
                                  <span className="penalty-weight">@ ₹{p.weight.toLocaleString()}{p.note ? ` (${p.note})` : ""}</span>
                                  <span className="penalty-subtotal" style={{ color: p.color }}>₹{p.subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                                </>
                              )}
                            </div>
                          </div>
                          {p.details && p.details.length > 0 && (
                            <div className="penalty-detail-rows">
                              {p.details.map((d, di) => (
                                <div key={di} className="penalty-detail-row">
                                  <span className="pdr-emp">{d.employeeId}</span>
                                  <span className="pdr-formula">
                                    {d.excessMinutes.toFixed(1)} min × ₹{d.rate.toLocaleString()}/min × P{d.priority}(×{d.pw})
                                  </span>
                                  <span className="pdr-amount" style={{ color: p.color }}>
                                    ₹{d.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  </span>
                                </div>
                              ))}
                              <div className="pdr-note">Formula: excess min × (maxDelay÷100) × priorityWeight — computed from solver's stop arrival times</div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="penalty-reconcile">
                      <span>Solver-computed total (exact):</span>
                      <strong>₹{totalPenaltyCost.toLocaleString()}</strong>
                    </div>
                  </>
                )}
                <div className="penalty-weights-note">
                  <strong>{Object.keys(solverWeights).length > 0 ? "Penalty weights used by this run:" : "Default penalty weights (configurable):"}</strong>
                  <ul>
                    <li>Unassigned employee: ₹{UNASSIGNED_PENALTY.toLocaleString()} (ensures everyone is served)</li>
                    <li>Hard time window violation: ₹{LATE_VIOLATION_PENALTY.toLocaleString()} — per excess-minute × priority weight (P1×50 … P5×10)</li>
                    {LATE_PER_MIN > 0 && <li>Late arrival: ₹{LATE_PER_MIN} per minute past deadline</li>}
                    {SHARING_PENALTY > 0 && <li>Sharing limit exceeded: ₹{SHARING_PENALTY.toLocaleString()} per occurrence</li>}
                    {VEH_PREF_PENALTY > 0 && <li>Vehicle preference mismatch: ₹{VEH_PREF_PENALTY.toLocaleString()} per request</li>}
                  </ul>
                  <p className="penalty-note-footer">
                    <strong>Example:</strong> If 6 employees unassigned → 6 × ₹{UNASSIGNED_PENALTY.toLocaleString()} = ₹{(6 * UNASSIGNED_PENALTY).toLocaleString()}. If an employee 72 min late (P1) → 72 × ₹{(LATE_VIOLATION_PENALTY/100).toLocaleString()} × 50 = ₹{(72 * LATE_VIOLATION_PENALTY / 100 * 50).toLocaleString()}. These are virtual costs that guide the optimizer, not real charges.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Objective Function Weights */}
          <div className="obj-weights-panel">
            <div className="obj-weights-title">Objective Function</div>
            <div className="obj-formula">
              minimize &nbsp;<strong>W<sub>C</sub></strong> × Cost &nbsp;+&nbsp; <strong>W<sub>T</sub></strong> × Time &nbsp;+&nbsp; Penalties
            </div>
            <div className="obj-chips">
              <div className="obj-chip obj-chip-cost">
                <span className="obj-chip-label">W<sub>C</sub></span>
                <span className="obj-chip-value">{wCostPct}%</span>
              </div>
              <div className="obj-chip obj-chip-time">
                <span className="obj-chip-label">W<sub>T</sub></span>
                <span className="obj-chip-value">{wTimePct}%</span>
              </div>
            </div>
            <div className="obj-bar-track">
              <div className="obj-bar-cost" style={{ width: `${wCostPct}%` }} title={`Cost weight: ${wCostPct}%`} />
              <div className="obj-bar-time" style={{ width: `${wTimePct}%` }} title={`Time weight: ${wTimePct}%`} />
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .cost-comparison-v2 { padding: 8px; }
        .card-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
        .card-header h3 { font-size: 1.1rem; }
        .cost-visual-grid { display: grid; gap: 16px; margin-bottom: 32px; }
        .cost-stat { padding: 20px; border-radius: 16px; display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--border-subtle); }
        .cost-stat.baseline { background: rgba(0,0,0,0.1); }
        .cost-stat.optimized { background: var(--primary-glow); border-color: var(--primary); }
        .cost-stat .label { font-size: 0.7rem; font-weight: 700; color: var(--text-dim); text-transform: uppercase; }
        .cost-stat .value { font-family: var(--font-display); font-size: 1.5rem; font-weight: 700; color: var(--text-bright); }
        
        .savings-infographic { display: flex; align-items: center; gap: 24px; padding: 20px; background: var(--bg-glass); border-radius: 16px; border: 1px solid var(--border-subtle); }
        .savings-circle { width: 80px; height: 80px; border-radius: 50%; border: 4px solid var(--accent); display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--accent); }
        .savings-circle .percent { font-family: var(--font-display); font-weight: 800; font-size: 1.1rem; line-height: 1; }
        .savings-circle .label { font-size: 0.6rem; text-transform: uppercase; font-weight: 700; }
        .savings-details { flex: 1; font-size: 0.9rem; color: var(--text-dim); }
        
        .breakdown-list-v2 { display: flex; flex-direction: column; gap: 12px; }
        .breakdown-item-v2 { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; background: rgba(0,0,0,0.2); border-radius: 12px; border: 1px solid var(--border-subtle); }
        .item-left { display: flex; align-items: center; gap: 12px; font-size: 0.85rem; color: var(--text-dim); }
        .item-value { font-family: var(--font-display); font-weight: 700; color: var(--text-bright); }
        .penalty-row:hover { background: rgba(255,255,255,0.04) !important; }
        .penalty-info-tag { display: inline-flex; align-items: center; gap: 3px; font-size: 0.65rem; color: var(--primary); background: var(--primary-glow); padding: 2px 6px; border-radius: 4px; margin-left: 4px; }
        .penalty-breakdown-panel { padding: 14px 16px; background: rgba(239,68,68,0.04); border: 1px solid rgba(239,68,68,0.15); border-radius: 10px; margin-top: -6px; display: flex; flex-direction: column; gap: 12px; }
        .penalty-explanation { font-size: 0.78rem; color: var(--text-dim); line-height: 1.5; }
        .penalty-all-clear { font-size: 0.78rem; color: #10b981; font-weight: 600; }
        .penalty-items { display: flex; flex-direction: column; gap: 8px; }
        .penalty-item-block { display: flex; flex-direction: column; gap: 4px; }
        .penalty-item { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; padding: 8px 10px; background: rgba(0,0,0,0.15); border-radius: 8px; }
        .penalty-detail-rows { padding: 6px 10px 8px 22px; background: rgba(0,0,0,0.1); border-radius: 0 0 8px 8px; border: 1px solid rgba(255,255,255,0.04); border-top: none; display: flex; flex-direction: column; gap: 4px; }
        .penalty-detail-row { display: flex; align-items: center; gap: 8px; font-size: 0.72rem; }
        .pdr-emp { font-weight: 700; color: var(--text-bright); min-width: 64px; }
        .pdr-formula { flex: 1; color: var(--text-dim); font-family: monospace; }
        .pdr-amount { font-family: var(--font-display); font-weight: 700; font-size: 0.8rem; }
        .pdr-note { font-size: 0.66rem; color: var(--text-faded); font-style: italic; margin-top: 4px; }
        .penalty-item-left { display: flex; align-items: center; gap: 8px; }
        .penalty-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .penalty-item-label { font-size: 0.78rem; color: var(--text-bright); }
        .penalty-item-count { font-size: 0.72rem; color: var(--text-dim); font-family: monospace; background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 4px; }
        .penalty-item-right { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
        .penalty-weight { font-size: 0.68rem; color: var(--text-dim); }
        .penalty-subtotal { font-family: var(--font-display); font-size: 0.88rem; font-weight: 700; }
        .penalty-weights-note { font-size: 0.73rem; color: var(--text-dim); border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; line-height: 1.6; }
        .penalty-weights-note strong { color: var(--text-bright); }
        .penalty-weights-note ul { margin: 6px 0 6px 14px; padding: 0; }
        .penalty-weights-note li { margin-bottom: 2px; }
        .penalty-note-footer { margin-top: 8px; font-size: 0.75rem; color: var(--text-dim); }
        .penalty-reconcile { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.25); border-radius: 8px; font-size: 0.78rem; color: var(--text-dim); }
        .penalty-reconcile strong { color: #10b981; font-family: var(--font-display); font-size: 0.9rem; }

        /* Objective weights */
        .obj-weights-panel { margin-top: 16px; padding: 14px 16px; background: rgba(59,130,246,0.05); border: 1px solid rgba(59,130,246,0.15); border-radius: 10px; display: flex; flex-direction: column; gap: 10px; }
        .obj-weights-title { font-size: 0.62rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); }
        .obj-formula { font-size: 0.8rem; color: var(--text-dim); }
        .obj-formula strong { color: var(--text-bright); }
        .obj-chips { display: flex; gap: 10px; }
        .obj-chip { display: flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 8px; font-size: 0.8rem; }
        .obj-chip-cost { background: rgba(37,99,235,0.15); border: 1px solid rgba(37,99,235,0.3); color: #60a5fa; }
        .obj-chip-time { background: rgba(139,92,246,0.15); border: 1px solid rgba(139,92,246,0.3); color: #a78bfa; }
        .obj-chip-label { font-size: 0.72rem; color: var(--text-dim); }
        .obj-chip-value { font-family: var(--font-display); font-weight: 700; font-size: 1rem; }
        .obj-bar-track { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(255,255,255,0.06); }
        .obj-bar-cost { background: #2563eb; border-radius: 3px 0 0 3px; transition: width 0.4s; }
        .obj-bar-time { background: #7c3aed; border-radius: 0 3px 3px 0; transition: width 0.4s; }
      `}</style>
    </div>
  );
}
