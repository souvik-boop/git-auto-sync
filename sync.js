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
    const taskId = 'git-auto-sync';
    await fetch(`${DASHBOARD_URL}/api/task/${taskId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Git Auto-Sync',
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

async function findGitRepos(searchDirs, excludeDirs) {
  const repos = [];
  
  for (const dir of searchDirs) {
    await dashLog(`🔍 Scanning ${dir} for git repos...`);
    
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
            repos.push(fullPath);
          }
        } catch (err) {
          // No .git directory, skip
        }
      }
      
      await dashLog(`  Found ${repos.length} repos in ${dir}`);
    } catch (err) {
      await dashLog(`  ⚠️  Error scanning ${dir}: ${err.message}`, 'warn');
    }
  }
  
  return repos;
}

async function syncRepo(repoPath, commitMessage, dryRun) {
  const git = simpleGit(repoPath);
  const repoName = path.basename(repoPath);
  
  try {
    // Check if it's a git repo
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      await dashLog(`  ⚠️  ${repoName}: Not a git repo`, 'warn');
      return { synced: false, reason: 'not a repo' };
    }
    
    // Get status
    const status = await git.status();
    
    if (status.files.length === 0) {
      await dashLog(`  ✅ ${repoName}: No changes`, 'info');
      return { synced: false, reason: 'no changes' };
    }
    
    await dashLog(`  📝 ${repoName}: ${status.files.length} file(s) changed`);
    
    if (dryRun) {
      await dashLog(`  🔍 [DRY RUN] Would commit: ${status.files.map(f => f.path).join(', ')}`);
      return { synced: false, reason: 'dry run' };
    }
    
    // Add all changes
    await git.add('.');
    
    // Commit
    const date = new Date().toLocaleDateString();
    const message = commitMessage.replace('{date}', date);
    await git.commit(message);
    
    // Try to push
    try {
      await git.push();
      await dashLog(`  ✅ ${repoName}: Committed and pushed`, 'success');
      return { synced: true, files: status.files.length };
    } catch (pushErr) {
      await dashLog(`  ⚠️  ${repoName}: Committed but failed to push: ${pushErr.message}`, 'warn');
      return { synced: false, reason: 'push failed', committed: true };
    }
    
  } catch (err) {
    await dashLog(`  ❌ ${repoName}: Error - ${err.message}`, 'error');
    return { synced: false, reason: err.message };
  }
}

async function main() {
  await initDashboard();
  
  await dashLog('🚀 Starting Git Auto-Sync...');
  
  // Load config
  const configPath = path.join(__dirname, 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  
  // Find all repos
  const repos = await findGitRepos(config.searchDirs, config.excludeDirs);
  await dashLog(`\n📦 Found ${repos.length} total repositories\n`);
  
  if (repos.length === 0) {
    await dashLog('No repositories found!', 'warn');
    await completeDashboard('No repositories found');
    return;
  }
  
  await dashProgress(0, repos.length);
  
  // Sync each repo
  const results = {
    synced: 0,
    noChanges: 0,
    failed: 0,
    committed: 0
  };
  
  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i];
    const result = await syncRepo(repo, config.commitMessage, config.dryRun);
    
    if (result.synced) {
      results.synced++;
    } else if (result.reason === 'no changes') {
      results.noChanges++;
    } else if (result.committed) {
      results.committed++;
    } else {
      results.failed++;
    }
    
    await dashProgress(i + 1, repos.length);
  }
  
  // Summary
  const summary = `
✨ Sync Complete!
• Synced: ${results.synced} repos
• No changes: ${results.noChanges} repos
• Committed (no push): ${results.committed} repos
• Failed: ${results.failed} repos
• Total scanned: ${repos.length} repos
  `.trim();
  
  await dashLog(`\n${summary}`, 'success');
  await completeDashboard(summary);
}

main().catch(console.error);
