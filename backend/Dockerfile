FROM node:22-bookworm-slim

# ffmpeg/ffprobe for video processing, python3 + Whisper for transcription.
# Whisper pulls in PyTorch, so this layer is large (~2 GB) and slow to build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
    && pip3 install --break-system-packages --no-cache-dir openai-whisper \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000

CMD ["npm", "start"]
