# Halloween Radio to Spotify

A Node.js application that continuously monitors Halloween Radio stations, extracts ICY metadata, and automatically adds tracks to dedicated Spotify playlists.

## Features

- **4 Station Monitoring**: Monitors Main, Movies, Oldies, and Kids channels
- **ICY Metadata Extraction**: Captures real-time track information from radio streams
- **Spotify Integration**: Automatically searches and adds tracks to dedicated playlists
- **Database-Driven Duplicate Prevention**: SQLite database ensures no duplicates across all playlists
- **Smart Matching**: Only adds tracks with ≥75% accuracy match (configurable)
- **Persistent Data Storage**: SQLite database with complete track history and analytics
- **Rich Analytics**: Daily stats, match quality tracking, and detailed reporting
- **Web Dashboard**: Real-time monitoring at http://localhost:8731
- **Comprehensive Logging**: All activities logged with structured data
- **Robust Operation**: Designed for continuous 24/7 operation

## Station URLs

- **Main**: https://radio1.streamserver.link:8000/hrm-aac
- **Movies**: https://radio1.streamserver.link/radio/8050/hrs-aac
- **Oldies**: https://radio1.streamserver.link/radio/8020/hro-aac  
- **Kids**: https://radio1.streamserver.link:8030/hrk-aac

## Setup

1. **Clone and Install**:
   ```bash
   npm install
   ```

2. **Environment Configuration**:
   The `.env` file has been pre-configured with your Spotify credentials.

3. **Spotify Authorization**:
   Run the authorization script to get your refresh token:
   ```bash
   npm run auth
   ```
   This will open a browser window for Spotify authorization and automatically save your refresh token.

4. **Start Monitoring**:
   ```bash
   npm start
   ```
   
   The application will start monitoring and provide:
   - **Web Interface**: http://localhost:3000 - Real-time dashboard
   - **Terminal Output**: Live logs and status updates

For development with auto-restart:
```bash
npm run dev
```

## Web Interface

Once running, visit **http://localhost:8731** to access the monitoring dashboard featuring:

- **📊 Real-time Station Status**: See which stations are connected
- **🎵 Spotify Playlist Links**: Direct links to your auto-generated playlists  
- **📝 Live Activity Logs**: Watch tracks being detected and added
- **⚠️ Unmatched Tracks**: View tracks that didn't meet the match threshold
- **📈 Database Statistics**: Track counts, success rates, and analytics
- **📋 Track History**: Searchable history of all matched and unmatched tracks
- **🔄 Auto-refresh**: Updates every 5 seconds automatically

## Database Structure

The application uses SQLite for persistent data storage (`data/halloween_radio.db`):

- **matched_tracks**: Successfully added tracks with full metadata and match percentages
- **unmatched_tracks**: Failed matches for analysis and potential retry
- **playlists**: Station and playlist tracking information
- **stats**: Daily statistics per station with success rates and averages
- **Views**: Pre-built reports for daily summaries and top unmatched tracks

## Configuration

The application automatically creates these Spotify playlists:
- Halloween Radio - Main
- Halloween Radio - Movies  
- Halloween Radio - Oldies
- Halloween Radio - Kids

## Logging

- **Activity Logs**: `logs/app.log` - General application activity and track processing
- **Error Logs**: `logs/error.log` - Application errors and issues
- **Database**: All matched/unmatched track details stored in SQLite database

## Docker Deployment

### Quick Start with Docker

1. **Copy and configure environment file**:
   ```bash
   cp .env.docker .env
   # Edit .env with your actual Spotify credentials
   ```

2. **Deploy with the included script**:
   
   **Linux/Mac:**
   ```bash
   chmod +x deploy-docker.sh
   ./deploy-docker.sh
   ```
   
   **Windows PowerShell:**
   ```powershell
   .\deploy-docker.ps1
   ```

3. **Manual deployment**:
   ```bash
   docker-compose build
   docker-compose up -d
   ```

### Docker Features

- **Persistent Data**: Database and logs are preserved between container restarts
- **Health Checks**: Automatic container health monitoring
- **Security**: Runs as non-root user inside container
- **Resource Optimized**: Alpine Linux base image for minimal size
- **Auto-Restart**: Container automatically restarts if it crashes

### Docker Management

```bash
# View logs
docker-compose logs -f

# Stop the service
docker-compose down

# View container status
docker-compose ps

# Update the container
docker-compose pull && docker-compose up -d
```

## Development

```bash
npm run dev  # Start with nodemon for development
```

## License

MIT