# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:26.3.0-slim@sha256:95a34da32a840bd9b3b09a5b773591c16923e350174b1c50e1200c75bf15eaa9
FROM ${NODE_IMAGE} AS website-build
WORKDIR /workspace/website
RUN npm install -g corepack@0.34.5 && corepack enable
COPY --from=exui . vendor/exui
WORKDIR /workspace/website/vendor/exui
RUN pnpm install --frozen-lockfile && pnpm --filter @exre/exui-tokens build && pnpm --filter @exre/exui build
WORKDIR /workspace/website
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236 AS web
COPY --from=website-build /workspace/website/apps/web/dist /usr/share/nginx/html
COPY infra/docs-integration/web/default.conf /etc/nginx/conf.d/default.conf

FROM ${NODE_IMAGE} AS server
ENV NODE_ENV=production
WORKDIR /workspace/website
COPY --from=website-build /workspace/website/apps/server/dist apps/server/dist
COPY --from=website-build /workspace/website/apps/server/drizzle apps/server/drizzle
COPY --from=website-build /workspace/website/apps/server/package.json apps/server/package.json
COPY --from=website-build /workspace/website/apps/server/node_modules apps/server/node_modules
COPY --from=website-build /workspace/website/node_modules node_modules
COPY --from=website-build /workspace/website/api api
COPY --from=website-build /workspace/website/package.json package.json
WORKDIR /workspace/website/apps/server
EXPOSE 8080
CMD ["node", "dist/server.js"]
