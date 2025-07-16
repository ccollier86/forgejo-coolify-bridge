#!/bin/bash

# Forgejo-Coolify Bridge Setup Script
# This script sets up a bridge between Forgejo and Coolify to enable GitHub App compatibility

set -e

echo "==================================="
echo "Forgejo-Coolify Bridge Setup"
echo "==================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
   echo "Please run as root (use sudo)"
   exit 1
fi

# Get installation directory
read -p "Installation directory [/opt/forgejo-coolify-bridge]: " INSTALL_DIR
INSTALL_DIR=${INSTALL_DIR:-/opt/forgejo-coolify-bridge}

# Create directory
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Get configuration values
echo ""
echo "Configuration:"
echo "--------------"
read -p "Forgejo URL (e.g., https://git.example.com): " FORGEJO_URL
read -p "Forgejo Access Token: " FORGEJO_TOKEN
read -p "Bridge Secret (leave empty to generate): " BRIDGE_SECRET
read -p "Coolify Webhook URL (e.g., https://coolify.example.com/api/v1/webhooks/github): " COOLIFY_WEBHOOK_URL
read -p "Bridge External URL (e.g., http://YOUR_SERVER_IP:3456): " BRIDGE_URL

# Generate secret if not provided
if [ -z "$BRIDGE_SECRET" ]; then
    BRIDGE_SECRET=$(openssl rand -hex 32)
    echo "Generated Bridge Secret: $BRIDGE_SECRET"
fi

# Create .env file
cat > .env << EOF
FORGEJO_URL=$FORGEJO_URL
FORGEJO_TOKEN=$FORGEJO_TOKEN
BRIDGE_SECRET=$BRIDGE_SECRET
COOLIFY_WEBHOOK_URL=$COOLIFY_WEBHOOK_URL
BRIDGE_URL=$BRIDGE_URL
INTERNAL_BRIDGE_IP=forgejo-bridge-proxy
EOF

# Create Dockerfile
cat > Dockerfile << 'EOF'
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
EOF

# Create package.json
cat > package.json << 'EOF'
{
  "name": "forgejo-coolify-bridge",
  "version": "1.0.0",
  "description": "Bridge between Forgejo and Coolify for GitHub App compatibility",
  "main": "forgejo-bridge.js",
  "scripts": {
    "start": "node forgejo-bridge.js",
    "dev": "nodemon forgejo-bridge.js"
  },
  "keywords": ["forgejo", "coolify", "github", "bridge"],
  "author": "Catalyst Lab",
  "license": "MIT",
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.2",
    "crypto": "^1.0.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
EOF

# Create docker-compose.yml
cat > docker-compose.yml << 'EOF'
services:
  forgejo-bridge:
    build: .
    container_name: forgejo-coolify-bridge
    restart: unless-stopped
    environment:
      - FORGEJO_URL=${FORGEJO_URL}
      - FORGEJO_TOKEN=${FORGEJO_TOKEN}
      - BRIDGE_SECRET=${BRIDGE_SECRET}
      - COOLIFY_WEBHOOK_URL=${COOLIFY_WEBHOOK_URL}
      - BRIDGE_URL=${BRIDGE_URL}
      - INTERNAL_BRIDGE_IP=${INTERNAL_BRIDGE_IP}
    networks:
      - bridge-internal
      - coolify
      - ${FORGEJO_NETWORK:-forgejo}

  nginx-proxy:
    image: nginx:alpine
    container_name: forgejo-bridge-proxy
    restart: unless-stopped
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - forgejo-bridge
    networks:
      - bridge-internal
      - coolify

networks:
  bridge-internal:
    driver: bridge
  coolify:
    external: true
EOF

# Create nginx.conf
cat > nginx.conf << 'EOF'
server {
    listen 80;
    server_name _;
    client_max_body_size 50M;
    
    location / {
        proxy_pass http://forgejo-coolify-bridge:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # For git operations
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_http_version 1.1;
    }
}
EOF

# Download the bridge application
echo ""
echo "Downloading bridge application..."
curl -fsSL https://raw.githubusercontent.com/yourusername/forgejo-coolify-bridge/main/forgejo-bridge.js -o forgejo-bridge.js

# Check if Forgejo is running in Docker
echo ""
echo "Checking for Forgejo container..."
FORGEJO_CONTAINER=$(docker ps --format "table {{.Names}}" | grep -E "forgejo|gitea" | head -1)

if [ -n "$FORGEJO_CONTAINER" ]; then
    echo "Found Forgejo container: $FORGEJO_CONTAINER"
    
    # Get the network name
    FORGEJO_NETWORK=$(docker inspect "$FORGEJO_CONTAINER" -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' | head -1)
    echo "Forgejo is on network: $FORGEJO_NETWORK"
    
    # Update docker-compose with the correct network
    sed -i "s/\${FORGEJO_NETWORK:-forgejo}/$FORGEJO_NETWORK/g" docker-compose.yml
    
    # Update .env to use container name
    sed -i "s|FORGEJO_URL=$FORGEJO_URL|FORGEJO_URL=http://$FORGEJO_CONTAINER:3000|g" .env
else
    echo "No Forgejo container found. Using external URL."
    echo "You may need to manually add the Forgejo network to docker-compose.yml"
fi

# Build and start
echo ""
echo "Building and starting the bridge..."
docker-compose build
docker-compose up -d

# Wait for services to start
sleep 5

# Get nginx proxy IP
NGINX_IP=$(docker inspect forgejo-bridge-proxy -f '{{range .NetworkSettings.Networks}}{{if eq .NetworkName "coolify"}}{{.IPAddress}}{{end}}{{end}}' | grep -E '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+')

if [ -z "$NGINX_IP" ]; then
    NGINX_IP=$(docker inspect forgejo-bridge-proxy | grep -A 10 '"coolify"' | grep IPAddress | awk -F'"' '{print $4}')
fi

# Update .env with the nginx IP
sed -i "s/INTERNAL_BRIDGE_IP=forgejo-bridge-proxy/INTERNAL_BRIDGE_IP=$NGINX_IP/g" .env

# Restart bridge to pick up new IP
docker-compose restart forgejo-bridge

echo ""
echo "==================================="
echo "Setup Complete!"
echo "==================================="
echo ""
echo "Bridge is running at: $BRIDGE_URL"
echo "Internal nginx proxy IP: $NGINX_IP"
echo ""
echo "Configure Coolify GitHub App with:"
echo "  HTML URL: http://$NGINX_IP"
echo "  API URL: http://$NGINX_IP/api/v3"
echo ""
echo "To view logs:"
echo "  docker-compose logs -f"
echo ""
echo "To stop the bridge:"
echo "  docker-compose down"
echo ""
