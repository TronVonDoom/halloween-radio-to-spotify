#!/bin/bash

# Halloween Radio to Spotify - Docker Deployment Script

echo "🎃 Halloween Radio to Spotify - Docker Deployment"
echo "=================================================="

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "📝 Please copy .env.docker to .env and configure your Spotify credentials:"
    echo "   cp .env.docker .env"
    echo "   # Then edit .env with your actual Spotify credentials"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

echo "🔧 Building Halloween Radio Monitor container..."
docker-compose build

if [ $? -ne 0 ]; then
    echo "❌ Failed to build container"
    exit 1
fi

echo "🚀 Starting Halloween Radio Monitor..."
docker-compose up -d

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Halloween Radio Monitor is now running!"
    echo ""
    echo "📊 Web Dashboard: http://localhost:8731"
    echo "📝 View logs: docker-compose logs -f"
    echo "🛑 Stop service: docker-compose down"
    echo ""
    echo "🔍 Container status:"
    docker-compose ps
else
    echo "❌ Failed to start container"
    exit 1
fi