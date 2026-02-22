import React, { useState } from "react";
import { ChevronDown, ChevronUp, Settings2, RotateCcw } from "lucide-react";

export const DEFAULT_PENALTY_WEIGHTS = {
  lateArrivalPenaltyPerMin: 0,
  sharingViolationPenalty: 0,
  vehiclePrefViolationPenalty: 0,
  unassignedPenalty: 100000,
  maxDelayViolationPenalty: 50000,
};

const PENALTY_FIELDS = [
  {
    key: "lateArrivalPenaltyPerMin",
    label: "Late Arrival (per minute)",
    description: "Cost per minute an employee's pickup/dropoff exceeds their time window",
    min: 0,
    step: 1,
  },
  {
    key: "sharingViolationPenalty",
    label: "Sharing Limit Violation",
    description: "Penalty when more co-passengers share a vehicle than the employee requested",
    min: 0,
    step: 100,
  },
  {
    key: "vehiclePrefViolationPenalty",
    label: "Vehicle Preference Violation",
    description: "Penalty when an employee is assigned a vehicle type different from their preference",
    min: 0,
    step: 100,
  },
  {
    key: "unassignedPenalty",
    label: "Unassigned Employee",
    description: "Heavy penalty to ensure every employee is served; raise to prioritise assignment over other metrics",
    min: 0,
    step: 5000,
  },
  {
    key: "maxDelayViolationPenalty",
    label: "Hard Time Window Violation",
    description: "Extreme penalty when an employee is served beyond their late-time plus tolerance window",
    min: 0,
    step: 10000,
  },
];

export default function PenaltyForm({ weights, onChange }) {
  const [expanded, setExpanded] = useState(false);

  const isModified = Object.keys(DEFAULT_PENALTY_WEIGHTS).some(
    (k) => weights[k] !== DEFAULT_PENALTY_WEIGHTS[k]
  );

  const handleReset = (e) => {
    e.stopPropagation();
    onChange({ ...DEFAULT_PENALTY_WEIGHTS });
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
