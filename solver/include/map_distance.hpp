#pragma once
#include <string>
#include <vector>
#include <unordered_map>
#include <mutex>
#include <utility>

// API Provider enum
enum class MapProvider {
    HAVERSINE,          // No API - uses Haversine straight-line distance
    GOOGLE_MAPS,        // Google Distance Matrix API
    OPENROUTESERVICE,   // OpenRouteService (free, open-source)
    OSRM                // Open Source Routing Machine (self-hosted or public demo)
};

class MapDistance {
public:
    MapDistance(bool allowExternal = false, const std::string &apiKey = "",
                MapProvider provider = MapProvider::OPENROUTESERVICE)
        : allowExternal_(allowExternal), apiKey_(apiKey), provider_(provider),
          timeoutMs_(2000), maxRetries_(2), cacheEnabled_(true) {}

    // Returns distance in kilometers
    double distance(double lat1, double lon1, double lat2, double lon2) const;

    // Configuration setters
    void setTimeout(long timeoutMs) { timeoutMs_ = timeoutMs; }
    void setMaxRetries(int retries) { maxRetries_ = retries; }
    void setProvider(MapProvider provider) { provider_ = provider; }
    void setCacheEnabled(bool enabled) { cacheEnabled_ = enabled; }

    // Clear the distance cache
    void clearCache();

    // Get cache statistics
    size_t getCacheSize() const;

    // Print API call statistics (for debugging)
    void printStats();

    // Get API call statistics for JSON output
    static int getApiCallCount();
    static int getApiSuccessCount();
    static int getTimeoutFallbackCount();
    static int getErrorFallbackCount();

    // Compute NxN distance table for a set of locations using OSRM Table API
    // Returns flat vector of size N*N (row-major), distances in km
    // Falls back to Haversine if API fails
    std::vector<double> computeDistanceTable(
        const std::vector<std::pair<double,double>>& locations) const;

    // Haversine (public for fallback use)
    double haversine(double lat1, double lon1, double lat2, double lon2) const;

    // Get provider info
    bool isExternalEnabled() const { return allowExternal_; }
    MapProvider getProvider() const { return provider_; }

private:
    bool allowExternal_;
    std::string apiKey_;
    MapProvider provider_;
    long timeoutMs_;
    int maxRetries_;
    bool cacheEnabled_;

    // Thread-safe cache for distances
    mutable std::unordered_map<std::string, double> distanceCache_;
    mutable std::mutex cacheMutex_;

    // API-specific implementations
    double googleMapsDistance(double lat1, double lon1, double lat2, double lon2) const;
    double openRouteServiceDistance(double lat1, double lon1, double lat2, double lon2) const;
    double osrmDistance(double lat1, double lon1, double lat2, double lon2) const;

    // Helper to create cache key
    std::string makeCacheKey(double lat1, double lon1, double lat2, double lon2) const;

    // HTTP request helper
    std::string httpGet(const std::string& url) const;
};
