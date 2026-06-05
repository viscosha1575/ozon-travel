FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci

COPY backend/src ./src
COPY backend/public ./public
COPY admin/src/mockAdminApi.js ./vendor/mockAdminApi.js
RUN mkdir -p /app/uploads

EXPOSE 3001

CMD ["npm", "run", "start"]
