-- Halloween Radio to Spotify Database Schema

-- Table to store matched tracks that have been added to Spotify
CREATE TABLE IF NOT EXISTS matched_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    station TEXT NOT NULL,
    
    -- Original radio metadata
    radio_artist TEXT NOT NULL,
    radio_title TEXT NOT NULL,
    radio_original TEXT,
    
    -- Spotify match details
    spotify_id TEXT NOT NULL UNIQUE,
    spotify_artist TEXT NOT NULL,
    spotify_title TEXT NOT NULL,
    spotify_url TEXT,
    
    -- Match quality and playlist info
    match_percentage INTEGER NOT NULL,
    playlist_name TEXT NOT NULL,
    
    -- Additional metadata
    added_at TEXT NOT NULL,
    
    -- Indexes for performance
    UNIQUE(spotify_id) -- Prevent true duplicates across all playlists
);

-- Table to store unmatched tracks for analysis
CREATE TABLE IF NOT EXISTS unmatched_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    station TEXT NOT NULL,
    
    -- Original radio metadata
    radio_artist TEXT NOT NULL,
    radio_title TEXT NOT NULL,
    radio_original TEXT,
    
    -- Best Spotify match (if any)
    best_spotify_artist TEXT,
    best_spotify_title TEXT,
    best_spotify_id TEXT,
    best_match_percentage INTEGER DEFAULT 0,
    
    -- Failure reason
    reason TEXT NOT NULL,
    search_results_count INTEGER DEFAULT 0,
    
    -- For retry logic
    retry_count INTEGER DEFAULT 0,
    last_retry_at TEXT,
    
    -- Metadata
    created_at TEXT NOT NULL
);

-- Table to track station and playlist information
CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    station TEXT NOT NULL UNIQUE,
    playlist_id TEXT NOT NULL,
    playlist_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Table to track application statistics
CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE, -- YYYY-MM-DD format
    station TEXT NOT NULL,
    
    -- Daily counts
    tracks_processed INTEGER DEFAULT 0,
    tracks_matched INTEGER DEFAULT 0,
    tracks_added INTEGER DEFAULT 0,
    tracks_duplicated INTEGER DEFAULT 0,
    tracks_unmatched INTEGER DEFAULT 0,
    
    -- Quality metrics
    avg_match_percentage REAL DEFAULT 0,
    
    -- Metadata
    updated_at TEXT NOT NULL,
    
    UNIQUE(date, station)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_matched_tracks_station ON matched_tracks(station);
CREATE INDEX IF NOT EXISTS idx_matched_tracks_timestamp ON matched_tracks(timestamp);
CREATE INDEX IF NOT EXISTS idx_matched_tracks_spotify_id ON matched_tracks(spotify_id);

CREATE INDEX IF NOT EXISTS idx_unmatched_tracks_station ON unmatched_tracks(station);
CREATE INDEX IF NOT EXISTS idx_unmatched_tracks_timestamp ON unmatched_tracks(timestamp);
CREATE INDEX IF NOT EXISTS idx_unmatched_tracks_retry ON unmatched_tracks(retry_count, last_retry_at);

CREATE INDEX IF NOT EXISTS idx_stats_date_station ON stats(date, station);

-- Views for easy reporting
CREATE VIEW IF NOT EXISTS daily_summary AS
SELECT 
    date,
    SUM(tracks_processed) as total_processed,
    SUM(tracks_matched) as total_matched,
    SUM(tracks_added) as total_added,
    SUM(tracks_duplicated) as total_duplicated,
    SUM(tracks_unmatched) as total_unmatched,
    ROUND(AVG(avg_match_percentage), 2) as overall_avg_match_percentage,
    ROUND((SUM(tracks_matched) * 100.0 / SUM(tracks_processed)), 2) as success_rate
FROM stats 
GROUP BY date 
ORDER BY date DESC;

CREATE VIEW IF NOT EXISTS station_summary AS
SELECT 
    station,
    COUNT(*) as total_tracks_added,
    MIN(timestamp) as first_track,
    MAX(timestamp) as last_track,
    ROUND(AVG(match_percentage), 2) as avg_match_percentage
FROM matched_tracks 
GROUP BY station 
ORDER BY total_tracks_added DESC;

CREATE VIEW IF NOT EXISTS top_unmatched AS
SELECT 
    radio_artist,
    radio_title,
    COUNT(*) as occurrence_count,
    MAX(best_match_percentage) as best_ever_match,
    MIN(timestamp) as first_seen,
    MAX(timestamp) as last_seen,
    MAX(retry_count) as max_retries
FROM unmatched_tracks 
GROUP BY radio_artist, radio_title 
HAVING occurrence_count > 1
ORDER BY occurrence_count DESC, best_ever_match DESC
LIMIT 50;