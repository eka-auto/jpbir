# Visitor Analytics Agent Dockerfile
# Multi-stage build for production

# Stage 1: Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    sqlite-dev

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p data logs backups

# Stage 2: Production stage
FROM node:18-alpine

LABEL maintainer="Kiro Agent Team"
LABEL version="2.0.0"
LABEL description="Visitor Analytics Agent for collecting visitor data and network information"

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    sqlite \
    iputils-ping \
    net-tools \
    curl \
    tzdata

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app .

# Set proper permissions
RUN chown -R nodejs:nodejs /app && \
    chmod -R 755 /app && \
    chmod 644 package*.json

# Switch to non-root user
USER nodejs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api/status || exit 1

# Expose port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    TZ=UTC

# Start command
CMD ["node", "server.js"]

# Build arguments
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

# Labels
LABEL org.label-schema.build-date=$BUILD_DATE \
      org.label-schema.name="Visitor Analytics Agent" \
      org.label-schema.description="Kiro-powered agent for visitor analytics and network device discovery" \
      org.label-schema.url="https://kiro.dev" \
      org.label-schema.vcs-url="https://github.com/kiro-dev/visitor-analytics-agent" \
      org.label-schema.vcs-ref=$VCS_REF \
      org.label-schema.version=$VERSION \
      org.label-schema.schema-version="1.0"