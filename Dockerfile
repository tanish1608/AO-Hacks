# Build the Cloudflare Worker bundle, then run it on Node behind a small adapter.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
# The bundle inlines its own dependencies, so only the adapter's two packages
# are installed here. better-sqlite3 is native and needs a toolchain to build.
COPY server/runtime/package.json ./package.json
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && npm install --omit=dev --no-audit --no-fund \
 && apt-get purge -y python3 make g++ && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /root/.npm
COPY --from=build /app/dist ./dist
COPY server ./server
COPY drizzle ./drizzle
RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "server/index.mjs"]
