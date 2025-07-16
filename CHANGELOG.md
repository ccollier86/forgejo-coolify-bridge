# Changelog

## [2.0.0] - 2025-07-17

### 🎉 Complete Rewrite - Everything Works Now!

If you tried v1.x and gave up - please try again! We've solved all the core issues.

### Added

- Git server implementation using git-http-backend
- Nginx reverse proxy for port management
- Automatic repository caching
- Internal Docker networking support
- One-command setup script
- Comprehensive logging for debugging

### Fixed

- "Repository not found" errors
- Authentication format mismatches
- Port stripping issues
- Private repository access
- Deployment failures

### Changed

- Complete architecture overhaul
- Now acts as a full git server, not just an API proxy
- Handles all git operations natively

### For v1.x Users

Simply run:

```bash
cd /opt/forgejo-coolify-bridge
git pull
./setup.sh
```
