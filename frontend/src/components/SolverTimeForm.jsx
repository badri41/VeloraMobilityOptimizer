import React, { useState } from "react";
import { ChevronDown, ChevronUp, Clock, RotateCcw } from "lucide-react";

export const DEFAULT_SOLVER_TIME = 30; // seconds

const PRESETS = [
  { label: "Quick", seconds: 15, description: "Fast results, good for small datasets" },
  { label: "Standard", seconds: 30, description: "Balanced speed and quality" },
  { label: "Thorough", seconds: 60, description: "Better optimization, larger datasets" },
  { label: "Maximum", seconds: 120, description: "Best possible results, be patient" },
];

export default function SolverTimeForm({ value, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const isModified = value !== DEFAULT_SOLVER_TIME;

  const handleReset = (e) => {
    e.stopPropagation();
    onChange(DEFAULT_SOLVER_TIME);
  };

  return (
    <div className="solver-time-container">
      <button
        className={`solver-time-toggle ${expanded ? "expanded" : ""} ${isModified ? "modified" : ""}`}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <div className="st-toggle-left">
          <Clock size={16} />
          <span>Optimization Runtime</span>
          <span className="st-current-time">{value}s</span>
          {isModified && <span className="modified-badge">Custom</span>}
        </div>
        <div className="st-toggle-right">
          {isModified && (
            <button className="st-reset-btn" onClick={handleReset} title="Reset to default" type="button">
              <RotateCcw size={13} />
              Reset
            </button>
          )}
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="solver-time-body">
          <p className="st-description">
            Control how long the optimizer runs. More time = better results, especially for
            large datasets. The solver uses 4 phases: construction, simulated annealing,
            large neighborhood search, and post-processing polish. Minimum 10s, maximum 300s.
          </p>

          <div className="st-presets">
            {PRESETS.map(({ label, seconds, description }) => (
              <button
                key={label}
                className={`st-preset-btn ${value === seconds ? "active" : ""}`}
                onClick={() => onChange(seconds)}
                type="button"
              >
                <span className="st-preset-label">{label}</span>
                <span className="st-preset-seconds">{seconds}s</span>
                <span className="st-preset-desc">{description}</span>
              </button>
            ))}
          </div>

          <div className="st-slider-wrap">
            <label htmlFor="solver-time-slider" className="st-slider-label">
              Custom: {value}s
            </label>
            <input
              id="solver-time-slider"
              type="range"
              min={10}
              max={300}
              step={5}
              value={value}
              onChange={(e) => onChange(Number(e.target.value))}
              className="st-slider"
            />
            <div className="st-slider-markers">
              <span>10s</span>
              <span>60s</span>
              <span>120s</span>
              <span>180s</span>
              <span>300s</span>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .solver-time-container { width: 100%; margin-top: 8px; }
        .solver-time-toggle {
          width: 100%; display: flex; justify-content: space-between; align-items: center;
          padding: 12px 18px; background: var(--bg-glass); border: 1px solid var(--border-subtle);
          border-radius: 12px; cursor: pointer; transition: all 0.2s; color: var(--text-dim);
        }
        .solver-time-toggle:hover { border-color: var(--primary); color: var(--text-bright); }
        .solver-time-toggle.expanded { border-color: var(--primary); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
        .solver-time-toggle.modified { border-color: rgba(59,130,246,0.4); }
        .st-toggle-left { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; font-weight: 600; }
        .st-toggle-right { display: flex; align-items: center; gap: 8px; }
        .st-current-time {
          font-size: 0.72rem; padding: 2px 8px; background: rgba(59,130,246,0.12);
          color: #3b82f6; border-radius: 4px; font-weight: 700; font-family: var(--font-display);
        }
        .modified-badge { font-size: 0.65rem; padding: 2px 8px; background: rgba(59,130,246,0.15); color: #3b82f6; border-radius: 4px; font-weight: 700; text-transform: uppercase; }
        .st-reset-btn { display: inline-flex; align-items: center; gap: 4px; font-size: 0.7rem; color: var(--text-dim); background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); padding: 3px 8px; border-radius: 4px; cursor: pointer; transition: background 0.2s; }
        .st-reset-btn:hover { background: rgba(239,68,68,0.2); color: #f87171; }
        .solver-time-body {
          padding: 16px 18px 20px; background: var(--bg-glass); border: 1px solid var(--primary);
          border-top: none; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;
          display: flex; flex-direction: column; gap: 16px;
        }
        .st-description { font-size: 0.78rem; color: var(--text-dim); line-height: 1.5; }
        .st-presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .st-preset-btn {
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          padding: 10px 6px; background: var(--bg-surface); border: 1px solid var(--border-subtle);
          border-radius: 8px; cursor: pointer; transition: all 0.2s; color: var(--text-dim);
        }
        .st-preset-btn:hover { border-color: var(--primary); color: var(--text-bright); }
        .st-preset-btn.active { border-color: #3b82f6; background: rgba(59,130,246,0.1); color: var(--text-bright); }
        .st-preset-label { font-size: 0.78rem; font-weight: 700; }
        .st-preset-seconds { font-size: 0.85rem; font-weight: 800; color: #3b82f6; font-family: var(--font-display); }
        .st-preset-desc { font-size: 0.6rem; text-align: center; line-height: 1.3; opacity: 0.7; }
        .st-slider-wrap { display: flex; flex-direction: column; gap: 6px; }
        .st-slider-label { font-size: 0.78rem; font-weight: 700; color: var(--text-bright); }
        .st-slider {
          width: 100%; height: 6px; border-radius: 3px; appearance: none;
          background: linear-gradient(to right, #3b82f6 0%, #8b5cf6 50%, #ef4444 100%);
          outline: none; cursor: pointer;
        }
        .st-slider::-webkit-slider-thumb {
          appearance: none; width: 18px; height: 18px; border-radius: 50%;
          background: #3b82f6; border: 2px solid var(--bg-surface); cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        .st-slider-markers { display: flex; justify-content: space-between; font-size: 0.65rem; color: var(--text-dim); }
        @media (max-width: 640px) { .st-presets { grid-template-columns: repeat(2, 1fr); } }
      `}</style>
    </div>
  );
}
