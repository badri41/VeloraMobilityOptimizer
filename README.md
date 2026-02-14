# Velora Mobility Optimizer - Backend Deployment

This branch contains **only the backend deployment files** for the Velora Mobility Optimizer.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Container                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Node.js   │──│   Python    │──│    C++ Solver       │  │
│  │   Backend   │  │   Parser    │  │  (velora_solver)    │  │
│  │  (Express)  │  │  (pandas)   │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│        ↓                ↓                    ↓              │
│    HTTP API        Excel→JSON          Optimization        │
│    Port 3001       Conversion          Algorithm           │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Files in This Branch

| Path | Description |
|------|-------------|
| `backend/` | Node.js Express API server |
| `solver/` | C++ optimization solver source code |
| `parser/` | Python Excel-to-JSON converter |
| `Dockerfile` | Multi-stage Docker build configuration |
| `render.yaml` | Render deployment blueprint |
| `CMakeLists.txt` | CMake build configuration for solver |

## 🚀 Deploy to Render

### Option 1: Blueprint (Recommended)

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New** → **Blueprint**
3. Connect your GitHub repo
4. Select branch: `Backend_deplyment`
5. Render will auto-detect `render.yaml` and configure the service

### Option 2: Manual Docker Service

1. Go to Render Dashboard → **New** → **Web Service**
2. Connect your GitHub repo
3. Configure:
   - **Branch**: `Backend_deplyment`
   - **Runtime**: Docker
   - **Dockerfile Path**: `./Dockerfile`
   - **Port**: 3001
4. Add environment variables:
   - `NODE_ENV`: production
   - `PORT`: 3001
   - `FRONTEND_URL`: your Vercel frontend URL

## 🧪 Local Testing

```bash
# Build and run with Docker
chmod +x docker-build.sh
./docker-build.sh

# Test the API
curl http://localhost:3001/api/health
```

## 🔗 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | API info |
| GET | `/api/health` | Health check |
| POST | `/api/optimize` | Upload Excel file |
| POST | `/api/optimize/json` | Submit JSON directly |
| GET | `/api/results/:jobId` | Get optimization results |

## 🔧 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Set to `production` |
| `PORT` | Yes | Server port (default: 3001) |
| `FRONTEND_URL` | No | CORS allowed origin |
| `MAPS_API_KEY` | No | Google Maps API key |

## 📝 Build Process

The Dockerfile uses a **multi-stage build**:

1. **Stage 1 (solver-builder)**: Compiles C++ solver with CMake
2. **Stage 2 (runtime)**: Creates lean production image with:
   - Compiled solver binary
   - Python 3 + pandas for Excel parsing
   - Node.js 20 + Express backend

Total image size: ~400MB (optimized from ~1.2GB single-stage)
