/***
 * VELORA MOBILITY OPTIMIZER - HVRPSTW SOLVER
 * Heterogeneous Vehicle Routing Problem with Soft Time Windows
 * 
 * Algorithm: Greedy Constructive Heuristic (Solomon I1) + Simulated Annealing
 * 
 * Based on research papers:
 * - Solomon (1987): "Algorithms for the Vehicle Routing and Scheduling Problems with Time Window Constraints"
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

#include "json.hpp"
#include "map_distance.hpp"

using json = nlohmann::json;
using namespace std;

// ============== DATA STRUCTURES ==============

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
        // Collect all unique locations
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
    unordered_set<int> pickedUp;
    for (const auto& stop : r.stops) {
        if (stop.type == PICKUP) {
            pickedUp.insert(stop.reqId);
        } else {  // DROPOFF
            if (pickedUp.find(stop.reqId) == pickedUp.end()) {
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
    unordered_set<int> activePassengers;  // Currently in vehicle
    
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
            activePassengers.insert(stop.reqId);
            
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
            for (int activeId : activePassengers) {
                if ((int)activePassengers.size() > reqs[activeId].sharingLimit) {
                    eval.penaltyCost += gCtx.sharingViolationPenalty;
                }
            }
            
        } else {  // DROPOFF
            currentLoad -= req.load;
            activePassengers.erase(stop.reqId);
            
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
    unordered_set<int> pickedUp;
    for (const auto& stop : r.stops) {
        if (stop.type == PICKUP) {
            pickedUp.insert(stop.reqId);
        } else {  // DROPOFF
            if (pickedUp.find(stop.reqId) == pickedUp.end()) {
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

InsertionResult findBestInsertion(const Route& route, int reqId, const Vehicle& v, 
                                   const vector<Request>& reqs, bool relaxedMode = false) {
    InsertionResult best;
    const Request& req = reqs[reqId];
    
    int n = static_cast<int>(route.stops.size());
    
    // Try all valid pickup-dropoff position pairs
    for (int p = 0; p <= n; ++p) {
        for (int d = p + 1; d <= n + 1; ++d) {
            Route trial = route;
            
            // Insert pickup at position p
            Stop pickup{reqId, PICKUP, req.pickup, 0, 0, 0};
            trial.stops.insert(trial.stops.begin() + p, pickup);
            
            // Insert dropoff at position d
            Stop dropoff{reqId, DROPOFF, req.dropoff, 0, 0, 0};
            trial.stops.insert(trial.stops.begin() + d, dropoff);
            
            // Check feasibility
            if (!isRouteFeasible(trial, v, reqs, !relaxedMode)) continue;
            
            // Evaluate cost
            auto eval = evaluateRoute(trial, v, reqs);
            if (!eval.feasible) continue;
            
            // Calculate cost increase
            double oldCost = route.stops.empty() ? 0 : evaluateRoute(route, v, reqs).totalCost;
            double costInc = eval.totalCost - oldCost;
            
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
    unordered_set<int> seen;
    vector<int> result;
    for (const auto& s : r.stops) {
        if (seen.insert(s.reqId).second) result.push_back(s.reqId);
    }
    return result;
}

// Relocate: Move a request from one route to another
Solution relocateMove(const Solution& current, const vector<Request>& reqs, 
                      const vector<Vehicle>& vehicles, mt19937& gen) {
    Solution neighbor = current;
    
    // Find routes with requests
    vector<int> nonEmptyRoutes;
    for (size_t i = 0; i < neighbor.routes.size(); ++i) {
        if (!neighbor.routes[i].stops.empty()) nonEmptyRoutes.push_back(static_cast<int>(i));
    }
    if (nonEmptyRoutes.empty()) return current;
    
    // Pick random source route and request
    uniform_int_distribution<> routeDist(0, static_cast<int>(nonEmptyRoutes.size()) - 1);
    int srcRouteIdx = nonEmptyRoutes[routeDist(gen)];
    
    auto reqIds = getRequestsInRoute(neighbor.routes[srcRouteIdx]);
    if (reqIds.empty()) return current;
    
    uniform_int_distribution<> reqDist(0, static_cast<int>(reqIds.size()) - 1);
    int reqId = reqIds[reqDist(gen)];
    
    // Remove from source
    removeRequestFromRoute(neighbor.routes[srcRouteIdx], reqId);
    
    // Try to insert into a different (or same) route
    uniform_int_distribution<> tgtDist(0, static_cast<int>(vehicles.size()) - 1);
    int tgtRouteIdx = tgtDist(gen);
    
    auto ins = findBestInsertion(neighbor.routes[tgtRouteIdx], reqId, vehicles[tgtRouteIdx], reqs, true);
    
    if (ins.feasible) {
        neighbor.routes[tgtRouteIdx] = std::move(ins.newRoute);
        evaluateSolution(neighbor, vehicles, reqs);
        return neighbor;
    }
    
    return current;  // Move failed
}

// Exchange: Swap requests between two routes
Solution exchangeMove(const Solution& current, const vector<Request>& reqs,
                      const vector<Vehicle>& vehicles, mt19937& gen) {
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

// ============== SIMULATED ANNEALING ==============

Solution simulatedAnnealing(const Solution& initial, const vector<Request>& reqs,
                            const vector<Vehicle>& vehicles, mt19937& gen) {
    
    Solution current = initial;
    Solution best = initial;
    
    // SA parameters
    double T = 1000.0;
    double Tmin = 0.1;
    double alpha = 0.995;
    int maxIterPerTemp = 100;
    int maxNoImprove = 2000;
    
    int noImproveCount = 0;
    int iteration = 0;
    
    while (T > Tmin && noImproveCount < maxNoImprove) {
        for (int iter = 0; iter < maxIterPerTemp; ++iter) {
            ++iteration;
            
            // Choose random move
            uniform_int_distribution<> moveDist(0, 2);
            Solution neighbor;
            
            switch (moveDist(gen)) {
                case 0: neighbor = relocateMove(current, reqs, vehicles, gen); break;
                case 1: neighbor = exchangeMove(current, reqs, vehicles, gen); break;
                case 2: neighbor = twoOptMove(current, reqs, vehicles, gen); break;
            }
            
            // Skip if move failed
            if (abs(neighbor.globalCost - current.globalCost) < 1e-9 && 
                neighbor.unassignedReqs.size() == current.unassignedReqs.size()) {
                continue;
            }
            
            double delta = neighbor.globalCost - current.globalCost;
            
            bool accept = false;
            if (delta < 0) {
                accept = true;
            } else {
                uniform_real_distribution<> prob(0.0, 1.0);
                if (prob(gen) < exp(-delta / T)) {
                    accept = true;
                }
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
        }
        
        T *= alpha;
    }
    
    cout << "SA completed: " << iteration << " iterations, final temp: " << T << endl;
    return best;
}

// ============== MAIN ==============

int main(int argc, char** argv) {
    string inputPath = (argc > 1) ? argv[1] : "input.json";
    string outputPath = (argc > 2) ? argv[2] : "solution.json";
    
    // Read input
    ifstream in(inputPath);
    if (!in.is_open()) {
        cerr << "Failed to open " << inputPath << endl;
        return 1;
    }
    json j;
    in >> j;
    in.close();
    
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
    for (auto& jr : j["requests"]) {
        Request r;
        r.id = jr.value("id", static_cast<int>(requests.size()));
        r.employeeId = jr.value("employee_id", "");
        r.priority = max(1, min(5, jr.value("priority", 3)));
        r.earlyTime = jr.value("earlyTime", 0.0);
        r.lateTime = jr.value("lateTime", 1440.0);  // Default to end of day
        r.load = jr.value("load", 1);
        r.pickup.lat = jr["pickup"].value("lat", 0.0);
        r.pickup.lon = jr["pickup"].value("lon", 0.0);
        r.dropoff.lat = jr["dropoff"].value("lat", 0.0);
        r.dropoff.lon = jr["dropoff"].value("lon", 0.0);
        r.vehiclePreference = jr.value("vehiclePreference", "any");
        r.sharingLimit = jr.value("sharingLimit", 100);
        requests.push_back(r);
    }
    
    // Parse vehicles
    vector<Vehicle> vehicles;
    for (auto& jv : j["vehicles"]) {
        Vehicle v;
        v.id = jv.value("id", static_cast<int>(vehicles.size()));
        v.vehicleId = jv.value("vehicle_id", "");
        v.capacity = jv.value("capacity", 4);
        v.costPerKm = jv.value("costPerKm", 10.0);
        v.startLoc.lat = jv["startLoc"].value("lat", 0.0);
        v.startLoc.lon = jv["startLoc"].value("lon", 0.0);
        v.availabilityTime = jv.value("availabilityTime", 0.0);
        // CRITICAL: Use vehicle's own speed
        v.speed = jv.value("avg_speed_kmph", jv.value("avgSpeedKmph", gCtx.defaultSpeedKmph));
        v.type = jv.value("type", jv.value("vehicle_type", "any"));
        v.category = jv.value("category", "");
        v.fuelType = jv.value("fuel_type", "");
        vehicles.push_back(v);
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
    
    cout << "Input: " << requests.size() << " requests, " << vehicles.size() << " vehicles" << endl;
    cout << "Weights: cost=" << gCtx.wCost << ", time=" << gCtx.wTime << endl;

    // Pre-compute NxN distance matrix (1 API call instead of thousands)
    if (allowExternal && mapProvider != MapProvider::HAVERSINE) {
        cout << "\nPre-computing distance matrix via Table API..." << endl;
        gDistMatrix.build(vehicles, requests, mapDist);
    }

    // Multiple restarts for better solution
    cout << "\nPhase 1: Constructive Heuristic (multi-start)..." << endl;
    mt19937 gen(42);
    Solution bestInit;
    bestInit.globalCost = numeric_limits<double>::max();
    
    for (int restart = 0; restart < 10; ++restart) {
        Solution init = constructInitialSolution(requests, vehicles, gen);
        if (init.globalCost < bestInit.globalCost) {
            bestInit = std::move(init);
        }
    }
    
    cout << "Initial solution: cost=" << fixed << setprecision(2) << bestInit.totalMoneyCost 
         << ", penalty=" << bestInit.totalPenaltyCost 
         << ", unassigned=" << bestInit.unassignedReqs.size() << endl;
    
    // Improve with SA
    cout << "\nPhase 2: Simulated Annealing optimization..." << endl;
    Solution finalSol = simulatedAnnealing(bestInit, requests, vehicles, gen);
    
    cout << "\nFinal solution: cost=" << fixed << setprecision(2) << finalSol.totalMoneyCost 
         << ", penalty=" << finalSol.totalPenaltyCost 
         << ", global=" << finalSol.globalCost
         << ", unassigned=" << finalSol.unassignedReqs.size() << endl;
    
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

    // Distance method metadata for frontend fallback notice
    {
        const char* provNames[] = {"haversine", "google_maps", "openrouteservice", "osrm"};
        int tFallbacks = MapDistance::getTimeoutFallbackCount();
        int eFallbacks = MapDistance::getErrorFallbackCount();
        bool fallbackUsed = (tFallbacks > 0 || eFallbacks > 0 || !allowExternal);
        out["summary"]["distanceMethod"] = {
            {"provider", provNames[static_cast<int>(mapProvider)]},
            {"apiCalls", MapDistance::getApiCallCount()},
            {"apiSuccess", MapDistance::getApiSuccessCount()},
            {"timeoutFallbacks", tFallbacks},
            {"errorFallbacks", eFallbacks},
            {"fallbackUsed", fallbackUsed},
            {"externalEnabled", allowExternal}
        };
    }
    
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
    fo << setw(2) << out << endl;
    fo.close();
    
    cout << "\nSolution written to: " << outputPath << endl;
    cout << "========================================" << endl;
    
    return 0;
}