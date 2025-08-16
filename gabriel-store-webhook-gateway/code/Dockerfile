FROM node:20-alpine AS builder

WORKDIR /app

COPY ./code/package*.json ./
COPY ./code/tsconfig.json ./
COPY ./code/vite.config.ts ./

RUN npm install

COPY ./code/src ./src
COPY ./code/public ./public
COPY ./code/webhooks.yml ./webhooks.yml

# Build backend e frontend
RUN npm run build && npm run build-frontend

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist/public ./dist/public
COPY --from=builder /app/webhooks.yml ./webhooks.yml 

RUN npm install --only=production

EXPOSE 5124

CMD ["node", "dist/index.js"]