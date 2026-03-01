import React, { useState } from "react";
import { ChevronDown, ChevronUp, MapPin } from "lucide-react";

export const DEFAULT_DISTANCE_METHOD = "osrm";

const OPTIONS = [
  {
    value: "osrm",
    label: "Real-road Distance",
    subtitle: "Accurate road routing via OSRM (1 API call).",
  },
  {
    value: "haversine",
    label: "Straight-line Distance",
    subtitle: "Fast, no API call. Uses crow-flies distance.",
  },
];

export default function DistanceModeForm({ value, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const isModified = value !== DEFAULT_DISTANCE_METHOD;
  const selected = OPTIONS.find((o) => o.value === value) || OPTIONS[0];

  return (
    <div className="dm-container">
      <button
        className={`dm-toggle ${expanded ? "expanded" : ""} ${isModified ? "modified" : ""}`}
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <div className="dm-toggle-left">
          <MapPin size={16} />
          <span>Distance Calculation</span>
          <span className="dm-current-mode">{selected.label}</span>
          {isModified && <span className="dm-modified-badge">Custom</span>}
        </div>
        <div className="dm-toggle-right">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="dm-body">
          <p className="dm-description">
            Choose how distances between stops are calculated. Real-road routing is more
            accurate but requires a network call to OSRM before solving. Straight-line
            (Haversine) is instant and works offline.
          </p>
          <div className="dm-options">
            {OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`dm-option-btn ${value === opt.value ? "active" : ""}`}
                onClick={() => onChange(opt.value)}
                type="button"
              >
                <span className="dm-option-label">{opt.label}</span>
                <span className="dm-option-subtitle">{opt.subtitle}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .dm-container { width: 100%; margin-top: 8px; }
        .dm-toggle {
          width: 100%; display: flex; justify-content: space-between; align-items: center;
          padding: 12px 18px; background: var(--bg-glass); border: 1px solid var(--border-subtle);
          border-radius: 12px; cursor: pointer; transition: all 0.2s; color: var(--text-dim);
        }
        .dm-toggle:hover { border-color: var(--primary); color: var(--text-bright); }
        .dm-toggle.expanded { border-color: var(--primary); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
        .dm-toggle.modified { border-color: rgba(16,185,129,0.4); }
        .dm-toggle-left { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; font-weight: 600; }
        .dm-toggle-right { display: flex; align-items: center; gap: 8px; }
        .dm-current-mode {
          font-size: 0.72rem; padding: 2px 8px; background: rgba(16,185,129,0.12);
          color: #10b981; border-radius: 4px; font-weight: 700;
        }
        .dm-modified-badge { font-size: 0.65rem; padding: 2px 8px; background: rgba(16,185,129,0.15); color: #10b981; border-radius: 4px; font-weight: 700; text-transform: uppercase; }
        .dm-body {
          padding: 16px 18px 20px; background: var(--bg-glass); border: 1px solid var(--primary);
          border-top: none; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;
          display: flex; flex-direction: column; gap: 16px;
        }
        .dm-description { font-size: 0.78rem; color: var(--text-dim); line-height: 1.5; }
        .dm-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .dm-option-btn {
          display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
          padding: 12px 14px; background: var(--bg-surface); border: 1px solid var(--border-subtle);
          border-radius: 8px; cursor: pointer; transition: all 0.2s; color: var(--text-dim); text-align: left;
        }
        .dm-option-btn:hover { border-color: var(--primary); color: var(--text-bright); }
        .dm-option-btn.active { border-color: #10b981; background: rgba(16,185,129,0.08); color: var(--text-bright); }
        .dm-option-label { font-size: 0.82rem; font-weight: 700; }
        .dm-option-subtitle { font-size: 0.68rem; line-height: 1.3; opacity: 0.75; }
        @media (max-width: 480px) { .dm-options { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
