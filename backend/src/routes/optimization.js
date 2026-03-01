const express = require("express");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const upload = require("../middleware/upload");
const optimizationController = require("../controllers/optimizationController");
const solver = require("../services/solver");

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, "../../uploads");
const OUTPUTS_DIR = path.join(__dirname, "../../outputs");

// Ensure directories exist
[UPLOADS_DIR, OUTPUTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Stage 5: Input Validation ────────────────────────────────────────────────

function validateInput(data) {
  const errors = [];

  if (!data.vehicles || !Array.isArray(data.vehicles) || data.vehicles.length === 0) {
    errors.push("'vehicles' array is required and must not be empty.");
  }
  if (!data.requests || !Array.isArray(data.requests) || data.requests.length === 0) {
    errors.push("'requests' array is required and must not be empty.");
  }

  if (errors.length > 0) return errors;

  // Validate each vehicle
  data.vehicles.forEach((v, i) => {
    if (!v.capacity || v.capacity <= 0) {
      errors.push(`Vehicle ${i}: capacity must be > 0.`);
    }
    if (v.costPerKm !== undefined && v.costPerKm < 0) {
      errors.push(`Vehicle ${i}: costPerKm must be >= 0.`);
    }
  });

  // Validate each request
  data.requests.forEach((r, i) => {
    if (!r.pickup || r.pickup.lat === undefined || r.pickup.lon === undefined) {
      errors.push(`Request ${i}: pickup location (lat, lon) is required.`);
    }
    if (!r.dropoff || r.dropoff.lat === undefined || r.dropoff.lon === undefined) {
      errors.push(`Request ${i}: dropoff location (lat, lon) is required.`);
    }
  });

  return errors;
}

// ─── Stage 6: Input Preparation ───────────────────────────────────────────────

function prepareInput(data) {
  const incomingConfig = data.config || {};
  const distMethod = incomingConfig.distance_method || "osrm";
  const prepared = {
    config: {
      allow_external_maps: distMethod !== "haversine",
      map_provider: distMethod === "haversine" ? "haversine" : "osrm",
      maps_api_key: incomingConfig.maps_api_key || "",
      ...(incomingConfig.weights ? { weights: incomingConfig.weights } : {}),
      ...(incomingConfig.tolerances ? { tolerances: incomingConfig.tolerances } : {}),
      ...(incomingConfig.penalty_weights ? { penalty_weights: incomingConfig.penalty_weights } : {}),
      solver_time_seconds: Math.max(10, Math.min(300, incomingConfig.solver_time_seconds || 30)),
      ...(incomingConfig.force_assign !== undefined ? { force_assign: incomingConfig.force_assign } : {}),
    },
    vehicles: data.vehicles.map((v, i) => ({
      id: v.id !== undefined ? v.id : i,
      vehicle_id: v.vehicle_id || v.vehicleId || `V${i + 1}`,
      capacity: v.capacity || 4,
      costPerKm: v.costPerKm || 15,
      avg_speed_kmph: v.avg_speed_kmph || v.speed || 30,
      startLoc: {
        lat: v.startLoc?.lat || v.startLocation?.lat || 0,
        lon: v.startLoc?.lon || v.startLocation?.lon || 0,
      },
      availabilityTime: v.availabilityTime || 0,
      type: v.type || v.vehicle_type || "4w",
      vehicle_type: v.type || v.vehicle_type || "4w",
      fuel_type: v.fuel_type || v.fuelType || "petrol",
      category: v.category || "normal",
    })),
    requests: data.requests.map((r, i) => ({
      id: r.id !== undefined ? r.id : i,
      employee_id: r.employee_id || r.employeeId || `E${i + 1}`,
      priority: r.priority || 3,
      pickup: {
        lat: r.pickup?.lat || 0,
        lon: r.pickup?.lon || 0,
      },
      dropoff: {
        lat: r.dropoff?.lat || 0,
        lon: r.dropoff?.lon || 0,
      },
      earlyTime: r.earlyTime || 0,
      lateTime: r.lateTime || 90,
      load: r.load || 1,
      vehiclePreference: r.vehiclePreference || r.vehiclepreference || "any",
      sharingLimit: r.sharingLimit || 4,
    })),
  };

  // Inject tolerances from metadata if available
  if (data.metadata?.maxDelayByPriority && !prepared.config.tolerances) {
    prepared.config.tolerances = data.metadata.maxDelayByPriority;
  }

  // Pass baseline data through to solver
  if (data.baseline && Array.isArray(data.baseline) && data.baseline.length > 0) {
    prepared.baseline = data.baseline.map((b) => ({
      employee_id: b.employee_id || b.employeeId || "",
      baseline_cost: b.baseline_cost || b.baselineCost || 0,
      baseline_time_min: b.baseline_time_min || b.baselineTime || 0,
    }));
  }

  return prepared;
}

// ─── Stage 9a: Constraint Analysis ───────────────────────────────────────────

function formatMinutesToTime(minutes) {
  if (minutes == null || isNaN(minutes)) return "N/A";
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function getMaxDelay(priority, tolerances) {
  const defaults = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 30 };
  const p = Math.max(1, Math.min(5, priority || 3));
  if (tolerances && tolerances[p] !== undefined) return tolerances[p];
  return defaults[p];
}

function analyzeConstraints(enrichedRoutes, preparedInput, unassignedReqIds) {
  const tolerances = preparedInput.config?.tolerances || {};
  const requestMap = {};
  preparedInput.requests.forEach((r) => { requestMap[r.id] = r; });
  const vehicleMap = {};
  preparedInput.vehicles.forEach((v) => { vehicleMap[v.id] = v; });

  const analysis = [];

  // --- Analyze each route for sharing violations ---
  // First pass: compute max concurrent passengers for each request
  const reqMaxSharing = {}; // reqId -> max concurrent passengers during their ride

  for (const route of enrichedRoutes) {
    if (!route.stops || route.stops.length === 0) continue;

    const activePassengers = new Set();
    for (const stop of route.stops) {
      if (stop.type === "pickup") {
        activePassengers.add(stop.reqId);
        // Record the count for every active passenger at this moment
        for (const activeId of activePassengers) {
          const current = reqMaxSharing[activeId] || 0;
          if (activePassengers.size > current) {
            reqMaxSharing[activeId] = activePassengers.size;
          }
        }
      } else if (stop.type === "dropoff") {
        activePassengers.delete(stop.reqId);
      }
    }
  }

  // --- Build per-request analysis ---
  for (const route of enrichedRoutes) {
    if (!route.stops || route.stops.length === 0) continue;

    const vehicle = vehicleMap[route.vehicleId];
    const vehType = vehicle?.type || vehicle?.vehicle_type || "any";
    const vehCategory = vehicle?.category || "";
    const vehId = route.vehicleIdStr || route.vehicleId;

    // Group stops by employee
    const empStops = {};
    for (const stop of route.stops) {
      const reqId = stop.reqId;
      if (!empStops[reqId]) empStops[reqId] = {};
      if (stop.type === "pickup") empStops[reqId].pickup = stop;
      else if (stop.type === "dropoff") empStops[reqId].dropoff = stop;
    }

    for (const [reqIdStr, stops] of Object.entries(empStops)) {
      const reqId = parseInt(reqIdStr);
      const req = requestMap[reqId];
      if (!req) continue;

      const pickup = stops.pickup;
      const dropoff = stops.dropoff;
      const maxDelay = getMaxDelay(req.priority, tolerances);
      const notes = [];

      // --- Time window analysis ---
      const effectivePickupTime = pickup?.arrivalTime ?? null;
      const vehicleWaitTime = pickup?.waitTime ?? 0;
      const vehicleArrivalTime = effectivePickupTime != null ? effectivePickupTime - vehicleWaitTime : null;
      const dropoffArrival = dropoff?.arrivalTime ?? null;

      let pickupStatus = "on_time";
      if (effectivePickupTime != null) {
        if (effectivePickupTime > req.lateTime + maxDelay) {
          pickupStatus = "violated";
          notes.push({
            type: "error",
            text: `TIME WINDOW CONSTRAINT VIOLATED: Pickup at ${formatMinutesToTime(effectivePickupTime)} exceeds deadline ${formatMinutesToTime(req.lateTime)} + ${maxDelay} min tolerance = ${formatMinutesToTime(req.lateTime + maxDelay)}`,
          });
        } else if (effectivePickupTime > req.lateTime) {
          pickupStatus = "within_tolerance";
          notes.push({
            type: "warning",
            text: `Pickup at ${formatMinutesToTime(effectivePickupTime)} is ${(effectivePickupTime - req.lateTime).toFixed(1)} min past window end ${formatMinutesToTime(req.lateTime)}, but within ${maxDelay} min tolerance (P${req.priority})`,
          });
        }
      }

      let dropoffStatus = "on_time";
      if (dropoffArrival != null) {
        if (dropoffArrival > req.lateTime + maxDelay) {
          dropoffStatus = "violated";
          notes.push({
            type: "error",
            text: `TIME WINDOW CONSTRAINT VIOLATED: Dropoff at ${formatMinutesToTime(dropoffArrival)} exceeds deadline ${formatMinutesToTime(req.lateTime)} + ${maxDelay} min tolerance = ${formatMinutesToTime(req.lateTime + maxDelay)}`,
          });
        } else if (dropoffArrival > req.lateTime) {
          dropoffStatus = "within_tolerance";
          notes.push({
            type: "warning",
            text: `Dropoff at ${formatMinutesToTime(dropoffArrival)} is ${(dropoffArrival - req.lateTime).toFixed(1)} min past window end ${formatMinutesToTime(req.lateTime)}, but within ${maxDelay} min tolerance (P${req.priority})`,
          });
        }
      }

      // --- Wait time explanation ---
      if (vehicleWaitTime > 0) {
        notes.push({
          type: "info",
          text: `Vehicle arrived at ${formatMinutesToTime(vehicleArrivalTime)} (${vehicleWaitTime.toFixed(1)} min early), waited for pickup window to open at ${formatMinutesToTime(req.earlyTime)}`,
        });
      }

      // --- Vehicle preference analysis ---
      const reqPref = req.vehiclePreference || "any";
      let vehiclePrefViolated = false;
      if (reqPref !== "any" && vehType !== "any") {
        if (reqPref !== vehType && reqPref !== vehCategory) {
          vehiclePrefViolated = true;
          notes.push({
            type: "error",
            text: `Vehicle preference violated: requested "${reqPref}", assigned "${vehType}" (${vehCategory || "no category"})`,
          });
        }
      }

      // --- Sharing analysis ---
      const sharingLimit = req.sharingLimit || 100;
      const maxConcurrent = reqMaxSharing[reqId] || 1;
      let sharingViolated = false;
      if (maxConcurrent > sharingLimit) {
        sharingViolated = true;
        const sharingNames = { 1: "single (no sharing)", 2: "double", 3: "triple" };
        const wanted = sharingNames[sharingLimit] || `max ${sharingLimit}`;
        notes.push({
          type: "error",
          text: `Sharing limit violated: requested ${wanted}, but rode with ${maxConcurrent - 1} other(s) (${maxConcurrent} total in vehicle)`,
        });
      }

      // Determine overall status (worst of pickup and dropoff)
      let overallStatus = "on_time";
      if (pickupStatus === "violated" || dropoffStatus === "violated") overallStatus = "violated";
      else if (pickupStatus === "within_tolerance" || dropoffStatus === "within_tolerance") overallStatus = "within_tolerance";

      analysis.push({
        employeeId: req.employee_id,
        reqId,
        assignedVehicleId: vehId,
        assignedVehicleType: vehType,
        assignedVehicleCategory: vehCategory,
        requestedVehicleType: reqPref,
        vehiclePrefViolated,
        sharingLimit,
        maxConcurrentPassengers: maxConcurrent,
        sharingViolated,
        pickupArrival: vehicleArrivalTime,
        vehicleWaitTime,
        effectivePickupTime,
        dropoffArrival,
        earlyTime: req.earlyTime,
        lateTime: req.lateTime,
        priority: req.priority,
        maxDelay,
        pickupStatus,
        dropoffStatus,
        overallStatus,
        notes,
      });
    }
  }

  // --- Unassigned requests ---
  for (const reqId of (unassignedReqIds || [])) {
    const req = requestMap[reqId];
    if (!req) continue;
    analysis.push({
      employeeId: req.employee_id,
      reqId,
      assignedVehicleId: null,
      overallStatus: "unassigned",
      earlyTime: req.earlyTime,
      lateTime: req.lateTime,
      priority: req.priority,
      maxDelay: getMaxDelay(req.priority, tolerances),
      notes: [
        { type: "error", text: `Unassigned: No feasible vehicle could serve this request within constraints` },
      ],
    });
  }

  return analysis;
}

// ─── Stage 9: Post-Processing ─────────────────────────────────────────────────

function postProcess(solverOutput, preparedInput) {
  const routes = solverOutput.routes || [];
  const rawSummary = solverOutput.summary || {};
  const requestDetails = solverOutput.requestDetails || [];

  // Build employee ID lookup from prepared input
  const employeeIdMap = {};
  preparedInput.requests.forEach((r) => {
    employeeIdMap[r.id] = r.employee_id;
  });

  // Enrich routes: normalize stop types, inject employee IDs
  const enrichedRoutes = routes.map((route) => ({
    ...route,
    stops: (route.stops || []).map((stop) => {
      let stopType = stop.type;
      if (stopType === "P") stopType = "pickup";
      else if (stopType === "D") stopType = "dropoff";

      return {
        ...stop,
        type: stopType,
        employeeId:
          stop.employeeId || employeeIdMap[stop.reqId] || `Req-${stop.reqId}`,
      };
    }),
  }));

  // Compute summary metrics
  const totalMoneyCost = rawSummary.totalMoneyCost || rawSummary.totalCost || 0;
  const totalDistance = rawSummary.totalDistance || rawSummary.totalDist || 0;
  const totalTime = rawSummary.totalTime || 0;
  const vehiclesUsed = rawSummary.vehiclesUsed || routes.filter((r) => r.stops?.length > 0).length;
  const unassignedCount =
    rawSummary.unassignedCount !== undefined
      ? rawSummary.unassignedCount
      : (solverOutput.unassigned || []).length;
  const globalCost = rawSummary.globalCost || totalMoneyCost;

  // Enrich unassigned: solver outputs plain integer IDs [0, 3, 5]
  // Convert to objects with employee details for frontend display
  const rawUnassigned = solverOutput.unassigned || [];
  const requestLookup = {};
  preparedInput.requests.forEach((r) => { requestLookup[r.id] = r; });

  const enrichedUnassigned = rawUnassigned.map((item) => {
    // Already an object? pass through
    if (typeof item === "object" && item !== null) return item;
    // Plain integer reqId — enrich from prepared input
    const req = requestLookup[item];
    return {
      reqId: item,
      employeeId: req?.employee_id || `Req-${item}`,
      priority: req?.priority || 3,
      earlyTime: req?.earlyTime || 0,
      lateTime: req?.lateTime || 90,
      vehiclePreference: req?.vehiclePreference || "any",
    };
  });

  // Per-vehicle baseline aggregation fallback:
  // If solver didn't include baselineCost, compute from preparedInput.baseline
  const baselineData = preparedInput.baseline || [];
  if (baselineData.length > 0) {
    const baselineByEmp = {};
    baselineData.forEach((b) => {
      baselineByEmp[b.employee_id] = b;
    });

    for (const route of enrichedRoutes) {
      if (route.baselineCost === undefined || route.baselineCost === 0) {
        let routeBaselineCost = 0;
        let routeBaselineTime = 0;
        const seen = new Set();
        for (const stop of (route.stops || [])) {
          const empId = stop.employeeId;
          if (empId && !seen.has(empId) && stop.type === "pickup") {
            seen.add(empId);
            const bl = baselineByEmp[empId];
            if (bl) {
              routeBaselineCost += bl.baseline_cost || 0;
              routeBaselineTime += bl.baseline_time_min || 0;
            }
          }
        }
        route.baselineCost = routeBaselineCost;
        route.baselineTime = routeBaselineTime;
      }
    }
  }

  // Stage 9a: Constraint analysis
  const constraintAnalysis = analyzeConstraints(
    enrichedRoutes,
    preparedInput,
    rawUnassigned
  );

  return {
    routes: enrichedRoutes,
    unassigned: enrichedUnassigned,
    unassignedRequests: enrichedUnassigned,
    summary: {
      totalMoneyCost,
      totalDistance,
      totalTime,
      vehiclesUsed,
      unassignedCount,
      globalCost,
      ...rawSummary,
    },
    requestDetails,
    constraintAnalysis,
  };
}

// ─── POST /api/parse — Upload Excel → Parse Only (no solving) ────────────────

const excelParser = require("../services/excelParser");

router.post("/parse", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const excelPath = req.file.path;
    const jsonPath = excelPath.replace(/\.(xlsx|xls|csv)$/i, ".json");

    // Run Python parser: Excel → JSON
    await excelParser.parse(excelPath, jsonPath);

    // Read the parsed JSON
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

    // Return parsed data for frontend preview
    res.json({
      status: "parsed",
      vehicles: parsed.vehicles || [],
      requests: parsed.requests || [],
      config: parsed.config || {},
      metadata: parsed.metadata || {},
      baseline: parsed.baseline || [],
    });
  } catch (error) {
    console.error("Parse error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/optimize — Upload Excel → Parse → Solve ───────────────────────

router.post(
  "/optimize",
  upload.single("file"),
  optimizationController.startOptimization
);

// ─── POST /api/optimize/json — JSON → Validate → Prepare → Solve → Post-process

router.post("/optimize/json", async (req, res) => {
  const jobId = uuidv4();
  const startTime = Date.now();

  const inputPath = path.join(UPLOADS_DIR, `${jobId}_input.json`);
  const outputPath = path.join(OUTPUTS_DIR, `${jobId}_output.json`);

  try {
    // Stage 5: Validation
    const validationErrors = validateInput(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        error: "Validation failed",
        details: validationErrors,
      });
    }

    // Stage 6: Input Preparation
    const preparedInput = prepareInput(req.body);
    fs.writeFileSync(inputPath, JSON.stringify(preparedInput, null, 2));

    // Stage 7 & 8: Run C++ solver
    const solverTime = preparedInput.config?.solver_time_seconds || null;
    const solverOutput = await solver.run(inputPath, outputPath, solverTime);

    // Stage 9: Post-Processing
    const result = postProcess(solverOutput, preparedInput);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Job ${jobId}] Completed in ${elapsed}s`);

    res.json({ jobId, status: "success", result });
  } catch (error) {
    console.error(`[Job ${jobId}] Failed:`, error.message);
    res.status(500).json({ jobId, status: "error", error: error.message });
  }
});

// ─── GET /api/results/:jobId — Retrieve past result ──────────────────────────

router.get("/results/:jobId", (req, res) => {
  const { jobId } = req.params;

  if (!/^[a-f0-9-]{36}$/.test(jobId)) {
    return res.status(400).json({ error: "Invalid job ID format" });
  }

  const outputPath = path.join(OUTPUTS_DIR, `${jobId}_output.json`);
  if (fs.existsSync(outputPath)) {
    try {
      const result = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
      return res.json({ jobId, status: "success", result });
    } catch {
      return res.status(500).json({ error: "Failed to read result file" });
    }
  }

  return optimizationController.getJobResult(req, res);
});

// ─── Other endpoints ─────────────────────────────────────────────────────────

router.get("/optimize/:jobId/status", optimizationController.getJobStatus);
router.get("/optimize/:jobId/result", optimizationController.getJobResult);
router.get("/testcases", optimizationController.listTestCases);
router.post("/testcases/:id/run", optimizationController.runTestCase);

module.exports = router;
