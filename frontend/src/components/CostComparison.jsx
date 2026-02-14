import React from "react";
import { motion } from "framer-motion";
import { TrendingUp, DollarSign, Activity, PieChart, BarChart3, ShieldCheck } from "lucide-react";

export default function CostComparison({ solution, inputData }) {
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
              { label: "Constraint Penalties", value: `₹${(data.summary?.totalPenaltyCost || 0).toFixed(0)}`, icon: ShieldCheck },
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
      `}</style>
    </div>
  );
}
