import React, { useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";

export default function FileUpload({
  onFile,
  fileName,
  isParsing,
  onClear,
  error,
}) {
  const inputRef = useRef(null);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      onFile(file);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (
      file &&
      (file.name.endsWith(".xlsx") ||
        file.name.endsWith(".xls") ||
        file.name.endsWith(".json"))
    ) {
      onFile(file);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  return (
    <motion.div
      className="glass-card upload-card"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
    >
      <div className="upload-header">
        <div className="upload-header-title">
          <FileSpreadsheet
            className="title-icon"
            size={24}
            color="var(--primary)"
          />
          <h3>Upload Data File</h3>
        </div>
        <p className="upload-header-subtitle">
          Upload input data (Excel/JSON) to run optimization, or upload output
          JSON to view pre-computed results.
        </p>
      </div>

      <div
        className={`upload-dropzone ${fileName ? "has-file" : ""} ${isParsing ? "parsing" : ""}`}
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <AnimatePresence mode="wait">
          {!fileName ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="dropzone-content"
            >
              <div className="upload-cloud-icon-wrapper">
                <Upload className="upload-cloud-icon" size={40} />
              </div>
              <p className="upload-primary-text">
                {isParsing
                  ? "Processing your file..."
                  : "Click to browse or drag & drop your file here"}
              </p>
              <p className="upload-secondary-text">
                Excel (.xlsx, .xls), Input JSON, or Output JSON
              </p>

              <div
                className="upload-requirements"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginTop: "16px",
                  flexWrap: "wrap",
                  justifyContent: "center",
                }}
              >
                <span
                  className="req-label"
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-dim)",
                    fontWeight: "600",
                  }}
                >
                  Excel sheets (Vehicles, Employees, Metadata) or JSON file
                </span>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="selected"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="dropzone-content file-selected"
            >
              <div className="file-success-icon-wrapper">
                <CheckCircle2 className="file-success-icon" size={40} />
              </div>
              <p className="upload-primary-text">{fileName}</p>
              <p className="upload-secondary-text success">
                File loaded successfully
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="upload-footer">
        {fileName && (
          <button
            className="btn btn-secondary clear-button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            <X size={16} />
            <span>Clear File</span>
          </button>
        )}

        {error && (
          <motion.div
            className="upload-error-message"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <AlertCircle size={18} />
            <span>{error}</span>
          </motion.div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.json"
        onChange={handleChange}
        style={{ display: "none" }}
      />
    </motion.div>
  );
}
