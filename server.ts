import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import cookieSession from "cookie-session";
import { Octokit } from "octokit";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.set('trust proxy', true); // Trust all proxies
  
  // Force secure behavior by setting the forwarded proto header
  app.use((req, res, next) => {
    req.headers['x-forwarded-proto'] = 'https';
    next();
  });

  app.use(express.json());
  app.use(cookieSession({
    name: 'session',
    keys: [process.env.SESSION_SECRET || 'voterhub-secret'],
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: true,
    sameSite: 'none',
    httpOnly: true,
  }));

  // GitHub OAuth Routes
  app.get("/api/auth/github/url", (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
      return res.status(500).json({ error: "GITHUB_CLIENT_ID is not configured" });
    }
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${appUrl}/api/auth/github/callback`;
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo`;
    res.json({ url });
  });

  app.get(["/api/auth/github/callback", "/api/auth/github/callback/"], async (req: any, res) => {
    const { code, error, error_description } = req.query;
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (error) {
      return res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'GITHUB_AUTH_ERROR', error: '${error}', description: '${error_description}' }, '*');
                window.close();
              } else {
                document.body.innerText = 'GitHub Auth Error: ${error} - ${error_description}';
              }
            </script>
            <p>Authentication failed. This window should close automatically.</p>
          </body>
        </html>
      `);
    }

    if (!clientId || !clientSecret) {
      return res.status(500).send("Server Configuration Error: GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is missing in environment variables.");
    }

    if (!code) {
      return res.status(400).send("Missing authorization code from GitHub.");
    }

    try {
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      const data = await response.json();
      if (data.access_token) {
        req.session.githubToken = data.access_token;
        res.send(`
          <html>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'GITHUB_AUTH_SUCCESS' }, '*');
                  window.close();
                } else {
                  window.location.href = '/';
                }
              </script>
              <p>Authentication successful. This window should close automatically.</p>
            </body>
          </html>
        `);
      } else {
        console.error("GitHub Token Exchange Error:", data);
        res.status(400).send(`Failed to get access token from GitHub. Error: ${data.error} - ${data.error_description}`);
      }
    } catch (error) {
      console.error("GitHub Auth Error:", error);
      res.status(500).send("Internal server error during GitHub auth");
    }
  });

  app.get("/api/auth/github/status", (req: any, res) => {
    res.json({ authenticated: !!req.session?.githubToken });
  });

  app.post("/api/github/sync", async (req: any, res) => {
    const token = req.session?.githubToken;
    if (!token) {
      return res.status(401).json({ error: "Not authenticated with GitHub" });
    }

    const octokit = new Octokit({ auth: token });
    const repoName = "voterhub";

    try {
      // Get the authenticated user's login
      const { data: user } = await octokit.rest.users.getAuthenticated();
      const owner = user.login;

      // Check if repo exists
      try {
        await octokit.rest.repos.get({ owner, repo: repoName });
      } catch (e: any) {
        if (e.status === 404) {
          // Try to create it if it doesn't exist
          await octokit.rest.repos.createForAuthenticatedUser({ name: repoName, private: true });
        } else {
          throw e;
        }
      }

      // Recursive function to get all files in the project
      async function getFiles(dir: string, baseDir: string): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(entries.map((entry) => {
          const res = path.resolve(dir, entry.name);
          if (entry.isDirectory()) {
            // Skip node_modules, .git, dist
            if (['node_modules', '.git', 'dist', '.next', 'out'].includes(entry.name)) {
              return [];
            }
            return getFiles(res, baseDir);
          } else {
            // Skip sensitive files and large binaries
            if (['.env', 'firebase-applet-config.json', 'package-lock.json'].includes(entry.name)) {
              return [];
            }
            // Skip common binary extensions
            if (entry.name.match(/\.(png|jpg|jpeg|gif|ico|pdf|zip|tar|gz|exe|dll|so|dylib)$/i)) {
              return [];
            }
            return [path.relative(baseDir, res)];
          }
        }));
        return Array.prototype.concat(...files);
      }

      const projectFiles = await getFiles(process.cwd(), process.cwd());
      console.log(`Found ${projectFiles.length} files to sync`);
      
      // 1. Get the default branch
      const { data: repo } = await octokit.rest.repos.get({ owner, repo: repoName });
      const defaultBranch = repo.default_branch;

      // 2. Get the latest commit SHA (if any)
      let latestCommitSha: string | undefined;
      try {
        const { data: ref } = await octokit.rest.git.getRef({
          owner,
          repo: repoName,
          ref: `heads/${defaultBranch}`,
        });
        latestCommitSha = ref.object.sha;
      } catch (e: any) {
        if (e.status !== 404) throw e;
        // Repo is empty, no latest commit
      }

      // 3. Create tree entries
      const treeEntries = await Promise.all(projectFiles.map(async (filePath) => {
        const fullPath = path.join(process.cwd(), filePath);
        const content = await fs.readFile(fullPath, 'utf8');
        return {
          path: filePath,
          mode: '100644' as const,
          type: 'blob' as const,
          content: content,
        };
      }));

      // 4. Create a new tree
      const { data: newTree } = await octokit.rest.git.createTree({
        owner,
        repo: repoName,
        base_tree: latestCommitSha,
        tree: treeEntries,
      });

      // 5. Create a new commit
      const { data: newCommit } = await octokit.rest.git.createCommit({
        owner,
        repo: repoName,
        message: `Sync project from VoterHub App at ${new Date().toISOString()}`,
        tree: newTree.sha,
        parents: latestCommitSha ? [latestCommitSha] : [],
      });

      // 6. Update or Create the reference
      if (latestCommitSha) {
        await octokit.rest.git.updateRef({
          owner,
          repo: repoName,
          ref: `heads/${defaultBranch}`,
          sha: newCommit.sha,
        });
      } else {
        await octokit.rest.git.createRef({
          owner,
          repo: repoName,
          ref: `refs/heads/${defaultBranch}`,
          sha: newCommit.sha,
        });
      }

      res.json({ 
        success: true, 
        message: `Successfully synced ${projectFiles.length} files to ${owner}/${repoName} in a single commit.`
      });
    } catch (error: any) {
      console.error("GitHub Sync Error:", error);
      res.status(500).json({ error: error.message || "Failed to sync with GitHub" });
    }
  });

  // Proxy route for Google Civic Information API
  app.get("/api/civic/voterinfo", async (req, res) => {
    const { address } = req.query;
    const apiKey = process.env.GOOGLE_CIVIC_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "GOOGLE_CIVIC_API_KEY is not configured" });
    }

    if (!address) {
      return res.status(400).json({ error: "Address is required" });
    }

    // Normalize address: remove extra spaces and trailing commas
    const normalizedAddress = (address as string).split(',').map(p => p.trim()).filter(Boolean).join(', ');
    
    console.log(`Calling Google Civic API for address: "${normalizedAddress}"`);

    const url = `https://www.googleapis.com/civicinfo/v2/voterinfo?address=${encodeURIComponent(normalizedAddress)}&key=${apiKey}`;

    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'VoterHub-App/1.0',
          // Forward the origin as the Referer to help with API key restrictions
          'Referer': req.get('origin') || req.get('referer') || appUrl
        }
      });
      
      const text = await response.text();
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error("Google Civic API returned non-JSON response:", text.substring(0, 500));
        return res.status(response.status).json({ 
          error: "Google Civic API returned invalid response format", 
          status: response.status,
          details: text.substring(0, 500) 
        });
      }
      
      if (!response.ok) {
        const errorMessage = data.error?.message || "Unknown Google Civic API error";
        const reason = data.error?.errors?.[0]?.reason || "";
        
        // "Election unknown" is a common/expected response when no elections are scheduled
        if (errorMessage.includes("Election unknown") || reason === "invalid") {
          console.info(`Google Civic API: No active election found for this address. Falling back to Gemini search.`);
        } else {
          console.warn(`Google Civic API Error (${response.status}): ${errorMessage} [Reason: ${reason}]`);
        }
        
        let hint = "";
        const lowerMsg = errorMessage.toLowerCase();
        
        if (response.status === 403) {
          if (reason === 'accessNotConfigured' || lowerMsg.includes('disabled') || lowerMsg.includes('not enabled')) {
            hint = " - ACTION REQUIRED: Enable Civic Information API at https://console.cloud.google.com/apis/library/civicinfo.googleapis.com";
          } else if (reason === 'keyInvalid' || lowerMsg.includes('key invalid')) {
            hint = " - ACTION REQUIRED: Check your GOOGLE_CIVIC_API_KEY in Cloud Console.";
          }
        }

        return res.status(response.status).json({
          error: errorMessage + hint,
          code: response.status,
          details: data
        });
      }

      res.json(data);
    } catch (error) {
      console.error("Google Civic Proxy error:", error);
      res.status(500).json({ error: "Internal server error during Google Civic proxy" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
