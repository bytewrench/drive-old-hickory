# ── build the Vite bundle ─────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci || npm install

COPY . .
RUN npm run build

# ── serve dist/ + the multiplayer relay from one Node process ──
# This used to be an nginx stage. It can't be any more: the game needs a
# WebSocket at /ws on the same origin, and running node behind nginx in one
# image would mean a process supervisor for no benefit. server/static.mjs
# reproduces the caching and gzip rules the old nginx.conf had.
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ws is the only runtime dependency — three and rapier are bundled into dist.
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist

# Coolify's app config exposes 80, so listen there rather than remapping it.
ENV PORT=80
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:80/healthz || exit 1

CMD ["node", "server/index.mjs"]
