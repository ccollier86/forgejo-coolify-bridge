# 🚀 Forgejo-Coolify Bridge

> **The world's first native integration between Forgejo and Coolify!**

This bridge service makes Forgejo (or Gitea) appear as a GitHub source to Coolify, enabling seamless repository browsing, automatic webhook creation, and push-to-deploy functionality - just like you'd get with GitHub!

## ✨ Features

- 🔍 **Browse Forgejo repositories** directly in Coolify's UI
- 🔗 **Automatic webhook creation** for push-to-deploy
- 🏢 **Organization support** (coming soon)
- 🔐 **Private repository support**
- 🚀 **Zero manual configuration** per repository
- 🐳 **Docker-ready** with health checks
- 🛡️ **Secure** webhook signature verification

## 📋 Prerequisites

- A running Forgejo (or Gitea) instance
- A running Coolify instance
- Docker and Docker Compose
- A server with port 3456 available (configurable)

## 🚀 Quick Start

### 1. Clone this repository

```bash
git clone https://github.com/yourusername/forgejo-coolify-bridge.git
cd forgejo-coolify-bridge
```

### 2. Create Forgejo Personal Access Token

1. Go to your Forgejo instance (e.g., `https://git.yourdomain.com`)
2. Navigate to Settings → Applications → Generate New Token
3. Name it: `Coolify Bridge`
4. Select these permissions:
   - ✅ **repository**: Read and write
   - ✅ **user**: Read
   - ✅ **organization**: Read (if using orgs)
   - ✅ **issue**: Read and write (for PR comments)
5. Copy the generated token

### 3. Configure the bridge

```bash
# Copy the example environment file
cp .env.example .env

# Edit with your values
nano .env
```

Set these values:

```env
FORGEJO_URL=https://git.yourdomain.com
FORGEJO_TOKEN=your-token-from-step-2
BRIDGE_SECRET=$(openssl rand -hex 32)
BRIDGE_URL=http://your-server-ip:3456
COOLIFY_WEBHOOK_URL=https://coolify.yourdomain.com/api/v1/webhooks/github
```

### 4. Start the bridge

```bash
# Using Docker Compose
docker-compose up -d

# Check logs
docker-compose logs -f
```

### 5. Configure Coolify

1. In Coolify, go to **Sources** → **New Source**
2. Select **GitHub Apps**
3. Fill in:

   - **Name**: `Forgejo Bridge`
   - **HTML URL**: `http://your-server-ip:3456`
   - **API URL**: `http://your-server-ip:3456/api/v3`
   - **App ID**: `999999`
   - **Installation ID**: `1`
   - **Client ID**: `forgejo-bridge`
   - **Client Secret**: Your BRIDGE_SECRET value
   - **Webhook Secret**: Your BRIDGE_SECRET value
   - **Private Key**: Generate with:
     ```bash
     openssl genrsa -out private-key.pem 2048
     cat private-key.pem
     ```

4. Save and click **Connect**!

## 🎉 Usage

Once connected, you can:

1. Create new applications in Coolify
2. Select your Forgejo source
3. Browse and select any repository
4. Deploy with automatic webhooks!

## 🔧 Advanced Configuration

### Using Different Ports

Edit `.env`:

```env
BRIDGE_PORT=8080  # External port
```

### Production Deployment

For production, consider:

1. **Use Redis** for token storage:

   ```javascript
   // Add Redis support in forgejo-bridge.js
   const redis = require("redis");
   const client = redis.createClient();
   ```

2. **SSL/TLS** termination with reverse proxy (nginx/caddy)

3. **Monitoring** with the `/health` endpoint

### Deploy on Coolify itself!

You can even deploy this bridge using Coolify:

1. Push this code to a Forgejo repository
2. Create new app in Coolify
3. Select Docker Compose as build pack
4. Deploy!

## 🐛 Troubleshooting

### Bridge not accessible

- Check firewall rules for port 3456
- Verify Docker container is running: `docker-compose ps`

### Can't see repositories

- Verify Forgejo token has correct permissions
- Check bridge logs: `docker-compose logs`

### Webhooks not triggering

- Ensure BRIDGE_URL is publicly accessible
- Check webhook secrets match

## 🤝 Contributing

Contributions are welcome! Feel free to:

- Report bugs
- Suggest features
- Submit pull requests

## 📄 License

MIT License - feel free to use this in your own projects!

## 🙏 Acknowledgments

- Created by [@catalystlab](https://github.com/catalystlab) with the help of Claude
- Inspired by the need for better Forgejo integration with modern deployment platforms
- Thanks to the Coolify and Forgejo communities

## 🗺️ Roadmap

- [ ] Organization repository browsing
- [ ] PR deployment previews
- [ ] Multiple Forgejo instance support
- [ ] GitLab adapter
- [ ] Webhook event filtering
- [ ] Admin UI for configuration

---

**Note**: This is an unofficial bridge and is not affiliated with Coolify or Forgejo projects.

If you find this useful, please ⭐ star this repository!

## 💖 Support This Project

If this bridge saves you time and manual webhook headaches, consider supporting the development:

<a href="https://coff.ee/caseyc" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

[![](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86)](https://github.com/sponsors/ccollier86)

**Crypto Donations:**

- **Bitcoin**: `bc1qyouradress...`
- **Ethereum**: `0xYourAddress...`
- **Monero**: `YourMoneroAddress...`

Your support helps maintain this project and develop new features! 🚀
