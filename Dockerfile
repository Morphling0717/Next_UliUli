FROM node:20-bookworm-slim AS base

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# vendor/ 里放的本地 tarball（如 @windchime/embed）也要在 deps 阶段就进来，
# 否则 npm ci 读 package-lock 里的 `file:./vendor/...` 会 ENOENT。
COPY vendor/ ./vendor/
ENV npm_config_build_from_source=true
RUN npm ci && npm rebuild sqlite3 --build-from-source

FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/app/data/codes.db

RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/data /app/public/memes /app/public/pic

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

EXPOSE 3000
VOLUME ["/app/data", "/app/public/memes", "/app/public/pic"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
