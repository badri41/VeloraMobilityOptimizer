import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, X } from "lucide-react";

export default function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          className={`velora-toast velora-toast-${toast.type}`}
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.95 }}
          transition={{ duration: 0.25 }}
        >
          {toast.type === "success" ? <CheckCircle size={18} /> : <XCircle size={18} />}
          <span>{toast.message}</span>
          <button className="toast-close" onClick={onDismiss} aria-label="Dismiss">
            <X size={14} />
          </button>
        </motion.div>
      )}
      <style>{`
        .velora-toast {
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 9999;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 18px;
          border-radius: 12px;
          font-size: 0.88rem;
          font-weight: 600;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          max-width: 360px;
          pointer-events: all;
        }
        .velora-toast-success {
          background: rgba(16,185,129,0.15);
          border: 1px solid rgba(16,185,129,0.4);
          color: #10b981;
        }
        .velora-toast-error {
          background: rgba(239,68,68,0.15);
          border: 1px solid rgba(239,68,68,0.4);
          color: #f87171;
        }
        .velora-toast span { flex: 1; color: var(--text-bright); }
        .toast-close {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-dim);
          padding: 2px;
          display: flex;
          align-items: center;
          border-radius: 4px;
        }
        .toast-close:hover { color: var(--text-bright); }
      `}</style>
    </AnimatePresence>
  );
}
