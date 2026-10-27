# Multi-stage build: compile the React client, then ship only production deps + built assets.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY server/src server/src
COPY --from=build /app/client/dist client/dist
USER node
EXPOSE 4000
CMD ["node", "server/src/index.js"]
