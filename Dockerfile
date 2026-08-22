# syntax=docker/dockerfile:1

# Debian slim rather than Alpine (#17): this runs unattended for long stretches
# and the app formats dates and numbers across 10 locales via Intl, so the
# well-trodden glibc/ICU path is worth ~150MB.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build && npm run build:server

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built frontend and compiled server.
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# Migration SQL is read at runtime by drizzle-orm's migrator.
COPY --from=build /app/db/migrations ./db/migrations

# Do not run as root.
USER node

EXPOSE 3001

# Migrate, then serve. A failed migration exits non-zero and the container
# does not start, which is the intended behaviour.
CMD ["sh", "-c", "node dist-server/server/migrate.js && node dist-server/server/index.js"]
