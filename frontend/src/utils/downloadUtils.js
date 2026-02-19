import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ──────────────────────────────────────────────
// JSON Download
// ──────────────────────────────────────────────
export function downloadJSON(solution, inputData) {
  const report = {
    timestamp: new Date().toISOString(),
    solution,
    inputData,
    summary: {
      totalRoutes: solution?.data?.routes?.length || 0,
      totalDistance: solution?.data?.summary?.totalDistance || 0,
      totalCost: solution?.data?.summary?.totalMoneyCost || 0,
    },
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `velora-optimization-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ──────────────────────────────────────────────
// Excel Download
// ──────────────────────────────────────────────
export function downloadExcel(solution, inputData) {
  const data = solution?.data || {};
  const routes = data.routes || [];
  const summary = data.summary || {};

  // ── Sheet 1: Summary ──
  let baselineCost = 0;
  if (inputData?.baseline?.length) {
    baselineCost = inputData.baseline.reduce((s, b) => s + (b.baseline_cost || 0), 0);
  }
  const optimizedCost = summary.totalMoneyCost || 0;
  const savings = baselineCost > 0 ? baselineCost - optimizedCost : null;
  const savingsPct = baselineCost > 0 ? ((savings / baselineCost) * 100).toFixed(1) : null;

  const summaryRows = [
    ["Metric", "Value"],
    ["Report Generated", new Date().toLocaleString()],
    ["Optimized Cost (₹)", optimizedCost.toFixed(2)],
    ...(baselineCost > 0 ? [
      ["Baseline Cost (₹)", baselineCost.toFixed(2)],
      ["Savings (₹)", savings.toFixed(2)],
      ["Savings (%)", savingsPct + "%"],
    ] : []),
    ["Vehicles Used", summary.vehiclesUsed || routes.length],
    ["Total Distance (km)", (summary.totalDistance || 0).toFixed(2)],
    ["Total Time (min)", (summary.totalTime || 0).toFixed(0)],
    ["Unassigned Employees", summary.unassignedCount || 0],
    ["Penalty Cost (₹)", (summary.totalPenaltyCost || 0).toFixed(2)],
  ];

  // ── Sheet 2: Vehicle Routes ──
  const routeRows = [["Vehicle ID", "Stop #", "Type", "Employee ID", "Arrival Time", "Lat", "Lon"]];
  routes.forEach((route) => {
    const vId = route.vehicleIdStr || route.vehicleId;
    (route.stops || []).forEach((stop, idx) => {
      const arrMins = stop.arrivalTime ?? stop.arrival;
      const arrFmt = arrMins != null
        ? `${String(Math.floor(arrMins / 60)).padStart(2, "0")}:${String(Math.floor(arrMins % 60)).padStart(2, "0")}`
        : "-";
      routeRows.push([vId, idx + 1, stop.type || "-", stop.employeeId || "-", arrFmt, stop.lat?.toFixed(4) || "-", stop.lon?.toFixed(4) || "-"]);
    });
  });

  // ── Sheet 3: Employee Assignments ──
  const baselineMap = {};
  (inputData?.baseline || []).forEach((b) => {
    const id = b.employee_id || b.employeeId;
    if (id) baselineMap[id] = b;
  });
  const empOptCostMap = {};
  routes.forEach((route) => {
    const emps = [...new Set((route.stops || []).filter((s) => s.type === "pickup").map((s) => s.employeeId).filter(Boolean))];
    if (!emps.length) return;
    const share = (route.totalCost || 0) / emps.length;
    emps.forEach((id) => { empOptCostMap[id] = (empOptCostMap[id] || 0) + share; });
  });

  const empRows = [["Employee ID", "Vehicle", "Pickup Time", "Dropoff Time", "Trip Duration (min)", "Baseline Cost (₹)", "Optimized Cost (₹)", "Time Saved (min)"]];
  const empTrips = {};
  routes.forEach((route) => {
    const vId = route.vehicleIdStr || route.vehicleId;
    (route.stops || []).forEach((stop) => {
      if (!stop.employeeId) return;
      if (!empTrips[stop.employeeId]) empTrips[stop.employeeId] = { vehicleId: vId, pickupTime: null, dropoffTime: null };
      if (stop.type === "pickup") empTrips[stop.employeeId].pickupTime = stop.arrivalTime;
      else if (stop.type === "dropoff") empTrips[stop.employeeId].dropoffTime = stop.arrivalTime;
    });
  });

  const fmtTime = (m) => m != null ? `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}` : "-";

  Object.entries(empTrips).sort((a, b) => a[0].localeCompare(b[0])).forEach(([empId, trip]) => {
    const bl = baselineMap[empId];
    const travelTime = trip.pickupTime != null && trip.dropoffTime != null ? trip.dropoffTime - trip.pickupTime : null;
    const blTime = bl?.baseline_time_min ?? null;
    const timeSaved = blTime != null && travelTime != null ? (blTime - travelTime).toFixed(1) : "-";
    empRows.push([
      empId,
      trip.vehicleId,
      fmtTime(trip.pickupTime),
      fmtTime(trip.dropoffTime),
      travelTime != null ? travelTime.toFixed(1) : "-",
      bl?.baseline_cost != null ? bl.baseline_cost.toFixed(2) : "-",
      empOptCostMap[empId] != null ? empOptCostMap[empId].toFixed(2) : "-",
      timeSaved,
    ]);
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(routeRows), "Vehicle Routes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(empRows), "Employee Assignments");

  XLSX.writeFile(wb, `velora-optimization-${Date.now()}.xlsx`);
}

// ──────────────────────────────────────────────
// PDF Download
// ──────────────────────────────────────────────
export function downloadPDF(solution, inputData) {
  const data = solution?.data || {};
  const routes = data.routes || [];
  const summary = data.summary || {};

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  let baselineCost = 0;
  if (inputData?.baseline?.length) {
    baselineCost = inputData.baseline.reduce((s, b) => s + (b.baseline_cost || 0), 0);
  }
  const optimizedCost = summary.totalMoneyCost || 0;
  const savings = baselineCost > 0 ? baselineCost - optimizedCost : null;
  const savingsPct = baselineCost > 0 ? ((savings / baselineCost) * 100).toFixed(1) : null;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Velora Mobility Optimizer", 14, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text("Optimization Report", 14, 25);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 31);
  doc.setTextColor(0);

  // Section 1: Summary
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("1. Summary", 14, 42);

  const summaryBody = [
    ["Optimized Cost", `Rs.${optimizedCost.toFixed(2)}`],
    ...(baselineCost > 0 ? [
      ["Baseline Cost", `Rs.${baselineCost.toFixed(2)}`],
      ["Savings", `Rs.${savings.toFixed(2)} (${savingsPct}%)`],
    ] : []),
    ["Vehicles Used", String(summary.vehiclesUsed || routes.length)],
    ["Total Distance", `${(summary.totalDistance || 0).toFixed(2)} km`],
    ["Total Time", `${(summary.totalTime || 0).toFixed(0)} min`],
    ["Unassigned Employees", String(summary.unassignedCount || 0)],
    ["Penalty Cost", `Rs.${(summary.totalPenaltyCost || 0).toFixed(2)}`],
  ];

  autoTable(doc, {
    startY: 46,
    head: [["Metric", "Value"]],
    body: summaryBody,
    theme: "striped",
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 9 },
    columnStyles: { 0: { fontStyle: "bold" }, 1: { halign: "right" } },
  });

  // Section 2: Vehicle Routes
  let y = doc.lastAutoTable.finalY + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("2. Vehicle Routes", 14, y);

  const routeBody = routes.map((route) => {
    const vId = route.vehicleIdStr || route.vehicleId;
    const emps = [...new Set((route.stops || []).filter((s) => s.type === "pickup").map((s) => s.employeeId).filter(Boolean))];
    return [
      String(vId),
      emps.join(", ") || "-",
      `${(route.totalDist || 0).toFixed(1)} km`,
      `Rs.${(route.totalCost || 0).toFixed(0)}`,
      String((route.stops || []).length),
    ];
  });

  autoTable(doc, {
    startY: y + 4,
    head: [["Vehicle ID", "Employees", "Distance", "Cost", "Stops"]],
    body: routeBody,
    theme: "striped",
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 9 },
  });

  // Section 3: Employee Assignments
  y = doc.lastAutoTable.finalY + 10;
  if (y > 250) { doc.addPage(); y = 14; }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("3. Employee Assignments", 14, y);

  const baselineMap = {};
  (inputData?.baseline || []).forEach((b) => {
    const id = b.employee_id || b.employeeId;
    if (id) baselineMap[id] = b;
  });
  const empOptCostMap = {};
  routes.forEach((route) => {
    const emps = [...new Set((route.stops || []).filter((s) => s.type === "pickup").map((s) => s.employeeId).filter(Boolean))];
    if (!emps.length) return;
    const share = (route.totalCost || 0) / emps.length;
    emps.forEach((id) => { empOptCostMap[id] = (empOptCostMap[id] || 0) + share; });
  });

  const empTrips = {};
  routes.forEach((route) => {
    const vId = route.vehicleIdStr || route.vehicleId;
    (route.stops || []).forEach((stop) => {
      if (!stop.employeeId) return;
      if (!empTrips[stop.employeeId]) empTrips[stop.employeeId] = { vehicleId: vId, pickupTime: null, dropoffTime: null };
      if (stop.type === "pickup") empTrips[stop.employeeId].pickupTime = stop.arrivalTime;
      else if (stop.type === "dropoff") empTrips[stop.employeeId].dropoffTime = stop.arrivalTime;
    });
  });

  const fmtTime = (m) => m != null ? `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}` : "-";

  const empBody = Object.entries(empTrips).sort((a, b) => a[0].localeCompare(b[0])).map(([empId, trip]) => {
    const bl = baselineMap[empId];
    const travelTime = trip.pickupTime != null && trip.dropoffTime != null ? trip.dropoffTime - trip.pickupTime : null;
    const blTime = bl?.baseline_time_min ?? null;
    const timeSaved = blTime != null && travelTime != null ? (blTime - travelTime).toFixed(1) : "-";
    return [
      empId,
      String(trip.vehicleId),
      fmtTime(trip.pickupTime),
      fmtTime(trip.dropoffTime),
      travelTime != null ? `${travelTime.toFixed(1)} min` : "-",
      bl?.baseline_cost != null ? `Rs.${bl.baseline_cost.toFixed(0)}` : "-",
      empOptCostMap[empId] != null ? `Rs.${empOptCostMap[empId].toFixed(0)}` : "-",
      timeSaved !== "-" ? `${timeSaved} min` : "-",
    ];
  });

  autoTable(doc, {
    startY: y + 4,
    head: [["Employee", "Vehicle", "Pickup", "Dropoff", "Duration", "Baseline", "Optimized", "Time Saved"]],
    body: empBody,
    theme: "striped",
    headStyles: { fillColor: [37, 99, 235] },
    styles: { fontSize: 8 },
  });

  doc.save(`velora-optimization-${Date.now()}.pdf`);
}
