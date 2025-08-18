FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY vite.config.ts ./

RUN npm install

COPY src ./src
COPY public ./public

# Build backend e frontend
RUN npm run build && npm run build-frontend

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist/public ./dist/public

RUN npm install --only=production

EXPOSE 5124

CMD ["node", "dist/index.js"]