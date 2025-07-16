FROM node:18-alpine

# Install git and git-daemon (includes http-backend)
RUN apk add --no-cache git git-daemon

# Add labels
LABEL maintainer="Catalyst Lab"
LABEL description="Forgejo-Coolify Bridge"
LABEL version="1.0.0"

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production

# Copy application files
COPY . .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); })"

# Run the application
CMD ["node", "forgejo-bridge.js"]