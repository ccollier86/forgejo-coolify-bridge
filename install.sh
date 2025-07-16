#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Banner
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════╗"
echo "║      Forgejo-Coolify Bridge Installer     ║"
echo "║          The Missing Link! 🚀             ║"
echo "╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running with sudo when needed
check_sudo() {
    if [ "$EUID" -ne 0 ] && docker ps >/dev/null 2>&1; then
        if ! docker ps >/dev/null 2>&1; then
            echo -e "${YELLOW}This script needs to run with sudo to access Docker${NC}"
            echo -e "${YELLOW}Restarting with sudo...${NC}"
            exec sudo "$0" "$@"
        fi
    fi
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
check_prerequisites() {
    echo -e "${BLUE}Checking prerequisites...${NC}"
    
    local missing=()
    
    if ! command_exists docker; then
        missing+=("docker")
    fi
    
    if ! command_exists docker-compose && ! docker compose version >/dev/null 2>&1; then
        missing+=("docker-compose")
    fi
    
    if ! command_exists openssl; then
        missing+=("openssl")
    fi
    
    if [ ${#missing[@]} -ne 0 ]; then
        echo -e "${RED}Missing required tools: ${missing[*]}${NC}"
        echo "Please install them first."
        exit 1
    fi
    
    echo -e "${GREEN}✓ All prerequisites installed${NC}"
}

# Detect if Coolify is installed
detect_coolify() {
    if docker network ls | grep -q coolify; then
        echo -e "${GREEN}✓ Detected Coolify installation${NC}"
        COOLIFY_DETECTED=true
    else
        echo -e "${YELLOW}⚠ Coolify network not detected${NC}"
        echo -e "${YELLOW}  The bridge will create its own network${NC}"
        COOLIFY_DETECTED=false
    fi
}

# Setup function
setup_bridge() {
    echo -e "\n${BLUE}Setting up Forgejo-Coolify Bridge...${NC}"
    
    # Create .env if it doesn't exist
    if [ ! -f .env ]; then
        echo -e "${BLUE}Creating .env file...${NC}"
        cp .env.example .env
        
        # Generate secret
        SECRET=$(openssl rand -hex 32)
        
        # Update .env with the secret
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/generate-with-openssl-rand-hex-32/$SECRET/g" .env
        else
            sed -i "s/generate-with-openssl-rand-hex-32/$SECRET/g" .env
        fi
        
        echo -e "${GREEN}✓ Generated BRIDGE_SECRET${NC}"
        
        # Interactive setup
        echo -e "\n${YELLOW}Let's configure your bridge:${NC}"
        
        read -p "Forgejo URL (e.g., https://git.yourdomain.com): " FORGEJO_URL
        read -p "Forgejo Token: " FORGEJO_TOKEN
        read -p "Server IP/Domain for bridge: " SERVER_IP
        read -p "Coolify URL (e.g., https://coolify.yourdomain.com): " COOLIFY_URL
        read -p "Bridge Port (default 3456): " BRIDGE_PORT
        BRIDGE_PORT=${BRIDGE_PORT:-3456}
        
        # Update .env file
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|https://git.yourdomain.com|$FORGEJO_URL|g" .env
            sed -i '' "s|your-forgejo-personal-access-token|$FORGEJO_TOKEN|g" .env
            sed -i '' "s|your-server-ip|$SERVER_IP|g" .env
            sed -i '' "s|https://coolify.yourdomain.com|$COOLIFY_URL|g" .env
            sed -i '' "s|3456|$BRIDGE_PORT|g" .env
        else
            sed -i "s|https://git.yourdomain.com|$FORGEJO_URL|g" .env
            sed -i "s|your-forgejo-personal-access-token|$FORGEJO_TOKEN|g" .env
            sed -i "s|your-server-ip|$SERVER_IP|g" .env
            sed -i "s|https://coolify.yourdomain.com|$COOLIFY_URL|g" .env
            sed -i "s|3456|$BRIDGE_PORT|g" .env
        fi
        
        echo -e "${GREEN}✓ Configuration saved${NC}"
    else
        echo -e "${YELLOW}Using existing .env file${NC}"
    fi
    
    # Update docker-compose for Coolify compatibility
    if [ "$COOLIFY_DETECTED" = false ]; then
        echo -e "${BLUE}Creating standalone network configuration...${NC}"
        # Create a modified docker-compose without external network
        cp docker-compose.yml docker-compose.standalone.yml
        sed -i '/external: true/d' docker-compose.standalone.yml
        COMPOSE_FILE="docker-compose.standalone.yml"
    else
        COMPOSE_FILE="docker-compose.yml"
    fi
    
    # Build and start
    echo -e "\n${BLUE}Building and starting bridge...${NC}"
    
    if command_exists docker-compose; then
        docker-compose -f $COMPOSE_FILE build
        docker-compose -f $COMPOSE_FILE up -d
    else
        docker compose -f $COMPOSE_FILE build
        docker compose -f $COMPOSE_FILE up -d
    fi
    
    # Wait for service to be ready
    echo -e "${BLUE}Waiting for bridge to be ready...${NC}"
    sleep 5
    
    # Test the bridge
    if curl -s http://localhost:${BRIDGE_PORT:-3456}/health > /dev/null; then
        echo -e "${GREEN}✓ Bridge is running!${NC}"
        
        # Show the credentials needed for Coolify
        echo -e "\n${GREEN}═══════════════════════════════════════════${NC}"
        echo -e "${GREEN}Bridge installed successfully!${NC}"
        echo -e "${GREEN}═══════════════════════════════════════════${NC}"
        
        echo -e "\n${YELLOW}Next steps in Coolify:${NC}"
        echo -e "1. Go to Sources → New Source → GitHub Apps"
        echo -e "2. Use these values:"
        echo -e "   ${BLUE}API URL:${NC} http://$SERVER_IP:${BRIDGE_PORT:-3456}/api/v3"
        echo -e "   ${BLUE}HTML URL:${NC} http://$SERVER_IP:${BRIDGE_PORT:-3456}"
        echo -e "   ${BLUE}Client Secret:${NC} $SECRET"
        echo -e "\n${YELLOW}Generate RSA key with:${NC} openssl genrsa -out private-key.pem 2048"
        
        echo -e "\n${BLUE}View logs:${NC} docker-compose logs -f"
        echo -e "${BLUE}Stop bridge:${NC} docker-compose down"
        
    else
        echo -e "${RED}✗ Bridge failed to start${NC}"
        echo -e "Check logs with: docker-compose logs"
        exit 1
    fi
}

# Main execution
main() {
    check_sudo "$@"
    check_prerequisites
    detect_coolify
    setup_bridge
}

# Run main
main "$@"
