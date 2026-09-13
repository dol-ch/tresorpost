# syntax=docker/dockerfile:1

# ── Frontend build ─────────────────────────────────
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Backend build ──────────────────────────────────
FROM rust:1-bookworm AS backend
WORKDIR /app
COPY rust-toolchain.toml Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

# ── Runtime ────────────────────────────────────
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /app/target/release/tresorpost /usr/local/bin/tresorpost
COPY --from=frontend /app/frontend/dist ./frontend/dist
ENV PORT=3000 \
    STATIC_DIR=/app/frontend/dist \
    DATABASE_PATH=/data/tresorpost.db \
    RUST_LOG=info
VOLUME ["/data"]
EXPOSE 3000
CMD ["tresorpost"]
