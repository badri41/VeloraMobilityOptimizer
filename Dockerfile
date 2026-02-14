# ══════════════════════════════════════════════════════════════════════════════
# Velora Mobility Optimizer - Render Deployment
# Multi-stage build: C++ Solver + Python Parser + Node.js Backend
# ══════════════════════════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════════════════════
# Stage 1: Build C++ Solver
# ══════════════════════════════════════════════════════════════════════════════
FROM ubuntu:22.04 AS solver-builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    g++ \
    nlohmann-json3-dev \
    libcurl4-openssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Copy solver source
COPY CMakeLists.txt ./
COPY solver/ ./solver/

# Build solver binary
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build -j$(nproc) \
    && chmod +x build/solver/velora_solver \
    && ./build/solver/velora_solver --version 2>/dev/null || true

# ══════════════════════════════════════════════════════════════════════════════
# Stage 2: Production Runtime
# ══════════════════════════════════════════════════════════════════════════════
FROM ubuntu:22.04 AS runtime

ENV DEBIAN_FRONTEND=noninteractive

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Runtime libraries for solver
    libcurl4 \
    libstdc++6 \
    # Python 3 for Excel parser
    python3 \
    python3-pip \
    # Node.js
    curl \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# ─── Copy compiled solver from builder stage ─────────────────────────────────
COPY --from=solver-builder /build/build/solver/velora_solver ./build/solver/
RUN chmod +x ./build/solver/velora_solver

# ─── Install Python dependencies ─────────────────────────────────────────────
COPY backend/requirements.txt ./backend/
RUN pip3 install --no-cache-dir -r backend/requirements.txt

# ─── Copy Python parser ──────────────────────────────────────────────────────
COPY parser/ ./parser/

# ─── Install Node.js dependencies ────────────────────────────────────────────
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev --silent 2>/dev/null || npm install --omit=dev --silent

# ─── Copy backend source ─────────────────────────────────────────────────────
COPY backend/src/ ./src/

# ─── Create runtime directories ──────────────────────────────────────────────
RUN mkdir -p uploads outputs jobs \
    && chown -R node:node /app

# ─── Environment configuration ───────────────────────────────────────────────
ENV NODE_ENV=production \
    PORT=3001 \
    PATH="/app/build/solver:$PATH"

# ─── Switch to non-root user ─────────────────────────────────────────────────
USER node

EXPOSE 3001

# ─── Health check ────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/api/health || exit 1

# ─── Start server ────────────────────────────────────────────────────────────
CMD ["node", "src/app.js"]
