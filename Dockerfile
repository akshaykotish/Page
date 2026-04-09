# ─── Build Stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install root dependencies
COPY package.json package-lock.json* ./
RUN npm ci --production=false

# Install and build React client
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm ci

COPY client/ ./client/
RUN cd client && npm run build

# ─── Production Stage ──────────────────────────────────────────────────────────
FROM node:20-alpine

# Security: run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Install production deps only
COPY package.json package-lock.json* ./
RUN npm ci --production && npm cache clean --force

# Copy server code (cache bust: v2-csp-fix)
COPY server.js ./
COPY firebase-admin.js ./
COPY routes/ ./routes/
COPY middleware/ ./middleware/
COPY utils/ ./utils/

# Copy Firebase service account
COPY akshaykotish-aca69-firebase-adminsdk-yi1ji-f1a589ef5a.json ./

# Copy static public site + images
COPY public/ ./public/
COPY images/ ./images/

# Copy React build from builder stage
COPY --from=builder /app/client/dist ./client/dist

# Set ownership
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/api/health || exit 1

# Cloud Run expects 8080
EXPOSE 8080

CMD ["node", "server.js"]
