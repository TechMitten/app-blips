# syntax=docker/dockerfile:1

# Runs AppBlips in your browser from a container: the same app as the desktop
# version, served by server.js. See docs/self-hosting/docker.mdx.

# ---- Build stage -----------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Electron is only needed for the desktop app; skip its ~100 MB download.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm run build:server

# ---- Runtime stage ---------------------------------------------------------
# The server is bundled into one file with its dependencies, so the runtime
# image needs no node_modules.
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server/server.mjs ./server.mjs

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.mjs"]
