# Git Auto-Sync

Bi-directional Git synchronization tool with GitHub integration.

## Features

- 🔄 **Bi-directional sync**: Pull from GitHub, push local changes
- 📥 **Auto-clone**: Automatically clone repos from your GitHub that don't exist locally
- 🗑️ **Empty repo cleanup**: Detect and delete empty repos (both local and GitHub)
- 📊 **Dashboard integration**: Real-time progress on Mission Control dashboard
- ⚡ **Batch processing**: Handle unlimited repositories

## Setup

### 1. GitHub Personal Access Token

You need a GitHub Personal Access Token (PAT) for the tool to work.

**Create a token:**
1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a name like "git-auto-sync"
4. Select scopes:
   - ✅ `repo` (full repository access)
   - ✅ `delete_repo` (if you want to delete empty repos)
5. Click "Generate token"
6. **Copy the token immediately** (you won't see it again!)

**Add to config:**
```json
{
  "username": "your-github-username",
  "githubToken": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  ...
}
```

### 2. Configuration

Edit `config.json`:

```json
{
  "searchDirs": ["C:\\dev"],           // Where to look for local repos
  "excludeDirs": ["node_modules"],     // Directories to ignore
  "username": "souvik-boop",           // Your GitHub username
  "githubToken": "",                   // Your GitHub PAT (required!)
  "deleteEmptyRepos": true,            // Auto-delete empty repos
  "commitMessage": "🤖 Auto-sync: {date}",
  "dryRun": false                      // Set true to test without changes
}
```

## Usage

### Manual Run

```bash
npm start          # Run original sync (push only)
npm run sync:v2    # Run bi-directional sync (recommended)
```

### Scheduled Run

The tool runs automatically at 2 AM daily via OpenClaw cron.

## What It Does

### Phase 1: Fetch GitHub Repos
- Fetches all repos from your GitHub account

### Phase 2: Scan Local Repos
- Finds all git repositories in configured directories

### Phase 3: Pull Updates
- For each GitHub repo:
  - If exists locally → pull latest changes
  - If not local → clone it

### Phase 4: Push Local Changes
- For each local repo:
  - Check if empty (no commits or only README)
  - If empty and `deleteEmptyRepos` enabled → delete it
  - Otherwise → commit and push changes

## Empty Repo Detection

A repo is considered empty if:
- It has zero commits, OR
- It has only one commit with just a README file

Empty repos are deleted from:
- ✅ GitHub (via API)
- ⚠️ Local (manual deletion required)

## Dashboard

View real-time progress at: http://localhost:3737

The dashboard shows:
- Current phase
- Repos processed
- Success/failure counts
- Detailed logs

## Troubleshooting

### "GitHub token not configured"
Add your GitHub PAT to `config.json` → `githubToken`

### "Push failed: authentication failed"
Your GitHub token may be expired or lack `repo` scope

### "Clone failed: authentication failed"
Public repos clone fine, but private repos need a valid token with `repo` scope

### Rate limiting
GitHub API has limits:
- 5000 requests/hour (authenticated)
- 60 requests/hour (unauthenticated)

This tool stays well under limits.

## Security

**Keep your token safe!**
- Never commit `config.json` with your token to public repos
- Add to `.gitignore` if needed
- Tokens have full access to your repos - treat them like passwords

## Future Enhancements

- [ ] Trash integration for safe local repo deletion
- [ ] Selective sync (include/exclude patterns)
- [ ] Multi-account support
- [ ] Branch-specific sync
- [ ] Conflict resolution strategies
