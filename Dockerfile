# syntax=docker/dockerfile:1

# ─── Build: install the workspace, build the dashboard and bundle the gateway ───
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first, so dependency layers are cached until a package.json changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
COPY packages/client/package.json packages/client/
COPY packages/react/package.json packages/react/
COPY packages/vue/package.json packages/vue/
COPY packages/vite/package.json packages/vite/
COPY apps/dashboard/package.json apps/dashboard/
COPY examples/react-app/package.json examples/react-app/
COPY examples/vue-app/package.json examples/vue-app/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build -w @skewforge/dashboard && npm run build -w @skewforge/server

# ─── Runtime: Node, one bundled file and the dashboard; no node_modules ───
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    ADMIN_PORT=8081 \
    DATA_DIR=/data \
    DASHBOARD_DIR=/app/dashboard

COPY --from=build --chown=node:node /app/packages/server/dist ./
COPY --from=build --chown=node:node /app/apps/dashboard/dist ./dashboard
RUN mkdir -p /data && chown node:node /data

USER node
VOLUME ["/data"]
EXPOSE 8080 8081
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8081/health || exit 1
CMD ["node", "index.js"]
