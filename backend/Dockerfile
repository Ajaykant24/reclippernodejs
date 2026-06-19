FROM node:22-bookworm-slim

# ffmpeg/ffprobe for video processing.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8000
ENV SF_FONT_PATH=/app/fonts/SFProText-Regular.ttf
EXPOSE 8000

CMD ["npm", "start"]
