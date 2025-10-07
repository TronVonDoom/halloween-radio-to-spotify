const ICY = require('icy');
const logger = require('../utils/logger');

class RadioMonitor {
  constructor(spotifyService) {
    this.spotifyService = spotifyService;
    this.stations = new Map();
    this.isMonitoring = false;
    this.lastMetadata = new Map();
    this.checkInterval = parseInt(process.env.METADATA_CHECK_INTERVAL) || 30000;
    
    // Halloween Radio station URLs
    this.stationUrls = {
      main: 'https://radio1.streamserver.link:8000/hrm-aac',
      movies: 'https://radio1.streamserver.link/radio/8050/hrs-aac',
      oldies: 'https://radio1.streamserver.link/radio/8020/hro-aac',
      kids: 'https://radio1.streamserver.link:8030/hrk-aac'
    };
  }

  async startMonitoring() {
    if (this.isMonitoring) {
      logger.warn('Radio monitoring is already active');
      return;
    }

    logger.info('📻 Starting radio station monitoring...');
    this.isMonitoring = true;

    // Start monitoring each station
    for (const [stationName, url] of Object.entries(this.stationUrls)) {
      try {
        await this.connectToStation(stationName, url);
      } catch (error) {
        logger.error(`❌ Failed to connect to ${stationName}:`, error);
      }
    }

    logger.info(`✅ Monitoring ${this.stations.size} stations`);
  }

  async connectToStation(stationName, url) {
    return new Promise((resolve, reject) => {
      logger.info(`🔗 Connecting to ${stationName}: ${url}`);

      const request = ICY.get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${stationName}`));
          return;
        }

        const contentType = res.headers ? res.headers['content-type'] || 'unknown' : 'unknown';
        logger.info(`✅ Connected to ${stationName} (${contentType})`);

        // Store connection info
        this.stations.set(stationName, {
          url,
          response: res,
          connected: true,
          lastMetadata: null
        });

        // Handle metadata
        res.on('metadata', (metadata) => {
          this.handleMetadata(stationName, metadata);
        });

        // Handle connection errors
        res.on('error', (error) => {
          logger.error(`❌ Stream error for ${stationName}:`, error);
          this.handleStationDisconnect(stationName);
        });

        res.on('end', () => {
          logger.warn(`⚠️ Stream ended for ${stationName}`);
          this.handleStationDisconnect(stationName);
        });

        // We don't need the actual audio data, just metadata
        res.resume();
        resolve();
      });

      request.on('error', (error) => {
        logger.error(`❌ Connection error for ${stationName}:`, error);
        reject(error);
      });

      // Set timeout for connection
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error(`Connection timeout for ${stationName}`));
      });
    });
  }

  async handleMetadata(stationName, metadata) {
    try {
      const parsed = ICY.parse(metadata);
      if (!parsed.StreamTitle) {
        return;
      }

      const currentTrack = this.parseStreamTitle(parsed.StreamTitle);
      if (!currentTrack || !currentTrack.artist || !currentTrack.title) {
        return;
      }

      // Check if this is a new track
      const lastTrack = this.lastMetadata.get(stationName);
      if (lastTrack && 
          lastTrack.artist === currentTrack.artist && 
          lastTrack.title === currentTrack.title) {
        return; // Same track, ignore
      }

      // Store new track
      this.lastMetadata.set(stationName, currentTrack);

      logger.info(`🎵 New track on ${stationName}: ${currentTrack.artist} - ${currentTrack.title}`);

      // Add to Spotify playlist
      await this.spotifyService.searchAndAddTrack(
        this.capitalizeStationName(stationName),
        currentTrack.artist,
        currentTrack.title,
        {
          ...currentTrack,
          station: stationName,
          timestamp: new Date().toISOString()
        }
      );

    } catch (error) {
      logger.error(`❌ Error handling metadata for ${stationName}:`, error);
    }
  }

  parseStreamTitle(streamTitle) {
    // Common formats:
    // "Artist - Title"
    // "Artist: Title"
    // "Title by Artist"
    // "Artist – Title" (different dash)
    
    const cleanTitle = streamTitle.trim();
    
    // Try different separators
    const separators = [' - ', ' – ', ' — ', ': ', ' by '];
    
    for (const separator of separators) {
      if (cleanTitle.includes(separator)) {
        const parts = cleanTitle.split(separator);
        
        if (parts.length >= 2) {
          if (separator === ' by ') {
            // "Title by Artist" format
            return {
              title: parts[0].trim(),
              artist: parts[1].trim(),
              original: cleanTitle
            };
          } else {
            // "Artist - Title" format
            return {
              artist: parts[0].trim(),
              title: parts.slice(1).join(separator).trim(),
              original: cleanTitle
            };
          }
        }
      }
    }

    // If no separator found, log as unparseable
    logger.warn(`⚠️ Could not parse stream title: "${cleanTitle}"`);
    return {
      artist: 'Unknown Artist',
      title: cleanTitle,
      original: cleanTitle
    };
  }

  capitalizeStationName(stationName) {
    return stationName.charAt(0).toUpperCase() + stationName.slice(1);
  }

  handleStationDisconnect(stationName) {
    const station = this.stations.get(stationName);
    if (station) {
      station.connected = false;
    }

    logger.warn(`⚠️ ${stationName} disconnected. Attempting to reconnect in 30 seconds...`);

    // Attempt to reconnect after delay
    setTimeout(async () => {
      if (this.isMonitoring) {
        try {
          const url = this.stationUrls[stationName];
          await this.connectToStation(stationName, url);
          logger.info(`✅ Reconnected to ${stationName}`);
        } catch (error) {
          logger.error(`❌ Failed to reconnect to ${stationName}:`, error);
          // Try again later
          this.handleStationDisconnect(stationName);
        }
      }
    }, 30000);
  }

  async stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }

    logger.info('🛑 Stopping radio monitoring...');
    this.isMonitoring = false;

    // Close all connections
    for (const [stationName, station] of this.stations) {
      if (station.response) {
        station.response.destroy();
      }
    }

    this.stations.clear();
    this.lastMetadata.clear();

    logger.info('✅ Radio monitoring stopped');
  }

  getStatus() {
    const status = {
      monitoring: this.isMonitoring,
      stations: {}
    };

    for (const [name, station] of this.stations) {
      status.stations[name] = {
        connected: station.connected,
        lastTrack: this.lastMetadata.get(name)
      };
    }

    return status;
  }
}

module.exports = RadioMonitor;