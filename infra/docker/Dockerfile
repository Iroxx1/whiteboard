# syntax=docker/dockerfile:1
# Multi-stage build (PLAN.md 7.3). Build context: repository root.
#   docker build -f infra/docker/Dockerfile -t whiteboard .

ARG NODE_VERSION=24.21.0

FROM node:${NODE_VERSION}-trixie AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:${NODE_VERSION}-trixie-slim AS runtime
# Media tools (ffmpeg, poppler, tesseract) are added with the phases that need them (2, 8).
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    UV_THREADPOOL_SIZE=2 \
    APP_VERSION=${APP_VERSION}

WORKDIR /app
# The server is bundled into a single file, so no node_modules are needed at runtime.
COPY --from=build /src/apps/server/dist apps/server/dist
COPY --from=build /src/apps/web/dist apps/web/dist
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "/app/apps/server/dist/healthcheck.js"]
ENTRYPOINT ["tini", "--"]
CMD ["node", "--enable-source-maps", "apps/server/dist/index.js"]
