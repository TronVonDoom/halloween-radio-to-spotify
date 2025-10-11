const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');

class DatabaseService {
  constructor() {
    this.db = null;
    this.dbPath = path.join(__dirname, '../../data/halloween_radio.db');
  }

  async initialize() {
    try {
      logger.info('🗄️ Initializing database...');
      
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      await fs.mkdir(dataDir, { recursive: true });
      
      // Open database connection
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });
      
      // Enable foreign keys and WAL mode for better performance
      await this.db.exec('PRAGMA foreign_keys = ON');
      await this.db.exec('PRAGMA journal_mode = WAL');
      
      // Initialize schema
      await this.initializeSchema();
      
      logger.info('✅ Database initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize database:', error);
      throw error;
    }
  }

  async initializeSchema() {
    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = await fs.readFile(schemaPath, 'utf8');
      await this.db.exec(schema);
      logger.info('✅ Database schema initialized');
    } catch (error) {
      logger.error('❌ Failed to initialize database schema:', error);
      throw error;
    }
  }

  // ==================== MATCHED TRACKS ====================
  
  async isTrackAlreadyAdded(spotifyId) {
    try {
      const result = await this.db.get(
        'SELECT id FROM matched_tracks WHERE spotify_id = ?',
        [spotifyId]
      );
      return !!result;
    } catch (error) {
      logger.error('❌ Error checking if track already added:', error);
      return false; // Fail safe - allow addition rather than miss it
    }
  }

  async addMatchedTrack(trackData) {
    try {
      const result = await this.db.run(`
        INSERT INTO matched_tracks (
          timestamp, station, radio_artist, radio_title, radio_original,
          spotify_id, spotify_artist, spotify_title, spotify_url,
          match_percentage, playlist_name, added_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        trackData.timestamp,
        trackData.station,
        trackData.metadata.artist,
        trackData.metadata.title,
        trackData.metadata.original,
        trackData.spotifyMatch.id,
        trackData.spotifyMatch.artist,
        trackData.spotifyMatch.title,
        trackData.spotifyMatch.url,
        trackData.percentage,
        trackData.playlist || `Halloween Radio - ${trackData.station}`,
        new Date().toISOString()
      ]);

      logger.info(`✅ Added matched track to database: ${trackData.spotifyMatch.artist} - ${trackData.spotifyMatch.title}`);
      
      // Update daily stats
      await this.updateDailyStats(trackData.station, 'matched', trackData.percentage);
      
      return result.lastID;
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        logger.info(`📋 Track already exists in database: ${trackData.spotifyMatch.artist} - ${trackData.spotifyMatch.title}`);
        
        // Update daily stats for duplicate
        await this.updateDailyStats(trackData.station, 'duplicate');
        
        return null; // Not an error, just already exists
      }
      logger.error('❌ Error adding matched track to database:', error);
      throw error;
    }
  }

  async getMatchedTracks(limit = 100, offset = 0, station = null) {
    try {
      let query = `
        SELECT * FROM matched_tracks 
        ${station ? 'WHERE station = ?' : ''}
        ORDER BY timestamp DESC 
        LIMIT ? OFFSET ?
      `;
      
      const params = station ? [station, limit, offset] : [limit, offset];
      const tracks = await this.db.all(query, params);
      
      return tracks;
    } catch (error) {
      logger.error('❌ Error getting matched tracks:', error);
      return [];
    }
  }

  async getMatchedTracksCount(station = null) {
    try {
      let query = 'SELECT COUNT(*) as count FROM matched_tracks';
      const params = [];
      
      if (station) {
        query += ' WHERE station = ?';
        params.push(station);
      }
      
      const result = await this.db.get(query, params);
      return result.count;
    } catch (error) {
      logger.error('❌ Error getting matched tracks count:', error);
      return 0;
    }
  }

  // ==================== UNMATCHED TRACKS ====================
  
  async addUnmatchedTrack(trackData) {
    try {
      const result = await this.db.run(`
        INSERT INTO unmatched_tracks (
          timestamp, station, radio_artist, radio_title, radio_original,
          best_spotify_artist, best_spotify_title, best_spotify_id,
          best_match_percentage, reason, search_results_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        trackData.timestamp,
        trackData.station,
        trackData.metadata.artist,
        trackData.metadata.title,
        trackData.metadata.original,
        trackData.spotifyMatch?.artist || null,
        trackData.spotifyMatch?.title || null,
        trackData.spotifyMatch?.id || null,
        trackData.percentage || 0,
        trackData.reason,
        trackData.searchResultsCount || 0,
        new Date().toISOString()
      ]);

      logger.warn(`⚠️ Added unmatched track to database: ${trackData.metadata.artist} - ${trackData.metadata.title}`);
      
      // Update daily stats
      await this.updateDailyStats(trackData.station, 'unmatched');
      
      return result.lastID;
    } catch (error) {
      logger.error('❌ Error adding unmatched track to database:', error);
      throw error;
    }
  }

  async getUnmatchedTracks(limit = 100, offset = 0, station = null) {
    try {
      let query = `
        SELECT * FROM unmatched_tracks 
        ${station ? 'WHERE station = ?' : ''}
        ORDER BY timestamp DESC 
        LIMIT ? OFFSET ?
      `;
      
      const params = station ? [station, limit, offset] : [limit, offset];
      const tracks = await this.db.all(query, params);
      
      return tracks;
    } catch (error) {
      logger.error('❌ Error getting unmatched tracks:', error);
      return [];
    }
  }

  async getTopUnmatchedTracks(limit = 50) {
    try {
      const tracks = await this.db.all(`
        SELECT * FROM top_unmatched LIMIT ?
      `, [limit]);
      
      return tracks;
    } catch (error) {
      logger.error('❌ Error getting top unmatched tracks:', error);
      return [];
    }
  }

  async retryUnmatchedTrack(trackId, newMatchData = null) {
    try {
      if (newMatchData) {
        // Track was successfully matched on retry
        await this.db.run(`
          UPDATE unmatched_tracks 
          SET best_spotify_artist = ?, best_spotify_title = ?, 
              best_spotify_id = ?, best_match_percentage = ?,
              retry_count = retry_count + 1, last_retry_at = ?
          WHERE id = ?
        `, [
          newMatchData.artist,
          newMatchData.title,
          newMatchData.id,
          newMatchData.percentage,
          new Date().toISOString(),
          trackId
        ]);
      } else {
        // Retry failed, just update retry count
        await this.db.run(`
          UPDATE unmatched_tracks 
          SET retry_count = retry_count + 1, last_retry_at = ?
          WHERE id = ?
        `, [
          new Date().toISOString(),
          trackId
        ]);
      }
    } catch (error) {
      logger.error('❌ Error updating retry information:', error);
    }
  }

  // ==================== PLAYLIST MANAGEMENT ====================
  
  async updatePlaylistInfo(station, playlistId, playlistName) {
    try {
      await this.db.run(`
        INSERT OR REPLACE INTO playlists (station, playlist_id, playlist_name, created_at, updated_at)
        VALUES (?, ?, ?, 
          COALESCE((SELECT created_at FROM playlists WHERE station = ?), ?),
          ?)
      `, [
        station,
        playlistId,
        playlistName,
        station,
        new Date().toISOString(),
        new Date().toISOString()
      ]);
    } catch (error) {
      logger.error('❌ Error updating playlist info:', error);
    }
  }

  async getPlaylistInfo(station = null) {
    try {
      let query = 'SELECT * FROM playlists';
      const params = [];
      
      if (station) {
        query += ' WHERE station = ?';
        params.push(station);
      }
      
      return await this.db.all(query, params);
    } catch (error) {
      logger.error('❌ Error getting playlist info:', error);
      return [];
    }
  }

  // ==================== STATISTICS ====================
  
  async updateDailyStats(station, type, matchPercentage = null) {
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      // First, ensure a stats record exists for today and this station using INSERT OR REPLACE
      await this.db.run(`
        INSERT OR REPLACE INTO stats (date, station, tracks_processed, tracks_matched, tracks_added, 
                         tracks_duplicated, tracks_unmatched, avg_match_percentage, updated_at)
        VALUES (?, ?, 
          COALESCE((SELECT tracks_processed FROM stats WHERE date = ? AND station = ?), 0),
          COALESCE((SELECT tracks_matched FROM stats WHERE date = ? AND station = ?), 0),
          COALESCE((SELECT tracks_added FROM stats WHERE date = ? AND station = ?), 0),
          COALESCE((SELECT tracks_duplicated FROM stats WHERE date = ? AND station = ?), 0),
          COALESCE((SELECT tracks_unmatched FROM stats WHERE date = ? AND station = ?), 0),
          COALESCE((SELECT avg_match_percentage FROM stats WHERE date = ? AND station = ?), 0),
          ?)
      `, [today, station, today, station, today, station, today, station, today, station, today, station, today, station, new Date().toISOString()]);
      
      // Get current stats
      const stats = await this.db.get(
        'SELECT * FROM stats WHERE date = ? AND station = ?',
        [today, station]
      );
      
      if (!stats) {
        logger.error(`Failed to create or retrieve stats record for ${station} on ${today}`);
        return;
      }
      
      // Update counters based on type
      const updates = {
        tracks_processed: stats.tracks_processed + 1
      };
      
      switch (type) {
        case 'matched':
          updates.tracks_matched = stats.tracks_matched + 1;
          updates.tracks_added = stats.tracks_added + 1;
          if (matchPercentage) {
            // Calculate new average
            const totalMatches = updates.tracks_matched;
            const currentTotal = stats.avg_match_percentage * (totalMatches - 1);
            updates.avg_match_percentage = (currentTotal + matchPercentage) / totalMatches;
          }
          break;
        case 'duplicate':
          updates.tracks_duplicated = stats.tracks_duplicated + 1;
          break;
        case 'unmatched':
          updates.tracks_unmatched = stats.tracks_unmatched + 1;
          break;
      }
      
      // Update database
      await this.db.run(`
        UPDATE stats 
        SET tracks_processed = ?, tracks_matched = ?, tracks_added = ?,
            tracks_duplicated = ?, tracks_unmatched = ?, avg_match_percentage = ?,
            updated_at = ?
        WHERE date = ? AND station = ?
      `, [
        updates.tracks_processed,
        updates.tracks_matched || stats.tracks_matched,
        updates.tracks_added || stats.tracks_added,
        updates.tracks_duplicated || stats.tracks_duplicated,
        updates.tracks_unmatched || stats.tracks_unmatched,
        updates.avg_match_percentage || stats.avg_match_percentage,
        new Date().toISOString(),
        today,
        station
      ]);
      
    } catch (error) {
      logger.error('❌ Error updating daily stats:', error);
    }
  }

  async getDailyStats(days = 30) {
    try {
      const stats = await this.db.all(`
        SELECT * FROM daily_summary 
        ORDER BY date DESC 
        LIMIT ?
      `, [days]);
      
      return stats;
    } catch (error) {
      logger.error('❌ Error getting daily stats:', error);
      return [];
    }
  }

  async getStationStats() {
    try {
      const stats = await this.db.all('SELECT * FROM station_summary');
      return stats;
    } catch (error) {
      logger.error('❌ Error getting station stats:', error);
      return [];
    }
  }

  // ==================== UTILITY METHODS ====================
  
  async clearAllData() {
    try {
      logger.info('🧹 Clearing all database data...');
      
      await this.db.exec(`
        DELETE FROM matched_tracks;
        DELETE FROM unmatched_tracks;
        DELETE FROM stats;
        DELETE FROM playlists;
      `);
      
      logger.info('✅ All database data cleared');
      return true;
    } catch (error) {
      logger.error('❌ Error clearing database:', error);
      return false;
    }
  }

  async getSystemStats() {
    try {
      const [matchedCount, unmatchedCount, playlistCount, statsCount] = await Promise.all([
        this.db.get('SELECT COUNT(*) as count FROM matched_tracks'),
        this.db.get('SELECT COUNT(*) as count FROM unmatched_tracks'),
        this.db.get('SELECT COUNT(*) as count FROM playlists'),
        this.db.get('SELECT COUNT(*) as count FROM stats')
      ]);
      
      return {
        matched_tracks: matchedCount.count,
        unmatched_tracks: unmatchedCount.count,
        playlists: playlistCount.count,
        daily_stats: statsCount.count,
        database_size: await this.getDatabaseSize()
      };
    } catch (error) {
      logger.error('❌ Error getting system stats:', error);
      return null;
    }
  }

  async getDatabaseSize() {
    try {
      const stats = await fs.stat(this.dbPath);
      return {
        bytes: stats.size,
        mb: Math.round(stats.size / 1024 / 1024 * 100) / 100
      };
    } catch (error) {
      return { bytes: 0, mb: 0 };
    }
  }

  async close() {
    if (this.db) {
      await this.db.close();
      logger.info('🗄️ Database connection closed');
    }
  }

  // ==================== MIGRATION HELPERS ====================
  
  async migrateFromFileData(spotifyDataPath) {
    try {
      logger.info('🔄 Migrating data from file-based system...');
      
      const data = JSON.parse(await fs.readFile(spotifyDataPath, 'utf8'));
      let migratedCount = 0;
      
      // Migrate matched tracks
      if (data.matchedTracks && Array.isArray(data.matchedTracks)) {
        for (const track of data.matchedTracks) {
          try {
            await this.addMatchedTrack(track);
            migratedCount++;
          } catch (error) {
            logger.warn(`⚠️ Could not migrate matched track: ${error.message}`);
          }
        }
      }
      
      // Migrate unmatched tracks
      if (data.unmatchedTracks && Array.isArray(data.unmatchedTracks)) {
        for (const track of data.unmatchedTracks) {
          try {
            await this.addUnmatchedTrack(track);
            migratedCount++;
          } catch (error) {
            logger.warn(`⚠️ Could not migrate unmatched track: ${error.message}`);
          }
        }
      }
      
      logger.info(`✅ Migration complete: ${migratedCount} tracks migrated`);
      return migratedCount;
    } catch (error) {
      logger.error('❌ Error during migration:', error);
      return 0;
    }
  }

  async getLastMatchedTrackTimestamp() {
    try {
      const query = `
        SELECT timestamp 
        FROM matched_tracks 
        ORDER BY timestamp DESC 
        LIMIT 1
      `;
      const result = await this.db.get(query);
      return result ? result.timestamp : null;
    } catch (error) {
      logger.error('❌ Error getting last matched track timestamp:', error);
      return null;
    }
  }

  async getUnmatchedTrackCounts() {
    try {
      const totalQuery = `
        SELECT COUNT(*) as count 
        FROM unmatched_tracks
      `;
      const totalResult = await this.db.get(totalQuery);
      
      const stationQuery = `
        SELECT station, COUNT(*) as count 
        FROM unmatched_tracks 
        GROUP BY station
      `;
      const stationResults = await this.db.all(stationQuery);
      
      const stationCounts = {};
      stationResults.forEach(row => {
        stationCounts[row.station] = row.count;
      });
      
      return {
        total: totalResult ? totalResult.count : 0,
        byStation: stationCounts
      };
    } catch (error) {
      logger.error('❌ Error getting unmatched track counts:', error);
      return { total: 0, byStation: {} };
    }
  }
}

module.exports = DatabaseService;