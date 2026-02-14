const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const jobQueue = require('../services/jobQueue');
const solver = require('../services/solver');
const excelParser = require('../services/excelParser');

const TESTCASES_DIR = path.join(__dirname, '../../../data/json');
const AVAILABLE_TESTCASES = ['tc01', 'tc02', 'tc03', 'tc04', 'tc05'];

// Start optimization from uploaded Excel file
exports.startOptimization = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const jobId = uuidv4();
    const job = jobQueue.createJob(jobId, req.file.path);

    // Process asynchronously
    processOptimization(jobId, req.file.path);

    res.json({ jobId, status: 'queued' });
  } catch (error) {
    console.error('Error starting optimization:', error);
    res.status(500).json({ error: 'Failed to start optimization' });
  }
};

// Get job status
exports.getJobStatus = (req, res) => {
  const { jobId } = req.params;
  const job = jobQueue.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    error: job.error
  });
};

// Get job result
exports.getJobResult = (req, res) => {
  const { jobId } = req.params;
  const job = jobQueue.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'complete') {
    return res.status(400).json({
      error: 'Results not ready',
      status: job.status,
      stage: job.stage
    });
  }

  res.json(job.result);
};

// List available test cases
exports.listTestCases = (req, res) => {
  const testCases = AVAILABLE_TESTCASES.map(id => {
    const inputPath = path.join(TESTCASES_DIR, `${id}_input.json`);
    const outputPath = path.join(TESTCASES_DIR, `${id}_output.json`);

    let employeeCount = 0;
    let vehicleCount = 0;
    let hasOutput = fs.existsSync(outputPath);

    if (fs.existsSync(inputPath)) {
      try {
        const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
        employeeCount = input.requests?.length || 0;
        vehicleCount = input.vehicles?.length || 0;
      } catch (e) {
        console.error(`Error reading ${id} input:`, e);
      }
    }

    return {
      id,
      name: id.toUpperCase(),
      employeeCount,
      vehicleCount,
      hasOutput
    };
  });

  res.json({ testCases });
};

// Run a specific test case
exports.runTestCase = async (req, res) => {
  const { id } = req.params;

  if (!AVAILABLE_TESTCASES.includes(id.toLowerCase())) {
    return res.status(404).json({ error: 'Test case not found' });
  }

  const tcId = id.toLowerCase();
  const inputPath = path.join(TESTCASES_DIR, `${tcId}_input.json`);

  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: 'Test case input file not found' });
  }

  const jobId = uuidv4();
  const job = jobQueue.createJob(jobId, inputPath, true);

  // Process asynchronously
  processTestCase(jobId, inputPath, tcId);

  res.json({ jobId, status: 'queued', testCaseId: tcId });
};

// Process optimization (Excel upload)
async function processOptimization(jobId, excelPath) {
  try {
    // Stage 1: Parsing
    jobQueue.updateJob(jobId, { status: 'processing', stage: 'parsing', progress: 10 });

    const jsonInputPath = excelPath.replace(/\.(xlsx|xls)$/i, '.json');
    await excelParser.parse(excelPath, jsonInputPath);

    jobQueue.updateJob(jobId, { progress: 30 });

    // Stage 2: Solving
    jobQueue.updateJob(jobId, { stage: 'solving', progress: 40 });

    const jsonOutputPath = jsonInputPath.replace('.json', '_output.json');
    await solver.run(jsonInputPath, jsonOutputPath);

    jobQueue.updateJob(jobId, { progress: 80 });

    // Stage 3: Transform results
    jobQueue.updateJob(jobId, { stage: 'transforming', progress: 90 });

    const result = await transformResults(jsonInputPath, jsonOutputPath);

    jobQueue.updateJob(jobId, {
      status: 'complete',
      stage: 'complete',
      progress: 100,
      result
    });

  } catch (error) {
    console.error('Optimization error:', error);
    jobQueue.updateJob(jobId, {
      status: 'error',
      error: error.message
    });
  }
}

// Process test case (pre-existing JSON)
async function processTestCase(jobId, inputPath, tcId) {
  try {
    // Check if output already exists
    const existingOutputPath = path.join(TESTCASES_DIR, `${tcId}_output.json`);

    if (fs.existsSync(existingOutputPath)) {
      // Use existing output
      jobQueue.updateJob(jobId, { status: 'processing', stage: 'loading', progress: 50 });

      const result = await transformResults(inputPath, existingOutputPath);

      jobQueue.updateJob(jobId, {
        status: 'complete',
        stage: 'complete',
        progress: 100,
        result
      });
    } else {
      // Run solver
      jobQueue.updateJob(jobId, { status: 'processing', stage: 'solving', progress: 30 });

      const outputPath = path.join(__dirname, '../../jobs', `${jobId}_output.json`);
      await solver.run(inputPath, outputPath);

      jobQueue.updateJob(jobId, { progress: 80 });

      const result = await transformResults(inputPath, outputPath);

      jobQueue.updateJob(jobId, {
        status: 'complete',
        stage: 'complete',
        progress: 100,
        result
      });
    }
  } catch (error) {
    console.error('Test case error:', error);
    jobQueue.updateJob(jobId, {
      status: 'error',
      error: error.message
    });
  }
}

// Transform solver output for frontend
async function transformResults(inputPath, outputPath) {
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const output = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

  // Calculate baseline total
  const baselineData = input.baseline || [];
  const baselineTotal = baselineData.reduce((sum, b) => sum + (b.baseline_cost || 0), 0);
  const baselineTimeTotal = baselineData.reduce((sum, b) => sum + (b.baseline_time_min || 0), 0);

  // Build employee assignments from routes
  const employeeAssignments = [];
  const routeColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];

  for (const route of output.routes) {
    if (route.stops.length === 0) continue;

    const vehicleColor = routeColors[route.vehicleId % routeColors.length];

    // Group stops by employee
    const employeeStops = {};
    for (const stop of route.stops) {
      if (!employeeStops[stop.employeeId]) {
        employeeStops[stop.employeeId] = { pickup: null, dropoff: null };
      }
      if (stop.type === 'pickup') {
        employeeStops[stop.employeeId].pickup = stop;
      } else {
        employeeStops[stop.employeeId].dropoff = stop;
      }
    }

    for (const [employeeId, stops] of Object.entries(employeeStops)) {
      const baseline = baselineData.find(b => b.employee_id === employeeId);
      const request = input.requests.find(r => r.employee_id === employeeId);

      employeeAssignments.push({
        employeeId,
        vehicleId: route.vehicleIdStr,
        vehicleColor,
        pickupTime: stops.pickup?.arrivalTime || 0,
        dropoffTime: stops.dropoff?.arrivalTime || 0,
        pickupLat: stops.pickup?.lat || request?.pickup?.lat,
        pickupLon: stops.pickup?.lon || request?.pickup?.lon,
        dropoffLat: stops.dropoff?.lat || request?.dropoff?.lat,
        dropoffLon: stops.dropoff?.lon || request?.dropoff?.lon,
        waitTime: stops.pickup?.waitTime || 0,
        baselineCost: baseline?.baseline_cost || 0,
        baselineTime: baseline?.baseline_time_min || 0,
        priority: request?.priority || 3,
        status: 'assigned'
      });
    }
  }

  // Add unassigned employees
  for (const unassigned of output.unassigned || []) {
    const request = input.requests.find(r => r.id === unassigned.reqId);
    const baseline = baselineData.find(b => b.employee_id === request?.employee_id);

    employeeAssignments.push({
      employeeId: request?.employee_id || `E${unassigned.reqId}`,
      vehicleId: null,
      vehicleColor: '#999999',
      pickupTime: null,
      dropoffTime: null,
      pickupLat: request?.pickup?.lat,
      pickupLon: request?.pickup?.lon,
      dropoffLat: request?.dropoff?.lat,
      dropoffLon: request?.dropoff?.lon,
      waitTime: 0,
      baselineCost: baseline?.baseline_cost || 0,
      baselineTime: baseline?.baseline_time_min || 0,
      priority: request?.priority || 3,
      status: 'unassigned',
      reason: unassigned.reason
    });
  }

  // Build map data
  const mapData = {
    center: { lat: 12.9716, lon: 77.5946 }, // Bangalore
    pickupPoints: input.requests.map(r => ({
      employeeId: r.employee_id,
      lat: r.pickup.lat,
      lon: r.pickup.lon,
      earlyTime: r.earlyTime,
      lateTime: r.lateTime
    })),
    dropoffPoints: input.requests.map(r => ({
      employeeId: r.employee_id,
      lat: r.dropoff.lat,
      lon: r.dropoff.lon
    })),
    vehicleStarts: input.vehicles.map(v => ({
      vehicleId: v.vehicle_id,
      lat: v.startLoc.lat,
      lon: v.startLoc.lon,
      category: v.category
    })),
    routes: output.routes.filter(r => r.stops.length > 0).map(route => ({
      vehicleId: route.vehicleIdStr,
      color: routeColors[route.vehicleId % routeColors.length],
      stops: route.stops.map(s => ({
        lat: s.lat,
        lon: s.lon,
        type: s.type,
        employeeId: s.employeeId,
        arrivalTime: s.arrivalTime
      }))
    }))
  };

  // Calculate savings
  const optimizedCost = output.summary.totalMoneyCost || output.summary.globalCost;
  const savings = baselineTotal > 0 ? ((baselineTotal - optimizedCost) / baselineTotal) * 100 : 0;

  return {
    summary: {
      totalCost: optimizedCost,
      baselineCost: baselineTotal,
      savings: Math.max(0, savings),
      vehiclesUsed: output.summary.vehiclesUsed,
      totalDistance: output.summary.totalDistance,
      totalTime: output.summary.totalTime,
      unassignedCount: output.summary.unassignedCount,
      totalEmployees: input.requests.length,
      totalVehicles: input.vehicles.length
    },
    baseline: {
      totalCost: baselineTotal,
      totalTime: baselineTimeTotal,
      perEmployee: baselineData
    },
    routes: output.routes,
    employeeAssignments,
    mapData,
    rawInput: input,
    rawOutput: output
  };
}
