const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const optimizationRoutes = require("./routes/optimization");

function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "10mb" }));

// Serve static output files
app.use("/outputs", express.static(path.join(__dirname, "../outputs")));

// Root route
app.get("/", (req, res) => {
  res.json({
    message: "Velora Mobility Optimizer API",
    endpoints: {
      health: "GET /api/health",
      optimize: "POST /api/optimize",
      optimizeJson: "POST /api/optimize/json",
      results: "GET /api/results/:jobId",
      testcases: "GET /api/testcases",
    },
  });
});

// Health check
app.get("/api/health", (req, res) => {
  const solverName =
    process.platform === "win32" ? "velora_solver.exe" : "velora_solver";
  const solverPath = path.join(__dirname, "../../build/solver", solverName);
  const parserPath = path.join(__dirname, "../../parser/excel_to_json.py");

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    solver: fs.existsSync(solverPath) ? "found" : "missing",
    parser: fs.existsSync(parserPath) ? "found" : "missing",
  });
});

// Routes
app.use("/api", optimizationRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("[ERROR]", err.message);
  res.status(500).json({ error: "Internal server error", details: err.message });
});

// Start server — bind to all interfaces so the Vite proxy can reach it
app.listen(PORT, "0.0.0.0", () => {
  const lanIp = getLanIp();
  console.log(`\n  Velora Backend API`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${lanIp}:${PORT}  (backend — access via Vite proxy)`);
  console.log(`\n  Open on phone: http://${lanIp}:5173\n`);

  // Startup checks
  const solverName =
    process.platform === "win32" ? "velora_solver.exe" : "velora_solver";
  const solverPath = path.join(__dirname, "../../build/solver", solverName);

  if (!fs.existsSync(solverPath)) {
    console.warn(`  Warning: Solver not found at ${solverPath}`);
    console.warn("  Run 'bash build.sh' to compile the solver.\n");
  }
});

module.exports = app;
