# syntax=docker/dockerfile:1

# ---- Build stage -----------------------------------------------------------
# Builds the static client in self-hosted mode (SELF_HOSTED_MODE=true is the
# default already, set explicitly here for clarity). No Firebase env vars are
# needed: self-hosted mode never touches src/firebase.js's Firebase init.
FROM node:22-alpine AS builder
WORKDIR /app

ENV SELF_HOSTED_MODE=true

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage ----------------------------------------------------------
# server.js and functions/_lib/chatProxy.js use only Node built-ins (fetch,
# Request, Response are globals since Node 18+), so the runtime image needs
# no node_modules at all -- just the built client and the two server files.
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV SELF_HOSTED_MODE=true
ENV PORT=3000

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/functions/_lib/chatProxy.js ./functions/_lib/chatProxy.js
COPY server.js ./server.js

USER node
EXPOSE 3000

CMD ["node", "server.js"]
