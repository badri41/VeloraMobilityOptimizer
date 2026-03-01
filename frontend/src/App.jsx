import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  Fragment,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Rocket,
  Database,
  Settings2,
  BarChart,
  Car,
  Users,
  Sun,
  Moon,
} from "lucide-react";
import HomePage from "./components/HomePage.jsx";
import Header from "./components/Header.jsx";
import FileUpload from "./components/FileUpload.jsx";
import ResultsSection from "./components/ResultsSection.jsx";
import PenaltyForm, { DEFAULT_PENALTY_WEIGHTS } from "./components/PenaltyForm.jsx";
import SolverTimeForm, { DEFAULT_SOLVER_TIME } from "./components/SolverTimeForm.jsx";
import DistanceModeForm, { DEFAULT_DISTANCE_METHOD } from "./components/DistanceModeForm.jsx";
import AddEmployeeModal from "./components/AddEmployeeModal.jsx";
import AddVehicleModal from "./components/AddVehicleModal.jsx";
import RerunConfirmDialog from "./components/RerunConfirmDialog.jsx";
import Toast from "./components/Toast.jsx";
import { getSolution, submitOptimization, parseExcelFile } from "./api.js";

const defaultStatus = "idle";

// Build the solution object shape that ResultsSection expects
function buildSolution(result) {
  const routes = result.routes || [];
  const summary = result.summary || {};
  const unassigned = result.unassigned || [];
  const requestDetails = result.requestDetails || [];

  const totalMoneyCost = summary.totalMoneyCost || 0;
  const totalDistance = summary.totalDistance || 0;
  const totalTime = summary.totalTime || 0;
  const vehiclesUsed = summary.vehiclesUsed || routes.length;
  const unassignedCount = summary.unassignedCount || unassigned.length;
  const globalCost = summary.globalCost || totalMoneyCost;

  return {
    status: "completed",
    routes,
    unassigned,
    totalDistance,
    totalMoneyCost,
    globalCost,
    totalTime,
    vehiclesUsed,
    requestDetails,
    data: {
      routes,
      unassigned,
      unassignedRequests: result.unassignedRequests || unassigned,
      summary: { totalMoneyCost, totalDistance, totalTime, vehiclesUsed, unassignedCount, globalCost, ...summary },
      constraintAnalysis: result.constraintAnalysis || [],
    },
    output: { summary, routes },
  };
}

// ─── Theme Toggle ─────────────────────────────────────────────────────────────

function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("velora-theme") || "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("velora-theme", theme);
  }, [theme]);

  return (
    <button
      className="theme-toggle"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
    >
      {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [showHomePage, setShowHomePage] = useState(true);
  const [showResults, setShowResults] = useState(false);
  const [fileName, setFileName] = useState("");
  const [inputData, setInputData] = useState(null);
  const [parseError, setParseError] = useState("");
  const [isParsing, setIsParsing] = useState(false);

  const [status, setStatus] = useState(defaultStatus);
  const [solutionId, setSolutionId] = useState("");
  const [solution, setSolution] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [penaltyWeights, setPenaltyWeights] = useState({ ...DEFAULT_PENALTY_WEIGHTS });
  const [solverTime, setSolverTime] = useState(DEFAULT_SOLVER_TIME);
  const [forceAssign, setForceAssign] = useState(true);
  const [distanceMethod, setDistanceMethod] = useState(DEFAULT_DISTANCE_METHOD);

  // Hover state for employee card → map route highlight
  const [hoveredEmployeeId, setHoveredEmployeeId] = useState(null);

  // Dynamic reoptimization modal state
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [showRerunConfirm, setShowRerunConfirm] = useState(false);
  const [toast, setToast] = useState(null);

  const isReady = useMemo(
    () => inputData?.vehicles?.length && inputData?.requests?.length,
    [inputData],
  );

  // ─── Stage 1 & 2: File Upload + Parsing ───────────────────────────────────

  const handleFile = async (file) => {
    setParseError("");
    setIsParsing(true);
    setFileName(file.name);
    setStatus(defaultStatus);
    setSolution(null);
    setSolutionId("");
    setSubmitError("");

    try {
      let output;

      if (file.name.endsWith(".json")) {
        const text = await file.text();
        const jsonData = JSON.parse(text);

        // Pre-computed OUTPUT file — display directly
        if (jsonData.routes && (jsonData.summary || jsonData.requestDetails)) {
          setIsParsing(false);

          const routes = jsonData.routes || [];
          const requestDetails = jsonData.requestDetails || [];

          setInputData({
            requests: requestDetails.map((r, i) => ({
              employeeId: r.employeeId || r.employee_id || `E${i + 1}`,
              priority: r.priority || 3,
              earlyTime: r.earlyTime || 0,
              lateTime: r.lateTime || 90,
              sharingLimit: r.sharingLimit || 4,
              vehiclePreference: r.vehiclePreference || "any",
              pickup: { lat: 0, lon: 0 },
              dropoff: { lat: 0, lon: 0 },
            })),
            vehicles: routes.map((route, i) => ({
              vehicleId: route.vehicleIdStr || route.vehicleId || `V${i + 1}`,
              type: route.vehicleType || "4w",
              fuelType: route.fuelType || "petrol",
              category: route.category || "normal",
              capacity: route.capacity || 4,
              costPerKm: route.costPerKm || 15,
              speed: 30,
              startLocation: { lat: 0, lon: 0 },
            })),
            metadata: { maxDelayByPriority: { 1: 5, 2: 10, 3: 15, 4: 20, 5: 30 } },
          });

          setSolution(buildSolution(jsonData));
          setStatus("completed");
          setShowResults(true);
          return;
        }

        // Solver INPUT format
        if (jsonData.config && jsonData.vehicles && jsonData.requests) {
          output = {
            vehicles: jsonData.vehicles.map((v) => ({
              vehicleId: v.vehicle_id || v.vehicleId,
              capacity: v.capacity,
              costPerKm: v.costPerKm,
              startLocation: { lat: v.startLoc?.lat || 0, lon: v.startLoc?.lon || 0 },
              availabilityTime: v.availabilityTime || 0,
              speed: v.avg_speed_kmph || v.speed || 30,
              type: v.type || v.vehicle_type || "4w",
              category: v.category || "normal",
              fuelType: v.fuel_type || v.fuelType || "petrol",
            })),
            requests: jsonData.requests.map((r) => ({
              employeeId: r.employee_id || r.employeeId,
              priority: r.priority,
              pickup: { lat: r.pickup?.lat || 0, lon: r.pickup?.lon || 0 },
              dropoff: { lat: r.dropoff?.lat || 0, lon: r.dropoff?.lon || 0 },
              earlyTime: r.earlyTime || 0,
              lateTime: r.lateTime || 90,
              load: r.load || 1,
              vehiclePreference: r.vehiclePreference || r.vehiclepreference || "any",
              sharingLimit: r.sharingLimit || 4,
            })),
            metadata: { maxDelayByPriority: jsonData.config?.tolerances || { 1: 5, 2: 10, 3: 15, 4: 20, 5: 30 } },
            config: jsonData.config,
            baseline: jsonData.baseline || [],
          };
        } else if (jsonData.vehicles && jsonData.requests) {
          output = { ...jsonData, baseline: jsonData.baseline || [] };
        } else {
          throw new Error("Invalid JSON format. Must contain vehicles and requests, or routes and summary.");
        }
      } else {
        // Excel file: upload to backend for Python parsing (parse only, no solving)
        const parsed = await parseExcelFile(file);

        output = {
          vehicles: (parsed.vehicles || []).map((v, i) => ({
            vehicleId: v.vehicle_id || v.vehicleId || `V${i + 1}`,
            capacity: v.capacity || 4,
            costPerKm: v.costPerKm || 15,
            startLocation: { lat: v.startLoc?.lat || 0, lon: v.startLoc?.lon || 0 },
            availabilityTime: v.availabilityTime || 0,
            speed: v.avg_speed_kmph || v.speed || 30,
            type: v.type || v.vehicle_type || "4w",
            category: v.category || "normal",
            fuelType: v.fuel_type || v.fuelType || "petrol",
          })),
          requests: (parsed.requests || []).map((r, i) => ({
            employeeId: r.employee_id || r.employeeId || `E${i + 1}`,
            priority: r.priority || 3,
            pickup: { lat: r.pickup?.lat || 0, lon: r.pickup?.lon || 0 },
            dropoff: { lat: r.dropoff?.lat || 0, lon: r.dropoff?.lon || 0 },
            earlyTime: r.earlyTime || 0,
            lateTime: r.lateTime || 90,
            load: r.load || 1,
            vehiclePreference: r.vehiclePreference || r.vehiclepreference || "any",
            sharingLimit: r.sharingLimit || 4,
          })),
          config: parsed.config || {},
          metadata: {
            maxDelayByPriority: parsed.config?.tolerances || { 1: 5, 2: 10, 3: 15, 4: 20, 5: 30 },
          },
          baseline: parsed.baseline || [],
        };
      }

      if (!output.vehicles.length || !output.requests.length) {
        throw new Error("Missing required fleet or employee data.");
      }
      setInputData(output);
    } catch (error) {
      setParseError(error.message || "Failed to parse file.");
      setInputData(null);
    } finally {
      setIsParsing(false);
    }
  };

  const handleClear = () => {
    setFileName("");
    setInputData(null);
    setParseError("");
    setStatus(defaultStatus);
    setSolution(null);
    setSolutionId("");
    setSubmitError("");
  };

  // ─── Dynamic Reoptimization Handlers ────────────────────────────────────

  const handleAddEmployee = (req) => {
    setInputData((prev) => ({ ...prev, requests: [...(prev?.requests || []), req] }));
    setToast({ message: "Employee added successfully", type: "success" });
  };

  const handleAddVehicle = (veh) => {
    setInputData((prev) => ({ ...prev, vehicles: [...(prev?.vehicles || []), veh] }));
    setToast({ message: "Vehicle added successfully", type: "success" });
  };

  // ─── Stage 4: API Call Trigger ────────────────────────────────────────────

  const handleOptimize = async () => {
    if (!isReady || isSubmitting) return false;
    setSubmitError("");
    setIsSubmitting(true);

    try {
      const payload = {
        config: {
          ...(inputData.config || {}),
          penalty_weights: penaltyWeights,
          solver_time_seconds: solverTime,
          force_assign: forceAssign,
          distance_method: distanceMethod,
        },
        vehicles: inputData.vehicles,
        requests: inputData.requests,
        metadata: inputData.metadata,
        baseline: inputData.baseline || [],
      };

      const response = await submitOptimization(payload);

      if (response.status === "success" && response.result) {
        setSolution(buildSolution(response.result));
        setStatus("completed");
        if (response.result.summary?.distanceMethodUsed === "haversine_fallback") {
          setToast({ message: "OSRM API timed out — distances computed using Straight-line (Haversine) instead.", type: "warning" });
        }
      } else {
        setSolutionId(response.solutionId || response.jobId);
        setStatus(response.status || "processing");
        setSolution({ status: response.status || "processing" });
      }
      setShowResults(true);
      return true;
    } catch (error) {
      setSubmitError(error.message || "Optimization request failed.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Polling ──────────────────────────────────────────────────────────────

  const pollSolution = useCallback(async () => {
    if (!solutionId) return;
    try {
      const response = await getSolution(solutionId);
      if (response.status === "success" && response.result) {
        setSolution(buildSolution(response.result));
        setStatus("completed");
        return true;
      }
      setSolution(response);
      setStatus(response.status);
      return response.status === "success" || response.status === "completed" || response.status === "failed";
    } catch {
      setSubmitError("Connection lost while polling.");
      return false;
    }
  }, [solutionId]);

  useEffect(() => {
    if (!solutionId || status === "completed" || status === "failed" || status === "success") return;
    const interval = setInterval(async () => {
      if (await pollSolution()) clearInterval(interval);
    }, 2000);
    return () => clearInterval(interval);
  }, [pollSolution, solutionId, status]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (showHomePage) {
    return (
      <>
        <ThemeToggle key="theme-toggle" />
        <HomePage onStart={() => setShowHomePage(false)} />
      </>
    );
  }

  if (showResults) {
    return (
      <>
        <ThemeToggle key="theme-toggle" />
        <div className="app">
          <div className="header-with-back">
            <Header />
            <button className="btn btn-secondary back-btn-compact" onClick={() => setShowResults(false)}>
              <ArrowLeft size={16} />
              <span>Refine Data</span>
            </button>
          </div>
          <ResultsSection
            solution={solution}
            inputData={inputData}
            hoveredEmployeeId={hoveredEmployeeId}
            onEmployeeHover={setHoveredEmployeeId}
            onAddEmployee={() => setShowAddEmployee(true)}
            onAddVehicle={() => setShowAddVehicle(true)}
            onRerun={() => setShowRerunConfirm(true)}
          />
        </div>
        <Toast toast={toast} onDismiss={() => setToast(null)} />
        {showAddEmployee && (
          <AddEmployeeModal
            onSave={(req) => { handleAddEmployee(req); setShowAddEmployee(false); }}
            onClose={() => setShowAddEmployee(false)}
          />
        )}
        {showAddVehicle && (
          <AddVehicleModal
            onSave={(veh) => { handleAddVehicle(veh); setShowAddVehicle(false); }}
            onClose={() => setShowAddVehicle(false)}
          />
        )}
        {showRerunConfirm && (
          <RerunConfirmDialog
            inputData={inputData}
            isSubmitting={isSubmitting}
            onConfirm={async () => {
              const success = await handleOptimize();
              if (success) {
                setShowRerunConfirm(false);
                setToast({ message: "Optimization complete!", type: "success" });
              } else {
                setToast({ message: "Optimization failed. Please try again.", type: "error" });
              }
            }}
            onClose={() => setShowRerunConfirm(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <ThemeToggle key="theme-toggle" />
      <div className="app">
        <Header />
        <div className="upload-workflow">
          <div className="workflow-steps-premium">
            {[
              { id: 1, label: "Upload", icon: Database, done: !!fileName },
              { id: 2, label: "Optimize", icon: Settings2, done: status === "completed" },
              { id: 3, label: "Review", icon: BarChart, done: false },
            ].map((step, idx) => (
              <Fragment key={step.id}>
                <div className={`workflow-step-v2 ${step.done ? "completed" : idx === 0 || (idx === 1 && fileName) ? "active" : ""}`}>
                  <div className="step-icon-wrapper">
                    <step.icon size={18} />
                  </div>
                  <span className="step-label-v2">{step.label}</span>
                </div>
                {idx < 2 && <div className="step-connector-v2" />}
              </Fragment>
            ))}
          </div>

          <div className="workflow-main">
            <FileUpload onFile={handleFile} fileName={fileName} isParsing={isParsing} onClear={handleClear} error={parseError} />
          </div>

          <PenaltyForm
            weights={penaltyWeights}
            onChange={setPenaltyWeights}
            forceAssign={forceAssign}
            onForceAssignChange={setForceAssign}
          />
          <SolverTimeForm value={solverTime} onChange={setSolverTime} />
          <DistanceModeForm value={distanceMethod} onChange={setDistanceMethod} />

          <AnimatePresence>
            {fileName && (
              <motion.div
                className="glass-card action-bar-premium"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
              >
                <div className="action-bar-grid">
                  <div className="action-status-info">
                    <div className="status-indicator-v2">
                      <div className={`status-pulse ${status === "processing" ? "active" : status === "completed" ? "success" : ""}`} />
                      <span className="status-text-v2">
                        {status === "idle" && "Configuration Ready"}
                        {status === "processing" && "Optimizer Active"}
                        {status === "completed" && "Optimization Success"}
                      </span>
                    </div>
                    {isReady && (
                      <div className="dataset-chips">
                        <div className="chip"><Car size={14} /> <span>{inputData.vehicles.length} Fleet</span></div>
                        <div className="chip"><Users size={14} /> <span>{inputData.requests.length} Targets</span></div>
                      </div>
                    )}
                  </div>

                  <div className="action-buttons-group">
                    <button className="btn btn-primary optimize-btn-v2" onClick={handleOptimize} disabled={!isReady || isSubmitting}>
                      {isSubmitting ? (
                        <span className="loading-spinner">Processing...</span>
                      ) : (
                        <><Rocket size={18} /><span>EXECUTE ENGINE</span></>
                      )}
                    </button>
                  </div>
                </div>
                {submitError && <p className="error-text-v2">{submitError}</p>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <style>{`
          .upload-workflow { display: flex; flex-direction: column; gap: 40px; max-width: 800px; margin: 0 auto; width: 100%; }
          .workflow-steps-premium { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 20px; }
          .workflow-step-v2 { display: flex; align-items: center; gap: 12px; color: var(--text-dim); transition: all 0.3s ease; }
          .workflow-step-v2.active { color: var(--primary); }
          .workflow-step-v2.completed { color: var(--accent); }
          .step-icon-wrapper { width: 40px; height: 40px; border-radius: 12px; background: var(--bg-glass); border: 1px solid var(--border-subtle); display: flex; align-items: center; justify-content: center; }
          .active .step-icon-wrapper { border-color: var(--primary); background: var(--primary-glow); }
          .completed .step-icon-wrapper { border-color: var(--accent); color: var(--accent); }
          .step-label-v2 { font-family: var(--font-display); font-weight: 600; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
          .step-connector-v2 { width: 40px; height: 1px; background: var(--border-subtle); }
          .action-bar-premium { padding: 24px 32px; border-radius: var(--radius-lg); }
          .action-bar-grid { display: flex; justify-content: space-between; align-items: center; gap: 24px; }
          .status-indicator-v2 { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
          .status-pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--text-dim); }
          .status-pulse.active { background: var(--primary); box-shadow: 0 0 10px var(--primary); animation: pulse 2s infinite; }
          .status-pulse.success { background: var(--accent); box-shadow: 0 0 10px var(--accent); }
          .status-text-v2 { font-family: var(--font-display); font-weight: 700; font-size: 0.9rem; color: var(--text-bright); }
          .dataset-chips { display: flex; gap: 8px; }
          .chip { display: flex; align-items: center; gap: 6px; padding: 4px 12px; background: var(--bg-glass); border-radius: 100px; font-size: 0.75rem; color: var(--text-dim); border: 1px solid var(--border-subtle); }
          .optimize-btn-v2 { min-width: 220px; }
          .error-text-v2 { color: #ef4444; font-size: 0.85rem; margin-top: 12px; text-align: center; }
          .header-with-back { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
          .back-btn-compact { margin-top: 12px; }
        `}</style>
      </div>
    </>
  );
}
