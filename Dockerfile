# Build the Cloudflare Worker bundle, then run it on Node behind a small adapter.
#
# The working directory is deliberately not /app. The App Router's own directory
# is `app/`, so building under /app nests the routes at /app/app/<route>/page.tsx
# and the landing page at /app/app/page.tsx. A path normalization anywhere in
# that chain that strips "/app" unanchored collapses the two, and the workspace
# route answers "/" — which is exactly what the first deploy of this branch did,
# while the identical bundle built on macOS served "/" correctly.
FROM node:22-slim AS build
WORKDIR /srv/foundry
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /srv/foundry
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data HOST=0.0.0.0
# The bundle inlines its own dependencies, so only the adapter's two packages
# are installed here. better-sqlite3 is native and needs a toolchain to build.
COPY server/runtime/package.json ./package.json
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && npm install --omit=dev --no-audit --no-fund \
 && apt-get purge -y python3 make g++ && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* /root/.npm
COPY --from=build /srv/foundry/dist ./dist
COPY server ./server
COPY drizzle ./drizzle
RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "server/index.mjs"]
