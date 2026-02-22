import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Map,
  BarChart3,
  Users,
  List,
  FileJson,
  FileSpreadsheet,
  FileText,
  UserPlus,
  Truck,
  RefreshCw,
} from "lucide-react";
import { downloadJSON, downloadExcel, downloadPDF } from "../utils/downloadUtils.js";
import RouteMap from "./RouteMap.jsx";
import CostComparison from "./CostComparison.jsx";
import EmployeeResults from "./EmployeeResults.jsx";
import ResultsPanel from "./ResultsPanel.jsx";
import "../resultsSection.css";

export default function ResultsSection({ solution, inputData, hoveredEmployeeId, onEmployeeHover, onAddEmployee, onAddVehicle, onRerun }) {
  const [activeTab, setActiveTab] = useState("visualization");

  if (!solution || solution.status !== "completed") {
    return (
      <div className="glass-card processing-placeholder">
        <div className="loader-v2"></div>
        <h3>Optimizing Logistics...</h3>
        <p>
          Our engine is currently calculating the most efficient routes for your
          fleet.
        </p>
        <style>{`
          .processing-placeholder { text-align: center; padding: 80px 40px; }
          .loader-v2 { width: 40px; height: 40px; border: 3px solid var(--border-subtle); border-top-color: var(--primary); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 24px; }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  const tabs = [
    { id: "visualization", label: "Visualization", icon: Map },
    { id: "costs", label: "Analytics", icon: BarChart3 },
    { id: "employees", label: "Employees", icon: Users },
    { id: "details", label: "Routes", icon: List },
  ];

  return (
    <div className="results-section">
      <div className="results-header-v2">
        <h2 className="results-title-v2">Optimization Intelligence</h2>
        <div className="download-actions-v2">
          <button className="btn btn-secondary dl-btn-v2" onClick={() => downloadJSON(solution, inputData)}>
            <FileJson size={18} />
            <span>JSON</span>
          </button>
          <button className="btn btn-secondary dl-btn-v2" onClick={() => downloadExcel(solution, inputData)}>
            <FileSpreadsheet size={18} />
            <span>Excel</span>
          </button>
          <button className="btn btn-secondary dl-btn-v2" onClick={() => downloadPDF(solution, inputData)}>
            <FileText size={18} />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {(onAddEmployee || onAddVehicle || onRerun) && (
        <div className="reopt-bar">
          {onAddEmployee && (
            <button className="btn btn-secondary reopt-btn" onClick={onAddEmployee}>
              <UserPlus size={16} /> Add Employee
            </button>
          )}
          {onAddVehicle && (
            <button className="btn btn-secondary reopt-btn" onClick={onAddVehicle}>
              <Truck size={16} /> Add Vehicle
            </button>
          )}
          {onRerun && (
            <button className="btn btn-primary reopt-btn reopt-btn-run" onClick={onRerun}>
              <RefreshCw size={16} /> Re-Run Optimization
            </button>
          )}
        </div>
      )}

      <nav className="results-tabs-nav">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab-btn-v2 ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon size={16} />
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <div className="results-content-v2">
        {/* RouteMap is always mounted to prevent Leaflet remount glitches; hidden via CSS when inactive */}
        <div style={{ display: activeTab === "visualization" ? "block" : "none" }}>
          <RouteMap
            inputData={inputData}
            solution={solution}
            hoveredEmployeeId={hoveredEmployeeId}
            isActive={activeTab === "visualization"}
          />
        </div>

        <AnimatePresence mode="sync">
          {activeTab !== "visualization" && (
            <motion.div
              key={activeTab}
              className="tab-panel-v2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === "costs" && (
                <CostComparison solution={solution} inputData={inputData} />
              )}
              {activeTab === "employees" && (
                <EmployeeResults solution={solution} inputData={inputData} onEmployeeHover={onEmployeeHover} />
              )}
              {activeTab === "details" && (
                <ResultsPanel solution={solution} inputData={inputData} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
