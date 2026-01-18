FROM node:22-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine

COPY frontend/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY frontend/nginx/99-runtime-config.sh /docker-entrypoint.d/99-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/99-runtime-config.sh

COPY --from=build /app/dist/app /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
