# ─── Stage 1: Build frontend ───
FROM node:20-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ─── Stage 2: Build backend ───
FROM golang:1.25-alpine AS backend
RUN apk add --no-cache gcc musl-dev
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o ksm-dns .

# ─── Stage 3: Runtime ───
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend /src/backend/ksm-dns .
COPY --from=frontend /src/frontend/dist ./frontend/dist

ENV KSM_DATA_DIR=/app/data
ENV KSM_FRONTEND_DIR=/app/frontend/dist
ENV KSM_PORT=8910

EXPOSE 8910
VOLUME ["/app/data"]

CMD ["./ksm-dns"]