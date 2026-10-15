# Gezinsbord: één container met de server en de gebouwde app
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data TZ=Europe/Brussels
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
VOLUME /data
EXPOSE 8080
WORKDIR /app/server
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
