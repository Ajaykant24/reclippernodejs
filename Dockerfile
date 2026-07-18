# Reclipper Backend API Server
# Node.js runtime for the video repurposing pipeline

FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy backend code
COPY backend ./backend

# Copy any public assets needed by the backend (like fonts, etc)
COPY public ./public 2>/dev/null || true

# Expose API port
EXPOSE ${PORT:-8000}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8000), (r) => {if (r.statusCode !== 200) throw new Error('Health check failed')})" || exit 1

# Start the API server
CMD ["node", "backend/main.js"]
