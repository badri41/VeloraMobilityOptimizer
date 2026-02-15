# Velora Mobility Optimizer - Frontend Deployment

This branch contains **only the frontend deployment files** for the Velora Mobility Optimizer.

## � Live URLs

- **Frontend**: https://velora-jext.onrender.com
- **Backend API**: https://veloramobilityoptimizer.onrender.com/api

## �🏗️ Tech Stack

- **React 18** - UI Library
- **Vite** - Build tool
- **Leaflet** - Maps
- **Framer Motion** - Animations

## 📁 Files in This Branch

```
Frontend_Deployment/
├── src/                 # React source code
│   ├── App.jsx
│   ├── api.js          # API client (connects to backend)
│   └── components/
├── index.html
├── package.json
├── vite.config.js
├── render.yaml          # Render deployment config
└── .env.production      # Backend API endpoint
```

## 🔗 Backend Connection

The frontend connects to the deployed backend at:
```
https://veloramobilityoptimizer.onrender.com/api
```

This is configured in `.env.production`:
```env
VITE_API_BASE=https://veloramobilityoptimizer.onrender.com/api
```

## 🚀 Deploy to Render

### Option 1: Static Site (Recommended)

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New +** → **Static Site**
3. Connect your GitHub repo
4. Configure:
   - **Name**: `velora-frontend`
   - **Branch**: `Frontend_Deployment`
   - **Build Command**: `npm install && npm run build`
   - **Publish Directory**: `dist`
5. Add Environment Variable:
   - **Key**: `VITE_API_BASE`
   - **Value**: `https://veloramobilityoptimizer.onrender.com/api`
6. Click **Create Static Site**

### Option 2: Blueprint

1. **New +** → **Blueprint**
2. Connect repo → Select `Frontend_Deployment` branch
3. Render auto-detects `render.yaml`

## 🧪 Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🔧 Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE` | Backend API URL (required) |

## 📝 API Endpoints Used

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/optimize/json` | Submit optimization |
| GET | `/api/results/:jobId` | Get results |

## ⚡ Performance

- Static site with CDN caching
- Assets cached for 1 year (immutable)
- SPA routing via rewrite rules
- Build size: ~200KB gzipped
