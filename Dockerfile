# syntax=docker/dockerfile:1

# ---- Build stage -----------------------------------------------------------
# Local self-hosted image: builds the static client in self-hosted mode (SELF_HOSTED_MODE=true is the
# default already, set explicitly here for clarity). No Firebase env vars are
# needed: self-hosted mode never touches src/firebase.js's Firebase init.
FROM node:22-alpine AS builder
WORKDIR /app

ARG APPBLIPS_GENERATED_AI_MODE=relay
ARG APPBLIPS_APP_AI_RELAY_URL=
ENV SELF_HOSTED_MODE=true
ENV APPBLIPS_GENERATED_AI_MODE=$APPBLIPS_GENERATED_AI_MODE
ENV APPBLIPS_APP_AI_RELAY_URL=$APPBLIPS_APP_AI_RELAY_URL

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Runtime stage ----------------------------------------------------------
# The server handlers use only Node built-ins (fetch, Request, and Response
# are globals since Node 18+), so the runtime image needs no node_modules.
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV SELF_HOSTED_MODE=true
ENV PORT=3000

COPY --from=builder /app/dist ./dist
# Copy the whole _lib dir: chatProxy.js pulls in trackTokens/usageTracking/
# firebaseServer transitively, and a hand-kept file list goes stale.
COPY --from=builder /app/functions/_lib ./functions/_lib
COPY server.js ./server.js

USER node
EXPOSE 3000

CMD ["node", "server.js"]
