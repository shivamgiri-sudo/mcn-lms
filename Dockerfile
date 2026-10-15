# syntax=docker/dockerfile:1.7

FROM node:26-bookworm-slim AS frontend-build
WORKDIR /workspace/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM node:26-bookworm-slim AS backend-build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY backend/prisma ./prisma
RUN ./node_modules/.bin/prisma generate
COPY backend/src ./src

FROM node:26-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends ca-certificates curl dumb-init openssl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
       /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx \
    && groupadd --system --gid 10001 lms \
    && useradd --system --uid 10001 --gid lms --home-dir /app --shell /usr/sbin/nologin lms

WORKDIR /app/backend
COPY --chown=lms:lms --from=backend-build /workspace/backend/package*.json ./
COPY --chown=lms:lms --from=backend-build /workspace/backend/node_modules ./node_modules
COPY --chown=lms:lms --from=backend-build /workspace/backend/prisma ./prisma
COPY --chown=lms:lms --from=backend-build /workspace/backend/src ./src
COPY --chown=lms:lms --from=frontend-build /workspace/frontend/dist /app/frontend/dist
COPY --chown=lms:lms deploy/scripts/container-entrypoint.sh /usr/local/bin/lms-entrypoint
RUN chmod 0755 /usr/local/bin/lms-entrypoint \
    && mkdir -p /app/backend/uploads/content /app/backend/uploads/scorm \
    && chown -R lms:lms /app

ENV NODE_ENV=production \
    PORT=4000 \
    SERVE_FRONTEND=true \
    LMS_RUN_MIGRATIONS=false

USER lms
EXPOSE 4000
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=5 \
  CMD curl --fail --silent http://127.0.0.1:${PORT}/api/runtime/health/live >/dev/null || exit 1

ENTRYPOINT ["dumb-init", "--", "lms-entrypoint"]
CMD ["node", "src/server.js"]
