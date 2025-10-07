# Halloween Radio to Spotify - Docker Deployment Script (PowerShell)

Write-Host "🎃 Halloween Radio to Spotify - Docker Deployment" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green

# Check if .env file exists
if (-not (Test-Path ".env")) {
    Write-Host "❌ .env file not found!" -ForegroundColor Red
    Write-Host "📝 Please copy .env.docker to .env and configure your Spotify credentials:" -ForegroundColor Yellow
    Write-Host "   Copy-Item .env.docker .env" -ForegroundColor Cyan
    Write-Host "   # Then edit .env with your actual Spotify credentials" -ForegroundColor Gray
    exit 1
}

# Check if Docker is running
try {
    docker info | Out-Null
} catch {
    Write-Host "❌ Docker is not running. Please start Docker first." -ForegroundColor Red
    exit 1
}

Write-Host "🔧 Building Halloween Radio Monitor container..." -ForegroundColor Yellow
docker-compose build

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to build container" -ForegroundColor Red
    exit 1
}

Write-Host "🚀 Starting Halloween Radio Monitor..." -ForegroundColor Yellow
docker-compose up -d

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Halloween Radio Monitor is now running!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 Web Dashboard: http://localhost:8731" -ForegroundColor Cyan
    Write-Host "📝 View logs: docker-compose logs -f" -ForegroundColor Gray
    Write-Host "🛑 Stop service: docker-compose down" -ForegroundColor Gray
    Write-Host ""
    Write-Host "🔍 Container status:" -ForegroundColor Yellow
    docker-compose ps
} else {
    Write-Host "❌ Failed to start container" -ForegroundColor Red
    exit 1
}