import { useState } from "react";

export default function InputPreview({ inputData, meta }) {
  const [showJson, setShowJson] = useState(false);

  if (!inputData) {
    return (
      <div className="card">
        <h3>Input Preview</h3>
        <p className="muted">Upload an Excel file to preview the input JSON.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>Input Preview</h3>
      <div className="kv">
        <span>Sheets detected</span>
        <div>{meta?.sheetNames?.join(", ") || "-"}</div>
        <span>Vehicles</span>
        <div>{inputData.vehicles.length}</div>
        <span>Requests</span>
        <div>{inputData.requests.length}</div>
        <span>Metadata rows</span>
        <div>{meta?.metadataRows ?? 0}</div>
        <span>Baseline rows</span>
        <div>{meta?.baselineRows ?? 0}</div>
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="button ghost" onClick={() => setShowJson(!showJson)}>
          {showJson ? "Hide JSON" : "Show JSON"}
        </button>
      </div>
      {showJson && (
        <textarea
          className="textarea"
          readOnly
          value={JSON.stringify(inputData, null, 2)}
        />
      )}
    </div>
  );
}
