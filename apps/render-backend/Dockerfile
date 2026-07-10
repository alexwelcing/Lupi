# Lupi render backend — self-contained: builds the LUPI web app and drives it on
# localhost inside the container (SwiftShader WebGL/WebGPU, no GPU, no dependency
# on production lupi.live and no bot-challenge surface).
#
# Build from the REPO ROOT:  docker build -f apps/render-backend/Dockerfile -t lupi-render-backend .

# ---- stage 1: build the viewer ----
FROM node:22-bookworm AS webbuild
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ---- stage 2: renderer service ----
FROM mcr.microsoft.com/playwright:v1.49.0-jammy
WORKDIR /app
COPY apps/render-backend/package.json ./
RUN npm install --omit=dev --no-audit --no-fund --no-workspaces
COPY apps/render-backend/src ./src
# built viewer, served locally by the service supervisor
COPY --from=webbuild /repo/apps/web/dist ./web-dist
RUN npm install --no-save serve@14 --no-audit --no-fund
ENV PORT=8080 \
    VIEWER_PORT=4173 \
    VIEWER_URL="http://127.0.0.1:4173/?sim=caffeine" \
    WEB_DIST=/app/web-dist
EXPOSE 8080
CMD ["node", "src/supervisor.mjs"]
