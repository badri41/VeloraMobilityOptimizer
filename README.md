# Velora Mobility Optimizer

Employee transportation cost optimizer for Heterogeneous Vehicle Routing with Soft Time Windows (HVRPSTW). Given a fleet of vehicles and a set of employees with pickup/dropoff locations and time windows, it finds routes that minimize total cost while satisfying capacity, precedence, and time-window constraints.

**Live deployment:**
- Frontend: https://velorafrontend-kri-2651-ti.onrender.com
- Backend API: https://velorabackend-kri-2651-ti.onrender.com

---

## Architecture

```
VeloraMobilityOptimizer/
├── solver/                       # C++ optimizer binary
│   ├── src/
│   │   ├── main.cpp              # 4-phase metaheuristic solver
│   │   └── map_distance.cpp      # OSRM / Haversine distance client
│   ├── include/
│   │   ├── map_distance.hpp
│   │   └── json.hpp              # nlohmann/json (header-only)
│   ├── CMakeLists.txt
│   └── build/velora_solver       # Compiled binary (gitignored)
│
├── backend/                      # Node.js REST API
│   ├── src/
│   │   ├── app.js                # Express setup, CORS, routes
│   │   ├── routes/
│   │   │   └── optimization.js   # Validate → prepare → solve → post-process
│   │   ├── services/
│   │   │   ├── solver.js         # Spawns the C++ subprocess
│   │   │   └── excelParser.js    # Bridges to Python Excel parser
│   │   ├── controllers/
│   │   │   └── optimizationController.js  # Test-case runner
│   │   ├── middleware/
│   │   │   └── upload.js         # Multer file upload
│   │   └── utils/
│   │       └── processRunner.js  # Async subprocess helper
│   ├── uploads/                  # Temp uploaded files (gitignored)
│   └── outputs/                  # Solver output files (gitignored)
│
├── frontend/                     # React + Vite SPA
│   ├── src/
│   │   ├── App.jsx               # Root component — tabs, state, orchestration
│   │   ├── api.js                # Fetch wrappers for backend API
│   │   └── components/
│   │       ├── RouteMap.jsx      # Leaflet map + OSRM road geometry
│   │       ├── ResultsPanel.jsx  # Cost analytics, constraint compliance
│   │       ├── EmployeeResults.jsx
│   │       ├── AddEmployeeModal.jsx
│   │       ├── SolverTimeForm.jsx
│   │       ├── DistanceModeForm.jsx
│   │       └── PenaltyForm.jsx
│   ├── .env.production           # VITE_API_BASE for production build
│   └── vite.config.js
│
├── parser/
│   └── excel_to_json.py          # Excel → JSON input converter
│
├── data/
│   ├── json/                     # Test case inputs + best-known outputs (tc01–tc05)
│   └── *.txt                     # Human-readable solution reports
│
├── Dockerfile                    # Docker build: compiles solver + runs backend
├── build.sh                      # Local build script (compile + start)
└── render.yaml                   # Render.com deployment config
```

---

## Algorithm

The solver is a **4-phase metaheuristic** for HVRPSTW, implemented in C++ with a fixed random seed (42) for reproducible results.

### Objective Function

```
Minimize: Σ (distance_ij × costPerKm_v) × w_cost
        + Σ (travelTime_route)          × w_time
        + Penalty terms
```

Default weights: `w_cost = 0.7`, `w_time = 0.3`

### Constraints

| Type | Constraint |
|------|-----------|
| **Hard** | Vehicle capacity; pickup before dropoff (precedence) |
| **Soft** | Time windows `[earlyTime, lateTime]` with priority-based tolerance; sharing limits; vehicle type preference |

Soft constraints are penalized rather than strictly enforced, allowing the optimizer to trade off constraint violations against route cost.

### Phase 1 — Solomon I1 Greedy Construction

Up to 20 restarts of a greedy insertion heuristic. Each restart shuffles requests within priority buckets and inserts them one by one into the cheapest feasible position across all vehicles. The best result across all restarts is kept.

### Phase 2 — Simulated Annealing (SA)

Deterministic SA with 5 move operators. Terminates by `maxNoImprove` count (not wall-clock), so results are identical every run with seed=42.

| Operator | Weight | Description |
|----------|--------|-------------|
| Greedy Relocate | 28% | Move a request to its cheapest route (all vehicles) |
| Intra-Route Relocate | 28% | Re-insert a request at its best position within the same route |
| Exchange | 18% | Swap requests between two routes |
| 2-Opt | 13% | Reverse a segment within a route |
| Or-Opt | 13% | Move a chain of 1–2 stops to another position |

SA parameters scale with problem complexity (`avgRouteStops`): initial temperature `T₀ = min(0.3 × cost, 1000)`, cooling `α = 0.99`, adaptive reheating every `maxNoImprove/3` stagnant steps.

### Phase 3 — Adaptive Large Neighborhood Search (ALNS)

Time-bounded destroy-repair loop using Ropke & Pisinger adaptive scoring (σ₁=33, σ₂=9, σ₃=3, λ=0.8).

**Destroy operators:**
- **Shaw Removal** — remove geographically related requests (seed + nearest neighbors)
- **Random Removal** — uniform random selection for diversification
- **Route Removal** — evict the entire most-penalized route (plateau escape)

**Repair:** Regret-2 insertion heuristic — inserts requests with the highest regret (2nd-best minus best insertion cost) first, prioritizing tightly-constrained requests.

### Phase 4 — Post-ALNS SA Polish

Restarts SA from the ALNS best solution with a shorter `maxNoImprove` for fine-grained local improvement. Keeps whichever solution (ALNS vs. Phase 4) is better.

### Distance Computation

| Mode | Method | Speed |
|------|--------|-------|
| `osrm` | OSRM Table API — single HTTP call for full NxN matrix | ~5–20s pre-compute, then O(1) lookups |
| `haversine` | Straight-line air distance | Instant |

All SA/ALNS distance lookups are O(1) reads from a pre-computed NxN matrix.

---

## Local Setup

### Prerequisites

- **C++ compiler** with C++17 support (GCC 10+ or Clang 12+)
- **CMake 3.14+**
- **libcurl** (for OSRM API calls)
- **Node.js 18+**
- **Python 3.9+** (for Excel parsing only)

### 1. Build the Solver

```bash
cd solver/build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j4
# Binary: solver/build/velora_solver
```

Or use the convenience script from the project root:

```bash
bash build.sh
```

### 2. Start the Backend

```bash
cd backend
npm install
# Create backend/.env:
#   PORT=3001
#   FRONTEND_URL=http://localhost:5173
node src/app.js
# API available at http://localhost:3001
```

### 3. Start the Frontend

```bash
cd frontend
npm install
npm run dev
# App available at http://localhost:5173
```

The Vite dev server proxies `/api` requests to `localhost:3001` automatically.

### Using the CLI

You can run the solver directly for debugging:

```bash
./solver/build/velora_solver input.json output.json [convergence.csv]
```

---

## API Reference

### `POST /api/optimize/json`

Submit a JSON optimization request.

**Request body:**
```json
{
  "config": {
    "distance_method": "osrm",       // "osrm" | "haversine"
    "solver_time_seconds": 30,        // 10–300
    "force_assign": true,             // false = leave violators unassigned
    "weights": { "cost": 0.7, "time": 0.3 },
    "tolerances": { "1": 5, "2": 10, "3": 15, "4": 20, "5": 30 },
    "penalty_weights": { "sharingViolationPenalty": 500, ... }
  },
  "vehicles": [
    {
      "vehicle_id": "V01",
      "capacity": 4,
      "costPerKm": 15,
      "avg_speed_kmph": 30,
      "startLoc": { "lat": 12.9716, "lon": 77.5946 },
      "type": "4w",
      "fuel_type": "petrol",
      "category": "normal"
    }
  ],
  "requests": [
    {
      "employee_id": "E01",
      "priority": 2,
      "pickup":  { "lat": 12.9352, "lon": 77.6245 },
      "dropoff": { "lat": 12.9716, "lon": 77.5946 },
      "earlyTime": 480,
      "lateTime": 510,
      "load": 1,
      "vehiclePreference": "any",
      "sharingLimit": 3
    }
  ]
}
```

Times are **minutes from midnight** (e.g. 480 = 08:00, 540 = 09:00).

**Response:** `{ jobId, status: "success", result: { routes, unassigned, summary, constraintAnalysis } }`

### `POST /api/parse`

Upload an Excel file (`.xlsx`) → returns parsed JSON preview.

### `GET /api/health`

Returns solver binary status.

---

## Deployment

The project deploys to **Render.com** via `render.yaml`:

- **Backend:** Docker runtime — builds the C++ solver inside the container and starts the Node.js API.
- **Frontend:** Static site — `npm run build` → serves `frontend/dist/`.

All environment variables for production are configured in `render.yaml`.

---

## Test Cases

Five pre-built test cases are in `data/json/tc0X_input.json`:

| TC | Employees | Vehicles | Notes |
|----|-----------|----------|-------|
| tc01 | 5 | 3 | Basic convergence test |
| tc02 | 8 | 3 | Mixed priorities |
| tc03 | 10 | 4 | Sharing limits |
| tc04 | 15 | 5 | Penalty-dominated (tight windows) |
| tc05 | 12 | 4 | OSRM vs haversine comparison |

Run a test case via the UI (Test Cases tab) or directly:

```bash
./solver/build/velora_solver data/json/tc01_input.json out.json
```

---

## References

- Solomon, M.M. (1987). *Algorithms for the Vehicle Routing and Scheduling Problems with Time Window Constraints.* Operations Research, 35(2), 254–265.
- Ropke, S. & Pisinger, D. (2006). *An Adaptive Large Neighborhood Search Heuristic for the Pickup and Delivery Problem with Time Windows.* Transportation Science, 40(4), 455–472.
