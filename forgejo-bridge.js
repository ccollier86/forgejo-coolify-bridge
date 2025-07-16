const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const app = express();

// Configuration from environment variables
const CONFIG = {
  FORGEJO_URL: process.env.FORGEJO_URL || 'https://your-forgejo.com',
  FORGEJO_TOKEN: process.env.FORGEJO_TOKEN,
  BRIDGE_PORT: process.env.PORT || 3000,
  BRIDGE_SECRET: process.env.BRIDGE_SECRET || crypto.randomBytes(32).toString('hex'),
  COOLIFY_WEBHOOK_URL: process.env.COOLIFY_WEBHOOK_URL || 'https://your-coolify.com/api/v1/webhooks/github',
  INTERNAL_BRIDGE_IP: process.env.INTERNAL_BRIDGE_IP || 'localhost'
};

// In-memory token store (use Redis for production)
const tokenStore = new Map();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', bridge: 'forgejo-coolify', version: '1.0.0' });
});

// Git server implementation - serve repos to Coolify
app.all('*', async (req, res, next) => {
  // Log ALL requests for debugging
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`);
  
  // Check if this is a git operation
  const gitMatch = req.path.match(/\/([^/]+)\/([^/]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)/);
  if (!gitMatch) {
    return next();
  }
  
  const [, owner, repo, gitOp] = gitMatch;
  const repoPath = `${owner}/${repo}`;
  const cacheDir = `/tmp/git-cache/${owner}/${repo}.git`;
  
  console.log(`[GIT SERVER] Request: ${req.method} ${repoPath} - ${gitOp}`);
  console.log(`[GIT SERVER] Query:`, req.query);
  
  try {
    // Ensure cache directory exists
    await fs.mkdir(path.dirname(cacheDir), { recursive: true });
    
    // Clone or update the repo from Forgejo
    const forgejoUrl = `${CONFIG.FORGEJO_URL}/${repoPath}.git`;
    
    try {
      await fs.access(cacheDir);
      // Repo exists, fetch updates
      console.log(`[GIT SERVER] Fetching updates for ${repoPath}`);
      await execPromise(`cd ${cacheDir} && git -c http.extraHeader="Authorization: token ${CONFIG.FORGEJO_TOKEN}" fetch --all`);
    } catch (e) {
      // Repo doesn't exist, clone it
      console.log(`[GIT SERVER] Cloning ${repoPath} from ${forgejoUrl}`);
      await execPromise(`git -c http.extraHeader="Authorization: token ${CONFIG.FORGEJO_TOKEN}" clone --bare ${forgejoUrl} ${cacheDir}`);
    }
    
    // Handle git operations using git's CGI interface
    if (gitOp === 'info/refs' || gitOp === 'git-upload-pack' || gitOp === 'git-receive-pack') {
      console.log(`[GIT SERVER] Handling ${gitOp} for ${repoPath}`);
      
      // Set up environment for git http-backend
      const env = {
        ...process.env,
        'GIT_PROJECT_ROOT': '/tmp/git-cache',
        'GIT_HTTP_EXPORT_ALL': '1',
        'REQUEST_METHOD': req.method,
        'PATH_INFO': `/${owner}/${repo}.git/${gitOp}`,
        'REMOTE_USER': 'git',
        'REMOTE_ADDR': req.ip || req.connection.remoteAddress,
        'CONTENT_TYPE': req.headers['content-type'] || '',
        'QUERY_STRING': require('querystring').stringify(req.query),
        'REQUEST_URI': req.originalUrl
      };
      
      if (req.headers['content-length']) {
        env['CONTENT_LENGTH'] = req.headers['content-length'];
      }
      
      console.log(`[GIT SERVER] Executing git http-backend with PATH_INFO=${env.PATH_INFO}`);
      
      const gitHttpBackend = require('child_process').spawn('git', ['http-backend'], {
        env: env
      });
      
      // Pipe request to git http-backend
      if (req.method !== 'GET') {
        req.pipe(gitHttpBackend.stdin);
      }
      
      // Parse headers from git http-backend
      let headers = '';
      let headersParsed = false;
      
      gitHttpBackend.stdout.on('data', (data) => {
        if (!headersParsed) {
          headers += data.toString();
          const headerEnd = headers.indexOf('\r\n\r\n');
          if (headerEnd !== -1) {
            headersParsed = true;
            const headerLines = headers.substring(0, headerEnd).split('\r\n');
            headerLines.forEach(line => {
              const [key, value] = line.split(': ');
              if (key && value) {
                res.setHeader(key, value);
              }
            });
            // Send the rest of the data
            const bodyStart = headerEnd + 4;
            if (headers.length > bodyStart) {
              res.write(headers.substring(bodyStart));
            }
          }
        } else {
          res.write(data);
        }
      });
      
      gitHttpBackend.stderr.on('data', (data) => {
        console.error(`[GIT SERVER] Error: ${data}`);
      });
      
      gitHttpBackend.on('close', (code) => {
        console.log(`[GIT SERVER] Git http-backend exited with code ${code}`);
        res.end();
        
        // Clean up after 5 minutes
        setTimeout(() => {
          fs.rm(cacheDir, { recursive: true, force: true }).catch(console.error);
        }, 5 * 60 * 1000);
      });
    }
    
  } catch (error) {
    console.error('[GIT SERVER] Error:', error.message);
    res.status(500).send('Git server error');
  }
});

// Helper function to promisify exec
function execPromise(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, { ...options, encoding: options.encoding || 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// OAuth endpoints that Coolify expects
app.get('/login/oauth/authorize', (req, res) => {
  const { client_id, redirect_uri, state } = req.query;
  
  // Generate a fake auth code
  const code = crypto.randomBytes(20).toString('hex');
  tokenStore.set(code, {
    client_id,
    state,
    forgejo_token: CONFIG.FORGEJO_TOKEN
  });
  
  // Redirect back to Coolify with the code
  res.redirect(`${redirect_uri}?code=${code}&state=${state}`);
});

app.post('/login/oauth/access_token', (req, res) => {
  const { code } = req.body;
  const authData = tokenStore.get(code);
  
  if (!authData) {
    return res.status(400).json({ error: 'Invalid code' });
  }
  
  // Generate access token
  const access_token = crypto.randomBytes(20).toString('hex');
  tokenStore.set(access_token, authData);
  tokenStore.delete(code);
  
  res.json({
    access_token,
    token_type: 'bearer',
    scope: 'repo,user'
  });
});

// Catch-all for OAuth routes
app.get('/login/oauth/:anything', (req, res) => {
  res.redirect(`/login/oauth/authorize?client_id=forgejo-bridge&redirect_uri=${encodeURIComponent(req.headers.referer || 'https://coolify.local')}&state=coolify`);
});

// GitHub API endpoints
app.get('/api/v3/user', async (req, res) => {
  try {
    const response = await axios.get(`${CONFIG.FORGEJO_URL}/api/v1/user`, {
      headers: { 'Authorization': `token ${CONFIG.FORGEJO_TOKEN}` }
    });
    
    res.json({
      login: response.data.login,
      id: response.data.id,
      avatar_url: response.data.avatar_url,
      name: response.data.full_name,
      email: response.data.email
    });
  } catch (error) {
    console.error('Error fetching user:', error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.get('/api/v3/user/repos', async (req, res) => {
  const { page = 1, per_page = 30 } = req.query;
  
  try {
    const response = await axios.get(`${CONFIG.FORGEJO_URL}/api/v1/user/repos`, {
      headers: { 'Authorization': `token ${CONFIG.FORGEJO_TOKEN}` },
      params: { page, limit: per_page }
    });
    
    const repos = response.data.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      html_url: repo.html_url,
      description: repo.description,
      fork: repo.fork,
      created_at: repo.created_at,
      updated_at: repo.updated_at,
      pushed_at: repo.updated_at,
      ssh_url: repo.ssh_url,
      clone_url: `http://${CONFIG.INTERNAL_BRIDGE_IP}/${repo.full_name}.git`,
      default_branch: repo.default_branch,
      owner: {
        login: repo.owner.login,
        id: repo.owner.id,
        avatar_url: repo.owner.avatar_url
      }
    }));
    
    res.json(repos);
  } catch (error) {
    console.error('Error fetching repos:', error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.get('/api/v3/repos/:owner/:repo', async (req, res) => {
  const { owner, repo } = req.params;
  
  try {
    const response = await axios.get(`${CONFIG.FORGEJO_URL}/api/v1/repos/${owner}/${repo}`, {
      headers: { 'Authorization': `token ${CONFIG.FORGEJO_TOKEN}` }
    });
    
    res.json({
      id: response.data.id,
      name: response.data.name,
      full_name: response.data.full_name,
      private: response.data.private,
      html_url: response.data.html_url,
      description: response.data.description,
      ssh_url: response.data.ssh_url,
      clone_url: `http://${CONFIG.INTERNAL_BRIDGE_IP}/${response.data.full_name}.git`,
      default_branch: response.data.default_branch,
      owner: {
        login: response.data.owner.login,
        id: response.data.owner.id
      }
    });
  } catch (error) {
    console.error('Error fetching repo details:', error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.get('/api/v3/repos/:owner/:repo/branches', async (req, res) => {
  const { owner, repo } = req.params;
  
  try {
    const response = await axios.get(`${CONFIG.FORGEJO_URL}/api/v1/repos/${owner}/${repo}/branches`, {
      headers: { 'Authorization': `token ${CONFIG.FORGEJO_TOKEN}` }
    });
    
    const branches = response.data.map(branch => ({
      name: branch.name,
      commit: {
        sha: branch.commit.id,
        url: branch.commit.url
      },
      protected: branch.protected
    }));
    
    res.json(branches);
  } catch (error) {
    console.error('Error fetching branches:', error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// GitHub App endpoints
app.get('/api/v3/app', (req, res) => {
  res.json({
    id: 999999,
    slug: 'forgejo-bridge',
    name: 'Forgejo Bridge',
    owner: {
      login: 'forgejo-bridge',
      id: 1,
      avatar_url: '',
      type: 'User'
    },
    description: 'Bridge between Forgejo and Coolify',
    external_url: CONFIG.FORGEJO_URL,
    html_url: CONFIG.FORGEJO_URL,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
});

app.get('/api/v3/app/installations', (req, res) => {
  res.json([{
    id: 1,
    account: {
      login: 'forgejo-user',
      id: 1,
      avatar_url: '',
      type: 'User'
    },
    repository_selection: 'all',
    access_tokens_url: '/api/v3/app/installations/1/access_tokens',
    repositories_url: '/api/v3/installation/repositories'
  }]);
});

// GitHub App installation token endpoint
app.post('/api/v3/app/installations/:installationId/access_tokens', (req, res) => {
  // Return a fake installation token
  res.json({
    token: `ghs_${crypto.randomBytes(20).toString('hex')}`,
    expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
    permissions: {
      contents: 'read',
      metadata: 'read', 
      pull_requests: 'write',
      issues: 'write'
    },
    repository_selection: 'all'
  });
});

// Installation endpoint
app.get('/api/v3/installation', (req, res) => {
  res.json({
    id: 1,
    account: {
      login: 'forgejo-user',
      id: 1,
      type: 'User'
    },
    repository_selection: 'all',
    access_tokens_url: '/api/v3/app/installations/1/access_tokens',
    repositories_url: '/api/v3/installation/repositories'
  });
});

app.get('/api/v3/installation/repositories', async (req, res) => {
  try {
    const response = await axios.get(`${CONFIG.FORGEJO_URL}/api/v1/user/repos`, {
      headers: { 'Authorization': `token ${CONFIG.FORGEJO_TOKEN}` },
      params: { limit: 100 }
    });
    
    const repos = response.data.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      clone_url: `http://${CONFIG.INTERNAL_BRIDGE_IP}/${repo.full_name}.git`,
      owner: {
        login: repo.owner.login,
        id: repo.owner.id
      }
    }));
    
    res.json({
      total_count: repos.length,
      repositories: repos
    });
  } catch (error) {
    console.error('Error fetching installation repos:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GitHub App permissions endpoint
app.get('/settings/apps/:appName/permissions', (req, res) => {
  res.json({
    permissions: {
      contents: 'read',
      metadata: 'read',
      pull_requests: 'write',
      webhooks: 'write'
    },
    events: ['push', 'pull_request']
  });
});

// GitHub App installations endpoints
app.get('/app/installations', (req, res) => {
  res.json([{
    id: 1,
    account: {
      login: 'forgejo-user',
      id: 1,
      avatar_url: '',
      type: 'User'
    }
  }]);
});

app.get('/github-apps/:appName/installations/new', (req, res) => {
  const redirectUrl = `/login/oauth/authorize?client_id=forgejo-bridge&redirect_uri=${encodeURIComponent(req.headers.referer)}&state=coolify`;
  res.redirect(redirectUrl);
});

app.get('/installations/:installationId', (req, res) => {
  res.json({
    id: req.params.installationId,
    account: {
      login: 'forgejo-user',
      id: 1,
      type: 'User'
    }
  });
});

// Webhook endpoints
app.post('/api/v3/repos/:owner/:repo/hooks', async (req, res) => {
  const { owner, repo } = req.params;
  const { config, events, active = true } = req.body;
  
  try {
    // Create webhook in Forgejo
    const forgejoWebhook = await axios.post(
      `${CONFIG.FORGEJO_URL}/api/v1/repos/${owner}/${repo}/hooks`,
      {
        type: 'forgejo',
        config: {
          url: `${process.env.BRIDGE_URL || 'http://localhost:3000'}/webhook/forgejo`,
          content_type: 'json',
          secret: CONFIG.BRIDGE_SECRET
        },
        events: events || ['push'],
        active: active
      },
      {
        headers: { 'Authorization': `token ${CONFIG.FORGEJO_TOKEN}` }
      }
    );
    
    // Store webhook mapping
    tokenStore.set(`webhook_${forgejoWebhook.data.id}`, {
      coolify_url: config.url,
      coolify_secret: config.secret,
      repo: `${owner}/${repo}`
    });
    
    // Return GitHub-formatted webhook
    res.json({
      id: forgejoWebhook.data.id,
      url: forgejoWebhook.data.url,
      config: {
        url: config.url,
        content_type: 'json',
        secret: '********'
      },
      events: events || ['push'],
      active: active
    });
  } catch (error) {
    console.error('Error creating webhook:', error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Webhook receiver from Forgejo
app.post('/webhook/forgejo', async (req, res) => {
  const signature = req.headers['x-forgejo-signature'] || req.headers['x-gitea-signature'];
  const event = req.headers['x-forgejo-event'] || req.headers['x-gitea-event'];
  
  // Verify webhook signature
  const hmac = crypto.createHmac('sha256', CONFIG.BRIDGE_SECRET);
  const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
  
  if (signature !== digest) {
    console.warn('Invalid webhook signature');
    return res.status(401).send('Invalid signature');
  }
  
  console.log(`Received ${event} webhook from Forgejo`);
  
  // TODO: Transform and forward to Coolify
  // This is where you'd transform the Forgejo webhook to GitHub format
  // and forward it to Coolify
  
  res.status(200).send('OK');
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start server
app.listen(CONFIG.BRIDGE_PORT, () => {
  console.log(`🚀 Forgejo-Coolify Bridge running on port ${CONFIG.BRIDGE_PORT}`);
  console.log(`📌 Forgejo URL: ${CONFIG.FORGEJO_URL}`);
  console.log(`🔗 Configure Coolify to use GitHub with API URL: http://YOUR_SERVER:${CONFIG.BRIDGE_PORT}/api/v3`);
  console.log(`✅ Health check: http://localhost:${CONFIG.BRIDGE_PORT}/health`);
});