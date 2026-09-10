# ===== Build Stage =====
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Remove package-lock.json to avoid npm optional dependencies bug with rolldown
# Then install dependencies (skip postinstall hooks)
RUN rm -f package-lock.json && npm install --ignore-scripts

# Explicitly install rolldown Linux native binding (workaround for npm optional deps bug)
RUN npm install @rolldown/binding-linux-x64-gnu --ignore-scripts --no-save || true

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

# Create necessary directories
RUN mkdir -p data media logs

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV FORCE_AUTHN_INNERAPI_DOMAIN=http://localhost:3000
ENV DISABLE_DATAPASS=true
ENV DEPRECATED_SKIP_INIT_DB_CONNECTION=true

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/archives/stats').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the application
CMD ["node", "dist/server/main.js"]
