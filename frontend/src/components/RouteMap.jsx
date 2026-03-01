import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { Flag, Info } from "lucide-react";
import "leaflet/dist/leaflet.css";

const vehicleColors = [
  { color: "#3b82f6", name: "Blue" },
  { color: "#8b5cf6", name: "Violet" },
  { color: "#10b981", name: "Green" },
  { color: "#f59e0b", name: "Amber" },
  { color: "#ef4444", name: "Red" },
  { color: "#06b6d4", name: "Cyan" },
  { color: "#ec4899", name: "Pink" },
];

// Darken a hex colour by the given factor (0–1)
function darkenColor(hex, factor = 0.35) {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.floor((num >> 16) * (1 - factor)));
  const g = Math.max(0, Math.floor(((num >> 8) & 0xff) * (1 - factor)));
  const b = Math.max(0, Math.floor((num & 0xff) * (1 - factor)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ─── Fit map bounds — re-fits whenever solutionKey changes ───────────────────
function MapBoundsHandler({ points, solutionKey }) {
  const map = useMap();
  const prevKey = useRef(null);
  useEffect(() => {
    if (points.length > 0 && prevKey.current !== solutionKey) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [50, 50] });
      prevKey.current = solutionKey;
    }
  }, [points, solutionKey, map]);
  return null;
}

// ─── Re-calculate map container size when tab becomes visible ────────────────
function MapResizer({ isActive }) {
  const map = useMap();
  const prevActive = useRef(isActive);
  useEffect(() => {
    if (isActive && !prevActive.current) {
      const t = setTimeout(() => map.invalidateSize({ animate: false }), 60);
      return () => clearTimeout(t);
    }
    prevActive.current = isActive;
  }, [isActive, map]);
  return null;
}

// ─── Route geometry cache (module-level — survives tab switches/re-renders) ───
const _routeCache = new Map();

// ─── Fetch real road geometry from OSRM (only in OSRM distance mode) ─────────
// Optimisations:
//   1. Module-level cache — same route is never re-fetched in a session.
//   2. Waypoint cap (8 max) — sending 17 coords to OSRM is exponentially slower;
//      we sample evenly, always keeping first and last point.
//   3. overview=simplified — coarser polyline but fine for a map; smaller & faster.
//   4. 8s AbortController timeout — falls back to straight lines instead of hanging.
async function fetchRoute(coordinates) {
  // 1. Cache lookup
  const cacheKey = coordinates.map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join("|");
  if (_routeCache.has(cacheKey)) return _routeCache.get(cacheKey);

  // 2. Waypoint cap — sample evenly, always keep first and last
  const MAX_WP = 8;
  let coords = coordinates;
  if (coordinates.length > MAX_WP) {
    const sampled = [coordinates[0]];
    const step = (coordinates.length - 1) / (MAX_WP - 1);
    for (let i = 1; i < MAX_WP - 1; i++) {
      sampled.push(coordinates[Math.round(i * step)]);
    }
    sampled.push(coordinates[coordinates.length - 1]);
    coords = sampled;
  }

  // 3. Fetch with 8s timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const coordStr = coords.map((c) => `${c[1]},${c[0]}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=simplified&geometries=geojson`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (data.code === "Ok" && data.routes?.[0]) {
      const geometry = data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
      _routeCache.set(cacheKey, geometry);
      return geometry;
    }
    return coordinates;
  } catch {
    clearTimeout(timeoutId);
    return coordinates; // timeout or network error → straight lines
  }
}

// ─── Single route polyline ───────────────────────────────────────────────────
// `straight`: when true (haversine mode) draws direct lines, skips OSRM geometry fetch.
function RealRoutePolyline({
  route, stops, color, routeIndex,
  isHighlighted, isFaded,
  onRouteClick, onRouteHover, onRouteHoverEnd,
  straight = false,
}) {
  const [routeGeometry, setRouteGeometry] = useState([]);
  const [isLoading, setIsLoading] = useState(!straight);

  useEffect(() => {
    if (straight) {
      // Haversine mode: straight lines, no OSRM call
      setRouteGeometry(stops?.map((s) => [s.lat, s.lon]) || []);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      if (!stops || stops.length < 2) { setIsLoading(false); return; }
      const coords = stops.map((s) => [s.lat, s.lon]);
      const geometry = await fetchRoute(coords);
      if (!cancelled) { setRouteGeometry(geometry); setIsLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [stops, straight]);

  const clickRef = useRef(onRouteClick);
  const hoverRef = useRef(onRouteHover);
  const hoverEndRef = useRef(onRouteHoverEnd);
  useEffect(() => { clickRef.current = onRouteClick; }, [onRouteClick]);
  useEffect(() => { hoverRef.current = onRouteHover; }, [onRouteHover]);
  useEffect(() => { hoverEndRef.current = onRouteHoverEnd; }, [onRouteHoverEnd]);

  const eventHandlers = useRef({
    click:     () => clickRef.current(),
    mouseover: () => hoverRef.current(routeIndex),
    mouseout:  () => hoverEndRef.current(),
  }).current;

  // Darken the hovered route; keep others at reduced opacity (not invisible)
  const displayColor = isHighlighted ? darkenColor(color, 0.35) : color;
  const weight  = isHighlighted ? 5 : 4;
  const opacity = isHighlighted ? 1  : isFaded ? 0.45 : 0.65;

  const formatTime = (m) => {
    if (m == null) return "—";
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
  };

  const employeeList = (stops || [])
    .filter((s) => s.type === "pickup")
    .map((s) => s.employeeId)
    .filter(Boolean)
    .join(", ");

  // Chronological stop list for tooltip — exclude depot (it has no arrival time / employee)
  const sortedStops = [...(stops || [])].filter((s) => s.type !== "depot").sort(
    (a, b) => (a.arrivalTime ?? a.arrival ?? 0) - (b.arrivalTime ?? b.arrival ?? 0)
  );

  const tooltipContent = (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 8, minWidth: 170 }}>
      <strong style={{ color, display: "block", marginBottom: 4 }}>
        {route?.vehicleIdStr || route?.vehicleId || `Vehicle ${routeIndex + 1}`}
      </strong>
      {employeeList && (
        <div style={{ marginBottom: 4, opacity: 0.85, fontSize: "0.75rem" }}>
          👥 {employeeList}
        </div>
      )}
      <div style={{ opacity: 0.75, fontSize: "0.72rem" }}>
        📏 {(route?.totalDist ?? route?.totalDistance)?.toFixed(1) ?? "—"} km
        &nbsp;·&nbsp;
        ₹{route?.totalCost?.toFixed(0) ?? "—"}
      </div>
      {sortedStops.length > 0 && (
        <div style={{ marginTop: 6, borderTop: "1px solid rgba(128,128,128,0.25)", paddingTop: 5 }}>
          {sortedStops.map((s, i) => (
            <div key={i} style={{ fontSize: "0.68rem", opacity: 0.8, marginTop: 3, display: "flex", gap: 4 }}>
              <span style={{ fontWeight: 700, minWidth: 14 }}>{i + 1}.</span>
              <span>{s.type === "pickup" ? "🏠" : "🏢"}</span>
              <span style={{ flex: 1 }}>{s.employeeId || "—"}</span>
              <span style={{ opacity: 0.65 }}>{formatTime(s.arrivalTime ?? s.arrival)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const positions = isLoading
    ? (stops?.map((s) => [s.lat, s.lon]) || [])
    : routeGeometry;

  if (positions.length === 0) return null;

  return (
    <Polyline
      positions={positions}
      color={displayColor}
      weight={weight}
      opacity={opacity}
      dashArray={isLoading ? "6, 10" : undefined}
      eventHandlers={eventHandlers}
    >
      <Tooltip sticky direction="top" className="route-tooltip">{tooltipContent}</Tooltip>
    </Polyline>
  );
}

// ─── Main Map Component ──────────────────────────────────────────────────────
export default function RouteMap({ inputData, solution, hoveredEmployeeId, isActive = true }) {
  const distanceMethodUsed = solution?.data?.summary?.distanceMethodUsed || "osrm";
  const isHaversine = distanceMethodUsed === "haversine";
  const [isDark, setIsDark] = useState(
    () => document.documentElement.getAttribute("data-theme") !== "light"
  );
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [hoveredRoute, setHoveredRoute] = useState(null);
  const hoverTimer = useRef(null);

  // Watch theme changes
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.getAttribute("data-theme") !== "light")
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Debounced hover handlers — 150ms prevents flicker on polyline width-change mouseout
  const handleRouteHover = useCallback((idx) => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    setHoveredRoute(idx);
  }, []);

  const handleRouteHoverEnd = useCallback(() => {
    hoverTimer.current = setTimeout(() => {
      setHoveredRoute(null);
      hoverTimer.current = null;
    }, 150);
  }, []);

  if (!inputData?.requests?.length) return null;

  const routes = solution?.data?.routes || [];

  // Unique key that changes whenever a new solution is loaded — triggers MapBoundsHandler re-fit
  const solutionKey = routes.length > 0
    ? (solution?.data?.summary?.globalCost ?? routes.map((r) => r.vehicleId).join(","))
    : "input-only";

  // Employee ID → route index (for employee-card hover)
  const empToRouteIdx = {};
  routes.forEach((r, idx) => {
    (r.stops || [])
      .filter((s) => s.type === "pickup")
      .forEach((s) => { if (s.employeeId) empToRouteIdx[s.employeeId] = idx; });
  });

  // Priority: click-select > employee-card hover > polyline/legend hover
  const effectiveHighlightIdx =
    selectedRoute != null
      ? selectedRoute
      : hoveredEmployeeId != null
        ? (empToRouteIdx[hoveredEmployeeId] ?? null)
        : hoveredRoute;

  // Map center derived from request locations
  const allLats = inputData.requests.flatMap((r) => [r.pickup.lat, r.dropoff.lat]);
  const allLons = inputData.requests.flatMap((r) => [r.pickup.lon, r.dropoff.lon]);
  const centerLat = (Math.min(...allLats) + Math.max(...allLats)) / 2;
  const centerLon = (Math.min(...allLons) + Math.max(...allLons)) / 2;

  // All map points for fitBounds (routes + requests + vehicle starts)
  const allMapPoints = [];
  routes.forEach((r) => r.stops?.forEach((s) => allMapPoints.push([s.lat, s.lon])));
  inputData.requests.forEach((r) => {
    allMapPoints.push([r.pickup.lat, r.pickup.lon]);
    allMapPoints.push([r.dropoff.lat, r.dropoff.lon]);
  });
  (inputData.vehicles || []).forEach((v) => {
    if (v.startLoc?.lat && v.startLoc?.lon && (v.startLoc.lat !== 0 || v.startLoc.lon !== 0)) {
      allMapPoints.push([v.startLoc.lat, v.startLoc.lon]);
    }
  });

  // Summary stats
  const totalStops = routes.reduce((s, r) => s + (r.stops?.length || 0), 0);
  const totalEmployees = new Set(
    routes.flatMap((r) => (r.stops || []).map((s) => s.employeeId).filter(Boolean))
  ).size;
  const totalDistance = routes.reduce((s, r) => s + (r.totalDist || 0), 0);

  const formatTime = (m) => {
    if (m == null) return "N/A";
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
  };

  const createGhostIcon = (color, type, label = "") =>
    L.divIcon({
      className: "",
      html: `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <div style="background:${color};width:30px;height:30px;border-radius:8px;border:2px solid white;box-shadow:0 3px 10px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:14px">${type === "pickup" ? "🏠" : "🏢"}</div>
        ${label ? `<div style="background:rgba(0,0,0,0.72);color:white;font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;white-space:nowrap;max-width:52px;overflow:hidden;text-overflow:ellipsis;line-height:1.4">${label}</div>` : ""}
      </div>`,
      iconSize: [52, label ? 46 : 32],
      iconAnchor: [26, label ? 46 : 32],
    });

  // Sort route indices so the highlighted route renders LAST (on top in Leaflet's SVG layer)
  const sortedRouteIndices = [...routes.keys()].sort((a, b) => {
    if (a === effectiveHighlightIdx) return 1;
    if (b === effectiveHighlightIdx) return -1;
    return 0;
  });

  return (
    <div className="map-view-v2">
      {/* Help banner */}
      <div className="map-help-banner glass-card">
        <Info size={18} color="var(--primary)" />
        <div className="help-text">
          <strong>Interactive Route Map</strong>
          {isHaversine
            ? "Routes shown as straight lines (Haversine / straight-line distance mode)."
            : "Routes follow actual roads (OSRM road geometry)."}
          {" "}Hover or click a route line or legend item to highlight it.
          🚗 markers show vehicle start positions.
        </div>
      </div>

      {/* Summary stats */}
      <div className="map-stats-panel glass-card">
        <h4 className="stats-title">Route Summary</h4>
        <div className="stats-grid">
          {[
            { icon: "🚗", value: routes.length, label: "Vehicles" },
            { icon: "👥", value: totalEmployees, label: "Employees" },
            { icon: "📍", value: totalStops, label: "Total Stops" },
            { icon: "📏", value: `${totalDistance.toFixed(1)} km`, label: "Distance" },
          ].map(({ icon, value, label }) => (
            <div key={label} className="stat-item">
              <div className="stat-icon">{icon}</div>
              <div className="stat-info">
                <div className="stat-value">{value}</div>
                <div className="stat-label">{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Vehicle routes legend */}
      <div className="map-legend-v2 glass-card">
        <div className="legend-header">
          <Flag size={16} color="var(--primary)" />
          <span>Vehicle Routes</span>
        </div>
        <div className="legend-description">
          Hover or click a row to highlight that vehicle's route on the map.
        </div>
        {routes.length > 0 && (
          <div className="fleet-status">
            {routes.map((r, i) => {
              const empCount = new Set(
                (r.stops || []).map((s) => s.employeeId).filter(Boolean)
              ).size;
              const dist = (r.totalDist || 0).toFixed(1);
              const color = vehicleColors[i % vehicleColors.length].color;
              const isActiveRoute = effectiveHighlightIdx === i;
              const isClickSelected = selectedRoute === i;
              return (
                <div
                  key={i}
                  className={`fleet-item${isActiveRoute ? " fleet-item-active" : ""}`}
                  onClick={() => setSelectedRoute(isClickSelected ? null : i)}
                  onMouseEnter={() => handleRouteHover(i)}
                  onMouseLeave={() => handleRouteHoverEnd()}
                  style={{ cursor: "pointer" }}
                >
                  <div
                    className="fleet-color"
                    style={{
                      background: color,
                      opacity: effectiveHighlightIdx != null && !isActiveRoute ? 0.3 : 1,
                      width: isActiveRoute ? 6 : 4,
                    }}
                  />
                  <div className="fleet-details">
                    <div
                      className="fleet-name"
                      style={{ color: isActiveRoute ? color : undefined, fontWeight: isActiveRoute ? 700 : 600 }}
                    >
                      {r.vehicleIdStr || r.vehicleId}
                    </div>
                    <div className="fleet-meta">{empCount} employees · {dist} km</div>
                  </div>
                  {isClickSelected && <div className="fleet-active-dot" />}
                </div>
              );
            })}
            {selectedRoute != null && (
              <button className="clear-selection-btn" onClick={() => setSelectedRoute(null)}>
                Clear selection
              </button>
            )}
          </div>
        )}
      </div>

      {/* Map */}
      <div className="map-wrapper-v2">
        <MapContainer
          center={[centerLat, centerLon]}
          zoom={12}
          className="premium-map-container"
          scrollWheelZoom
          zoomControl
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url={
              isDark
                ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            }
          />

          {/* C1: solutionKey makes bounds re-fit on each new solution */}
          <MapBoundsHandler points={allMapPoints} solutionKey={solutionKey} />
          <MapResizer isActive={isActive} />

          {/* Route polylines — sorted so highlighted renders last (on top) */}
          {sortedRouteIndices.map((rIdx) => {
            const route = routes[rIdx];
            const color = vehicleColors[rIdx % vehicleColors.length].color;
            const isHighlighted = effectiveHighlightIdx === rIdx;
            const isFaded = effectiveHighlightIdx != null && !isHighlighted;

            // Sort stops chronologically by arrival time
            const chronoStops = [...(route.stops || [])].sort(
              (a, b) => (a.arrivalTime ?? a.arrival ?? 0) - (b.arrivalTime ?? b.arrival ?? 0)
            );

            // Prepend vehicle depot so the first segment (depot → first pickup) is visible
            const routeVehicle =
              inputData?.vehicles?.[route.vehicleId] ??
              inputData?.vehicles?.find(
                (v) => v.vehicleId === route.vehicleIdStr || v.vehicle_id === route.vehicleIdStr
              );
            const vStartLat = routeVehicle?.startLoc?.lat ?? routeVehicle?.startLocation?.lat;
            const vStartLon = routeVehicle?.startLoc?.lon ?? routeVehicle?.startLocation?.lon;
            const depotStop = (vStartLat && vStartLon && !(vStartLat === 0 && vStartLon === 0))
              ? [{ lat: vStartLat, lon: vStartLon, type: "depot" }]
              : [];
            const stopsForPolyline = [...depotStop, ...(route.stops || [])];

            return (
              <React.Fragment key={rIdx}>
                <RealRoutePolyline
                  route={route}
                  stops={stopsForPolyline}
                  color={color}
                  routeIndex={rIdx}
                  isHighlighted={isHighlighted}
                  isFaded={isFaded}
                  onRouteClick={() => setSelectedRoute(selectedRoute === rIdx ? null : rIdx)}
                  onRouteHover={handleRouteHover}
                  onRouteHoverEnd={handleRouteHoverEnd}
                  straight={isHaversine}
                />

                {/* Stop markers — numbered in chronological arrival order */}
                {chronoStops.map((stop, chronoIdx) => (
                  <Marker
                    key={chronoIdx}
                    position={[stop.lat, stop.lon]}
                    icon={L.divIcon({
                      className: "stop-marker",
                      html: `<div style="background:${color};width:28px;height:28px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800">${chronoIdx + 1}</div>`,
                      iconSize: [28, 28],
                      iconAnchor: [14, 14],
                    })}
                  >
                    <Tooltip direction="top" offset={[0, -14]}>
                      <div style={{ fontSize: "0.75rem", padding: "4px", lineHeight: 1.5 }}>
                        <div style={{ fontWeight: 700, marginBottom: 2 }}>
                          Stop #{chronoIdx + 1} — {stop.type === "pickup" ? "🏠 Pickup" : "🏢 Dropoff"}
                        </div>
                        {stop.employeeId && <div>Employee: <strong>{stop.employeeId}</strong></div>}
                        <div>Arrival: <strong>{formatTime(stop.arrivalTime ?? stop.arrival)}</strong></div>
                        {stop.departureTime != null && (
                          <div>Departure: {formatTime(stop.departureTime)}</div>
                        )}
                        {stop.forceAssigned && (
                          <div style={{ color: "#f59e0b", marginTop: 3 }}>⚠ Force-assigned</div>
                        )}
                      </div>
                    </Tooltip>
                  </Marker>
                ))}
              </React.Fragment>
            );
          })}

          {/* Vehicle start position markers */}
          {routes.map((route, rIdx) => {
            const color = vehicleColors[rIdx % vehicleColors.length].color;
            // Match vehicle by array index first, then by id string (handles both naming conventions)
            const vehicle =
              inputData?.vehicles?.[route.vehicleId] ??
              inputData?.vehicles?.find(
                (v) => v.vehicleId === route.vehicleIdStr || v.vehicle_id === route.vehicleIdStr
              );
            // Support both `startLoc` (solver format) and `startLocation` (frontend-mapped format)
            const startLat = vehicle?.startLoc?.lat ?? vehicle?.startLocation?.lat;
            const startLon = vehicle?.startLoc?.lon ?? vehicle?.startLocation?.lon;
            if (!startLat || !startLon || (startLat === 0 && startLon === 0)) return null;
            return (
              <Marker
                key={`vstart-${rIdx}`}
                position={[startLat, startLon]}
                icon={L.divIcon({
                  className: "",
                  html: `<div style="position:relative;width:38px;height:38px">
                    <div style="background:${color};width:38px;height:38px;border-radius:50%;border:3px solid white;box-shadow:0 3px 12px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;font-size:18px">🚗</div>
                    <div style="position:absolute;bottom:-5px;right:-6px;background:white;color:${color};font-size:8px;font-weight:900;border-radius:3px;padding:1px 3px;line-height:1.2;border:1.5px solid ${color};white-space:nowrap">START</div>
                  </div>`,
                  iconSize: [38, 38],
                  iconAnchor: [19, 19],
                })}
              >
                <Tooltip direction="top" offset={[0, -22]}>
                  <div style={{ fontSize: "0.75rem", padding: "4px", lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 700, color, marginBottom: 2 }}>
                      {route.vehicleIdStr || `Vehicle ${rIdx + 1}`}
                    </div>
                    <div>🚗 Starting Position</div>
                    {vehicle.vehicle_type && (
                      <div style={{ opacity: 0.7 }}>
                        {vehicle.vehicle_type} · {vehicle.fuel_type}
                      </div>
                    )}
                    <div style={{ opacity: 0.6, fontFamily: "monospace", fontSize: "0.68rem" }}>
                      {startLat.toFixed(4)}, {startLon.toFixed(4)}
                    </div>
                  </div>
                </Tooltip>
              </Marker>
            );
          })}

          {/* Employee pickup landmarks — show ID label when no solution loaded, faint when covered by route stops */}
          {inputData.requests.map((req, idx) => {
            const hasSolution = routes.length > 0;
            const pickupOpacity = hasSolution ? 0.3 : 0.85;
            const dropoffOpacity = hasSolution ? 0.15 : 0.6;
            return (
              <React.Fragment key={idx}>
                <Marker
                  position={[req.pickup.lat, req.pickup.lon]}
                  icon={createGhostIcon("#10b981", "pickup", hasSolution ? "" : req.employeeId)}
                  opacity={pickupOpacity}
                >
                  <Popup className="premium-popup">
                    <div className="popup-content">
                      <h4>{req.employeeId}</h4>
                      <p>🏠 Pickup Location</p>
                      <p>Priority: <strong>P{req.priority}</strong></p>
                      <p>Sharing preference: max {req.sharingLimit === 100 ? "any" : req.sharingLimit}</p>
                      <p className="coords">{req.pickup.lat.toFixed(4)}, {req.pickup.lon.toFixed(4)}</p>
                    </div>
                  </Popup>
                </Marker>
                <Marker
                  position={[req.dropoff.lat, req.dropoff.lon]}
                  icon={createGhostIcon("#3b82f6", "dropoff", "")}
                  opacity={dropoffOpacity}
                >
                  <Popup className="premium-popup">
                    <div className="popup-content">
                      <h4>{req.employeeId}</h4>
                      <p>🏢 Office Dropoff</p>
                      <p>Window: {formatTime(req.earlyTime)} – {formatTime(req.lateTime)}</p>
                      <p className="coords">{req.dropoff.lat.toFixed(4)}, {req.dropoff.lon.toFixed(4)}</p>
                    </div>
                  </Popup>
                </Marker>
              </React.Fragment>
            );
          })}
        </MapContainer>
      </div>

      <style>{`
        .map-view-v2 { position: relative; border-radius: var(--radius-xl); overflow: hidden; border: 1px solid var(--border-subtle); height: 700px; }
        .map-wrapper-v2 { height: 100%; width: 100%; }
        .premium-map-container { height: 100%; width: 100%; z-index: 1; }

        .map-help-banner { position: absolute; top: 20px; left: 20px; z-index: 1000; max-width: 500px; padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
        .help-text { font-size: 0.8rem; line-height: 1.4; color: var(--text-dim); }
        .help-text strong { color: var(--text-bright); display: block; margin-bottom: 4px; }

        .map-stats-panel { position: absolute; bottom: 20px; left: 20px; z-index: 1000; padding: 16px; min-width: 380px; }
        .stats-title { font-family: var(--font-display); font-size: 0.85rem; font-weight: 700; color: var(--text-bright); margin-bottom: 12px; }
        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .stat-item { display: flex; align-items: center; gap: 8px; }
        .stat-icon { font-size: 1.2rem; }
        .stat-info { display: flex; flex-direction: column; }
        .stat-value { font-family: var(--font-display); font-size: 1.05rem; font-weight: 700; color: var(--text-bright); line-height: 1; }
        .stat-label { font-size: 0.65rem; color: var(--text-dim); text-transform: uppercase; margin-top: 2px; }

        .map-legend-v2 { position: absolute; top: 80px; right: 20px; z-index: 1000; width: 240px; padding: 16px; max-height: calc(100% - 120px); overflow-y: auto; }
        .legend-header { display: flex; align-items: center; gap: 10px; font-family: var(--font-display); font-weight: 700; font-size: 0.9rem; margin-bottom: 8px; color: var(--text-bright); }
        .legend-description { font-size: 0.73rem; color: var(--text-dim); margin-bottom: 14px; line-height: 1.4; }
        .fleet-status { display: flex; flex-direction: column; gap: 8px; }

        .fleet-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--bg-glass); border-radius: 8px; border: 1px solid transparent; transition: background 0.15s, border-color 0.15s; user-select: none; }
        .fleet-item:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.1); }
        .fleet-item-active { background: rgba(59,130,246,0.1) !important; border-color: rgba(59,130,246,0.4) !important; }
        .fleet-color { width: 4px; height: 34px; border-radius: 3px; transition: width 0.15s, opacity 0.15s; flex-shrink: 0; }
        .fleet-details { flex: 1; min-width: 0; }
        .fleet-name { font-size: 0.84rem; font-weight: 600; color: var(--text-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color 0.15s; }
        .fleet-meta { font-size: 0.7rem; color: var(--text-dim); margin-top: 2px; }
        .fleet-active-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); flex-shrink: 0; box-shadow: 0 0 6px var(--primary); }

        .clear-selection-btn { width: 100%; margin-top: 6px; padding: 6px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); border-radius: 6px; color: #f87171; font-size: 0.7rem; font-weight: 600; cursor: pointer; transition: background 0.15s; }
        .clear-selection-btn:hover { background: rgba(239,68,68,0.2); }

        .premium-popup .leaflet-popup-content-wrapper { background: var(--bg-surface); backdrop-filter: blur(10px); color: var(--text-bright); border: 1px solid var(--border-subtle); border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
        .premium-popup .leaflet-popup-tip { background: var(--bg-surface); }
        .popup-content { padding: 4px; }
        .popup-content h4 { font-family: var(--font-display); font-size: 0.9rem; margin-bottom: 8px; color: var(--text-bright); }
        .popup-content p { font-size: 0.75rem; color: var(--text-dim); margin: 4px 0; }
        .popup-content .coords { font-family: monospace; font-size: 0.7rem; color: var(--text-faded); }

        .leaflet-control-zoom { border: 1px solid var(--border-subtle) !important; border-radius: 8px !important; overflow: hidden; }
        .leaflet-control-zoom a { background: var(--bg-surface) !important; color: var(--text-bright) !important; border: none !important; }
        .leaflet-control-zoom a:hover { background: var(--bg-hover) !important; }

        .leaflet-tooltip { background: var(--bg-surface) !important; border: 1px solid var(--border-subtle) !important; color: var(--text-bright) !important; border-radius: 6px !important; box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important; }
        .leaflet-tooltip-top:before { border-top-color: var(--bg-surface) !important; }

        /* Route tooltip — themed for dark + light modes via CSS variables */
        .route-tooltip { background: var(--bg-surface) !important; border: 1px solid var(--border-subtle) !important; color: var(--text-bright) !important; border-radius: 8px !important; box-shadow: 0 6px 20px rgba(0,0,0,0.25) !important; padding: 8px 12px !important; font-size: 0.78rem !important; line-height: 1.6 !important; pointer-events: none !important; }
        .route-tooltip strong { font-size: 0.85rem; margin-bottom: 2px; }
        .route-tooltip:before { display: none !important; }

        /* C4: No pulsing animation on stop markers */
        .stop-marker { }

        @media (max-width: 768px) {
          .map-help-banner, .map-stats-panel { position: static; margin-bottom: 12px; }
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .map-legend-v2 { width: 180px; top: 60px; }
        }
      `}</style>
    </div>
  );
}
