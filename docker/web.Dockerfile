FROM node:20-bookworm-slim AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN BUILD_ID="$(node -e 'process.stdout.write(String(Date.now()))')" && \
    printf 'NEXT_PUBLIC_APP_BUILD_ID=%s\n' "$BUILD_ID" > apps/web/.env.production

RUN pnpm --dir apps/web build

FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN corepack enable

COPY --from=build /app /app

EXPOSE 3000

CMD ["pnpm", "--dir", "apps/web", "start"]
