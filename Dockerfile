# Laukin backend - production image
# Express + PostgreSQL (Neon) + Socket.IO. DB di-host terpisah, tidak ada volume asset.
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/migrations ./migrations

EXPOSE 4000

CMD ["node", "dist/index.js"]
