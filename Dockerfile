FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source code
COPY bot.js deploy-commands.js ./
COPY commands/ commands/
COPY utils/ utils/

# Create data directory for persistent storage
RUN mkdir -p /app/data

# Copy default data files (only if volume not mounted)
COPY data/ /app/data-defaults/

# Entrypoint script handles data initialization + command deploy + bot start
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
