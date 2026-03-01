import React, { useState } from "react";
import { ChevronDown, ChevronUp, Settings2, RotateCcw } from "lucide-react";

// Recommended defaults based on typical enterprise fleet costs (INR).
// Late arrival: ₹15/min is realistic — a 10-min delay costs ₹150, comparable to a short detour.
// Sharing violation: ₹500 is meaningful but not so high it blocks good routes.
// Vehicle preference: ₹300 — soft preference, allows overrides when needed.
// Max delay violation: ₹50,000 — strong but allows forced-assign as a last resort.
export const DEFAULT_PENALTY_WEIGHTS = {
  lateArrivalPenaltyPerMin: 15,
  sharingViolationPenalty: 500,
  vehiclePrefViolationPenalty: 300,
  maxDelayViolationPenalty: 50000,
};

const PENALTY_FIELDS = [
  {
    key: "lateArrivalPenaltyPerMin",
    label: "Late Arrival Penalty (per minute)",
    description: "Added cost per minute an employee is picked up or dropped off after their time window. ₹15/min = a 10-minute delay costs ₹150 — similar to a short detour.",
    min: 0,
    step: 5,
  },
  {
    key: "sharingViolationPenalty",
    label: "Sharing Limit Violation (per occurrence)",
    description: "Penalty when the number of co-passengers exceeds what the employee requested. Raise this if sharing preferences are critical; lower it to allow more aggressive ride-pooling.",
    min: 0,
    step: 100,
  },
  {
    key: "vehiclePrefViolationPenalty",
    label: "Vehicle Preference Violation (per employee)",
    description: "Penalty when an employee is assigned a vehicle category different from their preference (e.g., premium vs. normal). Keep this moderate — it is a soft preference, not a hard rule.",
    min: 0,
    step: 50,
  },
  {
    key: "maxDelayViolationPenalty",
    label: "Hard Time Window Breach (per employee)",
    description: "Applied when an employee is served past their late-time plus the priority tolerance window. This is the solver's last guardrail — keep it significantly higher than lateArrivalPenaltyPerMin.",
    min: 0,
    step: 10000,
  },
];

export default function PenaltyForm({ weights, onChange, forceAssign, onForceAssignChange }) {
  const [expanded, setExpanded] = useState(false);

  const isModified = Object.keys(DEFAULT_PENALTY_WEIGHTS).some(
    (k) => weights[k] !== DEFAULT_PENALTY_WEIGHTS[k]
  ) || forceAssign !== true;

  const handleReset = (e) => {
    e.stopPropagation();
    onChange({ ...DEFAULT_PENALTY_WEIGHTS });
    onForceAssignChange(true);
  };

  return (
    <div className="penalty-form-container">
      <button
        className={`penalty-form-toggle ${expanded ? "expanded" : ""} ${isModified ? "modified" : ""}`}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <div className="pf-toggle-left">
          <Settings2 size={16} />
          <span>Constraint Penalty Weights</span>
          {isModified && <span className="modified-badge">Custom</span>}
        </div>
        <div className="pf-toggle-right">
          {isModified && (
            <button className="pf-reset-btn" onClick={handleReset} title="Reset to defaults" type="button">
              <RotateCcw size={13} />
              Reset
            </button>
          )}
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="penalty-form-body">
          <p className="pf-description">
            Adjust how strongly the optimizer penalises each soft constraint violation.
            Higher values make the solver avoid that violation more aggressively.
            These do <strong>not</strong> affect real monetary costs.
          </p>

          <div className="pf-force-assign-row">
            <label className="pf-force-assign-label">
              <input
                type="checkbox"
                checked={forceAssign}
                onChange={(e) => onForceAssignChange(e.target.checked)}
                className="pf-force-assign-check"
              />
              <span className="pf-label">Force Assign Unserved Employees</span>
            </label>
            <span className="pf-desc">
              When enabled, the optimizer will assign every employee to a vehicle even if their
              time window cannot be fully met. Disable this to let the optimizer leave
              difficult-to-serve employees unassigned — they will be clearly flagged in results.
            </span>
          </div>

          <div className="pf-fields">
            {PENALTY_FIELDS.map(({ key, label, description, min, step }) => (
              <div key={key} className="pf-field">
                <div className="pf-field-info">
                  <label htmlFor={`pf-${key}`} className="pf-label">{label}</label>
                  <span className="pf-desc">{description}</span>
                </div>
                <div className="pf-input-wrap">
                  <span className="pf-rupee">₹</span>
                  <input
                    id={`pf-${key}`}
                    type="number"
                    min={min}
                    step={step}
                    value={weights[key]}
                    onChange={(e) => {
                      const val = Math.max(min, Number(e.target.value) || 0);
                      onChange({ ...weights, [key]: val });
                    }}
                    className="pf-input"
                  />
                  {weights[key] !== DEFAULT_PENALTY_WEIGHTS[key] && DEFAULT_PENALTY_WEIGHTS[key] > 0 && (
                    <span className="pf-default-note">default: ₹{DEFAULT_PENALTY_WEIGHTS[key].toLocaleString()}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .penalty-form-container { width: 100%; }
        .penalty-form-toggle {
          width: 100%; display: flex; justify-content: space-between; align-items: center;
          padding: 12px 18px; background: var(--bg-glass); border: 1px solid var(--border-subtle);
          border-radius: 12px; cursor: pointer; transition: all 0.2s; color: var(--text-dim);
        }
        .penalty-form-toggle:hover { border-color: var(--primary); color: var(--text-bright); }
        .penalty-form-toggle.expanded { border-color: var(--primary); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
        .penalty-form-toggle.modified { border-color: rgba(168,85,247,0.4); }
        .pf-toggle-left { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; font-weight: 600; }
        .pf-toggle-right { display: flex; align-items: center; gap: 8px; }
        .modified-badge { font-size: 0.65rem; padding: 2px 8px; background: rgba(168,85,247,0.15); color: #a855f7; border-radius: 4px; font-weight: 700; text-transform: uppercase; }
        .pf-reset-btn { display: inline-flex; align-items: center; gap: 4px; font-size: 0.7rem; color: var(--text-dim); background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); padding: 3px 8px; border-radius: 4px; cursor: pointer; transition: background 0.2s; }
        .pf-reset-btn:hover { background: rgba(239,68,68,0.2); color: #f87171; }
        .penalty-form-body {
          padding: 16px 18px 20px; background: var(--bg-glass); border: 1px solid var(--primary);
          border-top: none; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;
          display: flex; flex-direction: column; gap: 16px;
        }
        .pf-description { font-size: 0.78rem; color: var(--text-dim); line-height: 1.5; }
        .pf-force-assign-row { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; background: rgba(59,130,246,0.06); border: 1px solid rgba(59,130,246,0.15); border-radius: 8px; }
        .pf-force-assign-label { display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .pf-force-assign-check { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; flex-shrink: 0; }
        .pf-fields { display: flex; flex-direction: column; gap: 12px; }
        .pf-field { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
        .pf-field-info { flex: 1; min-width: 180px; }
        .pf-label { font-size: 0.78rem; font-weight: 700; color: var(--text-bright); display: block; margin-bottom: 2px; }
        .pf-desc { font-size: 0.7rem; color: var(--text-dim); line-height: 1.4; }
        .pf-input-wrap { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .pf-rupee { font-size: 0.85rem; color: var(--text-dim); }
        .pf-input {
          width: 120px; padding: 7px 10px; background: var(--bg-surface); border: 1px solid var(--border-subtle);
          border-radius: 8px; color: var(--text-bright); font-size: 0.85rem; font-family: var(--font-display);
          text-align: right; transition: border-color 0.2s;
        }
        .pf-input:focus { outline: none; border-color: var(--primary); }
        .pf-default-note { font-size: 0.65rem; color: var(--text-dim); white-space: nowrap; }
      `}</style>
    </div>
  );
}
