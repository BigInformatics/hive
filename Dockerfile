FROM oven/bun:1-slim AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# Production
FROM base AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/.output ./.output
COPY --from=build /app/SKILL.md ./SKILL.md
COPY --from=build /app/scripts ./scripts
EXPOSE 3000
CMD ["bun", "run", ".output/server/index.mjs"]
# force rebuild 1771371912
