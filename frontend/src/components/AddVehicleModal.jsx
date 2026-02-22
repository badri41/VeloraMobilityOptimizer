import React, { useState } from "react";
import { X, Truck } from "lucide-react";

const VEHICLE_TYPES = ["any", "2w", "4w", "van"];
const CATEGORIES = ["normal", "premium"];
const FUEL_TYPES = ["petrol", "diesel", "electric", "cng"];

const timeToMinutes = (hhmm) => {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export default function AddVehicleModal({ onSave, onClose }) {
  const [form, setForm] = useState({
    vehicleId: "",
    capacity: "",
    costPerKm: "",
    startLat: "",
    startLon: "",
    availabilityTime: "00:00",
    speed: "30",
    type: "4w",
    category: "normal",
    fuelType: "petrol",
  });
  const [error, setError] = useState("");

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  const handleSave = () => {
    const required = ["vehicleId", "capacity", "costPerKm", "startLat", "startLon"];
    for (const k of required) {
      if (!form[k].toString().trim()) {
        setError("Please fill all required fields before saving.");
        return;
      }
    }
    setError("");
    const veh = {
      vehicleId: form.vehicleId.trim(),
      capacity: parseInt(form.capacity),
      costPerKm: parseFloat(form.costPerKm),
      startLocation: { lat: parseFloat(form.startLat), lon: parseFloat(form.startLon) },
      availabilityTime: timeToMinutes(form.availabilityTime),
      speed: parseFloat(form.speed) || 30,
      type: form.type,
      category: form.category,
      fuelType: form.fuelType,
    };
    onSave(veh);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <div className="modal-title-row">
            <Truck size={20} color="var(--primary)" />
            <h3>Add Vehicle</h3>
          </div>
          <button className="modal-close-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          <div className="form-row">
            <label>Vehicle ID <span className="req">*</span></label>
            <input className="form-input" placeholder="e.g. VEH_007" value={form.vehicleId} onChange={(e) => set("vehicleId", e.target.value)} />
          </div>

          <div className="form-row-2col">
            <div className="form-row">
              <label>Capacity (seats) <span className="req">*</span></label>
              <input className="form-input" type="number" min="1" placeholder="4" value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
            </div>
            <div className="form-row">
              <label>Cost per km (₹) <span className="req">*</span></label>
              <input className="form-input" type="number" step="0.1" min="0" placeholder="15" value={form.costPerKm} onChange={(e) => set("costPerKm", e.target.value)} />
            </div>
          </div>

          <div className="form-section-label">Start Location <span className="req">*</span></div>
          <div className="form-row-2col">
            <div className="form-row">
              <label>Latitude</label>
              <input className="form-input" type="number" step="0.0001" placeholder="12.9716" value={form.startLat} onChange={(e) => set("startLat", e.target.value)} />
            </div>
            <div className="form-row">
              <label>Longitude</label>
              <input className="form-input" type="number" step="0.0001" placeholder="77.5946" value={form.startLon} onChange={(e) => set("startLon", e.target.value)} />
            </div>
          </div>

          <div className="form-row-2col">
            <div className="form-row">
              <label>Availability Time (HH:MM)</label>
              <input className="form-input" type="time" value={form.availabilityTime} onChange={(e) => set("availabilityTime", e.target.value)} />
            </div>
            <div className="form-row">
              <label>Avg Speed (km/h)</label>
              <input className="form-input" type="number" step="1" min="1" value={form.speed} onChange={(e) => set("speed", e.target.value)} />
            </div>
          </div>

          <div className="form-row-2col">
            <div className="form-row">
              <label>Vehicle Type</label>
              <select className="form-input" value={form.type} onChange={(e) => set("type", e.target.value)}>
                {VEHICLE_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>Category</label>
              <select className="form-input" value={form.category} onChange={(e) => set("category", e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <label>Fuel Type</label>
            <select className="form-input" value={form.fuelType} onChange={(e) => set("fuelType", e.target.value)}>
              {FUEL_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          {error && <p className="modal-error">{error}</p>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Vehicle</button>
        </div>
      </div>
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
        .modal-error { color: #f87171; font-size: 0.8rem; padding: 8px 12px; background: rgba(239,68,68,0.08); border-radius: 8px; border: 1px solid rgba(239,68,68,0.2); }
      `}</style>
    </div>
  );
}
