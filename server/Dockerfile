# Ping realtime backend. node:sqlite is built in, so there's nothing native to
# compile — a plain install is all it takes.
FROM node:22-slim

WORKDIR /app

# Install production deps first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=61337
ENV DB_FILE=/data/ping.db
# Avatars are written next to the DB, i.e. /data/uploads — also on the volume.
EXPOSE 61337

# Persist the SQLite database and uploaded avatars outside the image.
VOLUME ["/data"]

CMD ["node", "src/index.js"]
