# Build from the repository root:
# docker build -f apps/render-backend/Dockerfile --build-arg LUPI_BUILD_SHA=<40-hex-sha> .

FROM node:22-bookworm AS web-build
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /repo
COPY . .
ARG LUPI_BUILD_SHA
ENV VITE_LUPI_BUILD_SHA=${LUPI_BUILD_SHA}
RUN pnpm install --frozen-lockfile --filter . --filter @atlas/web...
RUN pnpm --filter @atlas/web... build

FROM mcr.microsoft.com/playwright:v1.59.1-noble AS runtime
WORKDIR /app
COPY apps/render-backend/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund --workspaces=false
COPY LICENSE ./LICENSE
COPY apps/render-backend/src ./src
COPY --from=web-build /repo/apps/web/dist ./web-dist

ENV NODE_ENV=production \
    PORT=8080 \
    VIEWER_PORT=4173 \
    WEB_DIST=/app/web-dist \
    RENDER_DEADLINE_MS=85000

USER pwuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/supervisor.mjs"]
