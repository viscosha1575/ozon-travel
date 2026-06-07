FROM node:20-alpine AS builder

WORKDIR /app

ARG VITE_API_BASE_URL=http://localhost:3001
ARG VITE_ALLOW_BROWSER_ADMIN=false

ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_ALLOW_BROWSER_ADMIN=${VITE_ALLOW_BROWSER_ADMIN}

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
