const { runProcess } = require("../utils/processRunner");
const path = require("path");
const fs = require("fs");

const PROJECT_ROOT = path.join(__dirname, "../../..");
const SOLVER_NAME =
  process.platform === "win32" ? "velora_solver.exe" : "velora_solver";

// Check build/solver first (compiled from source), then backend/solver (pre-built binary)
function getSolverPath() {
  const buildPath = path.join(PROJECT_ROOT, "build/solver", SOLVER_NAME);
  if (fs.existsSync(buildPath)) return buildPath;

  const backendPath = path.join(__dirname, "../../solver", SOLVER_NAME);
  if (fs.existsSync(backendPath)) return backendPath;

  return buildPath; // Default, will fail with clear error
}

const TIMEOUT_MS = 5 * 60 * 1000;  // 5 minutes max (user can specify up to 300s)

async function run(inputPath, outputPath, solverTimeSeconds = null) {
  const solverPath = getSolverPath();

  if (!fs.existsSync(solverPath)) {
    throw new Error(
      `Solver binary not found at ${solverPath}. Run 'bash build.sh' to compile.`
    );
  }

  // +15s buffer for process startup, JSON I/O, and node overhead.
  // Solver manages its own deadline internally (including OSRM pre-compute time).
  const dynamicTimeout = solverTimeSeconds
    ? (solverTimeSeconds + 15) * 1000
    : TIMEOUT_MS;

  console.log(`[Solver] Running: ${solverPath} "${inputPath}" "${outputPath}" (timeout: ${dynamicTimeout / 1000}s)`);
  const startTime = Date.now();

  const result = await runProcess(solverPath, [inputPath, outputPath], {
    timeout: dynamicTimeout,
    cwd: PROJECT_ROOT,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Solver failed (exit ${result.exitCode}): ${result.stderr || result.stdout || "Unknown error"}`
    );
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`[Solver] Completed in ${elapsed}s`);

  // Read and return the output JSON
  if (!fs.existsSync(outputPath)) {
    throw new Error("Solver ran but did not produce output file");
  }

  const raw = fs.readFileSync(outputPath, "utf-8");
  return JSON.parse(raw);
}

module.exports = { run };
