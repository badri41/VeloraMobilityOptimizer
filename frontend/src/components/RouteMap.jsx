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
import { Truck, MapPin, Building, Flag, Info } from "lucide-react";
import "leaflet/dist/leaflet.css";

const vehicleColors = [
  { color: "#2563eb", name: "Deep Blue" },
  { color: "#7c3aed", name: "Deep Violet" },
  { color: "#059669", name: "Forest Green" },
  { color: "#d97706", name: "Burnt Orange" },
  { color: "#dc2626", name: "Deep Rose" },
  { color: "#0891b2", name: "Ocean Blue" },
  { color: "#db2777", name: "Deep Pink" },
];

// Component to fit map bounds to all markers
function MapBoundsHandler({ points }) {
  const map = useMap();

  useEffect(() => {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [points, map]);

  return null;
}

// Fetch real road routes from OSRM
async function fetchRoute(coordinates) {
  try {
    const coordString = coordinates.map((c) => `${c[1]},${c[0]}`).join(";");
    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.code === "Ok" && data.routes && data.routes[0]) {
      // Convert GeoJSON coordinates [lon, lat] to Leaflet format [lat, lon]
      return data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
    }

    // Fallback to straight line if routing fails
    return coordinates;
  } catch (error) {
    console.warn("OSRM routing failed, falling back to straight line:", error);
    return coordinates;
  }
}

// Component to render a single route with real road data
function RealRoutePolyline({ route, stops, color, routeIndex, isHighlighted, isFaded, onRouteClick, onRouteHover, onRouteHoverEnd }) {
  const [routeGeometry, setRouteGeometry] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadRoute() {
      if (!stops || stops.length < 2) {
        setIsLoading(false);
        return;
      }
      const coordinates = stops.map((s) => [s.lat, s.lon]);
      const geometry = await fetchRoute(coordinates);
      setRouteGeometry(geometry);
      setIsLoading(false);
    }
    loadRoute();
  }, [stops]);

  const weight = isHighlighted ? 7 : isFaded ? 2 : 4;
  const opacity = isHighlighted ? 0.95 : isFaded ? 0.2 : 0.55;

  const employeeList = (stops || [])
    .filter((s) => s.type === "pickup")
    .map((s) => s.employeeId)
    .filter(Boolean)
    .join(", ");

  const tooltipContent = (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 8 }}>
      <strong style={{ color }}>{route?.vehicleIdStr || route?.vehicleId || `Vehicle ${routeIndex + 1}`}</strong>
      <div>Employees: {employeeList || "—"}</div>
      <div>Distance: {route?.totalDist?.toFixed(1) ?? route?.totalDistance?.toFixed(1) ?? "—"} km</div>
      <div>Cost: ₹{route?.totalCost?.toFixed(0) ?? "—"}</div>
    </div>
  );

  // Stable event handler object — uses refs internally to avoid stale closures
  // without recreating the object on every render (which causes Leaflet to
  // remove+re-add listeners and can fire spurious mouseout events mid-render)
  const onRouteHoverRef = useRef(onRouteHover);
  const onRouteHoverEndRef = useRef(onRouteHoverEnd);
  const onRouteClickRef = useRef(onRouteClick);
  useEffect(() => { onRouteHoverRef.current = onRouteHover; }, [onRouteHover]);
  useEffect(() => { onRouteHoverEndRef.current = onRouteHoverEnd; }, [onRouteHoverEnd]);
  useEffect(() => { onRouteClickRef.current = onRouteClick; }, [onRouteClick]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const eventHandlers = useRef({
    click: () => onRouteClickRef.current(),
    mouseover: () => onRouteHoverRef.current(routeIndex),
    mouseout: () => onRouteHoverEndRef.current(),
  }).current;

  if (isLoading) {
    const straightLine = stops?.map((s) => [s.lat, s.lon]) || [];
    return (
      <Polyline
        positions={straightLine}
        color={color}
        weight={weight}
        opacity={opacity * 0.6}
        dashArray="5, 10"
        eventHandlers={eventHandlers}
      >
        <Tooltip sticky direction="top" className="route-tooltip">{tooltipContent}</Tooltip>
      </Polyline>
    );
  }

  return (
    <Polyline
      positions={routeGeometry}
      color={color}
      weight={weight}
      opacity={opacity}
      eventHandlers={eventHandlers}
    >
      <Tooltip sticky direction="top" className="route-tooltip">{tooltipContent}</Tooltip>
    </Polyline>
  );
}

export default function RouteMap({ inputData, solution, hoveredEmployeeId }) {
  const [isDark, setIsDark] = useState(() => document.documentElement.getAttribute("data-theme") !== "light");
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [hoveredRoute, setHoveredRoute] = useState(null);
  const hoverEndTimer = useRef(null);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.getAttribute("data-theme") !== "light");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  if (!inputData?.requests?.length) return null;

  const allLats = inputData.requests.flatMap((r) => [
    r.pickup.lat,
    r.dropoff.lat,
  ]);
  const allLons = inputData.requests.flatMap((r) => [
    r.pickup.lon,
    r.dropoff.lon,
  ]);
  const centerLat = (Math.min(...allLats) + Math.max(...allLats)) / 2;
  const centerLon = (Math.min(...allLons) + Math.max(...allLons)) / 2;

  const createIcon = (color, type) => {
    const iconHtml = type === "pickup" ? "🏠" : "🏢";
    return L.divIcon({
      className: "premium-marker",
      html: `<div style="background: ${color}; width: 32px; height: 32px; border-radius: 10px; border: 2px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 16px;">${iconHtml}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  };

  const formatTime = (minutes) => {
    if (!minutes && minutes !== 0) return "N/A";
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
  };

  // Stable hover callbacks — debounce the end to prevent flicker from re-renders
  const handleRouteHover = useCallback((idx) => {
    if (hoverEndTimer.current) {
      clearTimeout(hoverEndTimer.current);
      hoverEndTimer.current = null;
    }
    setHoveredRoute(idx);
  }, []);

  const handleRouteHoverEnd = useCallback(() => {
    hoverEndTimer.current = setTimeout(() => {
      setHoveredRoute(null);
      hoverEndTimer.current = null;
    }, 80);
  }, []);

  const routes = solution?.data?.routes || [];

  // Build employee → route index lookup for card-hover highlighting
  const empToRouteIdx = {};
  routes.forEach((r, idx) => {
    (r.stops || []).filter((s) => s.type === "pickup").forEach((s) => {
      if (s.employeeId) empToRouteIdx[s.employeeId] = idx;
    });
  });

  // Effective highlight index: click-select > card hover > polyline hover
  const effectiveHighlightIdx =
    selectedRoute != null
      ? selectedRoute
      : hoveredEmployeeId != null
        ? (empToRouteIdx[hoveredEmployeeId] ?? null)
        : hoveredRoute;

  // Calculate summary statistics
  const totalStops = routes.reduce((sum, r) => sum + (r.stops?.length || 0), 0);
  const totalEmployees = new Set(
    routes.flatMap((r) =>
      (r.stops || []).map((s) => s.employeeId).filter(Boolean),
    ),
  ).size;
  const totalDistance = routes.reduce((sum, r) => sum + (r.totalDist || 0), 0);

  // Collect all points for map bounds
  const allMapPoints = [];
  routes.forEach((route) => {
    route.stops?.forEach((stop) => {
      allMapPoints.push([stop.lat, stop.lon]);
    });
  });

  // Add pickup/dropoff points
  inputData.requests.forEach((req) => {
    allMapPoints.push([req.pickup.lat, req.pickup.lon]);
    allMapPoints.push([req.dropoff.lat, req.dropoff.lon]);
  });

  return (
    <div className="map-view-v2">
      {/* Help Banner */}
      <div className="map-help-banner glass-card">
        <Info size={18} color="var(--primary)" />
        <div className="help-text">
          <strong>Interactive Route Map</strong>
          Routes follow actual roads (OSRM). Distance totals match the optimizer's OSRM distance matrix.
          Click a route line or legend item to highlight it. Click markers for stop details.
        </div>
      </div>

      {/* Summary Stats */}
      <div className="map-stats-panel glass-card">
        <h4 className="stats-title">Route Summary</h4>
        <div className="stats-grid">
          <div className="stat-item">
            <div className="stat-icon">🚗</div>
            <div className="stat-info">
              <div className="stat-value">{routes.length}</div>
              <div className="stat-label">Vehicles</div>
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-icon">👥</div>
            <div className="stat-info">
              <div className="stat-value">{totalEmployees}</div>
              <div className="stat-label">Employees</div>
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-icon">📍</div>
            <div className="stat-info">
              <div className="stat-value">{totalStops}</div>
              <div className="stat-label">Total Stops</div>
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-icon">📏</div>
            <div className="stat-info">
              <div className="stat-value">{totalDistance.toFixed(1)}</div>
              <div className="stat-label">km Total</div>
            </div>
          </div>
        </div>
      </div>

      <div className="map-legend-v2 glass-card">
        <div className="legend-header">
          <Flag size={16} color="var(--primary)" />
          <span>Vehicle Routes</span>
        </div>
        <div className="legend-description">
          Each vehicle follows a colored route to pick up and drop off
          employees.
        </div>
        {routes.length > 0 && (
          <div className="fleet-status">
            {routes.map((r, i) => {
              const employeeCount = new Set(
                (r.stops || []).map((s) => s.employeeId).filter(Boolean),
              ).size;
              const routeDistance = (r.totalDist || 0).toFixed(1);
              const isActive = effectiveHighlightIdx === i;
              return (
                <div
                  key={i}
                  className={`fleet-item ${isActive ? "fleet-item-active" : ""}`}
                  onClick={() => setSelectedRoute(isActive ? null : i)}
                  onMouseEnter={() => handleRouteHover(i)}
                  onMouseLeave={() => handleRouteHoverEnd()}
                  style={{ cursor: "pointer" }}
                >
                  <div
                    className="fleet-color"
                    style={{
                      background: vehicleColors[i % vehicleColors.length].color,
                      opacity: effectiveHighlightIdx != null && !isActive ? 0.35 : 1,
                    }}
                  ></div>
                  <div className="fleet-details">
                    <div className="fleet-name" style={{ color: isActive ? vehicleColors[i % vehicleColors.length].color : undefined }}>
                      {r.vehicleIdStr || r.vehicleId}
                    </div>
                    <div className="fleet-meta">
                      {employeeCount} employees • {routeDistance} km
                    </div>
                  </div>
                  {isActive && <div className="fleet-active-dot" />}
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

      <div className="map-wrapper-v2">
        <MapContainer
          center={[centerLat, centerLon]}
          zoom={12}
          className="premium-map-container"
          scrollWheelZoom={true}
          zoomControl={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url={isDark ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"}
          />

          <MapBoundsHandler points={allMapPoints} />

          {/* Render vehicle routes with real road routing */}
          {routes.map((route, rIdx) => {
            const color = vehicleColors[rIdx % vehicleColors.length].color;
            const isHighlighted = effectiveHighlightIdx === rIdx;
            const isFaded = effectiveHighlightIdx != null && !isHighlighted;
            return (
              <React.Fragment key={rIdx}>
                <RealRoutePolyline
                  route={route}
                  stops={route.stops}
                  color={color}
                  routeIndex={rIdx}
                  isHighlighted={isHighlighted}
                  isFaded={isFaded}
                  onRouteClick={() => setSelectedRoute(selectedRoute === rIdx ? null : rIdx)}
                  onRouteHover={handleRouteHover}
                  onRouteHoverEnd={handleRouteHoverEnd}
                />

                {/* Route stop markers with sequence numbers */}
                {route.stops?.map((stop, sIdx) => (
                  <Marker
                    key={sIdx}
                    position={[stop.lat, stop.lon]}
                    icon={L.divIcon({
                      className: "stop-marker",
                      html: `<div style="background: ${color}; width: 28px; height: 28px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.4); color: white; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800;">${sIdx + 1}</div>`,
                      iconSize: [28, 28],
                      iconAnchor: [14, 14],
                    })}
                  >
                    <Tooltip
                      direction="top"
                      offset={[0, -14]}
                      permanent={false}
                    >
                      <div style={{ fontSize: "0.75rem", padding: "4px" }}>
                        <strong>Stop #{sIdx + 1}</strong>
                        <br />
                        Type: {stop.type || "N/A"}
                        <br />
                        Time: {formatTime(stop.arrivalTime || stop.arrival)}
                        <br />
                        {stop.employeeId ? `Employee: ${stop.employeeId}` : ""}
                      </div>
                    </Tooltip>
                  </Marker>
                ))}
              </React.Fragment>
            );
          })}

          {/* Original pickup/dropoff markers (hidden by default, can be toggled) */}
          {inputData.requests.map((req, idx) => (
            <React.Fragment key={idx}>
              <Marker
                position={[req.pickup.lat, req.pickup.lon]}
                icon={createIcon("#10b981", "pickup")}
                opacity={0.4}
              >
                <Popup className="premium-popup">
                  <div className="popup-content">
                    <h4>{req.employeeId}</h4>
                    <p>🏠 Pickup Location</p>
                    <p>Priority Level {req.priority}</p>
                    <p className="coords">
                      {req.pickup.lat.toFixed(4)}, {req.pickup.lon.toFixed(4)}
                    </p>
                  </div>
                </Popup>
              </Marker>
              <Marker
                position={[req.dropoff.lat, req.dropoff.lon]}
                icon={createIcon("#3b82f6", "dropoff")}
                opacity={0.4}
              >
                <Popup className="premium-popup">
                  <div className="popup-content">
                    <h4>{req.employeeId}</h4>
                    <p>🏢 Office Dropoff</p>
                    <p className="coords">
                      {req.dropoff.lat.toFixed(4)}, {req.dropoff.lon.toFixed(4)}
                    </p>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          ))}
        </MapContainer>
      </div>

      <style>{`
        .map-view-v2 { position: relative; border-radius: var(--radius-xl); overflow: hidden; border: 1px solid var(--border-subtle); height: 700px; }
        .map-wrapper-v2 { height: 100%; width: 100%; }
        .premium-map-container { height: 100%; width: 100%; z-index: 1; }
        
        .map-help-banner { position: absolute; top: 20px; left: 20px; z-index: 1000; max-width: 500px; padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
        .help-text { font-size: 0.8rem; line-height: 1.4; color: var(--text-dim); }
        .help-text strong { color: var(--text-bright); display: block; margin-bottom: 4px; }
        
        .map-stats-panel { position: absolute; bottom: 20px; left: 20px; z-index: 1000; padding: 16px; min-width: 400px; }
        .stats-title { font-family: var(--font-display); font-size: 0.85rem; font-weight: 700; color: var(--text-bright); margin-bottom: 12px; }
        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .stat-item { display: flex; align-items: center; gap: 8px; }
        .stat-icon { font-size: 1.2rem; }
        .stat-info { display: flex; flex-direction: column; }
        .stat-value { font-family: var(--font-display); font-size: 1.1rem; font-weight: 700; color: var(--text-bright); line-height: 1; }
        .stat-label { font-size: 0.65rem; color: var(--text-dim); text-transform: uppercase; margin-top: 2px; }
        
        .map-legend-v2 { position: absolute; top: 80px; right: 20px; z-index: 1000; width: 240px; padding: 16px; max-height: calc(100% - 120px); overflow-y: auto; }
        .legend-header { display: flex; align-items: center; gap: 10px; font-family: var(--font-display); font-weight: 700; font-size: 0.9rem; margin-bottom: 8px; color: var(--text-bright); }
        .legend-description { font-size: 0.75rem; color: var(--text-dim); margin-bottom: 16px; line-height: 1.4; }
        .fleet-status { display: flex; flex-direction: column; gap: 10px; }
        .fleet-item { display: flex; align-items: center; gap: 10px; padding: 8px; background: var(--bg-glass); border-radius: 8px; transition: background 0.2s; }
        .fleet-item:hover { background: var(--border-subtle); }
        .fleet-item-active { background: var(--border-subtle) !important; border: 1px solid rgba(59,130,246,0.3); }
        .fleet-active-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); flex-shrink: 0; }
        .clear-selection-btn { width: 100%; margin-top: 8px; padding: 6px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); border-radius: 6px; color: #f87171; font-size: 0.7rem; font-weight: 600; cursor: pointer; transition: background 0.2s; }
        .clear-selection-btn:hover { background: rgba(239,68,68,0.2); }
        .fleet-color { width: 4px; height: 32px; border-radius: 2px; }
        .fleet-details { flex: 1; }
        .fleet-name { font-size: 0.85rem; font-weight: 600; color: var(--text-bright); }
        .fleet-meta { font-size: 0.7rem; color: var(--text-dim); margin-top: 2px; }
        
        .premium-popup .leaflet-popup-content-wrapper { 
          background: var(--bg-surface); 
          backdrop-filter: blur(10px); 
          color: var(--text-bright); 
          border: 1px solid var(--border-subtle); 
          border-radius: 12px; 
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .premium-popup .leaflet-popup-tip { background: var(--bg-surface); border: 1px solid var(--border-subtle); }
        .popup-content { padding: 4px; }
        .popup-content h4 { font-family: var(--font-display); font-size: 0.9rem; margin-bottom: 8px; color: var(--text-bright); }
        .popup-content p { font-size: 0.75rem; color: var(--text-dim); margin: 4px 0; }
        .popup-content .coords { font-family: monospace; font-size: 0.7rem; color: var(--text-faded); }
        
        /* Leaflet control styling */
        .leaflet-control-zoom { border: 1px solid var(--border-subtle) !important; border-radius: 8px !important; overflow: hidden; }
        .leaflet-control-zoom a { background: var(--bg-surface) !important; color: var(--text-bright) !important; border: none !important; }
        .leaflet-control-zoom a:hover { background: var(--bg-hover) !important; }
        
        /* Tooltip styling */
        .leaflet-tooltip {
          background: var(--bg-surface) !important;
          border: 1px solid var(--border-subtle) !important;
          color: var(--text-bright) !important;
          border-radius: 6px !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
        }
        .leaflet-tooltip-top:before { border-top-color: var(--bg-surface) !important; }

        /* Route polyline hover tooltip */
        .route-tooltip {
          background: rgba(10, 14, 26, 0.92) !important;
          border: 1px solid rgba(255,255,255,0.12) !important;
          border-radius: 8px !important;
          box-shadow: 0 6px 20px rgba(0,0,0,0.5) !important;
          padding: 8px 12px !important;
          font-size: 0.78rem !important;
          line-height: 1.6 !important;
          pointer-events: none !important;
        }
        .route-tooltip strong { display: block; font-size: 0.85rem; margin-bottom: 2px; }
        .route-tooltip:before { display: none !important; }
        
        /* Stop marker animations */
        .stop-marker { animation: pulse 2s infinite; }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        
        @media (max-width: 768px) {
          .map-help-banner, .map-stats-panel { position: static; margin-bottom: 12px; }
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .map-legend-v2 { width: 180px; top: 60px; }
        }
      `}</style>
    </div>
  );
}
