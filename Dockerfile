# Use Node.js LTS Alpine image for smaller size
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for native modules and SQLite
RUN apk add --no-cache python3 make g++ git sqlite sqlite-dev

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application source
COPY . .

# Create necessary directories with proper permissions
RUN mkdir -p logs data

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of app directory
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose the port
EXPOSE 8731

# Health check - simplified to avoid authentication issues
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider --timeout=5 http://localhost:8731/ || exit 1

# Start the application
CMD ["npm", "start"]