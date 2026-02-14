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
// Fallback: Haversine * 1.4 on timeout or error
// ============================================================================

double MapDistance::openRouteServiceDistance(double lat1, double lon1, double lat2, double lon2) const {
#ifdef USE_CURL
    apiCallCount++;

    // Pre-calculate fallback in case of timeout
    double fallbackDistance = haversine(lat1, lon1, lat2, lon2) * 1.4;

    CURL* curl = curl_easy_init();
    if (!curl) {
        errorFallbackCount++;
        return fallbackDistance;
    }

    // ORS v2 requires POST with JSON body, lon/lat order (GeoJSON format)
    std::string url = "https://api.openrouteservice.org/v2/directions/driving-car";

    // Build JSON request body
    std::ostringstream bodyStream;
    bodyStream << "{\"coordinates\":[[" << std::fixed << std::setprecision(6)
               << lon1 << "," << lat1 << "],[" << lon2 << "," << lat2 << "]]}";
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

    // Handle timeout - immediate fallback to Haversine * 1.4
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
                      << ". Using Haversine * 1.4 fallback.\n";
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
                      << ". Using Haversine * 1.4 fallback.\n";
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
    // No CURL - always use Haversine * 1.4
    return haversine(lat1, lon1, lat2, lon2) * 1.4;
#endif
}

// ============================================================================
// Google Maps Distance Matrix API (requires paid API key)
// ============================================================================

double MapDistance::googleMapsDistance(double lat1, double lon1, double lat2, double lon2) const {
#ifdef USE_CURL
    double fallbackDistance = haversine(lat1, lon1, lat2, lon2) * 1.4;

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
    return haversine(lat1, lon1, lat2, lon2) * 1.4;
#endif
}

// ============================================================================
// OSRM (Open Source Routing Machine) - Free, no API key
// ============================================================================

double MapDistance::osrmDistance(double lat1, double lon1, double lat2, double lon2) const {
#ifdef USE_CURL
    double fallbackDistance = haversine(lat1, lon1, lat2, lon2) * 1.4;

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
    return haversine(lat1, lon1, lat2, lon2) * 1.4;
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

    // Pre-calculate Haversine * 1.4 (always available as fallback)
    double haversineRoad = haversine(lat1, lon1, lat2, lon2) * 1.4;

    // CASE 1: Haversine-only mode - no API calls
    if (!allowExternal_ || provider_ == MapProvider::HAVERSINE) {
        return haversineRoad;
    }

    // CASE 2: API disabled due to repeated failures
    if (globalDisableExternal.load()) {
        return haversineRoad;
    }

    // CASE 3: No API key for providers that need one
    if (apiKey_.empty() && provider_ != MapProvider::OSRM) {
        static bool warned = false;
        if (!warned) {
            std::cerr << "[MapDistance] No API key. Using Haversine * 1.4.\n";
            std::cerr << "[MapDistance] Get free key: https://openrouteservice.org/dev/#/signup\n";
            warned = true;
        }
        return haversineRoad;
    }

    // CASE 4: Check cache first
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

    // CASE 5: Call API with automatic timeout fallback
    double result = haversineRoad;

    switch (provider_) {
        case MapProvider::OPENROUTESERVICE:
            result = openRouteServiceDistance(lat1, lon1, lat2, lon2);
            break;
        case MapProvider::GOOGLE_MAPS:
            result = googleMapsDistance(lat1, lon1, lat2, lon2);
            break;
        case MapProvider::OSRM:
            result = osrmDistance(lat1, lon1, lat2, lon2);
            break;
        default:
            result = haversineRoad;
            break;
    }

    // Cache the result (whether from API or fallback)
    if (cacheEnabled_) {
        std::string cacheKey = makeCacheKey(lat1, lon1, lat2, lon2);
        std::lock_guard<std::mutex> lock(cacheMutex_);
        distanceCache_[cacheKey] = result;
    }

    // Check if we should disable API globally (too many failures)
    int totalCalls = apiCallCount.load();
    int successCalls = apiSuccessCount.load();
    if (totalCalls > 10 && successCalls < totalCalls / 2) {
        // Less than 50% success rate after 10+ calls - disable API
        globalDisableExternal.store(true);
        std::cerr << "[MapDistance] Low success rate (" << successCalls << "/" << totalCalls
                  << "). Switching to Haversine * 1.4 permanently.\n";
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