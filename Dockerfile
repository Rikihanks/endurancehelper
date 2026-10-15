# Multi-stage build: compile the React frontend, then run the Node backend
# serving it from frontend/dist.
FROM node:20-alpine AS build
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace backend --workspace frontend
COPY . .
RUN npm run build --workspace frontend

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/frontend/package.json frontend/package.json
RUN npm ci --omit=dev --workspace backend
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
EXPOSE 8080
CMD ["node", "backend/server.js"]
