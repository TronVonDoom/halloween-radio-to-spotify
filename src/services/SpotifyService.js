const SpotifyWebApi = require('spotify-web-api-node');
const stringSimilarity = require('string-similarity');
const logger = require('../utils/logger');
const DatabaseService = require('../database/DatabaseService');

class SpotifyService {
  constructor() {
    this.spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      redirectUri: process.env.SPOTIFY_REDIRECT_URI
    });
    
    this.database = new DatabaseService();
    
    this.userId = null;
    this.playlists = new Map();
    this.playlistTrackCounts = new Map(); // Station name -> track count
    this.similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.9;
  }

  async initialize() {
    try {
      logger.info('🎵 Initializing Spotify service...');
      
      // Initialize database first
      await this.database.initialize();
      
      // Try to use existing refresh token
      if (process.env.SPOTIFY_REFRESH_TOKEN) {
        this.spotifyApi.setRefreshToken(process.env.SPOTIFY_REFRESH_TOKEN);
        await this.refreshAccessToken();
      } else {
        await this.authorizeUser();
      }
      
      // Get user profile
      const userProfile = await this.spotifyApi.getMe();
      this.userId = userProfile.body.id;
      logger.info(`✅ Authenticated as Spotify user: ${userProfile.body.display_name}`);
      
      // Create/find playlists
      await this.setupPlaylists();
      
      logger.info('✅ Spotify service initialized successfully');
      
    } catch (error) {
      logger.error('❌ Failed to initialize Spotify service:', error);
      throw error;
    }
  }

  async authorizeUser() {
    const scopes = [
      'playlist-modify-public', 
      'playlist-modify-private', 
      'playlist-read-private',
      'playlist-read-collaborative', 
      'user-read-private'
    ];
    const authorizeURL = this.spotifyApi.createAuthorizeURL(scopes, 'halloween-radio');
    
    logger.info('🔗 Please authorize the application at:', authorizeURL);
    
    // In a real implementation, you'd handle the callback
    // For now, we'll assume the user will manually provide the code
    throw new Error('Manual authorization required. Please implement OAuth flow.');
  }

  async refreshAccessToken() {
    try {
      const data = await this.spotifyApi.refreshAccessToken();
      this.spotifyApi.setAccessToken(data.body.access_token);
      
      // Update refresh token if provided
      if (data.body.refresh_token) {
        this.spotifyApi.setRefreshToken(data.body.refresh_token);
      }
      
      logger.info('✅ Spotify access token refreshed');
    } catch (error) {
      logger.error('❌ Failed to refresh access token:', error);
      throw error;
    }
  }

  async setupPlaylists() {
    const stationNames = ['Main', 'Movies', 'Oldies', 'Kids'];
    
    logger.info(`🎵 Setting up playlists for ${stationNames.length} stations...`);
    
    for (const station of stationNames) {
      const playlistName = `Halloween Radio - ${station}`;
      
      try {
        logger.info(`🔍 Setting up playlist for ${station}...`);
        
        // Check if playlist already exists
        let playlist = await this.findPlaylistByName(playlistName);
        
        if (!playlist) {
          // Create new playlist
          logger.info(`📝 Creating new playlist: ${playlistName}`);
          try {
            const response = await this.spotifyApi.createPlaylist(playlistName, {
              description: `Automatically curated tracks from Halloween Radio ${station} station`,
              public: false
            });
            playlist = response.body || response;
            logger.info(`✅ Created playlist: ${playlistName} (ID: ${playlist.id})`);
          } catch (createError) {
            logger.error(`❌ Error creating playlist ${playlistName}:`, createError.message);
            logger.debug('Create error details:', createError);
            throw createError;
          }
        } else {
          logger.info(`✅ Using existing playlist: ${playlistName} (ID: ${playlist.id})`);
        }
        
        if (!playlist || !playlist.id) {
          throw new Error(`Invalid playlist object for ${station}: ${JSON.stringify(playlist)}`);
        }
        
        // Store the playlist
        this.playlists.set(station.toLowerCase(), playlist);
        
        // Update playlist info in database
        await this.database.updatePlaylistInfo(station, playlist.id, playlistName);
        
        // Load existing tracks to prevent duplicates
        logger.info(`📚 Loading existing tracks from ${playlistName}...`);
        await this.loadExistingTracks(playlist.id, station);
        
      } catch (error) {
        logger.error(`❌ Failed to setup playlist for ${station}:`, error.message);
        throw error;
      }
    }
    
    logger.info(`✅ Successfully set up ${this.playlists.size} playlists`);
  }

  async findPlaylistByName(name) {
    try {
      let offset = 0;
      const limit = 50;
      
      logger.info(`🔍 Searching for existing playlist: ${name}`);
      
      while (true) {
        // Use the correct API call - try different approaches
        let response;
        try {
          // Try method 1: getUserPlaylists with user ID
          response = await this.spotifyApi.getUserPlaylists(this.userId, { offset, limit });
        } catch (error1) {
          logger.warn(`⚠️ Method 1 failed, trying method 2: ${error1.message}`);
          try {
            // Try method 2: getUserPlaylists without user ID  
            response = await this.spotifyApi.getUserPlaylists({ offset, limit });
          } catch (error2) {
            logger.warn(`⚠️ Method 2 failed: ${error2.message}`);
            // If both methods fail, throw the original error
            throw error1;
          }
        }
        
        let playlists = [];
        
        // Handle response format correctly
        if (response && response.body && response.body.items) {
          playlists = response.body.items;
        } else if (response && response.items) {
          playlists = response.items;
        } else {
          logger.warn('⚠️ No playlists found or unexpected response format');
          logger.debug('Response structure:', JSON.stringify(response, null, 2));
          break;
        }
        
        logger.info(`📋 Checking ${playlists.length} playlists (offset: ${offset})`);
        
        // Show playlist names for debugging (first few)
        if (playlists.length > 0) {
          const playlistNames = playlists.slice(0, 5).map((p, i) => `  ${i+1}. "${p.name}"`);
          logger.info(`Sample playlists: \n${playlistNames.join('\n')}`);
          if (playlists.length > 5) {
            logger.info(`  ... and ${playlists.length - 5} more`);
          }
        }
        
        // Look for exact name match
        const found = playlists.find(p => p && p.name === name);
        if (found) {
          logger.info(`✅ Found existing playlist: ${name} (ID: ${found.id})`);
          return found;
        }
        
        // If we got fewer results than requested, we've reached the end
        if (playlists.length < limit) break;
        offset += limit;
      }
      
      logger.info(`❌ Playlist not found: ${name}`);
      return null;
    } catch (error) {
      logger.error('❌ Error finding playlist:', error.message);
      logger.debug('Full error:', error);
      return null;
    }
  }

  async loadExistingTracks(playlistId, stationName = null) {
    try {
      let offset = 0;
      const limit = 100;
      let totalTracks = 0;
      const seenTracks = new Map(); // Track ID -> first position seen
      const duplicatePositions = [];
      
      // First pass: identify tracks and duplicates
      while (true) {
        const response = await this.spotifyApi.getPlaylistTracks(playlistId, { offset, limit });
        const tracks = (response.body || response).items || [];
        
        tracks.forEach((item, index) => {
          if (item.track && item.track.id) {
            const trackId = item.track.id;
            const position = offset + index;
            const trackName = `${item.track.artists[0]?.name} - ${item.track.name}`;
            
            if (seenTracks.has(trackId)) {
              // This is a duplicate - keep track of the duplicate position to remove
              const firstPosition = seenTracks.get(trackId);
              duplicatePositions.push({
                position,
                trackId,
                trackName,
                firstSeenAt: firstPosition
              });
              logger.warn(`🔍 Found duplicate: ${trackName} (first at position ${firstPosition}, duplicate at position ${position})`);
            } else {
              // First time seeing this track - keep it
              seenTracks.set(trackId, position);
              totalTracks++;
            }
          }
        });
        
        if (tracks.length < limit) break;
        offset += limit;
      }
      
      // Auto-remove duplicates if found (only the duplicate positions, not the originals)
      if (duplicatePositions.length > 0) {
        logger.warn(`📋 Found ${duplicatePositions.length} duplicates in playlist. Using rebuild strategy to preserve originals...`);
        
        // Strategy: Get all tracks in order, rebuild playlist with only first occurrence of each
        const allTracks = [];
        const seenInRebuild = new Set();
        
        // Collect all tracks again in order for rebuilding
        offset = 0;
        while (true) {
          const response = await this.spotifyApi.getPlaylistTracks(playlistId, { offset, limit: 100 });
          const tracks = (response.body || response).items || [];
          
          tracks.forEach(item => {
            if (item.track && item.track.id) {
              const trackId = item.track.id;
              if (!seenInRebuild.has(trackId)) {
                allTracks.push(`spotify:track:${trackId}`);
                seenInRebuild.add(trackId);
              }
            }
          });
          
          if (tracks.length < 100) break;
          offset += 100;
        }
        
        logger.info(`🔨 Rebuilding playlist with ${allTracks.length} unique tracks (removing ${duplicatePositions.length} duplicates)...`);
        
        // Clear the playlist completely
        logger.info(`🧹 Clearing entire playlist...`);
        await this.spotifyApi.replaceTracksInPlaylist(playlistId, []);
        
        // Add back only unique tracks
        if (allTracks.length > 0) {
          logger.info(`➕ Adding back ${allTracks.length} unique tracks...`);
          await this.spotifyApi.addTracksToPlaylist(playlistId, allTracks);
        }
        
        logger.info(`✅ Playlist rebuilt: removed ${duplicatePositions.length} duplicates, kept ${allTracks.length} unique tracks`);
      }
      
      // Store track count for this station
      if (stationName) {
        this.playlistTrackCounts.set(stationName.toLowerCase(), totalTracks);
        logger.info(`📚 Loaded ${totalTracks} unique tracks from ${stationName} playlist`);
      }
      
    } catch (error) {
      logger.error(`❌ Error loading existing tracks from playlist ${playlistId}:`, error.message);
    }
  }

  async searchAndAddTrack(station, artist, title, metadata) {
    try {
      // Create search query
      // Try multiple search strategies for better results
      let tracks = [];
      const searchQueries = [
        `artist:"${artist}" track:"${title}"`,  // Exact match
        `"${artist}" "${title}"`,               // Quoted terms
        `${artist} ${title}`,                   // Simple search
        title.includes('~') ? `"${title.split('~')[0].trim()}" "${artist}"` : null, // Handle ~ separator
        title.includes('~') ? `"${title.split('~')[0].trim()}"` : null  // Just the song title before ~
      ].filter(Boolean);
      
      logger.info(`🔍 Searching for: ${artist} - ${title} (${station})`);
      
      // Try each search strategy until we find results
      for (const query of searchQueries) {
        try {
          const searchResults = await this.spotifyApi.searchTracks(query, { limit: 20 });
          const currentTracks = ((searchResults.body || searchResults).tracks || {}).items || [];
          
          if (currentTracks.length > 0) {
            tracks = currentTracks;
            logger.info(`📊 Found ${tracks.length} results with query: ${query}`);
            break;
          } else {
            logger.info(`📊 No results for query: ${query}`);
          }
        } catch (searchError) {
          logger.warn(`⚠️ Search failed for query "${query}": ${searchError.message}`);
        }
      }
      
      if (tracks.length === 0) {
        await this.logUnmatchedTrack(station, metadata, 'No search results', [], null);
        return false;
      }
      
      // Find best match
      const bestMatch = this.findBestMatch(artist, title, tracks);
      
      if (!bestMatch) {
        // For unmatched tracks, still try to find the best match without threshold for logging
        const bestMatchForLogging = this.findBestMatchForLogging(artist, title, tracks);
        await this.logUnmatchedTrack(station, metadata, 'No suitable match found', tracks.slice(0, 3), bestMatchForLogging);
        return false;
      }
      
      // Check if already added using database
      if (await this.database.isTrackAlreadyAdded(bestMatch.track.id)) {
        logger.info(`⚠️ Track already exists: ${bestMatch.track.artists[0].name} - ${bestMatch.track.name}`);
        
        // Update daily stats for duplicate
        await this.database.updateDailyStats(station, 'duplicate');
        
        return false;
      }
      
      // Add to playlist
      const playlist = this.playlists.get(station.toLowerCase());
      if (!playlist) {
        logger.error(`❌ Playlist not found for station: ${station}`);
        return false;
      }
      
      try {
        await this.spotifyApi.addTracksToPlaylist(playlist.id, [`spotify:track:${bestMatch.track.id}`]);
      } catch (playlistError) {
        logger.error(`❌ Failed to add track to Spotify playlist: ${playlistError.message}`);
        await this.logUnmatchedTrack(station, metadata, `Spotify API error: ${playlistError.message}`, [], bestMatch);
        return false;
      }
      
      // Update track count for this station
      const currentCount = this.playlistTrackCounts.get(station.toLowerCase()) || 0;
      this.playlistTrackCounts.set(station.toLowerCase(), currentCount + 1);
      
      // Save to database
      const matchDetails = {
        timestamp: new Date().toISOString(),
        station,
        metadata: {
          artist: artist,
          title: title,
          original: metadata.original || `${artist} - ${title}`
        },
        spotifyMatch: {
          artist: bestMatch.track.artists[0].name,
          title: bestMatch.track.name,
          id: bestMatch.track.id,
          url: bestMatch.track.external_urls.spotify
        },
        percentage: Math.round(bestMatch.similarity * 100),
        playlist: playlist.name
      };
      
      const dbResult = await this.database.addMatchedTrack(matchDetails);
      
      if (dbResult === null) {
        // Track was already in database (duplicate)
        logger.info(`📋 Track already exists in database, but successfully added to playlist: ${bestMatch.track.artists[0].name} - ${bestMatch.track.name}`);
      } else {
        logger.info(`✅ Added to ${station}: ${bestMatch.track.artists[0].name} - ${bestMatch.track.name} (${Math.round(bestMatch.similarity * 100)}% match)`);
      }
      
      return true;
      
    } catch (error) {
      logger.error(`❌ Error adding track to ${station}:`, error);
      await this.logUnmatchedTrack(station, metadata, `Error: ${error.message}`, [], null);
      return false;
    }
  }

  findBestMatch(artist, title, tracks) {
    let bestMatch = null;
    let bestSimilarity = 0;
    
    // Clean the search terms for better matching
    const cleanArtist = artist.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const cleanTitle = title.toLowerCase().replace(/[^\w\s]/g, '').trim();
    
    for (const track of tracks) {
      const trackArtist = track.artists.map(a => a.name).join(' ').toLowerCase().replace(/[^\w\s]/g, '').trim();
      const trackTitle = track.name.toLowerCase().replace(/[^\w\s]/g, '').trim();
      
      // Calculate multiple similarity metrics
      const artistSimilarity = stringSimilarity.compareTwoStrings(cleanArtist, trackArtist);
      const titleSimilarity = stringSimilarity.compareTwoStrings(cleanTitle, trackTitle);
      
      // Check for partial matches (useful for songs with subtitles, etc.)
      const artistContains = trackArtist.includes(cleanArtist) || cleanArtist.includes(trackArtist) ? 0.8 : 0;
      const titleContains = trackTitle.includes(cleanTitle) || cleanTitle.includes(trackTitle) ? 0.8 : 0;
      
      // Use the best similarity score for each field
      const finalArtistSimilarity = Math.max(artistSimilarity, artistContains);
      const finalTitleSimilarity = Math.max(titleSimilarity, titleContains);
      
      // Weighted combination (title is slightly more important)
      const combinedSimilarity = (finalArtistSimilarity * 0.4) + (finalTitleSimilarity * 0.6);
      
      if (combinedSimilarity > bestSimilarity && combinedSimilarity >= 0.75) { // Lowered from 0.9 to 0.75
        bestSimilarity = combinedSimilarity;
        bestMatch = {
          track,
          similarity: combinedSimilarity
        };
      }
    }
    
    // Log the best match details for debugging
    if (bestMatch) {
      logger.info(`🎯 Best match: ${bestMatch.track.artists[0].name} - ${bestMatch.track.name} (${Math.round(bestMatch.similarity * 100)}%)`);
    }
    
    return bestMatch;
  }

  findBestMatchForLogging(artist, title, tracks) {
    let bestMatch = null;
    let bestSimilarity = 0;
    
    // Clean the search terms for better matching
    const cleanArtist = artist.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const cleanTitle = title.toLowerCase().replace(/[^\w\s]/g, '').trim();
    
    for (const track of tracks) {
      const trackArtist = track.artists.map(a => a.name).join(' ').toLowerCase().replace(/[^\w\s]/g, '').trim();
      const trackTitle = track.name.toLowerCase().replace(/[^\w\s]/g, '').trim();
      
      // Calculate multiple similarity metrics
      const artistSimilarity = stringSimilarity.compareTwoStrings(cleanArtist, trackArtist);
      const titleSimilarity = stringSimilarity.compareTwoStrings(cleanTitle, trackTitle);
      
      // Check for partial matches (useful for songs with subtitles, etc.)
      const artistContains = trackArtist.includes(cleanArtist) || cleanArtist.includes(trackArtist) ? 0.8 : 0;
      const titleContains = trackTitle.includes(cleanTitle) || cleanTitle.includes(trackTitle) ? 0.8 : 0;
      
      // Use the best similarity score for each field
      const finalArtistSimilarity = Math.max(artistSimilarity, artistContains);
      const finalTitleSimilarity = Math.max(titleSimilarity, titleContains);
      
      // Weighted combination (title is slightly more important)
      const combinedSimilarity = (finalArtistSimilarity * 0.4) + (finalTitleSimilarity * 0.6);
      
      // No threshold constraint for logging purposes
      if (combinedSimilarity > bestSimilarity) {
        bestSimilarity = combinedSimilarity;
        bestMatch = {
          track,
          similarity: combinedSimilarity
        };
      }
    }
    
    return bestMatch;
  }

  async logUnmatchedTrack(station, metadata, reason, searchResults = [], bestMatchForLogging = null) {
    // Filter out obvious non-music tracks to reduce clutter
    const artist = metadata.artist.toLowerCase();
    const title = metadata.title.toLowerCase();
    
    // Skip logging for these obvious non-music entries
    const skipPatterns = [
      'azuracast',
      'halloweenradio',
      'commercials',
      'jingle',
      'station id',
      'radio id',
      'live!',
      'streaming'
    ];
    
    const shouldSkip = skipPatterns.some(pattern => 
      artist.includes(pattern) || title.includes(pattern)
    );
    
    if (shouldSkip) {
      logger.info(`⏭️ Skipping non-music track: ${metadata.artist} - ${metadata.title}`);
      return;
    }
    
    // Calculate best match percentage from search results or use provided match
    let bestMatchPercentage = 0;
    let bestSpotifyMatch = null;
    
    if (bestMatchForLogging) {
      bestMatchPercentage = Math.round(bestMatchForLogging.similarity * 100);
      bestSpotifyMatch = {
        artist: bestMatchForLogging.track.artists[0].name,
        title: bestMatchForLogging.track.name,
        id: bestMatchForLogging.track.id
      };
    } else if (searchResults.length > 0) {
      const bestResult = this.findBestMatchForLogging(metadata.artist, metadata.title, searchResults);
      if (bestResult) {
        bestMatchPercentage = Math.round(bestResult.similarity * 100);
        bestSpotifyMatch = {
          artist: bestResult.track.artists[0].name,
          title: bestResult.track.name,
          id: bestResult.track.id
        };
      }
    }
    
    const unmatchDetails = {
      timestamp: new Date().toISOString(),
      station,
      metadata: {
        artist: metadata.artist,
        title: metadata.title,
        original: metadata.original || `${metadata.artist} - ${metadata.title}`
      },
      spotifyMatch: bestSpotifyMatch,
      percentage: bestMatchPercentage,
      reason,
      searchResultsCount: searchResults.length
    };
    
    // Save to database instead of files
    await this.database.addUnmatchedTrack(unmatchDetails);
    
    logger.warn(`⚠️ Unmatched track (${station}): ${metadata.artist} - ${metadata.title} | Reason: ${reason} | Best match: ${bestMatchPercentage}%`);
  }

  async deleteAllHalloweenPlaylists(recreate = false) {
    try {
      logger.info(`🗑️ Starting deletion of all Halloween Radio playlists... (recreate: ${recreate})`);
      
      let offset = 0;
      const limit = 50;
      let deletedCount = 0;
      const deletedPlaylists = [];
      const recreatedPlaylists = [];
      
      while (true) {
        const response = await this.spotifyApi.getUserPlaylists(this.userId, { offset, limit });
        const playlists = (response.body?.items || response.items || []);
        
        if (playlists.length === 0) break;
        
        for (const playlist of playlists) {
          if (playlist.name.startsWith('Halloween Radio - ')) {
            try {
              logger.info(`🗑️ Deleting playlist: ${playlist.name} (${playlist.id})`);
              await this.spotifyApi.unfollowPlaylist(playlist.id);
              deletedPlaylists.push(playlist.name);
              deletedCount++;
            } catch (deleteError) {
              logger.error(`❌ Failed to delete playlist ${playlist.name}:`, deleteError.message);
            }
          }
        }
        
        if (playlists.length < limit) break;
        offset += limit;
      }
      
      // Clear the local playlist cache and tracking data
      this.playlists.clear();
      this.playlistTrackCounts.clear();
      
      // Clear database data
      await this.database.clearAllData();
      
      logger.info(`✅ Deleted ${deletedCount} Halloween Radio playlists and cleared all tracking data`);
      
      // Recreate empty playlists if requested
      if (recreate) {
        logger.info('🎵 Recreating empty playlists...');
        try {
          await this.setupPlaylists();
          const playlistNames = Array.from(this.playlists.keys()).map(name => 
            `Halloween Radio - ${name.charAt(0).toUpperCase() + name.slice(1)}`
          );
          recreatedPlaylists.push(...playlistNames);
          logger.info(`✅ Recreated ${recreatedPlaylists.length} empty playlists`);
        } catch (recreateError) {
          logger.error('❌ Failed to recreate playlists:', recreateError.message);
        }
      }
      
      return {
        message: `Successfully deleted ${deletedCount} Halloween Radio playlists${recreate ? ` and recreated ${recreatedPlaylists.length} empty playlists` : ''}`,
        deleted: deletedPlaylists,
        recreated: recreatedPlaylists
      };
      
    } catch (error) {
      logger.error('❌ Error deleting playlists:', error.message);
      throw error;
    }
  }

  async removeDuplicatesFromPlaylists() {
    try {
      logger.info('🧹 Starting duplicate removal from Halloween Radio playlists...');
      
      let totalRemoved = 0;
      const details = [];
      
      for (const [stationName, playlist] of this.playlists.entries()) {
        const removedCount = await this.removeDuplicatesFromPlaylist(playlist.id, playlist.name);
        if (removedCount > 0) {
          totalRemoved += removedCount;
          details.push(`${playlist.name}: ${removedCount} duplicates removed`);
        }
      }
      
      // Reload track counts after cleanup
      this.addedTracks.clear();
      this.playlistTrackCounts.clear();
      
      for (const [stationName, playlist] of this.playlists.entries()) {
        await this.loadExistingTracks(playlist.id, stationName);
      }
      
      const message = totalRemoved > 0 
        ? `Successfully removed ${totalRemoved} duplicate tracks from Halloween Radio playlists`
        : 'No duplicate tracks found in Halloween Radio playlists';
      
      logger.info(`✅ ${message}`);
      
      // Save data after duplicate removal
      await this.saveData();
      
      return {
        success: true,
        message: message,
        removedCount: totalRemoved,
        details: details
      };
      
    } catch (error) {
      logger.error('❌ Error removing duplicates from playlists:', error);
      throw error;
    }
  }

  async removeDuplicatesFromPlaylist(playlistId, playlistName) {
    try {
      const seenTracks = new Set();
      const duplicatePositions = [];
      let offset = 0;
      const limit = 100;
      
      // First pass: identify duplicates
      while (true) {
        const response = await this.spotifyApi.getPlaylistTracks(playlistId, { offset, limit });
        const tracks = (response.body || response).items || [];
        
        tracks.forEach((item, index) => {
          if (item.track && item.track.id) {
            const trackId = item.track.id;
            if (seenTracks.has(trackId)) {
              duplicatePositions.push(offset + index);
            } else {
              seenTracks.add(trackId);
            }
          }
        });
        
        if (tracks.length < limit) break;
        offset += limit;
      }
      
      if (duplicatePositions.length === 0) {
        logger.info(`✅ No duplicates found in ${playlistName}`);
        return 0;
      }
      
      // Remove duplicates in reverse order to maintain position indices
      duplicatePositions.reverse();
      let removedCount = 0;
      
      for (const position of duplicatePositions) {
        try {
          await this.spotifyApi.removeTracksFromPlaylist(playlistId, [{ positions: [position] }]);
          removedCount++;
          
          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          logger.error(`❌ Error removing duplicate at position ${position} from ${playlistName}:`, error);
        }
      }
      
      if (removedCount > 0) {
        logger.info(`🧹 Removed ${removedCount} duplicates from ${playlistName}`);
      }
      
      return removedCount;
      
    } catch (error) {
      logger.error(`❌ Error removing duplicates from playlist ${playlistName}:`, error);
      throw error;
    }
  }

  async consolidateDuplicatePlaylists() {
    try {
      logger.info('🔄 Starting consolidation of duplicate Halloween Radio playlists...');
      
      let offset = 0;
      const limit = 50;
      const playlistGroups = {};
      
      // Find all Halloween Radio playlists
      while (true) {
        const response = await this.spotifyApi.getUserPlaylists(this.userId, { offset, limit });
        const playlists = (response.body?.items || response.items || []);
        
        if (playlists.length === 0) break;
        
        for (const playlist of playlists) {
          if (playlist.name.startsWith('Halloween Radio - ')) {
            const stationName = playlist.name.replace('Halloween Radio - ', '');
            if (!playlistGroups[stationName]) {
              playlistGroups[stationName] = [];
            }
            playlistGroups[stationName].push(playlist);
          }
        }
        
        if (playlists.length < limit) break;
        offset += limit;
      }
      
      const consolidatedStations = [];
      
      // Process each station group
      for (const [stationName, playlists] of Object.entries(playlistGroups)) {
        if (playlists.length > 1) {
          logger.info(`🔄 Consolidating ${playlists.length} playlists for ${stationName}...`);
          
          // Sort by creation date (if available) or use first one as primary
          const primaryPlaylist = playlists[0];
          const duplicatePlaylists = playlists.slice(1);
          
          // Collect all tracks from duplicate playlists
          const allTracks = new Set();
          
          // Get tracks from primary playlist first
          await this.loadPlaylistTracks(primaryPlaylist.id, allTracks);
          
          // Get tracks from duplicate playlists
          for (const duplicate of duplicatePlaylists) {
            const duplicateTracks = new Set();
            await this.loadPlaylistTracks(duplicate.id, duplicateTracks);
            
            // Add unique tracks to primary playlist
            for (const trackId of duplicateTracks) {
              if (!allTracks.has(trackId)) {
                try {
                  await this.spotifyApi.addTracksToPlaylist(primaryPlaylist.id, [`spotify:track:${trackId}`]);
                  allTracks.add(trackId);
                  logger.info(`➕ Added track ${trackId} to primary playlist`);
                } catch (addError) {
                  logger.warn(`⚠️ Failed to add track ${trackId}:`, addError.message);
                }
              }
            }
            
            // Delete the duplicate playlist
            try {
              await this.spotifyApi.unfollowPlaylist(duplicate.id);
              logger.info(`🗑️ Deleted duplicate playlist: ${duplicate.name}`);
            } catch (deleteError) {
              logger.warn(`⚠️ Failed to delete duplicate ${duplicate.name}:`, deleteError.message);
            }
          }
          
          consolidatedStations.push(stationName);
        }
      }
      
      // Refresh playlist cache
      await this.setupPlaylists();
      
      if (consolidatedStations.length > 0) {
        logger.info(`✅ Consolidated playlists for ${consolidatedStations.length} stations`);
        return {
          message: `Successfully consolidated duplicate playlists for ${consolidatedStations.length} stations`,
          consolidated: consolidatedStations
        };
      } else {
        return {
          message: 'No duplicate playlists found to consolidate',
          consolidated: []
        };
      }
      
    } catch (error) {
      logger.error('❌ Error consolidating playlists:', error.message);
      throw error;
    }
  }

  async loadPlaylistTracks(playlistId, trackSet) {
    let offset = 0;
    const limit = 100;
    
    while (true) {
      const response = await this.spotifyApi.getPlaylistTracks(playlistId, { offset, limit });
      const tracks = (response.body || response).items || [];
      
      tracks.forEach(item => {
        if (item.track && item.track.id) {
          trackSet.add(item.track.id);
        }
      });
      
      if (tracks.length < limit) break;
      offset += limit;
    }
  }

  // ==================== DATA MANAGEMENT ====================
  
  async getMatchedTracks(limit = 100, offset = 0, station = null) {
    return await this.database.getMatchedTracks(limit, offset, station);
  }

  async getUnmatchedTracks(limit = 100, offset = 0, station = null) {
    return await this.database.getUnmatchedTracks(limit, offset, station);
  }

  async getTopUnmatchedTracks(limit = 50) {
    return await this.database.getTopUnmatchedTracks(limit);
  }

  async getDailyStats(days = 30) {
    return await this.database.getDailyStats(days);
  }

  async getStationStats() {
    return await this.database.getStationStats();
  }

  async getSystemStats() {
    return await this.database.getSystemStats();
  }

  async clearAllData() {
    try {
      logger.info('🧹 Clearing all tracking data...');
      
      // Clear database data
      const result = await this.database.clearAllData();
      
      // Clear in-memory data
      this.playlistTrackCounts.clear();
      
      // Reload existing tracks from playlists to repopulate tracking
      for (const [stationName, playlist] of this.playlists.entries()) {
        await this.loadExistingTracks(playlist.id, stationName);
      }
      
      logger.info('✅ All tracking data cleared successfully');
      
      return {
        success: true,
        message: 'All tracking data cleared successfully',
        details: [
          'Cleared database tracking data',
          'Cleared in-memory tracking data',
          `Reloaded playlist information for ${this.playlists.size} playlists`
        ]
      };
      
    } catch (error) {
      logger.error('❌ Error clearing data:', error);
      throw error;
    }
  }

  async migrateFromFileData() {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const oldDataPath = path.join(__dirname, '../../data/spotify_data.json');
      
      // Check if old data file exists
      try {
        await fs.access(oldDataPath);
        logger.info('🔄 Found old data file, starting migration...');
        
        const migratedCount = await this.database.migrateFromFileData(oldDataPath);
        
        // Backup and remove old file
        const backupPath = oldDataPath + '.backup';
        await fs.rename(oldDataPath, backupPath);
        
        logger.info(`✅ Migration complete: ${migratedCount} tracks migrated, old file backed up`);
        return {
          success: true,
          message: `Successfully migrated ${migratedCount} tracks from file-based system`,
          migratedCount
        };
      } catch (error) {
        if (error.code === 'ENOENT') {
          logger.info('No old data file found, migration not needed');
          return {
            success: true,
            message: 'No migration needed - no old data file found',
            migratedCount: 0
          };
        }
        throw error;
      }
    } catch (error) {
      logger.error('❌ Error during migration:', error);
      throw error;
    }
  }

  async saveData() {
    try {
      // Data is automatically saved to database, so this is just a placeholder
      // for any additional data persistence needs
      logger.info('💾 Data save checkpoint completed');
      return true;
    } catch (error) {
      logger.error('❌ Error saving data:', error);
      throw error;
    }
  }

  async close() {
    if (this.database) {
      await this.database.close();
    }
  }
}

module.exports = SpotifyService;
