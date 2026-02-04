const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs').promises;

// Dashboard integration
const DASHBOARD_URL = 'http://localhost:3737';
let dashTask = null;

async function dashLog(message, level = 'info') {
  console.log(message);
  if (!dashTask) return;
  try {
    await fetch(`${DASHBOARD_URL}/api/task/${dashTask.id}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, level })
    });
  } catch (err) {
    // Ignore
  }
}

async function dashProgress(current, total) {
  if (!dashTask) return;
  try {
    await fetch(`${DASHBOARD_URL}/api/task/${dashTask.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: current, total })
    });
  } catch (err) {
    // Ignore
  }
}

async function initDashboard() {
  try {
    const taskId = 'git-sync-bidirectional';
    await fetch(`${DASHBOARD_URL}/api/task/${taskId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Git Bi-Directional Sync',
        description: 'Syncs repos between local C:\\dev and GitHub (pull, push, clone, cleanup)',
        status: 'running',
        progress: 0,
        total: 0,
        startTime: Date.now()
      })
    });
    dashTask = { id: taskId };
  } catch (err) {
    console.log('Dashboard not available');
  }
}

async function completeDashboard(summary) {
  if (!dashTask) return;
  try {
    await fetch(`${DASHBOARD_URL}/api/task/${dashTask.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary })
    });
  } catch (err) {
    // Ignore
  }
}

async function failDashboard(error) {
  if (!dashTask) return;
  try {
    await fetch(`${DASHBOARD_URL}/api/task/${dashTask.id}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error })
    });
  } catch (err) {
    // Ignore
  }
}

// GitHub API helpers
async function githubApi(endpoint, token, method = 'GET', body = null) {
  const url = `https://api.github.com${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'git-auto-sync'
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
    options.headers['Content-Type'] = 'application/json';
  }
  
  const response = await fetch(url, options);
  
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

async function getAllRepos(username, token) {
  const repos = [];
  let page = 1;
  
  while (true) {
    const batch = await githubApi(
      `/users/${username}/repos?per_page=100&page=${page}`,
      token
    );
    
    if (batch.length === 0) break;
    repos.push(...batch);
    page++;
  }
  
  return repos;
}

async function isRepoEmpty(repoPath) {
  try {
    const git = simpleGit(repoPath);
    const log = await git.log();
    
    // No commits = empty
    if (log.total === 0) return true;
    
    // Only one commit and it's just README = empty
    if (log.total === 1) {
      const files = await git.raw(['ls-tree', '--name-only', 'HEAD']);
      const fileList = files.trim().split('\n');
      
      // Only README (any variant)
      if (fileList.length === 1 && fileList[0].toLowerCase().startsWith('readme')) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    return false;
  }
}

async function deleteEmptyRepo(repoName, username, token, dryRun) {
  if (dryRun) {
    await dashLog(`  🔍 [DRY RUN] Would delete empty repo: ${repoName}`);
    return { deleted: false, dryRun: true };
  }
  
  try {
    await githubApi(`/repos/${username}/${repoName}`, token, 'DELETE');
    await dashLog(`  🗑️  Deleted empty GitHub repo: ${repoName}`, 'success');
    return { deleted: true };
  } catch (err) {
    await dashLog(`  ❌ Failed to delete ${repoName}: ${err.message}`, 'error');
    return { deleted: false, error: err.message };
  }
}

async function deleteLocalRepo(repoPath, dryRun) {
  if (dryRun) {
    await dashLog(`  🔍 [DRY RUN] Would delete local repo: ${repoPath}`);
    return { deleted: false, dryRun: true };
  }
  
  try {
    // Move to trash instead of permanent delete (requires trash-cli or similar)
    // For now, just skip actual deletion and log
    await dashLog(`  🗑️  Would delete local repo: ${repoPath} (manual deletion required)`, 'warn');
    return { deleted: false, manual: true };
  } catch (err) {
    await dashLog(`  ❌ Failed to delete ${repoPath}: ${err.message}`, 'error');
    return { deleted: false, error: err.message };
  }
}

async function findLocalRepos(searchDirs, excludeDirs) {
  const repos = new Map(); // path -> repo
  
  for (const dir of searchDirs) {
    await dashLog(`🔍 Scanning ${dir} for local repos...`);
    
    try {
      const entries = await fs.readdir(dir);
      
      for (const entry of entries) {
        if (excludeDirs.includes(entry)) continue;
        
        const fullPath = path.join(dir, entry);
        const gitPath = path.join(fullPath, '.git');
        
        try {
          const stat = await fs.stat(fullPath);
          if (!stat.isDirectory()) continue;
          
          const gitStat = await fs.stat(gitPath);
          if (gitStat.isDirectory()) {
            repos.set(entry.toLowerCase(), fullPath);
          }
        } catch (err) {
          // No .git directory, skip
        }
      }
    } catch (err) {
      await dashLog(`  ⚠️  Error scanning ${dir}: ${err.message}`, 'warn');
    }
  }
  
  return repos;
}

async function pullRepo(repoPath) {
  const git = simpleGit(repoPath);
  const repoName = path.basename(repoPath);
  
  try {
    const status = await git.status();
    
    // Check for uncommitted changes
    if (status.files.length > 0) {
      await dashLog(`  ⚠️  ${repoName}: Has uncommitted changes, skipping pull`, 'warn');
      return { pulled: false, reason: 'uncommitted changes' };
    }
    
    // Pull from remote
    const result = await git.pull();
    
    if (result.files.length > 0) {
      await dashLog(`  ⬇️  ${repoName}: Pulled ${result.files.length} file(s)`, 'success');
      return { pulled: true, files: result.files.length };
    } else {
      await dashLog(`  ✅ ${repoName}: Already up to date`);
      return { pulled: false, reason: 'up to date' };
    }
    
  } catch (err) {
    await dashLog(`  ❌ ${repoName}: Pull failed - ${err.message}`, 'error');
    return { pulled: false, reason: err.message };
  }
}

async function cloneRepo(repoUrl, targetDir, repoName) {
  try {
    await dashLog(`  📥 Cloning ${repoName}...`);
    await simpleGit().clone(repoUrl, targetDir);
    await dashLog(`  ✅ ${repoName}: Cloned successfully`, 'success');
    return { cloned: true };
  } catch (err) {
    await dashLog(`  ❌ ${repoName}: Clone failed - ${err.message}`, 'error');
    return { cloned: false, reason: err.message };
  }
}

async function pushRepo(repoPath, commitMessage) {
  const git = simpleGit(repoPath);
  const repoName = path.basename(repoPath);
  
  try {
    const status = await git.status();
    
    if (status.files.length === 0) {
      await dashLog(`  ✅ ${repoName}: No changes to push`);
      return { pushed: false, reason: 'no changes' };
    }
    
    await dashLog(`  📝 ${repoName}: ${status.files.length} file(s) changed`);
    
    // Add all changes
    await git.add('.');
    
    // Commit
    const date = new Date().toLocaleDateString();
    const message = commitMessage.replace('{date}', date);
    await git.commit(message);
    
    // Push
    await git.push();
    
    await dashLog(`  ⬆️  ${repoName}: Committed and pushed`, 'success');
    return { pushed: true, files: status.files.length };
    
  } catch (err) {
    await dashLog(`  ❌ ${repoName}: Push failed - ${err.message}`, 'error');
    return { pushed: false, reason: err.message };
  }
}

async function main() {
  await initDashboard();
  
  await dashLog('🚀 Starting Bi-Directional Git Sync...');
  
  // Load config
  const configPath = path.join(__dirname, 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  
  if (!config.githubToken) {
    const error = 'GitHub token not configured! Set githubToken in config.json';
    await dashLog(`❌ ${error}`, 'error');
    await failDashboard(error);
    return;
  }
  
  const results = {
    pulled: 0,
    pushed: 0,
    cloned: 0,
    emptyDeleted: 0,
    upToDate: 0,
    failed: 0
  };
  
  // Phase 1: Fetch GitHub repos
  await dashLog(`\n📡 Phase 1: Fetching repos from GitHub...`);
  const githubRepos = await getAllRepos(config.username, config.githubToken);
  await dashLog(`  Found ${githubRepos.length} repos on GitHub\n`);
  
  // Phase 2: Find local repos
  await dashLog(`📂 Phase 2: Scanning local directories...`);
  const localRepos = await findLocalRepos(config.searchDirs, config.excludeDirs);
  await dashLog(`  Found ${localRepos.size} local repos\n`);
  
  const totalOps = githubRepos.length + localRepos.size;
  let currentOp = 0;
  
  // Phase 3: Pull updates from GitHub
  await dashLog(`⬇️  Phase 3: Pulling updates from GitHub...\n`);
  
  for (const ghRepo of githubRepos) {
    currentOp++;
    await dashProgress(currentOp, totalOps);
    
    const repoName = ghRepo.name.toLowerCase();
    const localPath = localRepos.get(repoName);
    
    if (localPath) {
      // Repo exists locally - pull updates
      const result = await pullRepo(localPath);
      if (result.pulled) results.pulled++;
      else if (result.reason === 'up to date') results.upToDate++;
      else results.failed++;
      
      // Remove from local map (we've processed it)
      localRepos.delete(repoName);
    } else {
      // Repo doesn't exist locally - clone it
      const targetDir = path.join(config.searchDirs[0], ghRepo.name);
      const result = await cloneRepo(ghRepo.clone_url, targetDir, ghRepo.name);
      if (result.cloned) results.cloned++;
      else results.failed++;
    }
  }
  
  // Phase 4: Push local changes
  await dashLog(`\n⬆️  Phase 4: Pushing local changes...\n`);
  
  for (const [repoName, repoPath] of localRepos) {
    currentOp++;
    await dashProgress(currentOp, totalOps);
    
    // Check if empty
    const isEmpty = await isRepoEmpty(repoPath);
    
    if (isEmpty && config.deleteEmptyRepos) {
      await dashLog(`  🗑️  ${repoName}: Detected as empty`);
      await deleteLocalRepo(repoPath, config.dryRun);
      // Try to delete from GitHub too
      const ghResult = await deleteEmptyRepo(repoName, config.username, config.githubToken, config.dryRun);
      if (ghResult.deleted) results.emptyDeleted++;
    } else {
      // Push changes
      const result = await pushRepo(repoPath, config.commitMessage);
      if (result.pushed) results.pushed++;
      else if (result.reason === 'no changes') results.upToDate++;
      else results.failed++;
    }
  }
  
  // Summary
  const summary = `
✨ Bi-Directional Sync Complete!
• Pulled updates: ${results.pulled} repos
• Pushed changes: ${results.pushed} repos
• Cloned new repos: ${results.cloned} repos
• Deleted empty: ${results.emptyDeleted} repos
• Up to date: ${results.upToDate} repos
• Failed: ${results.failed} operations
• Total processed: ${totalOps} repos
  `.trim();
  
  await dashLog(`\n${summary}`, 'success');
  await completeDashboard(summary);
}

main().catch(async (err) => {
  console.error(err);
  await failDashboard(err.message);
});
