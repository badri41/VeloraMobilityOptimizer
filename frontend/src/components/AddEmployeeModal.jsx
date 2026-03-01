import React, { useState } from "react";
import { X, UserPlus } from "lucide-react";

const VEHICLE_PREFS = ["any", "2w", "4w", "premium", "van"];
const PRIORITIES = [1, 2, 3, 4, 5];

const timeToMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export default function AddEmployeeModal({ onSave, onClose }) {
  const [form, setForm] = useState({
    employeeId: "",
    priority: "3",
    pickupLat: "",
    pickupLon: "",
    dropoffLat: "",
    dropoffLon: "",
    earlyTime: "07:00",
    lateTime: "09:30",
    load: "1",
    vehiclePreference: "any",
    sharingLimit: "3",
  });
  const [error, setError] = useState("");

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const handleSave = () => {
    const required = ["employeeId", "pickupLat", "pickupLon", "dropoffLat", "dropoffLon"];
    for (const k of required) {
      if (!form[k].toString().trim()) {
        setError("Please fill all required fields before saving.");
        return;
      }
    }
    setError("");
    const req = {
      employeeId: form.employeeId.trim(),
      priority: parseInt(form.priority) || 3,
      pickup: { lat: parseFloat(form.pickupLat), lon: parseFloat(form.pickupLon) },
      dropoff: { lat: parseFloat(form.dropoffLat), lon: parseFloat(form.dropoffLon) },
      earlyTime: timeToMinutes(form.earlyTime),
      lateTime: timeToMinutes(form.lateTime),
      load: parseInt(form.load) || 1,
      vehiclePreference: form.vehiclePreference,
      sharingLimit: parseInt(form.sharingLimit) || 100,
    };
    onSave(req);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <div className="modal-title-row">
            <UserPlus size={20} color="var(--primary)" />
            <h3>Add Employee</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          <div className="form-row">
            <label>Employee ID <span className="req">*</span></label>
            <input className="form-input" placeholder="e.g. EMP_042" value={form.employeeId} onChange={(e) => set("employeeId", e.target.value)} />
          </div>

          <div className="form-row">
            <label>Priority <span className="req">*</span></label>
            <select className="form-input" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p} — {["Critical", "High", "Normal", "Low", "Flexible"][p - 1]}</option>)}
            </select>
          </div>

          <div className="form-section-label">Pickup Location <span className="req">*</span></div>
          <div className="form-row-2col">
            <div className="form-row">
              <label>Latitude</label>
              <input className="form-input" type="number" step="0.0001" placeholder="12.9716" value={form.pickupLat} onChange={(e) => set("pickupLat", e.target.value)} />
            </div>
            <div className="form-row">
              <label>Longitude</label>
              <input className="form-input" type="number" step="0.0001" placeholder="77.5946" value={form.pickupLon} onChange={(e) => set("pickupLon", e.target.value)} />
            </div>
          </div>

          <div className="form-section-label">Dropoff Location <span className="req">*</span></div>
          <div className="form-row-2col">
            <div className="form-row">
              <label>Latitude</label>
              <input className="form-input" type="number" step="0.0001" placeholder="12.9352" value={form.dropoffLat} onChange={(e) => set("dropoffLat", e.target.value)} />
            </div>
            <div className="form-row">
              <label>Longitude</label>
              <input className="form-input" type="number" step="0.0001" placeholder="77.6245" value={form.dropoffLon} onChange={(e) => set("dropoffLon", e.target.value)} />
            </div>
          </div>

          <div className="form-row-2col">
            <div className="form-row">
              <label>Earliest Pickup (HH:MM) <span className="req">*</span></label>
              <input className="form-input" type="time" value={form.earlyTime} onChange={(e) => set("earlyTime", e.target.value)} />
            </div>
            <div className="form-row">
              <label>Latest Dropoff (HH:MM) <span className="req">*</span></label>
              <input className="form-input" type="time" value={form.lateTime} onChange={(e) => set("lateTime", e.target.value)} />
            </div>
          </div>

          <div className="form-row-2col">
            <div className="form-row">
              <label>Seats Required</label>
              <input className="form-input" type="number" min="1" max="10" value={form.load} onChange={(e) => set("load", e.target.value)} />
              <span className="form-hint">How many seats this employee occupies — almost always 1. Use &gt;1 only for groups travelling together as one booking.</span>
            </div>
            <div className="form-row">
              <label>Max Co-passengers (Sharing)</label>
              <input className="form-input" type="number" min="1" value={form.sharingLimit} onChange={(e) => set("sharingLimit", e.target.value)} />
              <span className="form-hint">Max number of co-workers allowed in the same vehicle. 1 = solo only.</span>
            </div>
          </div>

          <div className="form-row">
            <label>Vehicle Preference</label>
            <select className="form-input" value={form.vehiclePreference} onChange={(e) => set("vehiclePreference", e.target.value)}>
              {VEHICLE_PREFS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          {error && <p className="modal-error">{error}</p>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Employee</button>
        </div>
      </div>
      <ModalStyles />
    </div>
  );
}

function ModalStyles() {
  return (
    <style>{`
      .modal-overlay {
        position: fixed; inset: 0; z-index: 8000;
        background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center; padding: 24px;
      }
      .modal-box {
        background: var(--bg-surface); border: 1px solid var(--border-subtle);
        border-radius: 20px; width: 100%; max-width: 520px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.5); display: flex; flex-direction: column;
        max-height: 90vh;
      }
      .modal-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 20px 24px; border-bottom: 1px solid var(--border-subtle);
      }
      .modal-title-row { display: flex; align-items: center; gap: 10px; }
      .modal-title-row h3 { font-family: var(--font-display); font-size: 1.1rem; color: var(--text-bright); }
      .modal-close-btn { background: none; border: none; cursor: pointer; color: var(--text-dim); padding: 4px; border-radius: 6px; display: flex; align-items: center; }
      .modal-close-btn:hover { color: var(--text-bright); background: var(--bg-hover); }
      .modal-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
      .modal-footer { padding: 16px 24px; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end; gap: 12px; }
      .form-row { display: flex; flex-direction: column; gap: 6px; }
      .form-row label { font-size: 0.78rem; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
      .form-row-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .form-section-label { font-size: 0.72rem; font-weight: 700; color: var(--primary); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: -6px; }
      .form-input {
        background: var(--bg-glass); border: 1px solid var(--border-subtle);
        border-radius: 8px; padding: 9px 12px; color: var(--text-bright);
        font-size: 0.88rem; outline: none; transition: border-color 0.2s; width: 100%;
      }
      .form-input:focus { border-color: var(--primary); }
      .req { color: #ef4444; margin-left: 2px; }
      .form-hint { font-size: 0.68rem; color: var(--text-dim); line-height: 1.4; margin-top: 2px; }
      .modal-error { color: #f87171; font-size: 0.8rem; padding: 8px 12px; background: rgba(239,68,68,0.08); border-radius: 8px; border: 1px solid rgba(239,68,68,0.2); }
    `}</style>
  );
}
