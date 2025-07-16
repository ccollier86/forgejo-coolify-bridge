# Forgejo-Coolify Bridge

A bridge service that enables Coolify to work with Forgejo repositories by emulating GitHub's API. This allows you to use Forgejo as a source for your Coolify deployments without waiting for native Forgejo support.

## Features

- ✅ GitHub API v3 compatibility layer for Forgejo
- ✅ OAuth flow emulation for repository access
- ✅ Git HTTP smart protocol server for reliable cloning
- ✅ Repository listing and management
- ✅ Branch detection and selection
- ✅ Webhook support for automatic deployments
- ✅ Internal Docker networking for secure communication
- ✅ Automatic repository caching for faster deployments

## Architecture

The bridge consists of two components:
1. **API Bridge**: Translates GitHub API calls to Forgejo API calls
2. **Git Server**: Acts as a caching git server that clones from Forgejo and serves to Coolify

This design solves the authentication mismatch between Coolify (expecting GitHub-style tokens) and Forgejo, while also handling Coolify's URL rewriting behavior.

## Prerequisites

- Docker and Docker Compose installed
- A running Forgejo instance
- A running Coolify instance
- A Forgejo personal access token with repository access

## Quick Start

1. Clone this repository or download the setup script:
```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/forgejo-coolify-bridge/main/setup.sh -o setup.sh
chmod +x setup.sh
sudo ./setup.sh
```

2. Follow the prompts to configure:
   - Forgejo URL
   - Forgejo access token
   - Coolify webhook URL
   - Bridge external URL

3. The script will automatically:
   - Set up the bridge with nginx proxy
   - Configure Docker networking
   - Provide the internal IP addresses for Coolify configuration

## Manual Installation

### 1. Create Installation Directory

```bash
sudo mkdir -p /opt/forgejo-coolify-bridge
cd /opt/forgejo-coolify-bridge
```

### 2. Create Configuration Files

Create `.env` file:
```env
FORGEJO_URL=https://git.example.com
FORGEJO_TOKEN=your_forgejo_token_here
BRIDGE_SECRET=generate_a_random_secret_here
COOLIFY_WEBHOOK_URL=https://coolify.example.com/api/v1/webhooks/github
BRIDGE_URL=http://YOUR_SERVER_IP:3456
INTERNAL_BRIDGE_IP=forgejo-bridge-proxy
```

Create `docker-compose.yml`:
```yaml
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
      - your_forgejo_network  # Replace with actual Forgejo network name

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
  your_forgejo_network:  # Replace with actual network name
    external: true
```

### 3. Configure Nginx

Create `nginx.conf`:
```nginx
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
```

### 4. Build and Start

```bash
docker-compose build
docker-compose up -d
```

### 5. Get Nginx Proxy IP

```bash
docker inspect forgejo-bridge-proxy | grep -A 10 '"coolify"' | grep IPAddress
```

Update `.env` with this IP as `INTERNAL_BRIDGE_IP` and restart the bridge.

## Coolify Configuration

1. In Coolify, go to Sources and add a new GitHub App source
2. Configure with:
   - **HTML URL**: `http://[NGINX_PROXY_IP]` (no port!)
   - **API URL**: `http://[NGINX_PROXY_IP]/api/v3`
   - **User**: `git`
   - **Port**: `22`

3. Save and connect - you should see your Forgejo repositories!

## Configuration Scenarios

### Scenario 1: Forgejo and Coolify on Same Server

If both services are on the same server, the bridge can use Docker's internal networking:
- Use container names instead of IPs in `FORGEJO_URL`
- Ensure all services are on the correct Docker networks

### Scenario 2: Forgejo on Different Server

For Forgejo on a different server:
- Use the full HTTPS URL for `FORGEJO_URL`
- Ensure the Forgejo token has sufficient permissions
- Remove the Forgejo network from docker-compose.yml

### Scenario 3: Multiple Forgejo Instances

To bridge multiple Forgejo instances:
- Run multiple bridge instances on different ports
- Use different container names and config directories
- Configure each with its own Forgejo credentials

## Troubleshooting

### Bridge Can't Connect to Forgejo

Check Docker networks:
```bash
docker network ls
docker inspect [forgejo_container] | grep -A 10 "Networks"
```

Ensure the bridge is on the same network as Forgejo.

### Coolify Can't Clone Repositories

1. Check bridge logs:
```bash
docker-compose logs -f
```

2. Verify the nginx proxy is accessible:
```bash
docker exec -it coolify curl http://[NGINX_IP]/health
```

3. Ensure git operations are working:
```bash
docker exec -it forgejo-coolify-bridge git ls-remote http://forgejo:3000/owner/repo.git
```

### Authentication Errors

- Verify your Forgejo token has repository read permissions
- Check that the token is correctly set in `.env`
- Ensure no extra spaces or quotes in the token

## How It Works

1. **API Translation**: When Coolify makes GitHub API calls, the bridge translates them to Forgejo API calls
2. **Git Server**: For git operations, the bridge:
   - Clones repositories from Forgejo using proper authentication
   - Serves them to Coolify using git's HTTP protocol
   - Caches repositories temporarily for performance
   - Cleans up after 5 minutes to save space

3. **Network Architecture**: 
   - Nginx proxy listens on port 80 (internal Docker network)
   - Bridge service runs on port 3000
   - Coolify connects to nginx proxy IP without specifying a port
   - This avoids Coolify's port-stripping behavior

## Security Considerations

- The bridge stores your Forgejo token - ensure the server is secure
- Use strong, random secrets for `BRIDGE_SECRET`
- Consider implementing Redis for token storage in production
- Regularly rotate your Forgejo access tokens
- Monitor bridge logs for suspicious activity

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details

## Acknowledgments

This bridge was created to solve the immediate need for Forgejo integration in Coolify while native support is being developed. Thanks to the Forgejo and Coolify communities for their excellent platforms.
