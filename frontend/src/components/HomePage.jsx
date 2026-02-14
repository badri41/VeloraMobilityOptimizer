import React from "react";
import { motion } from "framer-motion";
import { ArrowRight, Truck, Clock, BarChart3, Target } from "lucide-react";
import "../homePageStyles.css";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.3,
    },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
  },
};

export default function HomePage({ onStart }) {
  return (
    <div className="homepage-container">
      <motion.div
        className="homepage-content"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div className="logo-section" variants={itemVariants}>
          <h1 className="velora-logo">VELORA</h1>
          <p className="velora-company">VELORA MOBITECH</p>
          <p className="velora-tagline">Driven by Possibility</p>
        </motion.div>

        <motion.div className="description-section" variants={itemVariants}>
          <p className="description-text">Employee Transport Route Planner</p>
          <p className="description-subtext">
            Upload your employee pickup/drop data and get optimized routes
            automatically - perfect for managing office commutes and shift
            schedules.
          </p>
        </motion.div>

        <motion.div variants={itemVariants}>
          <button className="start-button" onClick={onStart}>
            <span className="button-text">BEGIN OPTIMIZATION</span>
            <ArrowRight className="button-arrow" />
          </button>
        </motion.div>

        <div className="features-grid">
          {[
            { icon: Truck, label: "Multi-Vehicle" },
            { icon: Clock, label: "Time Windows" },
            { icon: BarChart3, label: "Analytics" },
            { icon: Target, label: "Optimized" },
          ].map((feature, idx) => (
            <motion.div
              key={idx}
              className="feature-item"
              variants={itemVariants}
              whileHover={{
                scale: 1.05,
                backgroundColor: "rgba(255, 255, 255, 0.1)",
              }}
            >
              <feature.icon
                className="feature-icon"
                size={32}
                color="var(--primary)"
              />
              <div className="feature-label">{feature.label}</div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
