require('dotenv').config();
const RadioMonitor = require('./services/RadioMonitor');
const SpotifyService = require('./services/SpotifyService');
const WebInterface = require('./services/WebInterface');
const logger = require('./utils/logger');
const packageInfo = require('../package.json');

class HalloweenRadioApp {
  constructor() {
    this.spotifyService = new SpotifyService();
    this.radioMonitor = null;
    this.webInterface = null;
    this.isRunning = false;
    this.saveInterval = null;
  }

  async initialize() {
    try {
      logger.info(`🎃 Starting Halloween Radio to Spotify Monitor v${packageInfo.version}...`);
      
      // Initialize Spotify service
      await this.spotifyService.initialize();
      
      // Create radio monitor with Spotify service
      this.radioMonitor = new RadioMonitor(this.spotifyService);
      
      // Create web interface
      this.webInterface = new WebInterface(this.radioMonitor, this.spotifyService);
      
      logger.info('✅ Application initialized successfully');
      return true;
    } catch (error) {
      logger.error('❌ Failed to initialize application:', error);
      return false;
    }
  }

  async start() {
    if (this.isRunning) {
      logger.warn('Application is already running');
      return;
    }

    const initialized = await this.initialize();
    if (!initialized) {
      process.exit(1);
    }

    try {
      this.isRunning = true;
      await this.radioMonitor.startMonitoring();
      
      // Start web interface
      this.webInterface.start();
      
      // Set up periodic data saving (every 5 minutes)
      this.saveInterval = setInterval(() => {
        this.spotifyService.saveData().catch(error => {
          logger.error('❌ Failed to save data periodically:', error);
        });
      }, 5 * 60 * 1000); // 5 minutes
      
      logger.info(`🎵 Halloween Radio monitoring v${packageInfo.version} started successfully`);
      logger.info('📻 Monitoring all 4 stations for new tracks...');
      logger.info(`📊 Version: ${packageInfo.version} | Build: ${new Date().toISOString()}`);
      
    } catch (error) {
      logger.error('❌ Failed to start monitoring:', error);
      this.isRunning = false;
      process.exit(1);
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    logger.info('🛑 Stopping Halloween Radio monitoring...');
    
    // Clear periodic save interval
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    
    // Save data before shutdown
    if (this.spotifyService) {
      try {
        await this.spotifyService.close();
        logger.info('💾 Database connection closed');
      } catch (error) {
        logger.error('❌ Failed to close database connection:', error);
      }
    }
    
    if (this.radioMonitor) {
      await this.radioMonitor.stopMonitoring();
    }
    
    if (this.webInterface) {
      this.webInterface.stop();
    }
    
    this.isRunning = false;
    logger.info('✅ Application stopped gracefully');
  }
}

// Handle graceful shutdown
const app = new HalloweenRadioApp();

process.on('SIGINT', async () => {
  logger.info('🔄 Received SIGINT, shutting down gracefully...');
  await app.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('🔄 Received SIGTERM, shutting down gracefully...');
  await app.stop();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
app.start().catch(error => {
  logger.error('💥 Failed to start application:', error);
  process.exit(1);
});