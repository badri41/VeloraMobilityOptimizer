import React from "react";
import { X, RefreshCw, Loader } from "lucide-react";

export default function RerunConfirmDialog({ inputData, isSubmitting, onConfirm, onClose }) {
  const empCount = inputData?.requests?.length ?? 0;
  const vehCount = inputData?.vehicles?.length ?? 0;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !isSubmitting && onClose()}>
      <div className="modal-box rerun-dialog">
        <div className="modal-header">
          <div className="modal-title-row">
            <RefreshCw size={20} color="var(--primary)" />
            <h3>Re-Run Optimization Engine?</h3>
          </div>
          {!isSubmitting && (
            <button className="modal-close-btn" onClick={onClose}><X size={18} /></button>
          )}
        </div>

        <div className="modal-body">
          <p className="rerun-body-text">
            This will run optimization using the latest employee and fleet data.
          </p>
          <div className="rerun-counts">
            <div className="rerun-count-chip">
              <span className="rerun-count-num">{empCount}</span>
              <span className="rerun-count-label">Employees</span>
            </div>
            <div className="rerun-count-chip">
              <span className="rerun-count-num">{vehCount}</span>
              <span className="rerun-count-label">Vehicles</span>
            </div>
          </div>
          {isSubmitting && (
            <div className="rerun-progress">
              <Loader size={16} className="rerun-spinner" />
              <span>Optimization in progress...</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>Cancel</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? (
              <><Loader size={15} className="rerun-spinner" /> Running...</>
            ) : (
              <><RefreshCw size={15} /> Run Optimization</>
            )}
          </button>
        </div>
      </div>
      <style>{`
        .rerun-dialog { max-width: 420px; }
        .rerun-body-text { font-size: 0.9rem; color: var(--text-dim); line-height: 1.5; }
        .rerun-counts { display: flex; gap: 16px; }
        .rerun-count-chip {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          padding: 16px; background: var(--bg-glass); border: 1px solid var(--border-subtle);
          border-radius: 12px;
        }
        .rerun-count-num { font-family: var(--font-display); font-size: 1.8rem; font-weight: 800; color: var(--text-bright); line-height: 1; }
        .rerun-count-label { font-size: 0.72rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
        .rerun-progress { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: var(--primary-glow); border: 1px solid var(--primary); border-radius: 10px; color: var(--primary); font-size: 0.88rem; font-weight: 600; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .rerun-spinner { animation: spin 1s linear infinite; }
        /* Shared modal styles */
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
        .modal-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }
        .modal-footer { padding: 16px 24px; border-top: 1px solid var(--border-subtle); display: flex; justify-content: flex-end; gap: 12px; }
      `}</style>
    </div>
  );
}
