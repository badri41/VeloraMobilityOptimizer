/***
 * VELORA MOBILITY OPTIMIZER - HVRPSTW SOLVER
 * Heterogeneous Vehicle Routing Problem with Soft Time Windows
 * 
 * Algorithm: 4-Phase Metaheuristic (designed for minimum cost, every run)
 *   Phase 1: Solomon I1 Greedy Constructive Heuristic (up to 20 restarts, deadline-bounded)
 *   Phase 2: Simulated Annealing — terminates by maxNoImprove (deterministic with seed=42)
 *   Phase 3: Adaptive Large Neighborhood Search (ALNS) — 3 destroy strategies + regret-2 repair
 *   Phase 4: Post-ALNS SA Polish — fine-grained local search from ALNS best solution
 *
 * SA Operators:
 *   1. Greedy Relocate  — best-reinsertion of a request across all routes (28%)
 *   2. Intra-Route      — best-reinsertion within the same route (28%)
 *   3. Exchange         — swap requests between routes (18%)
 *   4. 2-Opt            — segment reversal within a route (13%)
 *   5. Or-Opt           — chain move of 1-2 stops (13%)
 *
 * ALNS Destroy Strategies (Ropke & Pisinger adaptive scoring):
 *   0. Shaw Removal        — geographic relatedness clustering
 *   1. Random Removal      — uniform random for diversification
 *   2. Route Removal       — evict worst route entirely (plateau escape)
 *   Repair: Regret-2 Heuristic
 * 
 * Based on research papers:
 * - Solomon (1987): "Algorithms for the Vehicle Routing and Scheduling Problems with Time Window Constraints"
 * - Ropke & Pisinger (2006): "An Adaptive Large Neighborhood Search Heuristic for the PDPTW"
 * - HVRPSTW Case Studies for cost optimization
 * 
 * Cost Function (from research): 
 *   Min = Σ(distance_ij * cost_per_km) + Σ(early_penalty) + Σ(late_penalty) + soft_constraint_penalties
 * 
 * Constraints:
 *   HARD: Vehicle capacity, Pickup before dropoff precedence
 *   SOFT: Time windows (with priority-based tolerances), Sharing limits, Vehicle preferences
 */
#include <iostream>
#include <vector>
#include <cmath>
#include <algorithm>
#include <limits>
#include <random>
#include <iomanip>
#include <fstream>
#include <string>
#include <numeric>
#include <unordered_set>
#include <unordered_map>
#include <chrono>
#include <sstream>

#include "json.hpp"
#include "map_distance.hpp"

using json = nlohmann::json;
using namespace std;

struct Location { 
    double lat, lon; 
    
    bool operator==(const Location& o) const {
        return abs(lat - o.lat) < 1e-6 && abs(lon - o.lon) < 1e-6;
    }
};

enum StopType { PICKUP, DROPOFF };

struct Request {
    int id;
    string employeeId;
    int priority;           // 1 (highest) to 5 (lowest)
    Location pickup;
    Location dropoff;
    double earlyTime;       // Earliest pickup time (minutes from midnight)
    double lateTime;        // Latest drop time (minutes from midnight)
    int load;
    string vehiclePreference;  // "any", "premium", "normal", etc.
    int sharingLimit;          // Max passengers willing to share with (1=no sharing)
};

struct Vehicle {
    int id;
    string vehicleId;
    int capacity;
    double costPerKm;
    Location startLoc;
    double availabilityTime;   // Minutes from midnight
    double speed;              // km/h - CRITICAL: each vehicle has its own speed
    string type;               // "premium", "normal", "van", etc.
    string category;
    string fuelType;
};

struct Stop {
    int reqId;
    StopType type;
    Location loc;
    double arrivalTime{0};
    double departureTime{0};
    double waitTime{0};        // Time spent waiting for time window to open
};

struct Route {
    int vehicleId{-1};
    vector<Stop> stops;
    double totalDist{0};       // Total distance in km
    double totalTime{0};       // Total time in minutes
    double totalCost{0};       // Monetary cost (distance * costPerKm)
    double penaltyCost{0};     // Penalty cost for constraint violations
    double totalRouteCost{0};  // wCost*moneyCost + wTime*totalTime + penaltyCost
};

struct Solution {
    vector<Route> routes;
    vector<int> unassignedReqs;
    double totalMoneyCost{0};
    double totalPenaltyCost{0};
    double globalCost{0};
};

// Baseline data for comparison
struct BaselineEntry {
    string employeeId;
    double baselineCost;
    double baselineTime;
};

// ============== GLOBAL CONTEXT ==============

struct SolverContext {
    // Priority-based delay tolerances (minutes) - from metadata
    unordered_map<int, double> maxDelayByPriority;
    
    // Objective weights
    double wCost{0.7};
    double wTime{0.3};
    
    // Penalty weights (tuned based on research papers)
    double earlyArrivalPenaltyPerMin{0.0};      // Waiting cost
    double lateArrivalPenaltyPerMin{10.0};      // Base late penalty
    double sharingViolationPenalty{500.0};      // Per occurrence
    double vehiclePrefViolationPenalty{300.0};  // Per request
    double unassignedPenalty{50000.0};          // Must assign everyone if possible
    double maxDelayViolationPenalty{100000.0};  // Hard constraint violation
    
    // Service time per stop (loading/unloading)
    double serviceTimePerStop{0.0};  // minutes
    
    // Default speed if not specified
    double defaultSpeedKmph{30.0};
    
    // Baseline data
    vector<BaselineEntry> baseline;
    
    double getMaxDelay(int priority) const {
        int p = max(1, min(5, priority));
        auto it = maxDelayByPriority.find(p);
        if (it != maxDelayByPriority.end()) return it->second;
        static const double defaults[] = {5, 10, 15, 20, 30};
        return defaults[p - 1];
    }
} gCtx;

static MapDistance* gMapDist = nullptr;

// ============== DISTANCE MATRIX (Pre-computed NxN) ==============

class DistanceMatrix {
public:
    bool enabled{false};

    // Collect unique locations, build index, compute matrix
    void build(const vector<Vehicle>& vehicles, const vector<Request>& requests, MapDistance& mapDist) {
        vector<pair<double,double>> coords;
        auto addLoc = [&](double lat, double lon) {
            for (size_t i = 0; i < coords.size(); ++i) {
                if (abs(coords[i].first - lat) < 1e-6 && abs(coords[i].second - lon) < 1e-6)
                    return;
            }
            coords.push_back({lat, lon});
        };

        for (const auto& v : vehicles) addLoc(v.startLoc.lat, v.startLoc.lon);
        for (const auto& r : requests) {
            addLoc(r.pickup.lat, r.pickup.lon);
            addLoc(r.dropoff.lat, r.dropoff.lon);
        }

        N_ = coords.size();
        coords_ = coords;
        cout << "Distance matrix: " << N_ << " unique locations" << endl;

        // Compute NxN matrix via Table API (single HTTP call)
        matrix_ = mapDist.computeDistanceTable(coords);

        // Build coordinate-to-index lookup
        for (size_t i = 0; i < coords_.size(); ++i) {
            string key = makeKey(coords_[i].first, coords_[i].second);
            locIndex_[key] = i;
        }

        enabled = true;
    }

    // Lookup distance from matrix
    double lookup(double lat1, double lon1, double lat2, double lon2) const {
        if (!enabled) return -1;
        if (abs(lat1 - lat2) < 1e-6 && abs(lon1 - lon2) < 1e-6) return 0.0;

        string k1 = makeKey(lat1, lon1);
        string k2 = makeKey(lat2, lon2);
        auto it1 = locIndex_.find(k1);
        auto it2 = locIndex_.find(k2);
        if (it1 == locIndex_.end() || it2 == locIndex_.end()) return -1;

        return matrix_[it1->second * N_ + it2->second];
    }

private:
    size_t N_{0};
    vector<pair<double,double>> coords_;
    vector<double> matrix_;
    unordered_map<string, size_t> locIndex_;

    static string makeKey(double lat, double lon) {
        // Match with 5-decimal precision
        char buf[64];
        snprintf(buf, sizeof(buf), "%.5f,%.5f", lat, lon);
        return string(buf);
    }
};

static DistanceMatrix gDistMatrix;

// ============== UTILITY FUNCTIONS ==============

double getDistance(const Location& a, const Location& b) {
    // Use pre-computed matrix if available
    if (gDistMatrix.enabled) {
        double d = gDistMatrix.lookup(a.lat, a.lon, b.lat, b.lon);
        if (d >= 0) return d;
    }
    // Fallback to individual API call
    if (!gMapDist) {
        cerr << "[FATAL] MapDistance not initialized!" << endl;
        exit(1);
    }
    return gMapDist->distance(a.lat, a.lon, b.lat, b.lon);
}

// Convert distance to travel time using vehicle speed
double getTravelTime(double distKm, double speedKmph) {
    if (speedKmph <= 0) speedKmph = gCtx.defaultSpeedKmph;
    return (distKm / speedKmph) * 60.0;  // Return minutes
}

// Priority-based delay penalty weight (higher priority = higher penalty)
double getPriorityWeight(int priority) {
    int p = max(1, min(5, priority));
    // P1: 50, P2: 40, P3: 30, P4: 20, P5: 10
    return (6 - p) * 10.0;
}

// ============== ROUTE VALIDATION & COST CALCULATION ==============

struct RouteEvaluation {
    bool feasible{true};
    double totalDist{0};
    double totalTime{0};
    double moneyCost{0};
    double penaltyCost{0};
    double totalCost{0};
    vector<double> arrivalTimes;
    vector<double> waitTimes;
    string infeasibilityReason;
};

RouteEvaluation evaluateRoute(const Route& r, const Vehicle& v, const vector<Request>& reqs) {
    RouteEvaluation eval;
    if (r.stops.empty()) return eval;

    // First check pickup-before-dropoff constraint
    // Use flat bool array — fits in L1 cache (max 200 requests)
    bool pickedUp[205] = {};
    for (const auto& stop : r.stops) {
        if (stop.type == PICKUP) {
            pickedUp[stop.reqId] = true;
        } else {  // DROPOFF
            if (!pickedUp[stop.reqId]) {
                eval.feasible = false;
                eval.infeasibilityReason = "Dropoff before pickup for request " + to_string(stop.reqId);
                return eval;
            }
        }
    }
    
    double currentTime = v.availabilityTime;
    Location currentLoc = v.startLoc;
    double speedKmph = (v.speed > 0) ? v.speed : gCtx.defaultSpeedKmph;

    int currentLoad = 0;
    // Flat bool array for active passengers — L1-cache friendly
    bool activePassengers[205] = {};
    int activeCount = 0;  // Number of currently active passengers

    for (size_t i = 0; i < r.stops.size(); ++i) {
        const Stop& stop = r.stops[i];
        const Request& req = reqs[stop.reqId];
        
        // 1. Travel to this stop
        double dist = getDistance(currentLoc, stop.loc);
        double travelTime = getTravelTime(dist, speedKmph);
        eval.totalDist += dist;
        currentTime += travelTime;
        
        // 2. Handle time window and waiting
        double waitTime = 0;
        if (stop.type == PICKUP) {
            // Can't pick up before earliest time
            if (currentTime < req.earlyTime) {
                waitTime = req.earlyTime - currentTime;
                currentTime = req.earlyTime;
            }
        }
        eval.waitTimes.push_back(waitTime);
        eval.arrivalTimes.push_back(currentTime);
        
        // 3. Waiting penalty (opportunity cost)
        if (waitTime > 0) {
            eval.penaltyCost += waitTime * gCtx.earlyArrivalPenaltyPerMin;
        }
        
        // 4. Update load and check constraints
        if (stop.type == PICKUP) {
            currentLoad += req.load;
            activePassengers[stop.reqId] = true;
            ++activeCount;

            // HARD CONSTRAINT: Capacity
            if (currentLoad > v.capacity) {
                eval.feasible = false;
                eval.infeasibilityReason = "Capacity exceeded";
                return eval;
            }

            // SOFT CONSTRAINT: Vehicle preference
            if (req.vehiclePreference != "any" && v.type != "any" &&
                !v.type.empty() && req.vehiclePreference != v.type &&
                req.vehiclePreference != v.category) {
                eval.penaltyCost += gCtx.vehiclePrefViolationPenalty;
            }

            // SOFT CONSTRAINT: Sharing limit
            // Check if adding this passenger exceeds any active passenger's sharing limit
            for (size_t ai = 0; ai < r.stops.size(); ++ai) {
                if (r.stops[ai].type == PICKUP && activePassengers[r.stops[ai].reqId]) {
                    if (activeCount > reqs[r.stops[ai].reqId].sharingLimit) {
                        eval.penaltyCost += gCtx.sharingViolationPenalty;
                    }
                }
            }

        } else {  // DROPOFF
            currentLoad -= req.load;
            activePassengers[stop.reqId] = false;
            --activeCount;
            
            // SOFT CONSTRAINT: Late arrival penalty
            // Time window: [E_i, L_i] with tolerance f(P_i)
            // - Arrival <= L_i: ON-TIME, no penalty
            // - L_i < Arrival <= L_i + f(P_i): WITHIN TOLERANCE, no penalty
            // - Arrival > L_i + f(P_i): EXCEEDS TOLERANCE, severe penalty
            double maxDelay = gCtx.getMaxDelay(req.priority);
            double toleranceDeadline = req.lateTime + maxDelay;
            
            if (currentTime > toleranceDeadline) {
                // Exceeds tolerance - severe penalty
                double excessLateness = currentTime - toleranceDeadline;
                eval.penaltyCost += excessLateness * gCtx.maxDelayViolationPenalty / 100.0 * getPriorityWeight(req.priority);
            }
            // else: within L_i or within tolerance window - NO PENALTY
        }
        
        // 5. Service time
        currentTime += gCtx.serviceTimePerStop;
        currentLoc = stop.loc;
    }
    
    eval.totalTime = currentTime - v.availabilityTime;
    eval.moneyCost = eval.totalDist * v.costPerKm;
    eval.totalCost = (eval.moneyCost * gCtx.wCost) + (eval.totalTime * gCtx.wTime) + eval.penaltyCost;
    
    return eval;
}

// Quick feasibility check (cheaper than full evaluation)
bool isRouteFeasible(const Route& r, const Vehicle& v, const vector<Request>& reqs, bool strictTimeCheck = true) {
    if (r.stops.empty()) return true;

    // CRITICAL: Check pickup-before-dropoff constraint first
    // Flat bool array — avoids heap allocation on every call (huge speedup in inner loops)
    bool pickedUp[205] = {};
    for (const auto& stop : r.stops) {
        if (stop.type == PICKUP) {
            pickedUp[stop.reqId] = true;
        } else {  // DROPOFF
            if (!pickedUp[stop.reqId]) {
                return false;  // Dropoff before pickup - INVALID
            }
        }
    }
    
    double currentTime = v.availabilityTime;
    Location currentLoc = v.startLoc;
    double speedKmph = (v.speed > 0) ? v.speed : gCtx.defaultSpeedKmph;
    int currentLoad = 0;
    
    for (const auto& stop : r.stops) {
        const Request& req = reqs[stop.reqId];
        
        double dist = getDistance(currentLoc, stop.loc);
        double travelTime = getTravelTime(dist, speedKmph);
        currentTime += travelTime;
        
        if (stop.type == PICKUP) {
            if (currentTime < req.earlyTime) {
                currentTime = req.earlyTime;
            }
            currentLoad += req.load;
            if (currentLoad > v.capacity) return false;
        } else {
            currentLoad -= req.load;
            if (strictTimeCheck) {
                double maxDelay = gCtx.getMaxDelay(req.priority);
                if (currentTime > req.lateTime + maxDelay) {
                    return false;
                }
            }
        }
        
        currentTime += gCtx.serviceTimePerStop;
        currentLoc = stop.loc;
    }
    
    return true;
}

// ============== SOLUTION EVALUATION ==============

void evaluateSolution(Solution& sol, const vector<Vehicle>& vehicles, const vector<Request>& reqs) {
    sol.totalMoneyCost = 0;
    sol.totalPenaltyCost = 0;
    
    for (auto& route : sol.routes) {
        if (route.stops.empty()) {
            route.totalDist = route.totalTime = route.totalCost = route.penaltyCost = route.totalRouteCost = 0;
            continue;
        }
        
        auto eval = evaluateRoute(route, vehicles[route.vehicleId], reqs);
        route.totalDist = eval.totalDist;
        route.totalTime = eval.totalTime;
        route.totalCost = eval.moneyCost;
        route.penaltyCost = eval.penaltyCost;
        route.totalRouteCost = eval.totalCost;
        
        // Update stop arrival times
        for (size_t i = 0; i < route.stops.size() && i < eval.arrivalTimes.size(); ++i) {
            route.stops[i].arrivalTime = eval.arrivalTimes[i];
            route.stops[i].waitTime = eval.waitTimes[i];
        }
        
        sol.totalMoneyCost += eval.moneyCost;
        sol.totalPenaltyCost += eval.penaltyCost;
    }
    
    // Unassigned penalty
    sol.totalPenaltyCost += sol.unassignedReqs.size() * gCtx.unassignedPenalty;
    
    // Calculate total time across all routes (for weighted objective)
    double totalTime = 0;
    for (const auto& route : sol.routes) {
        totalTime += route.totalTime;
    }
    
    // Global cost = weighted combination
    // Formula: CTC * w_cost + TotalTime * w_time + TotalPenalty
    sol.globalCost = (sol.totalMoneyCost * gCtx.wCost) + 
                     (totalTime * gCtx.wTime) + 
                     sol.totalPenaltyCost;
}

// ============== INSERTION HEURISTIC (Solomon I1) ==============

struct InsertionResult {
    bool feasible{false};
    int pickupPos{-1};
    int dropoffPos{-1};
    double costIncrease{numeric_limits<double>::max()};
    Route newRoute;
};

InsertionResult findBestInsertion(const Route& route, int reqId, const Vehicle& v, const vector<Request>& reqs, bool relaxedMode = false) {
    InsertionResult best;
    const Request& req = reqs[reqId];

    int n = static_cast<int>(route.stops.size());

    // Cache once — recomputing inside every (p,d) pair would be O(n²) calls
    double oldCost = route.stops.empty() ? 0.0 : evaluateRoute(route, v, reqs).totalCost;

    // Stride-sample pickup positions for large routes to stay within cost budget
    const int FULL_SEARCH_THRESHOLD = 14;
    const int MAX_PICKUP_CANDIDATES = 16;

    vector<int> pickupCandidates;
    pickupCandidates.reserve(n + 1);

    if (n <= FULL_SEARCH_THRESHOLD) {
        // Small route: try every position exactly
        for (int p = 0; p <= n; ++p) pickupCandidates.push_back(p);
    } else {
        // Large route: stride-sample, always include first and last
        int step = max(1, (n + 1) / MAX_PICKUP_CANDIDATES);
        for (int p = 0; p <= n; p += step) pickupCandidates.push_back(p);
        if (pickupCandidates.back() != n) pickupCandidates.push_back(n);
    }

    // Try all valid pickup-dropoff position pairs (sampled pickup, all dropoffs)
    for (int p : pickupCandidates) {
        for (int d = p + 1; d <= n + 1; ++d) {
            Route trial = route;

            // Insert pickup at position p
            Stop pickup{reqId, PICKUP, req.pickup, 0, 0, 0};
            trial.stops.insert(trial.stops.begin() + p, pickup);

            // Insert dropoff at position d (index into post-pickup-insertion route)
            Stop dropoff{reqId, DROPOFF, req.dropoff, 0, 0, 0};
            trial.stops.insert(trial.stops.begin() + d, dropoff);

            // Check feasibility
            if (!isRouteFeasible(trial, v, reqs, !relaxedMode)) continue;

            // Evaluate cost
            auto eval = evaluateRoute(trial, v, reqs);
            if (!eval.feasible) continue;

            double costInc = eval.totalCost - oldCost;  // uses cached oldCost

            if (costInc < best.costIncrease) {
                best.feasible = true;
                best.pickupPos = p;
                best.dropoffPos = d;
                best.costIncrease = costInc;
                best.newRoute = std::move(trial);
            }
        }
    }

    return best;
}

// ============== CONSTRUCTION HEURISTIC ==============

Solution constructInitialSolution(const vector<Request>& reqs, const vector<Vehicle>& vehicles, mt19937& gen) {
    Solution sol;
    sol.routes.resize(vehicles.size());
    for (size_t i = 0; i < vehicles.size(); ++i) {
        sol.routes[i].vehicleId = static_cast<int>(i);
    }
    
    // Sort requests by priority (ascending) then by latest drop time (ascending)
    vector<int> reqOrder(reqs.size());
    iota(reqOrder.begin(), reqOrder.end(), 0);
    sort(reqOrder.begin(), reqOrder.end(), [&](int a, int b) {
        if (reqs[a].priority != reqs[b].priority) return reqs[a].priority < reqs[b].priority;
        return reqs[a].lateTime < reqs[b].lateTime;
    });
    
    // Slight randomization within same priority bucket
    for (size_t i = 0; i < reqOrder.size();) {
        size_t j = i + 1;
        while (j < reqOrder.size() && reqs[reqOrder[j]].priority == reqs[reqOrder[i]].priority) ++j;
        shuffle(reqOrder.begin() + i, reqOrder.begin() + j, gen);
        i = j;
    }
    
    // Insert each request using best insertion
    for (int reqId : reqOrder) {
        double bestCost = numeric_limits<double>::max();
        int bestVehicle = -1;
        Route bestRoute;
        
        // Try strict insertion first (respecting all constraints)
        for (size_t v = 0; v < vehicles.size(); ++v) {
            auto ins = findBestInsertion(sol.routes[v], reqId, vehicles[v], reqs, false);
            if (ins.feasible && ins.costIncrease < bestCost) {
                bestCost = ins.costIncrease;
                bestVehicle = static_cast<int>(v);
                bestRoute = std::move(ins.newRoute);
            }
        }
        
        // If strict insertion failed, try relaxed mode
        if (bestVehicle < 0) {
            for (size_t v = 0; v < vehicles.size(); ++v) {
                auto ins = findBestInsertion(sol.routes[v], reqId, vehicles[v], reqs, true);
                if (ins.feasible && ins.costIncrease < bestCost) {
                    bestCost = ins.costIncrease;
                    bestVehicle = static_cast<int>(v);
                    bestRoute = std::move(ins.newRoute);
                }
            }
        }
        
        if (bestVehicle >= 0) {
            sol.routes[bestVehicle] = std::move(bestRoute);
        } else {
            sol.unassignedReqs.push_back(reqId);
        }
    }
    
    evaluateSolution(sol, vehicles, reqs);
    return sol;
}

// ============== LOCAL SEARCH OPERATORS ==============

void removeRequestFromRoute(Route& r, int reqId) {
    r.stops.erase(
        remove_if(r.stops.begin(), r.stops.end(), 
                  [reqId](const Stop& s) { return s.reqId == reqId; }),
        r.stops.end()
    );
}

vector<int> getRequestsInRoute(const Route& r) {
    // Flat bool array — faster than unordered_set for small request counts
    bool seen[205] = {};
    vector<int> result;
    for (const auto& s : r.stops) {
        if (!seen[s.reqId]) {
            seen[s.reqId] = true;
            result.push_back(s.reqId);
        }
    }
    return result;
}

// Exchange: Swap requests between two routes
Solution exchangeMove(const Solution& current, const vector<Request>& reqs, const vector<Vehicle>& vehicles, mt19937& gen) {
    Solution neighbor = current;
    
    vector<int> nonEmptyRoutes;
    for (size_t i = 0; i < neighbor.routes.size(); ++i) {
        if (!neighbor.routes[i].stops.empty()) nonEmptyRoutes.push_back(static_cast<int>(i));
    }
    if (nonEmptyRoutes.size() < 2) return current;
    
    uniform_int_distribution<> routeDist(0, static_cast<int>(nonEmptyRoutes.size()) - 1);
    int r1Idx = nonEmptyRoutes[routeDist(gen)];
    int r2Idx;
    do { r2Idx = nonEmptyRoutes[routeDist(gen)]; } while (r2Idx == r1Idx);
    
    auto reqs1 = getRequestsInRoute(neighbor.routes[r1Idx]);
    auto reqs2 = getRequestsInRoute(neighbor.routes[r2Idx]);
    if (reqs1.empty() || reqs2.empty()) return current;
    
    uniform_int_distribution<> req1Dist(0, static_cast<int>(reqs1.size()) - 1);
    uniform_int_distribution<> req2Dist(0, static_cast<int>(reqs2.size()) - 1);
    int reqId1 = reqs1[req1Dist(gen)];
    int reqId2 = reqs2[req2Dist(gen)];
    
    // Remove both
    removeRequestFromRoute(neighbor.routes[r1Idx], reqId1);
    removeRequestFromRoute(neighbor.routes[r2Idx], reqId2);
    
    // Insert swapped
    auto ins1 = findBestInsertion(neighbor.routes[r1Idx], reqId2, vehicles[r1Idx], reqs, true);
    auto ins2 = findBestInsertion(neighbor.routes[r2Idx], reqId1, vehicles[r2Idx], reqs, true);
    
    if (ins1.feasible && ins2.feasible) {
        neighbor.routes[r1Idx] = std::move(ins1.newRoute);
        neighbor.routes[r2Idx] = std::move(ins2.newRoute);
        evaluateSolution(neighbor, vehicles, reqs);
        return neighbor;
    }
    
    return current;
}

// 2-opt within a single route
Solution twoOptMove(const Solution& current, const vector<Request>& reqs,
                    const vector<Vehicle>& vehicles, mt19937& gen) {
    Solution neighbor = current;
    
    vector<int> nonEmptyRoutes;
    for (size_t i = 0; i < neighbor.routes.size(); ++i) {
        if (neighbor.routes[i].stops.size() >= 4) nonEmptyRoutes.push_back(static_cast<int>(i));
    }
    if (nonEmptyRoutes.empty()) return current;
    
    uniform_int_distribution<> routeDist(0, static_cast<int>(nonEmptyRoutes.size()) - 1);
    int routeIdx = nonEmptyRoutes[routeDist(gen)];
    Route& route = neighbor.routes[routeIdx];
    
    int n = static_cast<int>(route.stops.size());
    uniform_int_distribution<> posDist(0, n - 1);
    int i = posDist(gen);
    int j = posDist(gen);
    if (i > j) swap(i, j);
    if (j - i < 2) return current;
    
    // Reverse segment [i, j]
    reverse(route.stops.begin() + i, route.stops.begin() + j + 1);
    
    // Check if still feasible
    if (isRouteFeasible(route, vehicles[routeIdx], reqs, false)) {
        evaluateSolution(neighbor, vehicles, reqs);
        return neighbor;
    }
    
    return current;
}

// Greedy Relocate: Move a request to its BEST route (tries all vehicles)
Solution greedyRelocateMove(const Solution& current, const vector<Request>& reqs,
                            const vector<Vehicle>& vehicles, mt19937& gen) {
    Solution neighbor = current;

    vector<int> nonEmptyRoutes;
    for (size_t i = 0; i < neighbor.routes.size(); ++i) {
        if (!neighbor.routes[i].stops.empty()) nonEmptyRoutes.push_back(static_cast<int>(i));
    }
    if (nonEmptyRoutes.empty()) return current;

    uniform_int_distribution<> routeDist(0, static_cast<int>(nonEmptyRoutes.size()) - 1);
    int srcRouteIdx = nonEmptyRoutes[routeDist(gen)];

    auto reqIds = getRequestsInRoute(neighbor.routes[srcRouteIdx]);
    if (reqIds.empty()) return current;

    uniform_int_distribution<> reqDist(0, static_cast<int>(reqIds.size()) - 1);
    int reqId = reqIds[reqDist(gen)];

    // Remove from source
    removeRequestFromRoute(neighbor.routes[srcRouteIdx], reqId);

    // Try ALL routes, pick the cheapest feasible insertion
    double bestCost = numeric_limits<double>::max();
    int bestRoute = -1;
    Route bestNewRoute;

    for (size_t v = 0; v < vehicles.size(); ++v) {
        auto ins = findBestInsertion(neighbor.routes[v], reqId, vehicles[v], reqs, true);
        if (ins.feasible && ins.costIncrease < bestCost) {
            bestCost = ins.costIncrease;
            bestRoute = static_cast<int>(v);
            bestNewRoute = std::move(ins.newRoute);
        }
    }

    if (bestRoute >= 0) {
        neighbor.routes[bestRoute] = std::move(bestNewRoute);
        evaluateSolution(neighbor, vehicles, reqs);
        return neighbor;
    }

    return current;
}

// Intra-route Relocate: Remove a request from its route and re-insert at the
// best position *within the same route* (Or-opt style).
// Explores orderings the construction heuristic couldn't reach.
Solution intraRouteRelocateMove(const Solution& current, const vector<Request>& reqs,
                                const vector<Vehicle>& vehicles, mt19937& gen) {
    Solution neighbor = current;

    // Need routes with ≥ 2 requests (4 stops) so removal still leaves a route to insert into
    vector<int> eligibleRoutes;
    for (size_t i = 0; i < neighbor.routes.size(); ++i) {
        if (neighbor.routes[i].stops.size() >= 4)
            eligibleRoutes.push_back(static_cast<int>(i));
    }
    if (eligibleRoutes.empty()) return current;

    uniform_int_distribution<> routeDist(0, static_cast<int>(eligibleRoutes.size()) - 1);
    int routeIdx = eligibleRoutes[routeDist(gen)];

    auto reqIds = getRequestsInRoute(neighbor.routes[routeIdx]);
    if (reqIds.size() < 2) return current;

    uniform_int_distribution<> reqDist(0, static_cast<int>(reqIds.size()) - 1);
    int reqId = reqIds[reqDist(gen)];

    // Remove from route
    removeRequestFromRoute(neighbor.routes[routeIdx], reqId);

    // Re-insert at best position in the SAME route
    auto ins = findBestInsertion(neighbor.routes[routeIdx], reqId, vehicles[routeIdx], reqs, true);

    if (ins.feasible) {
        neighbor.routes[routeIdx] = std::move(ins.newRoute);
        evaluateSolution(neighbor, vehicles, reqs);
        return neighbor;
    }

    return current;
}

// Or-opt: move a chain of 1-2 consecutive stops to another position in the same route.
// More PDPTW-friendly than 2-opt (no reversal = no precedence breakage).
Solution orOptMove(const Solution& current, const vector<Request>& reqs,
                   const vector<Vehicle>& vehicles, mt19937& gen) {
    Solution neighbor = current;

    vector<int> eligibleRoutes;
    for (size_t i = 0; i < neighbor.routes.size(); ++i) {
        if (neighbor.routes[i].stops.size() >= 4)
            eligibleRoutes.push_back(static_cast<int>(i));
    }
    if (eligibleRoutes.empty()) return current;

    uniform_int_distribution<> routeDist(0, static_cast<int>(eligibleRoutes.size()) - 1);
    int routeIdx = eligibleRoutes[routeDist(gen)];
    Route& route = neighbor.routes[routeIdx];

    int n = static_cast<int>(route.stops.size());

    // Pick chain length 1, 2, or 3 (Or-opt-3)
    int maxChain = min(3, n - 2);
    if (maxChain < 1) return current;
    uniform_int_distribution<> chainDist(1, maxChain);
    int chainLen = chainDist(gen);

    uniform_int_distribution<> posDist(0, n - chainLen - 1);
    int fromPos = posDist(gen);

    // Extract the chain
    vector<Stop> chain(route.stops.begin() + fromPos,
                       route.stops.begin() + fromPos + chainLen);
    route.stops.erase(route.stops.begin() + fromPos,
                      route.stops.begin() + fromPos + chainLen);

    // Insert at a random different position
    int newN = static_cast<int>(route.stops.size());
    if (newN == 0) return current;
    uniform_int_distribution<> insertDist(0, newN);
    int toPos = insertDist(gen);

    route.stops.insert(route.stops.begin() + toPos, chain.begin(), chain.end());

    if (isRouteFeasible(route, vehicles[routeIdx], reqs, false)) {
        evaluateSolution(neighbor, vehicles, reqs);
        return neighbor;
    }

    return current;
}

// ============== SIMULATED ANNEALING ==============

using Clock = chrono::steady_clock;

Solution simulatedAnnealing(const Solution& initial, const vector<Request>& reqs,
                            const vector<Vehicle>& vehicles, mt19937& gen,
                            Clock::time_point deadline,
                            ostream* convergenceLog = nullptr,
                            int maxNoImproveOverride = -1) {  // -1 = compute from scale

    Solution current = initial;
    Solution best = initial;

    // ── Scale SA parameters based on problem complexity ──────────────────────
    // "avgRouteStops" captures how large and expensive each move is.
    // For 50 emps / 2 vehicles: avgRouteStops ≈ 50 → very expensive per move.
    // For 10 emps / 5 vehicles: avgRouteStops ≈  4 → cheap, allow more iters.
    int nonEmptyCount = 0;
    int totalStops = 0;
    for (const auto& r : initial.routes) {
        if (!r.stops.empty()) {
            ++nonEmptyCount;
            totalStops += static_cast<int>(r.stops.size());
        }
    }
    int avgRouteStops = (nonEmptyCount > 0) ? (totalStops / nonEmptyCount) : 1;

    // Scale down iterations for large routes (expensive moves):
    //   avgRouteStops =  4 → scale=1  → maxIterPerTemp=80
    //   avgRouteStops = 20 → scale=5  → maxIterPerTemp=16
    //   avgRouteStops = 50 → scale=12 → maxIterPerTemp= 6
    int scale = max(1, avgRouteStops / 4);
    int maxIterPerTemp = max(5,  80 / scale);

    // maxNoImprove scales purely by problem complexity (not wall-clock).
    // SA terminates deterministically via this count (seed=42 → same path every run).
    // Phase 4 polish passes a smaller override to focus on fine-grained local search.
    int maxNoImprove = (maxNoImproveOverride > 0)? maxNoImproveOverride : max(100, 2000 / scale);  // scale=1→2000, scale=2→1000, scale=12→167

    // ── Calibrated initial temperature ──────────────────────────────────────
    // T₀ proportional to initial cost prevents wild acceptance of terrible moves.
    // T₀ = 1000 with globalCost ≈ 700 means exp(-500/1000) = 60% acceptance of +500 moves (too hot).
    // T₀ = 0.3 * globalCost → exp(-500/210) = 9% acceptance (controlled exploration).
    // Cap at 1000: penalty-heavy instances (globalCost 3M+) must not get absurd T.
    double T    = max(100.0, min(initial.globalCost * 0.3, 1000.0));
    double Tmin = 1.0;

    // Faster cooling for large routes to stay within time budget.
    double alpha = (avgRouteStops > 30) ? 0.985 : 0.99;

    // Whether exchange is even possible (needs ≥2 non-empty routes)
    bool canExchange = (nonEmptyCount >= 2);

    // ── Operator probability weights ────────────────────────────────────────
    // 5 core operators: Greedy Relocate, Exchange, Intra-Route Relocate, 2-Opt, Or-Opt.
    // Greedy Relocate + Intra-Route are the two highest-value movers (~26% each in ablation).
    // Exchange requires ≥2 active routes; without it its weight shifts to intra-route.
    vector<double> opWeights;
    if (canExchange) {
        // 0:greedyRelocate  1:exchange  2:intraRoute  3:twoOpt  4:orOpt
        opWeights = {28, 18, 28, 13, 13};
    } else {
        // 0:greedyRelocate  1:intraRoute  2:twoOpt  3:orOpt
        opWeights = {32, 36, 16, 16};
    }
    discrete_distribution<> opDist(opWeights.begin(), opWeights.end());

    int noImproveCount = 0;
    int iteration = 0;

    while (T > Tmin && noImproveCount < maxNoImprove) {
        // ── Wall-clock time limit — prevents runaway on any input ──────────
        if (Clock::now() >= deadline) {
            cout << "SA time limit reached at iteration " << iteration << endl;
            break;
        }

        for (int iter = 0; iter < maxIterPerTemp; ++iter) {
            ++iteration;

            // Dispatch to operator selected by weighted distribution
            Solution neighbor;
            int op = opDist(gen);
            if (canExchange) {
                switch (op) {
                    case 0: neighbor = greedyRelocateMove(current, reqs, vehicles, gen);     break;
                    case 1: neighbor = exchangeMove(current, reqs, vehicles, gen);           break;
                    case 2: neighbor = intraRouteRelocateMove(current, reqs, vehicles, gen); break;
                    case 3: neighbor = twoOptMove(current, reqs, vehicles, gen);             break;
                    default: neighbor = orOptMove(current, reqs, vehicles, gen);             break;
                }
            } else {
                switch (op) {
                    case 0: neighbor = greedyRelocateMove(current, reqs, vehicles, gen);     break;
                    case 1: neighbor = intraRouteRelocateMove(current, reqs, vehicles, gen); break;
                    case 2: neighbor = twoOptMove(current, reqs, vehicles, gen);             break;
                    default: neighbor = orOptMove(current, reqs, vehicles, gen);             break;
                }
            }

            // Skip if move made no change
            if (abs(neighbor.globalCost - current.globalCost) < 1e-9 &&
                neighbor.unassignedReqs.size() == current.unassignedReqs.size()) {
                if (convergenceLog) {
                    (*convergenceLog) << iteration << ',' << current.globalCost << ','
                                     << best.globalCost << ',' << T << '\n';
                }
                continue;
            }

            double delta = neighbor.globalCost - current.globalCost;

            bool accept = false;
            if (delta < 0) {
                accept = true;
            } else {
                uniform_real_distribution<> prob(0.0, 1.0);
                if (prob(gen) < exp(-delta / T)) accept = true;
            }

            if (accept) {
                current = std::move(neighbor);
                if (current.globalCost < best.globalCost) {
                    best = current;
                    noImproveCount = 0;
                } else {
                    ++noImproveCount;
                }
            } else {
                ++noImproveCount;
            }

            if (convergenceLog) {
                (*convergenceLog) << iteration << ',' << current.globalCost << ','
                                 << best.globalCost << ',' << T << '\n';
            }
        }

        T *= alpha;

        // ── Adaptive reheating: escape local minima ─────────────────────────
        // Every maxNoImprove/3 stagnant steps, reheat temperature for fresh exploration.
        int reheatInterval = max(30, maxNoImprove / 3);
        if (noImproveCount > 0 && noImproveCount % reheatInterval == 0) {
            double reheatT = max(T * 3.0, best.globalCost * 0.02);
            double maxT = max(100.0, min(best.globalCost * 0.3, 1000.0));
            T = min(reheatT, maxT);
        }
    }

    cout << "SA completed: " << iteration << " iters, avgRouteStops=" << avgRouteStops
         << ", maxIterPerTemp=" << maxIterPerTemp << ", maxNoImprove=" << maxNoImprove
         << ", T0=" << fixed << setprecision(1) << max(100.0, min(initial.globalCost * 0.3, 1000.0))
         << ", alpha=" << setprecision(3) << alpha
         << ", finalT=" << setprecision(3) << T << endl;
    return best;
}

// ============== PHASE 3: LARGE NEIGHBORHOOD SEARCH (LNS) ==============
// Iterative destroy-repair: removes a subset of requests and re-inserts them
// using regret-2 heuristic. This provides diversification that SA alone cannot.

Solution largeNeighborhoodSearch(const Solution& initial, const vector<Request>& reqs,
                                 const vector<Vehicle>& vehicles, mt19937& gen,
                                 Clock::time_point deadline) {
    Solution best = initial;
    Solution current = initial;

    int numRequests = static_cast<int>(reqs.size());
    // Destroy 20-50% of requests per iteration for aggressive exploration
    int minDestroy = max(2, numRequests / 5);
    int maxDestroy = max(4, numRequests / 2);

    int iteration = 0;
    int noImproveCount = 0;
    int maxNoImprove = max(100, numRequests * 8);  // more patient — ALNS has the time budget

    // ── ALNS: Adaptive operator weights ────────────────────────────────────
    // 3 destroy operators: 0=Shaw, 1=Random, 2=Route Removal
    // Worst Removal removed — penalty-based targeting adds noise for penalty-free cases.
    double opScore[3] = {1.0, 1.0, 1.0};
    uniform_real_distribution<> prob01(0.0, 1.0);

    // SA temperature for ALNS acceptance (Ropke-style probabilistic acceptance)
    double T_alns = max(10.0, initial.globalCost * 0.02);
    const double T_alns_min = 0.1;
    const double alpha_alns = 0.998;

    while (Clock::now() < deadline && noImproveCount < maxNoImprove) {
        ++iteration;
        Solution candidate = current;

        // Determine destroy size with some randomization
        uniform_int_distribution<> destroySizeDist(minDestroy, maxDestroy);
        int destroySize = destroySizeDist(gen);

        // ── DESTROY PHASE ──────────────────────────────────────────────────
        vector<int> removedReqs;

        // ALNS: roulette-wheel selection based on operator scores
        double totalScore = opScore[0] + opScore[1] + opScore[2];
        double r = prob01(gen) * totalScore;
        int strategy = 0;
        if (r > opScore[0]) { r -= opScore[0]; strategy = 1; }
        if (strategy == 1 && r > opScore[1]) { strategy = 2; }

        if (strategy == 0) {
            // SHAW REMOVAL: remove geographically related requests
            // Pick a seed request, then remove its nearest neighbors
            vector<int> allReqs;
            for (const auto& route : candidate.routes) {
                auto ids = getRequestsInRoute(route);
                allReqs.insert(allReqs.end(), ids.begin(), ids.end());
            }
            if (allReqs.empty()) continue;

            uniform_int_distribution<> seedDist(0, static_cast<int>(allReqs.size()) - 1);
            int seedReq = allReqs[seedDist(gen)];
            removedReqs.push_back(seedReq);

            // Score all other requests by relatedness (distance + time similarity)
            vector<pair<double, int>> relatedness;
            for (int reqId : allReqs) {
                if (reqId == seedReq) continue;
                double dist = getDistance(reqs[seedReq].pickup, reqs[reqId].pickup);
                double timeDiff = abs(reqs[seedReq].lateTime - reqs[reqId].lateTime);
                double score = dist + timeDiff * 0.5;  // Combined relatedness
                relatedness.push_back({score, reqId});
            }
            sort(relatedness.begin(), relatedness.end());

            // Pick closest relatives with some randomization (80% acceptance per candidate)
            for (const auto& [score, reqId] : relatedness) {
                if (static_cast<int>(removedReqs.size()) >= destroySize) break;
                if (prob01(gen) < 0.8) {
                    removedReqs.push_back(reqId);
                }
            }
        } else if (strategy == 1) {
            // RANDOM REMOVAL
            vector<int> allReqs;
            for (const auto& route : candidate.routes) {
                auto ids = getRequestsInRoute(route);
                allReqs.insert(allReqs.end(), ids.begin(), ids.end());
            }
            shuffle(allReqs.begin(), allReqs.end(), gen);
            for (int i = 0; i < min(destroySize, static_cast<int>(allReqs.size())); ++i) {
                removedReqs.push_back(allReqs[i]);
            }
        } else {
            // ROUTE REMOVAL: remove all requests from the most penalized route.
            // Forces radical restructuring — most effective for escaping plateaus.
            double worstScore = -1;
            int worstRoute = -1;
            for (size_t i = 0; i < candidate.routes.size(); ++i) {
                if (candidate.routes[i].stops.empty()) continue;
                double score = candidate.routes[i].penaltyCost + candidate.routes[i].totalDist * 0.5;
                if (score > worstScore) { worstScore = score; worstRoute = static_cast<int>(i); }
            }
            if (worstRoute >= 0) {
                removedReqs = getRequestsInRoute(candidate.routes[worstRoute]);
            }
        }

        // Actually remove the selected requests from routes
        unordered_set<int> removedSet(removedReqs.begin(), removedReqs.end());
        for (auto& route : candidate.routes) {
            route.stops.erase(
                remove_if(route.stops.begin(), route.stops.end(),
                          [&removedSet](const Stop& s) { return removedSet.count(s.reqId); }),
                route.stops.end()
            );
        }
        // Add removed to unassigned (avoid duplicates)
        for (int reqId : removedReqs) {
            candidate.unassignedReqs.push_back(reqId);
        }

        // ── REPAIR PHASE: Regret-2 Insertion ───────────────────────────────
        // Insert the request with highest regret first (regret = 2nd_best - best).
        // This prioritizes requests that have few good options.
        while (!candidate.unassignedReqs.empty() && Clock::now() < deadline) {
            int bestIdx = -1;
            double maxRegret = -numeric_limits<double>::max();
            int bestVehicleForRegret = -1;
            Route bestRouteForRegret;

            for (size_t ui = 0; ui < candidate.unassignedReqs.size(); ++ui) {
                int reqId = candidate.unassignedReqs[ui];

                double best1 = numeric_limits<double>::max();
                double best2 = numeric_limits<double>::max();
                int best1Vehicle = -1;
                Route best1Route;

                for (size_t v = 0; v < vehicles.size(); ++v) {
                    auto ins = findBestInsertion(candidate.routes[v], reqId, vehicles[v], reqs, true);
                    if (ins.feasible) {
                        if (ins.costIncrease < best1) {
                            best2 = best1;
                            best1 = ins.costIncrease;
                            best1Vehicle = static_cast<int>(v);
                            best1Route = std::move(ins.newRoute);
                        } else if (ins.costIncrease < best2) {
                            best2 = ins.costIncrease;
                        }
                    }
                }

                if (best1Vehicle < 0) continue;  // No feasible insertion

                // Regret = difference between 2nd-best and best
                double regret = (best2 < numeric_limits<double>::max() / 2)
                    ? (best2 - best1) : (best1 * 0.5);

                if (regret > maxRegret) {
                    maxRegret = regret;
                    bestIdx = static_cast<int>(ui);
                    bestVehicleForRegret = best1Vehicle;
                    bestRouteForRegret = std::move(best1Route);
                }
            }

            if (bestIdx >= 0) {
                candidate.routes[bestVehicleForRegret] = std::move(bestRouteForRegret);
                candidate.unassignedReqs.erase(candidate.unassignedReqs.begin() + bestIdx);
            } else {
                break;  // No feasible insertion for any remaining request
            }
        }

        evaluateSolution(candidate, vehicles, reqs);

        // ── ACCEPTANCE + ALNS score update (Ropke σ₁=33, σ₂=9, σ₃=3, λ=0.8) ──
        const double lambda = 0.8;
        double reward = 0;
        double delta = candidate.globalCost - current.globalCost;

        if (delta < 0) {
            current = candidate;
            if (current.globalCost < best.globalCost) {
                best = current;
                noImproveCount = 0;
                reward = 33;  // σ₁: new global best
            } else {
                ++noImproveCount;
                reward = 9;   // σ₂: improved current
            }
        } else if (T_alns > T_alns_min && prob01(gen) < exp(-delta / T_alns)) {
            current = candidate;
            ++noImproveCount;
            reward = 3;       // σ₃: accepted worse (diversification)
        } else {
            ++noImproveCount;
            reward = 0;       // rejected — no reward
        }

        opScore[strategy] = lambda * opScore[strategy] + (1.0 - lambda) * reward;
        T_alns = max(T_alns_min, T_alns * alpha_alns);
    }

    cout << "Phase 3 ALNS: " << iteration << " iterations, "
         << "best globalCost=" << fixed << setprecision(2) << best.globalCost
         << " | T_alns=" << setprecision(4) << T_alns
         << " | scores: Shaw=" << fixed << setprecision(2) << opScore[0]
         << " Rand=" << opScore[1] << " Route=" << opScore[2] << endl;
    return best;
}

// ============== MAIN ==============

int main(int argc, char** argv) {
    string inputPath = (argc > 1) ? argv[1] : "input.json";
    string outputPath = (argc > 2) ? argv[2] : "solution.json";
    string convergenceCsvPath = (argc > 3) ? argv[3] : "";

    if (convergenceCsvPath.empty()) {
        size_t dot = outputPath.find_last_of('.');
        string base = (dot == string::npos) ? outputPath : outputPath.substr(0, dot);
        convergenceCsvPath = base + "_convergence.csv";
    }
    
    // Read input
    ifstream in(inputPath);
    if (!in.is_open()) {
        cerr << "Failed to open " << inputPath << endl;
        return 1;
    }
    json j;
    try {
        in >> j;
    } catch (const exception& e) {
        cerr << "Error: failed to parse input JSON: " << e.what() << endl;
        return 1;
    }
    in.close();
    if (!j.is_object()) {
        cerr << "Error: input JSON must be an object" << endl;
        return 1;
    }
    
    cout << "========================================" << endl;
    cout << "VELORA MOBILITY OPTIMIZER - HVRPSTW" << endl;
    cout << "========================================" << endl;
    
    // Parse config
    bool allowExternal = false;
    string mapsKey;
    MapProvider mapProvider = MapProvider::OSRM;  // Default: OSRM (free, no key needed)
    long mapTimeoutMs = 2000;
    int mapMaxRetries = 2;

    if (j.contains("config")) {
        auto& cfg = j["config"];
        allowExternal = cfg.value("allow_external_maps", false);
        mapsKey = cfg.value("maps_api_key", "");

        // Parse map provider setting
        string providerStr = cfg.value("map_provider", "osrm");
        if (providerStr == "google" || providerStr == "google_maps") {
            mapProvider = MapProvider::GOOGLE_MAPS;
        } else if (providerStr == "ors" || providerStr == "openrouteservice") {
            mapProvider = MapProvider::OPENROUTESERVICE;
        } else if (providerStr == "osrm") {
            mapProvider = MapProvider::OSRM;
        } else if (providerStr == "haversine" || providerStr == "none") {
            mapProvider = MapProvider::HAVERSINE;
        }

        // Parse timeout and retry settings
        mapTimeoutMs = cfg.value("map_timeout_ms", 2000);
        mapMaxRetries = cfg.value("map_max_retries", 2);

        if (cfg.contains("weights")) {
            gCtx.wCost = cfg["weights"].value("cost", 0.7);
            gCtx.wTime = cfg["weights"].value("time", 0.3);
        }

        if (cfg.contains("tolerances")) {
            for (auto& [key, val] : cfg["tolerances"].items()) {
                try {
                    int p = stoi(key);
                    gCtx.maxDelayByPriority[p] = val.get<double>();
                } catch (...) {
                    throw std::runtime_error("Invalid priority key in tolerances: " + key);
                }
            }
        }

        if (cfg.contains("penalty_weights")) {
            auto& pw = cfg["penalty_weights"];
            gCtx.lateArrivalPenaltyPerMin = pw.value("lateArrivalPenaltyPerMin", gCtx.lateArrivalPenaltyPerMin);
            gCtx.sharingViolationPenalty = pw.value("sharingViolationPenalty", gCtx.sharingViolationPenalty);
            gCtx.vehiclePrefViolationPenalty = pw.value("vehiclePrefViolationPenalty", gCtx.vehiclePrefViolationPenalty);
            gCtx.unassignedPenalty = pw.value("unassignedPenalty", gCtx.unassignedPenalty);
            gCtx.maxDelayViolationPenalty = pw.value("maxDelayViolationPenalty", gCtx.maxDelayViolationPenalty);
            cout << "Custom penalty weights loaded: "
                 << "latePerMin=" << gCtx.lateArrivalPenaltyPerMin
                 << ", sharing=" << gCtx.sharingViolationPenalty
                 << ", vehPref=" << gCtx.vehiclePrefViolationPenalty
                 << ", unassigned=" << gCtx.unassignedPenalty
                 << ", maxDelay=" << gCtx.maxDelayViolationPenalty << endl;
        }
    }

    // Initialize MapDistance with provider configuration
    MapDistance mapDist(allowExternal, mapsKey, mapProvider);
    mapDist.setTimeout(mapTimeoutMs);
    mapDist.setMaxRetries(mapMaxRetries);

    // Log configuration
    const char* providerNames[] = {"Haversine", "Google Maps", "OpenRouteService", "OSRM"};
    cout << "Map distance: provider=" << providerNames[static_cast<int>(mapProvider)]
         << ", external=" << (allowExternal ? "enabled" : "disabled")
         << ", timeout=" << mapTimeoutMs << "ms" << endl;
    gMapDist = &mapDist;
    
    // Parse requests
    vector<Request> requests;
    if (!j.contains("requests") || !j["requests"].is_array()) {
        cerr << "Error: input JSON missing 'requests' array" << endl;
        return 1;
    }
    for (auto& jr : j["requests"]) {
        try {
            Request r;
            r.id = jr.value("id", static_cast<int>(requests.size()));
            r.employeeId = jr.value("employee_id", jr.value("employeeId", "E" + to_string(requests.size())));
            if (r.employeeId.empty()) r.employeeId = "E" + to_string(requests.size());
            r.priority = max(1, min(5, jr.value("priority", 3)));
            r.earlyTime = jr.value("earlyTime", 0.0);
            r.lateTime = jr.value("lateTime", 1440.0);
            r.load = jr.value("load", 1);
            // Safe pickup/dropoff parsing with fallback to 0,0
            if (jr.contains("pickup") && jr["pickup"].is_object()) {
                r.pickup.lat = jr["pickup"].value("lat", 0.0);
                r.pickup.lon = jr["pickup"].value("lon", 0.0);
            }
            if (jr.contains("dropoff") && jr["dropoff"].is_object()) {
                r.dropoff.lat = jr["dropoff"].value("lat", 0.0);
                r.dropoff.lon = jr["dropoff"].value("lon", 0.0);
            }
            r.vehiclePreference = jr.value("vehiclePreference", "any");
            r.sharingLimit = jr.value("sharingLimit", 100);
            requests.push_back(r);
        } catch (const exception& e) {
            cerr << "Warning: skipping malformed request at index " << requests.size()
                 << ": " << e.what() << endl;
        }
    }

    // Parse vehicles
    vector<Vehicle> vehicles;
    if (!j.contains("vehicles") || !j["vehicles"].is_array()) {
        cerr << "Error: input JSON missing 'vehicles' array" << endl;
        return 1;
    }
    for (auto& jv : j["vehicles"]) {
        try {
            Vehicle v;
            v.id = jv.value("id", static_cast<int>(vehicles.size()));
            v.vehicleId = jv.value("vehicle_id", jv.value("vehicleId", "V" + to_string(vehicles.size())));
            if (v.vehicleId.empty()) v.vehicleId = "V" + to_string(vehicles.size());
            v.capacity = jv.value("capacity", 4);
            v.costPerKm = jv.value("costPerKm", 10.0);
            if (jv.contains("startLoc") && jv["startLoc"].is_object()) {
                v.startLoc.lat = jv["startLoc"].value("lat", 0.0);
                v.startLoc.lon = jv["startLoc"].value("lon", 0.0);
            }
            v.availabilityTime = jv.value("availabilityTime", 0.0);
            v.speed = jv.value("avg_speed_kmph", jv.value("avgSpeedKmph", gCtx.defaultSpeedKmph));
            v.type = jv.value("type", jv.value("vehicle_type", "any"));
            v.category = jv.value("category", "");
            v.fuelType = jv.value("fuel_type", "");
            vehicles.push_back(v);
        } catch (const exception& e) {
            cerr << "Warning: skipping malformed vehicle at index " << vehicles.size()
                 << ": " << e.what() << endl;
        }
    }
    
    // Parse baseline if available
    if (j.contains("baseline")) {
        for (auto& jb : j["baseline"]) {
            BaselineEntry b;
            b.employeeId = jb.value("employee_id", "");
            b.baselineCost = jb.value("baseline_cost", 0.0);
            b.baselineTime = jb.value("baseline_time_min", 0.0);
            gCtx.baseline.push_back(b);
        }
    }
    
    // ── INPUT VALIDATION / HACK-PROOFING ────────────────────────────────────
    // Cap sizes to prevent memory explosion on adversarial inputs
    if (requests.size() > 200) {
        cerr << "Warning: capping requests from " << requests.size() << " to 200" << endl;
        requests.resize(200);
    }
    if (vehicles.size() > 50) {
        cerr << "Warning: capping vehicles from " << vehicles.size() << " to 50" << endl;
        vehicles.resize(50);
    }
    // Require at least 1 vehicle
    if (vehicles.empty()) {
        cerr << "Error: no vehicles provided — cannot optimize" << endl;
        return 1;
    }

    // Clamp and validate each request
    for (auto& r : requests) {
        r.priority    = max(1, min(5, r.priority));
        r.load        = max(1, min(100, r.load));
        r.earlyTime   = max(0.0, min(1440.0, r.earlyTime));
        r.lateTime    = max(0.0, min(1440.0, r.lateTime));
        if (r.lateTime <= r.earlyTime) r.lateTime = r.earlyTime + 60.0;
        r.pickup.lat  = max(-90.0,  min(90.0,  r.pickup.lat));
        r.pickup.lon  = max(-180.0, min(180.0, r.pickup.lon));
        r.dropoff.lat = max(-90.0,  min(90.0,  r.dropoff.lat));
        r.dropoff.lon = max(-180.0, min(180.0, r.dropoff.lon));
        r.sharingLimit = max(1, min(100, r.sharingLimit));
        // If pickup == dropoff (degenerate), nudge dropoff slightly
        if (abs(r.pickup.lat - r.dropoff.lat) < 1e-9 && abs(r.pickup.lon - r.dropoff.lon) < 1e-9) {
            r.dropoff.lat += 1e-5;
        }
    }

    // Clamp and validate each vehicle
    for (auto& v : vehicles) {
        v.capacity         = max(1, min(500, v.capacity));
        v.costPerKm        = max(0.01, min(10000.0, v.costPerKm));
        v.speed            = max(1.0,  min(300.0,  v.speed));
        v.availabilityTime = max(0.0,  min(1440.0, v.availabilityTime));
        // Assign sequential integer id if id field was missing/wrong
        if (v.id < 0 || v.id >= static_cast<int>(vehicles.size())) {
            v.id = static_cast<int>(&v - &vehicles[0]);
        }
    }

    cout << "Input: " << requests.size() << " requests, " << vehicles.size() << " vehicles" << endl;
    cout << "Weights: cost=" << gCtx.wCost << ", time=" << gCtx.wTime << endl;

    // ── Global wall-clock deadline ──────────────────────────────────────────
    // User-controllable runtime via config.solver_time_seconds.
    // Default: 24s (safe for backend 2-min timeout).
    // Min: 10s, Max: 300s.
    int solverTimeSeconds = 24;
    bool forceAssign = true;
    if (j.contains("config")) {
        solverTimeSeconds = j["config"].value("solver_time_seconds", 24);
        solverTimeSeconds = max(10, min(300, solverTimeSeconds));
        forceAssign = j["config"].value("force_assign", true);
    }
    cout << "Solver time budget: " << solverTimeSeconds << "s" << endl;

    auto solverStart = Clock::now();
    // Time budget: Construction/force-assign check deadline, SA terminates by maxNoImprove
    // (deterministic with seed=42), ALNS gets all remaining time, Phase 4 polish uses remainder.
    auto deadline  = solverStart + chrono::milliseconds(solverTimeSeconds * 1000LL);

    // Always pre-compute NxN distance matrix.
    // Haversine: O(N²) arithmetic, instant. OSRM: 1 table API call (10s timeout, haversine fallback).
    // This ensures all distance lookups during SA/ALNS are O(1) matrix reads.
    cout << "\nBuilding distance matrix ("
         << (mapProvider == MapProvider::HAVERSINE ? "haversine" : "OSRM table")
         << ", " << (vehicles.size() + requests.size() * 2) << " raw locations)..." << endl;
    int osrmTimeoutsBefore = MapDistance::getTimeoutFallbackCount();
    int osrmErrorsBefore   = MapDistance::getErrorFallbackCount();
    gDistMatrix.build(vehicles, requests, mapDist);
    bool osrmUsedFallback = (MapDistance::getTimeoutFallbackCount() > osrmTimeoutsBefore) ||
                            (MapDistance::getErrorFallbackCount()   > osrmErrorsBefore);
    string distanceMethodUsed = (mapProvider == MapProvider::HAVERSINE) ? "haversine"
                                : (osrmUsedFallback ? "haversine_fallback" : "osrm");
    if (osrmUsedFallback) {
        cout << "OSRM table API failed/timed out — fell back to Haversine distances." << endl;
    }

    // ── Scale construction restarts based on problem complexity ─────────────
    // More restarts = better initial solution. For n≤100 each restart is fast.
    //   avgStopsPerVeh=4  → 20 restarts   avgStopsPerVeh=20 → 5 restarts   50+ → 2 restarts
    int avgStopsPerVeh = (vehicles.empty()) ? 1
        : max(1, static_cast<int>(requests.size()) * 2 / static_cast<int>(vehicles.size()));
    int numRestarts = max(1, min(20, 100 / avgStopsPerVeh));

    cout << "\nPhase 1: Constructive Heuristic (" << numRestarts << " restarts, "
         << "avgStopsPerVeh=" << avgStopsPerVeh << ")..." << endl;

    mt19937 gen(42);
    Solution bestInit;
    bestInit.globalCost = numeric_limits<double>::max();

    for (int restart = 0; restart < numRestarts; ++restart) {
        if (Clock::now() >= deadline) {
            cout << "Construction time limit at restart " << restart << "/" << numRestarts << endl;
            break;
        }
        Solution init = constructInitialSolution(requests, vehicles, gen);
        if (init.globalCost < bestInit.globalCost) {
            bestInit = std::move(init);
        }
    }

    // Safety: if all restarts were skipped (extremely unlikely), build one solution
    if (bestInit.globalCost >= numeric_limits<double>::max()) {
        bestInit = constructInitialSolution(requests, vehicles, gen);
    }

    cout << "Initial solution: cost=" << fixed << setprecision(2) << bestInit.totalMoneyCost
         << ", penalty=" << bestInit.totalPenaltyCost
         << ", unassigned=" << bestInit.unassignedReqs.size() << endl;

    // SA is deterministic (seed=42 + terminates by maxNoImprove, not wall-clock).
    // The phase2End is a generous safety cap: SA should NEVER reach it in practice.
    // ALNS automatically gets all remaining time after SA's natural noImprove termination.
    auto phase2End = deadline - chrono::milliseconds(2000LL);

    // Improve with SA
    cout << "\nPhase 2: Simulated Annealing optimization..." << endl;
    ofstream convergenceOut(convergenceCsvPath);
    if (!convergenceOut.is_open()) {
        cerr << "Warning: could not open convergence CSV for writing: " << convergenceCsvPath << endl;
    } else {
        convergenceOut << "iteration,current_cost,best_cost,temperature\n";
    }

    Solution saSol = simulatedAnnealing(bestInit, requests, vehicles, gen, phase2End,
                                           convergenceOut.is_open() ? &convergenceOut : nullptr);

    if (convergenceOut.is_open()) {
        convergenceOut.close();
        cout << "Convergence CSV written to: " << convergenceCsvPath << endl;
    }

    cout << "\nSA solution: cost=" << fixed << setprecision(2) << saSol.totalMoneyCost 
         << ", penalty=" << saSol.totalPenaltyCost 
         << ", global=" << saSol.globalCost
         << ", unassigned=" << saSol.unassignedReqs.size() << endl;

    // ── Phase 3: Large Neighborhood Search ──────────────────────────────────
    cout << "\nPhase 3: Large Neighborhood Search (destroy-repair)..." << endl;
    // ALNS deadline: leave at least 3s for Phase 4 polish + I/O
    auto alnsDeadline = deadline - chrono::milliseconds(3000LL);
    Solution alnsSol = largeNeighborhoodSearch(saSol, requests, vehicles, gen, alnsDeadline);

    cout << "\nALNS solution: cost=" << fixed << setprecision(2) << alnsSol.totalMoneyCost
         << ", penalty=" << alnsSol.totalPenaltyCost
         << ", global=" << alnsSol.globalCost
         << ", unassigned=" << alnsSol.unassignedReqs.size() << endl;

    // ── Phase 4: Post-ALNS SA Polish ────────────────────────────────────────
    // SA restarts from the ALNS best, exploring its local basin with fresh randomness.
    // Uses a shorter maxNoImprove to focus on fine-grained improvements.
    cout << "\nPhase 4: SA polish (from ALNS best)..." << endl;
    int polishMaxNoImprove = max(50, 800 / max(1, avgStopsPerVeh / 4));
    Solution finalSol = simulatedAnnealing(alnsSol, requests, vehicles, gen,
                                           deadline - chrono::milliseconds(500LL),
                                           nullptr, polishMaxNoImprove);
    // Keep whichever is better
    if (alnsSol.globalCost < finalSol.globalCost) finalSol = alnsSol;

    cout << "\nFinal solution: cost=" << fixed << setprecision(2) << finalSol.totalMoneyCost
         << ", penalty=" << finalSol.totalPenaltyCost
         << ", global=" << finalSol.globalCost
         << ", unassigned=" << finalSol.unassignedReqs.size() << endl;

    // ── FORCE-ASSIGN: Every employee must be served ─────────────────────────
    // Controlled by config.force_assign (default: true).
    // When false, unassigned employees stay unassigned and are shown in results.
    // Track which requests were force-assigned so frontend can flag extra CTC.
    unordered_set<int> forceAssignedSet;
    if (forceAssign && !finalSol.unassignedReqs.empty()) {
        cout << "\nForce-assigning " << finalSol.unassignedReqs.size() << " unassigned requests..." << endl;
        vector<int> stillUnassigned;

        for (int reqId : finalSol.unassignedReqs) {
            if (Clock::now() >= deadline) {
                stillUnassigned.push_back(reqId);
                continue;
            }
            double bestCostInc = numeric_limits<double>::max();
            int bestVehicle = -1;
            Route bestRoute;

            // Try fully relaxed insertion into every vehicle
            for (size_t v = 0; v < vehicles.size(); ++v) {
                auto ins = findBestInsertion(finalSol.routes[v], reqId, vehicles[v], requests, true);
                if (ins.feasible && ins.costIncrease < bestCostInc) {
                    bestCostInc = ins.costIncrease;
                    bestVehicle = static_cast<int>(v);
                    bestRoute   = std::move(ins.newRoute);
                }
            }

            if (bestVehicle >= 0) {
                finalSol.routes[bestVehicle] = std::move(bestRoute);
                forceAssignedSet.insert(reqId);
                cout << "  Force-assigned req " << reqId << " (emp " << requests[reqId].employeeId
                     << ") to vehicle " << vehicles[bestVehicle].vehicleId << endl;
            } else {
                // Last resort: find vehicle with enough remaining capacity and append stops
                int bestCap = -1;
                for (size_t v = 0; v < vehicles.size(); ++v) {
                    int load = 0;
                    for (const auto& s : finalSol.routes[v].stops) {
                        if (s.type == PICKUP)  load += requests[s.reqId].load;
                        else                    load -= requests[s.reqId].load;
                    }
                    int remaining = vehicles[v].capacity - load;
                    if (remaining >= requests[reqId].load && remaining > bestCap) {
                        bestCap = remaining;
                        bestVehicle = static_cast<int>(v);
                    }
                }
                if (bestVehicle >= 0) {
                    Stop pu{reqId, PICKUP,  requests[reqId].pickup,  0, 0, 0};
                    Stop dr{reqId, DROPOFF, requests[reqId].dropoff, 0, 0, 0};
                    finalSol.routes[bestVehicle].stops.push_back(pu);
                    finalSol.routes[bestVehicle].stops.push_back(dr);
                    forceAssignedSet.insert(reqId);
                    cout << "  Last-resort assigned req " << reqId << " to vehicle "
                         << vehicles[bestVehicle].vehicleId << endl;
                } else {
                    stillUnassigned.push_back(reqId);
                    cerr << "  Could NOT assign req " << reqId << " (all vehicles at capacity)" << endl;
                }
            }
        }

        finalSol.unassignedReqs = stillUnassigned;
        evaluateSolution(finalSol, vehicles, requests);
        cout << "After force-assign: unassigned=" << finalSol.unassignedReqs.size() << endl;
    }

    // ── POST-PROCESS: Strip hard time-window violations when force_assign=false ─
    // The SA/ALNS treats all constraints as soft (penalised). When force_assign is
    // OFF the user expects no employee to appear as "served" if their dropoff
    // arrival exceeds lateTime + tolerance.  Remove those pairs and re-evaluate.
    if (!forceAssign) {
        vector<int> violatedReqs;
        for (auto& route : finalSol.routes) {
            if (route.stops.empty()) continue;
            unordered_set<int> toRemove;
            for (const auto& stop : route.stops) {
                if (stop.type == DROPOFF) {
                    const Request& req = requests[stop.reqId];
                    double maxDelay = gCtx.getMaxDelay(req.priority);
                    if (stop.arrivalTime > req.lateTime + maxDelay) {
                        toRemove.insert(stop.reqId);
                        violatedReqs.push_back(stop.reqId);
                        cout << "  Post-process: removing req " << stop.reqId
                             << " (emp " << req.employeeId << "): dropoff "
                             << fixed << setprecision(1) << stop.arrivalTime
                             << " > deadline " << req.lateTime + maxDelay << endl;
                    }
                }
            }
            if (!toRemove.empty()) {
                vector<Stop> clean;
                for (const auto& stop : route.stops) {
                    if (!toRemove.count(stop.reqId)) clean.push_back(stop);
                }
                route.stops = std::move(clean);
            }
        }
        if (!violatedReqs.empty()) {
            for (int rid : violatedReqs) finalSol.unassignedReqs.push_back(rid);
            evaluateSolution(finalSol, vehicles, requests);
            cout << "Post-process stripped " << violatedReqs.size()
                 << " hard-violated assignment(s). Unassigned now="
                 << finalSol.unassignedReqs.size() << endl;
        }
    }

    // Output JSON
    json out;
    out["summary"] = {
        {"totalMoneyCost", finalSol.totalMoneyCost},
        {"totalPenaltyCost", finalSol.totalPenaltyCost},
        {"globalCost", finalSol.globalCost},
        {"unassignedCount", finalSol.unassignedReqs.size()},
        {"vehiclesUsed", 0},
        {"totalDistance", 0.0},
        {"totalTime", 0.0},
        {"distanceMethodUsed", distanceMethodUsed},
        {"penaltyWeightsUsed", {
            {"lateArrivalPenaltyPerMin", gCtx.lateArrivalPenaltyPerMin},
            {"sharingViolationPenalty", gCtx.sharingViolationPenalty},
            {"vehiclePrefViolationPenalty", gCtx.vehiclePrefViolationPenalty},
            {"unassignedPenalty", gCtx.unassignedPenalty},
            {"maxDelayViolationPenalty", gCtx.maxDelayViolationPenalty}
        }},
        {"objectiveWeightsUsed", {
            {"wCost", gCtx.wCost},
            {"wTime", gCtx.wTime}
        }}
    };
    
    double totalDist = 0, totalTime = 0;
    int vehiclesUsed = 0;
    
    // Build baseline lookup by employeeId
    unordered_map<string, const BaselineEntry*> baselineLookup;
    for (const auto& b : gCtx.baseline) {
        baselineLookup[b.employeeId] = &b;
    }

    out["routes"] = json::array();
    for (auto& rt : finalSol.routes) {
        json jr;
        jr["vehicleId"] = rt.vehicleId;
        const Vehicle& veh = (rt.vehicleId < static_cast<int>(vehicles.size())) ? vehicles[rt.vehicleId] : vehicles[0];
        jr["vehicleIdStr"] = veh.vehicleId;
        jr["totalDist"] = rt.totalDist;
        jr["totalTime"] = rt.totalTime;
        jr["totalCost"] = rt.totalCost;
        jr["penaltyCost"] = rt.penaltyCost;

        // Vehicle biodata
        jr["vehicleType"] = veh.type;
        jr["fuelType"] = veh.fuelType;
        jr["category"] = veh.category;
        jr["capacity"] = veh.capacity;
        jr["costPerKm"] = veh.costPerKm;
        jr["speed"] = veh.speed > 0 ? veh.speed : gCtx.defaultSpeedKmph;
        jr["startLat"] = veh.startLoc.lat;
        jr["startLon"] = veh.startLoc.lon;
        jr["availabilityTime"] = veh.availabilityTime;

        // Baseline aggregation: sum baseline cost/time for employees on this route
        double routeBaselineCost = 0;
        double routeBaselineTime = 0;
        unordered_set<string> routeEmployees;

        jr["stops"] = json::array();
        for (auto& s : rt.stops) {
            json js;
            js["reqId"] = s.reqId;
            const string& empId = requests[s.reqId].employeeId;
            js["employeeId"] = empId;
            js["type"] = (s.type == PICKUP) ? "pickup" : "dropoff";
            js["lat"] = s.loc.lat;
            js["lon"] = s.loc.lon;
            js["arrivalTime"] = s.arrivalTime;
            js["waitTime"] = s.waitTime;
            js["vehiclePreference"] = requests[s.reqId].vehiclePreference;
            // Flag force-assigned employees so frontend can show extra CTC warning
            js["forceAssigned"] = (forceAssignedSet.count(s.reqId) > 0);
            jr["stops"].push_back(js);

            // Collect unique employees for baseline
            if (s.type == PICKUP) {
                routeEmployees.insert(empId);
            }
        }

        // Sum baseline for employees on this route
        for (const auto& empId : routeEmployees) {
            auto it = baselineLookup.find(empId);
            if (it != baselineLookup.end()) {
                routeBaselineCost += it->second->baselineCost;
                routeBaselineTime += it->second->baselineTime;
            }
        }
        jr["baselineCost"] = routeBaselineCost;
        jr["baselineTime"] = routeBaselineTime;

        out["routes"].push_back(jr);

        if (!rt.stops.empty()) {
            ++vehiclesUsed;
            totalDist += rt.totalDist;
            totalTime += rt.totalTime;
        }
    }
    
    out["summary"]["vehiclesUsed"] = vehiclesUsed;
    out["summary"]["totalDistance"] = totalDist;
    out["summary"]["totalTime"] = totalTime;

    // Total baseline for cost savings comparison
    double totalBaselineCost = 0, totalBaselineTime = 0;
    for (const auto& b : gCtx.baseline) {
        totalBaselineCost += b.baselineCost;
        totalBaselineTime += b.baselineTime;
    }
    out["summary"]["totalBaselineCost"] = totalBaselineCost;
    out["summary"]["totalBaselineTime"] = totalBaselineTime;

    out["unassigned"] = finalSol.unassignedReqs;

    // distanceMethodUsed already written to summary above; no legacy block needed.
    
    // Add request mapping for report
    out["requestDetails"] = json::array();
    for (const auto& req : requests) {
        out["requestDetails"].push_back({
            {"id", req.id},
            {"employeeId", req.employeeId},
            {"priority", req.priority},
            {"earlyTime", req.earlyTime},
            {"lateTime", req.lateTime},
            {"vehiclePreference", req.vehiclePreference},
            {"sharingLimit", req.sharingLimit}
        });
    }
    
    // Write output
    ofstream fo(outputPath);
    if (!fo.is_open()) {
        cerr << "Error: cannot write output to " << outputPath << endl;
        return 1;
    }
    fo << setw(2) << out << endl;
    fo.close();

    cout << "\nSolution written to: " << outputPath << endl;
    cout << "========================================" << endl;
    
    return 0;
}