#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# Velora Backend - Local Docker Build & Test Script
# ══════════════════════════════════════════════════════════════════════════════

set -e

IMAGE_NAME="velora-backend"
CONTAINER_NAME="velora-backend-test"
PORT=3001

echo "═══════════════════════════════════════════════════════════════════════"
echo " Velora Backend - Docker Build"
echo "═══════════════════════════════════════════════════════════════════════"

# Build the image
echo ""
echo "📦 Building Docker image..."
docker build -t $IMAGE_NAME .

echo ""
echo "✅ Build successful!"
echo ""

# Check if container is already running
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "🔄 Stopping existing container..."
    docker stop $CONTAINER_NAME 2>/dev/null || true
    docker rm $CONTAINER_NAME 2>/dev/null || true
fi

# Run the container
echo "🚀 Starting container..."
docker run -d \
    --name $CONTAINER_NAME \
    -p $PORT:$PORT \
    -e NODE_ENV=production \
    -e PORT=$PORT \
    $IMAGE_NAME

echo ""
echo "⏳ Waiting for server to start..."
sleep 5

# Test health endpoint
echo ""
echo "🔍 Testing health endpoint..."
if curl -s http://localhost:$PORT/api/health | grep -q '"status":"ok"'; then
    echo "✅ Health check passed!"
    curl -s http://localhost:$PORT/api/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:$PORT/api/health
else
    echo "❌ Health check failed!"
    echo "Container logs:"
    docker logs $CONTAINER_NAME
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo " Server running at http://localhost:$PORT"
echo " "
echo " Commands:"
echo "   View logs:    docker logs -f $CONTAINER_NAME"
echo "   Stop:         docker stop $CONTAINER_NAME"
echo "   Remove:       docker rm $CONTAINER_NAME"
echo "═══════════════════════════════════════════════════════════════════════"
