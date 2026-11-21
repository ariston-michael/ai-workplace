FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG DEPLOY_COMMIT
ARG DEPLOY_BRANCH=vultr-deployment
ENV DEPLOY_COMMIT=$DEPLOY_COMMIT DEPLOY_BRANCH=$DEPLOY_BRANCH NEXT_TELEMETRY_DISABLED=1
# Build-only placeholders. Runtime secrets come exclusively from the host env file.
RUN AUTH0_DOMAIN=build.invalid AUTH0_CLIENT_ID=build-placeholder AUTH0_CLIENT_SECRET=build-placeholder-secret AUTH0_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef APP_BASE_URL=https://build.invalid npm run build

FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN groupadd --gid 10001 workplace && useradd --uid 10001 --gid workplace --create-home workplace
COPY --from=build --chown=10001:10001 /app/.next/standalone ./
COPY --from=build --chown=10001:10001 /app/.next/static ./.next/static
COPY --from=build --chown=10001:10001 /app/public ./public
COPY --chown=10001:10001 deploy/validate-env.mjs deploy/backup.mjs ./deploy/
USER 10001:10001
EXPOSE 3000
CMD ["sh", "-c", "node deploy/validate-env.mjs && exec node server.js"]
