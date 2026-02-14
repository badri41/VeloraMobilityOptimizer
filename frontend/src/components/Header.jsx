import React from "react";
import { motion } from "framer-motion";

export default function Header() {
  return (
    <motion.div
      className="header"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        className="header-logo"
        style={{ display: "flex", alignItems: "center", gap: "0" }}
      >
        <span className="logo-text" style={{ marginRight: "8px" }}>
          VELORA
        </span>
        <span className="logo-badge">MOBITECH</span>
      </div>
      <div className="header-content">
        <h1>Smart Employee Transport Planner</h1>
        <p>
          Plan the best pickup and drop routes for your employees - save time,
          reduce costs, and optimize your fleet.
        </p>
        <p
          className="company-tagline"
          style={{
            fontSize: "0.85rem",
            color: "var(--text-dim)",
            marginTop: "8px",
            fontStyle: "italic",
          }}
        >
          Driven by Possibility
        </p>
      </div>
    </motion.div>
  );
}
