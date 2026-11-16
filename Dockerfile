# Drift — game page + WebSocket relay in one small image.
# Build: docker build -t drift-oyunu .     Run: docker run -p 8080:8080 drift-oyunu

FROM node:22-alpine AS build
LABEL app=drift-oyunu
WORKDIR /app
# Manifests first so the dependency layer is cached between code changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY game/package.json game/
COPY controller/package.json controller/
# Only the web workspaces: the Expo controller is not part of the server image.
RUN npm ci -w shared -w server -w game --include-workspace-root --ignore-scripts --no-audit --no-fund
COPY shared shared
COPY server server
COPY game game
RUN npm -w game run build \
 && npx esbuild server/src/main.ts --bundle --platform=node --format=esm --target=node22 --outfile=out/server.mjs \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

FROM node:22-alpine
LABEL app=drift-oyunu
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/public
WORKDIR /app
COPY --from=build /app/out/server.mjs ./server.mjs
COPY --from=build /app/game/dist ./public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.mjs"]
