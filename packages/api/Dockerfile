# flipagent api runtime image. Multi-stage: builder compiles every workspace
# package the api depends on, runtime ships only dist + production node_modules.

FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json tsconfig.json biome.json ./
COPY packages/types/package.json ./packages/types/package.json
COPY packages/ebay-scraper/package.json ./packages/ebay-scraper/package.json
COPY packages/api/package.json ./packages/api/package.json
RUN npm install --no-audit --no-fund --ignore-scripts \
	-w @flipagent/types -w @flipagent/ebay-scraper -w @flipagent/api \
	--include-workspace-root
COPY packages/types ./packages/types
COPY packages/ebay-scraper ./packages/ebay-scraper
COPY packages/api ./packages/api
RUN cd packages/types && npm run build \
	&& cd ../ebay-scraper && npm run build \
	&& cd ../api && npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini \
	&& rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/types ./packages/types
COPY --from=builder /app/packages/ebay-scraper ./packages/ebay-scraper
COPY --from=builder /app/packages/api ./packages/api
COPY --from=builder /app/package.json ./package.json
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
# Run drizzle migrations on boot when MIGRATE_ON_BOOT=1 (set by Terraform).
# Drizzle migrations are idempotent. With min_replicas>1, move this to a
# Container App Job triggered before each rollout instead.
CMD ["sh", "-c", "if [ \"$MIGRATE_ON_BOOT\" = \"1\" ]; then node packages/api/dist/db/migrate.js; fi && node packages/api/dist/server.js"]
