# ---------- Build stage ----------
FROM node:20 AS builder

WORKDIR /app

# Install all dependencies (including devDependencies needed for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# ---------- Runtime stage ----------
FROM node:20-slim

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built output from builder
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite persistence
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=5000
ENV DATA_DIR=/data

EXPOSE 5000

CMD ["node", "dist/index.cjs"]
