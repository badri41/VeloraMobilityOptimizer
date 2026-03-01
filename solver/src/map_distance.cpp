#define _USE_MATH_DEFINES
#include "map_distance.hpp"
#include <cmath>
#include <iostream>
#include <sstream>
#include <iomanip>
#include <chrono>
#include <atomic>

#ifdef USE_CURL
#include <curl/curl.h>
#endif

#include <nlohmann/json.hpp>

using json = nlohmann::json;

// ============================================================================
// Statistics & Global State
// ============================================================================

static std::atomic<int> apiCallCount{0};
static std::atomic<int> apiSuccessCount{0};
static std::atomic<int> timeoutFallbackCount{0};
static std::atomic<int> errorFallbackCount{0};
static std::atomic<bool> globalDisableExternal{false};

static double toRad(double deg) {
    return deg * M_PI / 180.0;
}

#ifdef USE_CURL
static size_t curlWriteCallback(void* ptr, size_t size, size_t nmemb, void* userdata) {
    std::string* s = static_cast<std::string*>(userdata);
    s->append(static_cast<char*>(ptr), size * nmemb);
    return size * nmemb;
}
#endif

// ============================================================================
// Cache Management
// ============================================================================

std::string MapDistance::makeCacheKey(double lat1, double lon1, double lat2, double lon2) const {
    std::ostringstream oss;
    oss << std::fixed << std::setprecision(5)
        << lat1 << "," << lon1 << "->" << lat2 << "," << lon2;
    return oss.str();
}

void MapDistance::clearCache() {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    distanceCache_.clear();
}

size_t MapDistance::getCacheSize() const {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    return distanceCache_.size();
}

// ============================================================================
// Haversine Distance (Air Distance) - Always available, no network
// ============================================================================

double MapDistance::haversine(double lat1, double lon1, double lat2, double lon2) const {
    const double R = 6371.0; // Earth radius in km
    double dLat = toRad(lat2 - lat1);
    double dLon = toRad(lon2 - lon1);
    double a = sin(dLat/2) * sin(dLat/2) +
               cos(toRad(lat1)) * cos(toRad(lat2)) * sin(dLon/2) * sin(dLon/2);
    double c = 2 * asin(std::min(1.0, sqrt(a)));
    return R * c;
}

// ============================================================================
// OpenRouteService API with Timeout Fallback
// Primary provider: Free API key from https://openrouteservice.org/dev/#/signup
// Fallback: Haversine on timeout or error
// ============================================================================

double MapDistance::openRouteServiceDistance(double lat1, double lon1, double lat2, double lon2) const {
#ifdef USE_CURL
    apiCallCount++;

    // Pre-calculate fallback in case of timeout
    double fallbackDistance = haversine(lat1, lon1, lat2, lon2);

    CURL* curl = curl_easy_init();
    if (!curl) {
        errorFallbackCount++;
        return fallbackDistance;
    }

    // ORS v2 requires POST with JSON body, lon/lat order (GeoJSON format)
    std::string url = "https://api.openrouteservice.org/v2/directions/driving-car";

    // Build JSON request body — preference=shortest routes by road distance, not travel time
    std::ostringstream bodyStream;
    bodyStream << "{\"coordinates\":[[" << std::fixed << std::setprecision(6)
               << lon1 << "," << lat1 << "],[" << lon2 << "," << lat2 << "]],"
               << "\"preference\":\"shortest\"}";

    std::string body = bodyStream.str();

    std::string response;
    struct curl_slist* headers = nullptr;
    std::string authHeader = "Authorization: Bearer " + apiKey_;
    headers = curl_slist_append(headers, authHeader.c_str());
    headers = curl_slist_append(headers, "Accept: application/json");
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, curlWriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    // CRITICAL: Timeout settings for fast fallback
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeoutMs_);           // Total timeout
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, timeoutMs_ / 2); // Connection timeout
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);                      // Thread-safe timeout
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "VeloraMobilityOptimizer/1.0");

    // Perform request
    CURLcode res = curl_easy_perform(curl);
    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    // Handle timeout - immediate fallback to Haversine
    if (res == CURLE_OPERATION_TIMEDOUT || res == CURLE_COULDNT_CONNECT) {
        timeoutFallbackCount++;
        // Silent fallback on timeout - don't spam logs
        return fallbackDistance;
    }

    // Handle other CURL errors
    if (res != CURLE_OK) {
        errorFallbackCount++;
        static bool errorLogged = false;
        if (!errorLogged) {
            std::cerr << "[MapDistance] OpenRouteService error: " << curl_easy_strerror(res)
                      << ". Using Haversine fallback.\n";
            errorLogged = true;
        }
        return fallbackDistance;
    }

    // Handle HTTP errors
    if (httpCode != 200) {
        errorFallbackCount++;
        static bool httpErrorLogged = false;
        if (!httpErrorLogged) {
            std::cerr << "[MapDistance] OpenRouteService HTTP " << httpCode
                      << ". Using Haversine fallback.\n";
            httpErrorLogged = true;
        }
        return fallbackDistance;
    }

    // Parse JSON response
    try {
        json doc = json::parse(response);

        // POST response format: { routes: [ { summary: { distance: meters } } ] }
        // Also handle GET format: { features: [ { properties: { summary: { distance: meters } } } ] }
        if (doc.contains("routes") && !doc["routes"].empty()) {
            auto& route = doc["routes"][0];
            if (route.contains("summary") && route["summary"].contains("distance")) {
                double meters = route["summary"]["distance"].get<double>();
                apiSuccessCount++;
                return meters / 1000.0; // Convert to km
            }
        } else if (doc.contains("features") && !doc["features"].empty()) {
            auto& feature = doc["features"][0];
            if (feature.contains("properties") && feature["properties"].contains("summary")) {
                auto& summary = feature["properties"]["summary"];
                if (summary.contains("distance")) {
                    double meters = summary["distance"].get<double>();
                    apiSuccessCount++;
                    return meters / 1000.0; // Convert to km
                }
            }
        }
    } catch (const std::exception& e) {
        errorFallbackCount++;
        return fallbackDistance;
    }

    // Invalid response format - fallback
    errorFallbackCount++;
    return fallbackDistance;
#else
    // No CURL - always use Haversine
    return haversine(lat1, lon1, lat2, lon2);
#endif
}

// ============================================================================
// Google Maps Distance Matrix API (requires paid API key)
// ============================================================================

double MapDistance::googleMapsDistance(double lat1, double lon1, double lat2, double lon2) const {
#ifdef USE_CURL
    double fallbackDistance = haversine(lat1, lon1, lat2, lon2);

    CURL* curl = curl_easy_init();
    if (!curl) return fallbackDistance;

    std::ostringstream urlStream;
    urlStream << "https://maps.googleapis.com/maps/api/distancematrix/json"
              << "?origins=" << std::fixed << std::setprecision(6) << lat1 << "," << lon1
              << "&destinations=" << lat2 << "," << lon2
              << "&mode=driving"
              << "&key=" << apiKey_;

    std::string response;
    curl_easy_setopt(curl, CURLOPT_URL, urlStream.str().c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, curlWriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeoutMs_);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, timeoutMs_ / 2);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

    CURLcode res = curl_easy_perform(curl);
    curl_easy_cleanup(curl);

    if (res == CURLE_OPERATION_TIMEDOUT || res != CURLE_OK) {
        timeoutFallbackCount++;
        return fallbackDistance;
    }

    try {
        json doc = json::parse(response);
        if (doc.contains("rows") && !doc["rows"].empty()) {
            auto& elements = doc["rows"][0]["elements"];
            if (!elements.empty() && elements[0].contains("distance")) {
                double meters = elements[0]["distance"]["value"].get<double>();
                apiSuccessCount++;
                return meters / 1000.0;
            }
        }
    } catch (...) {}

    return fallbackDistance;
#else
    return haversine(lat1, lon1, lat2, lon2);
#endif
}

// ============================================================================
// OSRM (Open Source Routing Machine) - Free, no API key
// ============================================================================

double MapDistance::osrmDistance(double lat1, double lon1, double lat2, double lon2) const {
#ifdef USE_CURL
    double fallbackDistance = haversine(lat1, lon1, lat2, lon2);

    CURL* curl = curl_easy_init();
    if (!curl) return fallbackDistance;

    std::ostringstream urlStream;
    urlStream << "https://router.project-osrm.org/route/v1/driving/"
              << std::fixed << std::setprecision(6)
              << lon1 << "," << lat1 << ";" << lon2 << "," << lat2
              << "?overview=false";

    std::string response;
    curl_easy_setopt(curl, CURLOPT_URL, urlStream.str().c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, curlWriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeoutMs_);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, timeoutMs_ / 2);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

    CURLcode res = curl_easy_perform(curl);
    curl_easy_cleanup(curl);

    if (res == CURLE_OPERATION_TIMEDOUT || res != CURLE_OK) {
        timeoutFallbackCount++;
        return fallbackDistance;
    }

    try {
        json doc = json::parse(response);
        if (doc["code"] == "Ok" && !doc["routes"].empty()) {
            double meters = doc["routes"][0]["distance"].get<double>();
            apiSuccessCount++;
            return meters / 1000.0;
        }
    } catch (...) {}

    return fallbackDistance;
#else
    return haversine(lat1, lon1, lat2, lon2);
#endif
}

// ============================================================================
// Main Distance Function
// ============================================================================

double MapDistance::distance(double lat1, double lon1, double lat2, double lon2) const {
    // Same point check
    if (std::abs(lat1 - lat2) < 1e-6 && std::abs(lon1 - lon2) < 1e-6) {
        return 0.0;
    }

    // Pre-calculate Haversine (always available as fallback)
    double haversineRoad = haversine(lat1, lon1, lat2, lon2);

    // Check cache first (regardless of provider)
    if (cacheEnabled_) {
        std::string cacheKey = makeCacheKey(lat1, lon1, lat2, lon2);
        {
            std::lock_guard<std::mutex> lock(cacheMutex_);
            auto it = distanceCache_.find(cacheKey);
            if (it != distanceCache_.end()) {
                return it->second;
            }
        }
    }

    // Fast path: haversine mode or external calls disabled — skip all API calls entirely
    if (provider_ == MapProvider::HAVERSINE || !allowExternal_) {
        return haversineRoad;
    }

    // If API has been disabled due to repeated failures, use Haversine
    if (globalDisableExternal.load()) {
        return haversineRoad;
    }

    // ALWAYS try to get real road distance via API
    // Priority: 1) Configured provider with API key, 2) OSRM (free, no key)
    double result = haversineRoad;
    bool apiAttempted = false;

#ifdef USE_CURL
    // Try configured provider first if API key is available
    if (!apiKey_.empty() && provider_ != MapProvider::OSRM && provider_ != MapProvider::HAVERSINE) {
        apiAttempted = true;
        switch (provider_) {
            case MapProvider::OPENROUTESERVICE:
                result = openRouteServiceDistance(lat1, lon1, lat2, lon2);
                break;
            case MapProvider::GOOGLE_MAPS:
                result = googleMapsDistance(lat1, lon1, lat2, lon2);
                break;
            default:
                break;
        }
        
        // If configured provider succeeded (result differs from fallback), use it
        if (std::abs(result - haversineRoad) > 0.01) {
            goto cache_and_return;
        }
    }

    // Always try OSRM as fallback (free, no API key needed)
    // This runs if: no API key, configured provider failed, or OSRM is configured
    {
        apiAttempted = true;
        double osrmResult = osrmDistance(lat1, lon1, lat2, lon2);
        
        // If OSRM succeeded (result differs from simple fallback calculation)
        if (std::abs(osrmResult - haversineRoad) > 0.01) {
            result = osrmResult;
            goto cache_and_return;
        }
    }

    // Both APIs failed - result remains as haversineRoad
#endif

cache_and_return:
    // Cache the result (whether from API or fallback)
    if (cacheEnabled_) {
        std::string cacheKey = makeCacheKey(lat1, lon1, lat2, lon2);
        std::lock_guard<std::mutex> lock(cacheMutex_);
        distanceCache_[cacheKey] = result;
    }

    // Check if we should disable API globally (too many failures)
    int totalCalls = apiCallCount.load();
    int successCalls = apiSuccessCount.load();
    if (totalCalls > 20 && successCalls < totalCalls / 4) {
        // Less than 25% success rate after 20+ calls - disable API
        globalDisableExternal.store(true);
        std::cerr << "[MapDistance] Low success rate (" << successCalls << "/" << totalCalls
                  << "). Switching to Haversine for remaining calculations.\n";
    }

    return result;
}

// ============================================================================
// Statistics (for debugging/monitoring)
// ============================================================================

void MapDistance::printStats() {
    std::cerr << "[MapDistance Stats] "
              << "API calls: " << apiCallCount.load()
              << ", Success: " << apiSuccessCount.load()
              << ", Timeout fallbacks: " << timeoutFallbackCount.load()
              << ", Error fallbacks: " << errorFallbackCount.load()
              << ", Cache size: " << getCacheSize()
              << "\n";
}

int MapDistance::getApiCallCount() { return apiCallCount.load(); }
int MapDistance::getApiSuccessCount() { return apiSuccessCount.load(); }
int MapDistance::getTimeoutFallbackCount() { return timeoutFallbackCount.load(); }
int MapDistance::getErrorFallbackCount() { return errorFallbackCount.load(); }
// ============================================================================
// Distance Table (OSRM Table API) — single HTTP call for NxN matrix
// ============================================================================

std::vector<double> MapDistance::computeDistanceTable(
    const std::vector<std::pair<double,double>>& locations) const {

    size_t N = locations.size();
    std::vector<double> matrix(N * N, 0.0);

    if (N == 0) return matrix;

    // Build Haversine fallback matrix first
    auto buildHaversineFallback = [&]() {
        for (size_t i = 0; i < N; ++i) {
            for (size_t j = 0; j < N; ++j) {
                if (i == j) { matrix[i * N + j] = 0.0; continue; }
                matrix[i * N + j] = haversine(
                    locations[i].first, locations[i].second,
                    locations[j].first, locations[j].second);
            }
        }
    };

#ifdef USE_CURL
    if (provider_ == MapProvider::HAVERSINE || !allowExternal_) {
        buildHaversineFallback();
        return matrix;
    }

    // ── OSRM Table API ───────────────────────────────────────────────────────
    // Free, no API key, reliable public instance. Returns real road distances
    // via annotations=distance (meters). Routes via fastest path — same as any
    // other free road-distance API. Single HTTP call for the full NxN matrix.
    std::ostringstream urlStream;
    urlStream << "https://router.project-osrm.org/table/v1/driving/";
    for (size_t i = 0; i < N; ++i) {
        if (i > 0) urlStream << ";";
        urlStream << std::fixed << std::setprecision(6)
                  << locations[i].second << "," << locations[i].first;
    }
    urlStream << "?annotations=distance";

    std::cerr << "[MapDistance] Computing " << N << "x" << N
              << " distance table via OSRM Table API...\n";

    CURL* curl = curl_easy_init();
    if (!curl) {
        std::cerr << "[MapDistance] CURL init failed, using Haversine fallback\n";
        buildHaversineFallback();
        return matrix;
    }

    std::string response;
    curl_easy_setopt(curl, CURLOPT_URL, urlStream.str().c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, curlWriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, 20000L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 10000L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "VeloraMobilityOptimizer/1.0");

    apiCallCount++;
    CURLcode res = curl_easy_perform(curl);
    curl_easy_cleanup(curl);

    if (res == CURLE_OPERATION_TIMEDOUT || res == CURLE_COULDNT_CONNECT) {
        timeoutFallbackCount++;
        std::cerr << "[MapDistance] OSRM Table API timed out, using Haversine fallback\n";
        buildHaversineFallback();
        return matrix;
    }
    if (res != CURLE_OK) {
        errorFallbackCount++;
        std::cerr << "[MapDistance] OSRM Table API error: " << curl_easy_strerror(res)
                  << ", using Haversine fallback\n";
        buildHaversineFallback();
        return matrix;
    }

    try {
        json doc = json::parse(response);
        if (doc["code"] != "Ok" || !doc.contains("distances")) {
            errorFallbackCount++;
            std::cerr << "[MapDistance] OSRM Table API returned code: "
                      << doc.value("code", "unknown") << ", using Haversine fallback\n";
            buildHaversineFallback();
            return matrix;
        }
        auto& distances = doc["distances"];
        if (distances.size() != N) {
            errorFallbackCount++;
            std::cerr << "[MapDistance] OSRM Table API returned wrong dimensions, using Haversine fallback\n";
            buildHaversineFallback();
            return matrix;
        }
        for (size_t i = 0; i < N; ++i) {
            for (size_t j = 0; j < N; ++j) {
                if (distances[i][j].is_null()) {
                    matrix[i * N + j] = haversine(
                        locations[i].first, locations[i].second,
                        locations[j].first, locations[j].second);
                } else {
                    matrix[i * N + j] = distances[i][j].get<double>() / 1000.0;
                }
            }
        }
        apiSuccessCount++;
        std::cerr << "[MapDistance] OSRM Table API success: " << N << "x" << N
                  << " matrix computed in 1 API call\n";
        return matrix;
    } catch (const std::exception& e) {
        errorFallbackCount++;
        std::cerr << "[MapDistance] OSRM Table API parse error: " << e.what()
                  << ", using Haversine fallback\n";
        buildHaversineFallback();
        return matrix;
    }
#else
    buildHaversineFallback();
    return matrix;
#endif
}