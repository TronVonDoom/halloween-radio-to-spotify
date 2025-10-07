const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');
const packageInfo = require('../../package.json');

class WebInterface {
  constructor(radioMonitor, spotifyService) {
    this.app = express();
    this.port = 8731; // Unique port for Halloween Radio Monitor
    this.radioMonitor = radioMonitor;
    this.spotifyService = spotifyService;
    
    this.setupRoutes();
  }

  setupRoutes() {
    // Middleware
    this.app.use(express.json());
    
    // Serve static files
    this.app.use(express.static(path.join(__dirname, '../web')));
    
    // API Routes
    this.app.get('/api/status', async (req, res) => {
      const status = this.radioMonitor.getStatus();
      
      // Get track counts per playlist/station
      const stationTrackCounts = {};
      let totalTrackCount = 0;
      
      for (const [stationName] of this.spotifyService.playlists.entries()) {
        const trackCount = this.spotifyService.playlistTrackCounts.get(stationName) || 0;
        stationTrackCounts[stationName] = trackCount;
        totalTrackCount += trackCount;
      }
      
      // Get database stats
      const systemStats = await this.spotifyService.getSystemStats();
      
      res.json({
        ...status,
        version: packageInfo.version,
        playlists: Array.from(this.spotifyService.playlists.entries()).map(([name, playlist]) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          id: playlist.id,
          url: playlist.external_urls.spotify
        })),
        addedTracksCount: totalTrackCount,
        stationTrackCounts: stationTrackCounts,
        databaseStats: systemStats
      });
    });

    this.app.get('/api/logs/recent', async (req, res) => {
      try {
        const logFile = path.join(process.cwd(), 'logs', 'app.log');
        const logContent = await fs.readFile(logFile, 'utf8');
        const lines = logContent.split('\n').filter(line => line.trim()).slice(-50);
        res.json({ logs: lines });
      } catch (error) {
        res.json({ logs: ['No logs available yet'] });
      }
    });

    this.app.get('/api/tracks/matched', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const station = req.query.station || null;
        
        const tracks = await this.spotifyService.getMatchedTracks(limit, offset, station);
        const total = await this.spotifyService.database.getMatchedTracksCount(station);
        
        // Convert database format to web interface format for compatibility
        const formattedTracks = tracks.map(track => ({
          id: track.id,
          timestamp: track.timestamp,
          station: track.station,
          metadata: {
            artist: track.radio_artist,
            title: track.radio_title,
            original: track.radio_original
          },
          spotifyMatch: {
            artist: track.spotify_artist,
            title: track.spotify_title,
            id: track.spotify_id,
            url: track.spotify_url
          },
          percentage: track.match_percentage,
          playlist: track.playlist_name
        }));
        
        res.json({ 
          tracks: formattedTracks, // Database already orders by timestamp DESC (newest first)
          total: total,
          limit: limit,
          offset: offset
        });
      } catch (error) {
        logger.error('❌ Error getting matched tracks:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/tracks/unmatched', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const station = req.query.station || null;
        
        const tracks = await this.spotifyService.getUnmatchedTracks(limit, offset, station);
        
        // Convert database format to web interface format for compatibility
        const formattedTracks = tracks.map(track => ({
          id: track.id,
          timestamp: track.timestamp,
          station: track.station,
          metadata: {
            artist: track.radio_artist,
            title: track.radio_title,
            original: track.radio_original
          },
          spotifyMatch: track.best_spotify_artist ? {
            artist: track.best_spotify_artist,
            title: track.best_spotify_title,
            id: track.best_spotify_id
          } : null,
          percentage: track.best_match_percentage || 0,
          reason: track.reason,
          searchResultsCount: track.search_results_count
        }));
        
        res.json({ 
          tracks: formattedTracks, // Database already orders by timestamp DESC (newest first)
          total: tracks.length,
          limit: limit,
          offset: offset
        });
      } catch (error) {
        logger.error('❌ Error getting unmatched tracks:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/tracks/top-unmatched', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const tracks = await this.spotifyService.getTopUnmatchedTracks(limit);
        
        res.json({ 
          tracks: tracks,
          total: tracks.length
        });
      } catch (error) {
        logger.error('❌ Error getting top unmatched tracks:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/stats/daily', async (req, res) => {
      try {
        const days = parseInt(req.query.days) || 30;
        const stats = await this.spotifyService.getDailyStats(days);
        
        res.json({ 
          stats: stats,
          days: days
        });
      } catch (error) {
        logger.error('❌ Error getting daily stats:', error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/stats/stations', async (req, res) => {
      try {
        const stats = await this.spotifyService.getStationStats();
        
        res.json({ 
          stats: stats
        });
      } catch (error) {
        logger.error('❌ Error getting station stats:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Debug endpoint to check database stats
    this.app.get('/api/debug/database', async (req, res) => {
      try {
        const systemStats = await this.spotifyService.getSystemStats();
        const dailyStats = await this.spotifyService.getDailyStats(7);
        const stationStats = await this.spotifyService.getStationStats();
        
        res.json({
          systemStats,
          recentDailyStats: dailyStats,
          stationStats
        });
      } catch (error) {
        logger.error('❌ Error getting debug info:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Migration endpoint
    this.app.post('/api/data/migrate', async (req, res) => {
      try {
        const result = await this.spotifyService.migrateFromFileData();
        res.json(result);
      } catch (error) {
        logger.error('❌ Error during migration:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    // Playlist management endpoints
    this.app.post('/api/playlists/remove-duplicates', async (req, res) => {
      try {
        const result = await this.spotifyService.removeDuplicatesFromPlaylists();
        res.json(result);
      } catch (error) {
        logger.error('❌ Error removing duplicates:', error);
        res.json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    this.app.post('/api/data/clear', async (req, res) => {
      try {
        const result = await this.spotifyService.clearAllData();
        res.json(result);
      } catch (error) {
        logger.error('❌ Error clearing data:', error);
        res.json({ 
          success: false, 
          error: error.message 
        });
      }
    });

    this.app.post('/api/playlists/delete-all', async (req, res) => {
      try {
        const recreate = req.query.recreate === 'true';
        console.log(`[DEBUG] Delete request - recreate parameter: ${req.query.recreate}, parsed as: ${recreate}`);
        
        const result = await this.spotifyService.deleteAllHalloweenPlaylists(recreate);
        res.json({ 
          success: true, 
          message: result.message, 
          deleted: result.deleted,
          recreated: result.recreated || []
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Main dashboard
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../web/index.html'));
    });
  }

  start() {
    this.server = this.app.listen(this.port, () => {
      logger.info(`🌐 Web interface available at: http://localhost:${this.port}`);
      console.log(`\n🎃 Halloween Radio Monitor Dashboard`);
      console.log(`📊 View status at: http://localhost:${this.port}`);
      console.log(`🎵 Monitor your playlists and track activity\n`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      logger.info('🛑 Web interface stopped');
    }
  }
}

module.exports = WebInterface;