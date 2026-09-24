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
# Keep the build root distinct from the App Router's app/ directory. Webpack
# can otherwise resolve /app/app/page.tsx to /app/app/app/page.tsx via roots.
WORKDIR /build
ARG NEXT_PUBLIC_WINDCHIME_DISPLAY_URL
ENV NEXT_PUBLIC_WINDCHIME_DISPLAY_URL=${NEXT_PUBLIC_WINDCHIME_DISPLAY_URL}
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -- --webpack && node scripts/verify-build-routes.cjs && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV DATABASE_PATH=/app/data/codes.db
ENV WINDCHIME_MEDIA_DIRECTORY=/app/data/mail-media

RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/data /app/public/memes /app/public/pic

COPY --from=builder /build/package*.json ./
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/.next ./.next
COPY --from=builder /build/public ./public
COPY --from=builder /build/migrations ./migrations
COPY --from=builder /build/scripts ./scripts

EXPOSE 3000
VOLUME ["/app/data", "/app/public/memes", "/app/public/pic"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
