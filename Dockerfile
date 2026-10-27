# Football Legacy – Web-Client und Game-Server (Next.js) als ein Service;
# der Hintergrunddienst für Simulationen läuft als Kindprozess (worker.cjs)
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/sim/package.json packages/sim/
COPY packages/game/package.json packages/game/
COPY packages/i18n/package.json packages/i18n/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Web-App und gebündelter Hintergrunddienst (worker.cjs)
RUN pnpm --filter @fl/web build && pnpm --filter @fl/game build:worker

FROM node:22-slim AS run
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN useradd --uid 1001 --create-home app
COPY --from=build --chown=app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app /app/apps/web/public ./apps/web/public
COPY --from=build --chown=app /app/apps/web/worker.cjs ./apps/web/worker.cjs
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
