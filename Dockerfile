# ===== Build Stage =====
FROM node:20-slim AS builder

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Remove package-lock.json to avoid npm optional dependencies bug with rolldown
# Then install dependencies
RUN rm -f package-lock.json && npm install

# Rebuild better-sqlite3 for this platform
RUN npm rebuild better-sqlite3

# Explicitly install rolldown Linux native binding (workaround for npm optional deps bug)
RUN npm install @rolldown/binding-linux-x64-gnu --no-save || true

# Copy source code
COPY . .

# Build backend and frontend
RUN npm run build

# ===== Runtime Stage =====
FROM node:20-slim AS runner

WORKDIR /app

# Copy node_modules from builder stage (includes all dependencies needed at runtime)
COPY --from=builder /app/node_modules ./node_modules

# Copy build artifacts
COPY --from=builder /app/dist ./dist

# Copy necessary config files
COPY package.json ./
COPY nest-cli.json ./
COPY .env ./

# Create necessary directories and set permissions
RUN mkdir -p data media logs && chmod -R 777 data media logs

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV FORCE_AUTHN_INNERAPI_DOMAIN=http://localhost:3000
ENV DISABLE_DATAPASS=true
ENV DEPRECATED_SKIP_INIT_DB_CONNECTION=true

# Expose port
EXPOSE 3000

# Use a non-root user for security (optional, but need to ensure permissions)
# USER node

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/archives/stats').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the application
CMD ["node", "dist/server/main.js"]
