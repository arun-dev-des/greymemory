# greymemory-console backend (for Railway) — the Express viz API served over a
# slim demo SQLite DB. Build context is the REPO ROOT: the server dynamically
# imports the library at ./src (Memory/Storage), which needs better-sqlite3
# resolved from the repo-root modules.
FROM node:20-bookworm-slim

# Toolchain for the native better-sqlite3 build (fallback if no prebuilt binary).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) Library deps (src/ → better-sqlite3)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# 2) Server deps (express, cors, better-sqlite3, express-rate-limit …)
COPY greymemory-console/server/package.json greymemory-console/server/package-lock.json* ./greymemory-console/server/
RUN npm --prefix greymemory-console/server install --omit=dev --no-audit --no-fund

# 3) App source + the committed slim demo DB
#    (greymemory-console/server/demo-data/greymemory.db, 4 containers).
COPY src ./src
COPY greymemory-console/server ./greymemory-console/server

ENV NODE_ENV=production
# GREYMEMORY_ROOT is resolved relative to the repo root (= /app) by index.js.
ENV GREYMEMORY_ROOT=greymemory-console/server/demo-data
# Railway injects PORT; the server reads process.env.PORT (default 4000).
EXPOSE 4000

CMD ["node", "greymemory-console/server/index.js"]
