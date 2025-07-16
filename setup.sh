#!/bin/bash

echo "🚀 Forgejo-Coolify Bridge Setup"
echo "=============================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    
    # Generate a random secret
    SECRET=$(openssl rand -hex 32)
    
    # Update .env with the secret
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/generate-with-openssl-rand-hex-32/$SECRET/g" .env
    else
        # Linux
        sed -i "s/generate-with-openssl-rand-hex-32/$SECRET/g" .env
    fi
    
    echo "✅ Created .env file with generated secret"
    echo ""
    echo "⚠️  Please edit .env and add:"
    echo "   - Your Forgejo URL"
    echo "   - Your Forgejo personal access token"
    echo "   - Your server IP address"
    echo "   - Your Coolify URL"
    echo ""
    echo "Then run: docker-compose up -d"
else
    echo "✅ .env file already exists"
    echo ""
    echo "Starting bridge..."
    docker-compose up -d
    echo ""
    echo "✅ Bridge started!"
    echo ""
    echo "View logs with: docker-compose logs -f"
fi

echo ""
echo "📖 Full setup instructions in README.md"