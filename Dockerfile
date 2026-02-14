# ══════════════════════════════════════════════════════════════════════════════
# Velora Mobility Optimizer - Docker Build for Render Deployment
# Includes: Node.js backend + Python parser + C++ solver binary
# ══════════════════════════════════════════════════════════════════════════════

FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# ─── Install System Dependencies ─────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build tools for C++ solver
    build-essential \
    cmake \
    g++ \
    # Python for excel parser
    python3 \
    python3-pip \
    # Node.js prerequisites
    curl \
    ca-certificates \
    # Required C++ libraries
    nlohmann-json3-dev \
    libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

# ─── Install Node.js 20 LTS ──────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ─── Set Working Directory ───────────────────────────────────────────────────
WORKDIR /app

# ─── Copy Project Files ──────────────────────────────────────────────────────
# Copy CMake files first (for better caching)
COPY CMakeLists.txt ./
COPY solver/ ./solver/

# ─── Build C++ Solver ────────────────────────────────────────────────────────
RUN mkdir -p build && \
    cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build -j$(nproc) && \
    # Verify solver was built
    test -f build/solver/velora_solver && \
    chmod +x build/solver/velora_solver

# ─── Install Python Dependencies ─────────────────────────────────────────────
COPY backend/requirements.txt ./backend/
RUN pip3 install --no-cache-dir -r backend/requirements.txt

# ─── Copy Parser Scripts ─────────────────────────────────────────────────────
COPY parser/ ./parser/

# ─── Install Node.js Dependencies ────────────────────────────────────────────
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --production --silent 2>/dev/null || npm install --production --silent

# ─── Copy Backend Source Code ────────────────────────────────────────────────
COPY backend/src/ ./src/

# ─── Create Required Directories ─────────────────────────────────────────────
RUN mkdir -p uploads outputs jobs

# ─── Environment Variables ───────────────────────────────────────────────────
ENV NODE_ENV=production
ENV PORT=3001

# ─── Expose Port ─────────────────────────────────────────────────────────────
EXPOSE 3001

# ─── Health Check ────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/api/health || exit 1

# ─── Start Backend Server ────────────────────────────────────────────────────
CMD ["node", "src/app.js"]
