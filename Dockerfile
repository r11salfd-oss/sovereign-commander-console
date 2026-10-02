# Multi-stage Dockerfile for Sovereign Commander Console
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build application
COPY . .
RUN npm run build

# Production runtime stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy package specs and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built distribution from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# --- Hardening (Wave 2 / A5): hand the runtime tree to `node` ---
# node:20-alpine ships an unprivileged `node` user (uid 1000, gid 1000).
# "npm ci --omit=dev" and the COPY steps above run as root, so every path
# is root-owned. Ownership is transferred HERE, while still root and
# BEFORE the USER switch: a non-root process cannot chown files it does
# not own, so doing this after the switch would fail and silently leave
# root-owned paths behind.
#
# SCOPE CORRECTION — why NOT `/app`:
#   The original line was `chown -R node:node /app`, which walked the ENTIRE
#   node_modules tree (tens of thousands of files) across the Docker Desktop
#   WSL2 9p/virtiofs bridge. Measured consequence: 3204 seconds (53 minutes)
#   for that single RUN layer, and the build was killed with SIGKILL
#   (container Exited 137) on a subsequent run once the bridge's memory
#   footprint exhausted the builder.
#
#   node_modules does not need this. The official node:* images install it
#   world-readable, and Node resolves packages by READING them — no write and
#   no ownership change is required at runtime. Only the application output
#   (dist/, public/) is root-owned and must be handed over.
RUN chown -R node:node /app/dist /app/public

# Drop privileges. This is the primary blast-radius control: any
# application-level RCE (e.g. the command-execution endpoint in
# server.ts) is now confined to uid 1000 instead of uid 0.
# PORT=3000 is well above 1024, so no privileged port is required.
USER node

# Health gate. /api/health is unauthenticated and returns 200
# {"ok":true,...} (verified: 2-20ms warm against the live container).
# Uses the image's own `node` rather than curl (NOT present in
# node:*-alpine) or wget (BusyBox applet build dependent), so this
# depends on nothing beyond the runtime already required by CMD.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
