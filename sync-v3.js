const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

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
        name: 'Git Bi-Directional Sync (v3 - Conflict Safe)',
        description: 'Syncs repos with conflict detection and resolution (keeps both versions)',
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

// Conflict resolution helpers
async function getFileHash(filePath) {
  try {
    const content = await fs.readFile(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (err) {
    return null;
  }
}

async function getFileMtime(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch (err) {
    return 0;
  }
}

async function backupFile(filePath, suffix) {
  try {
    const backupPath = `${filePath}.${suffix}`;
    await fs.copyFile(filePath, backupPath);
    return backupPath;
  } catch (err) {
    return null;
  }
}

async function detectConflicts(repoPath) {
  const git = simpleGit(repoPath);
  const conflicts = [];
  
  try {
    // Get current branch
    const status = await git.status();
    const currentBranch = status.current;
    
    // Fetch remote without merging
    await git.fetch();
    
    // Get list of files changed locally
    const localChanges = status.files.map(f => f.path);
    
    if (localChanges.length === 0) {
      return { hasConflicts: false, conflicts: [] };
    }
    
    // Get list of files changed remotely
    const remoteDiff = await git.diff([
      `${currentBranch}`,
      `origin/${currentBranch}`,
      '--name-only'
    ]);
    
    const remoteChanges = remoteDiff.split('\n').filter(f => f.trim());
    
    if (remoteChanges.length === 0) {
      return { hasConflicts: false, conflicts: [] };
    }
    
    // Find files changed in both places
    for (const localFile of localChanges) {
      if (remoteChanges.includes(localFile)) {
        const fullPath = path.join(repoPath, localFile);
        const mtime = await getFileMtime(fullPath);
        const hash = await getFileHash(fullPath);
        
        conflicts.push({
          file: localFile,
          path: fullPath,
          localMtime: mtime,
          localHash: hash
        });
      }
    }
    
    return { hasConflicts: conflicts.length > 0, conflicts };
    
  } catch (err) {
    // If fetch fails, assume no conflicts
    return { hasConflicts: false, conflicts: [] };
  }
}

async function resolveConflicts(repoPath, conflicts) {
  const git = simpleGit(repoPath);
  const repoName = path.basename(repoPath);
  const resolutions = [];
  
  await dashLog(`  ⚠️  ${repoName}: ${conflicts.length} potential conflict(s) detected`);
  
  for (const conflict of conflicts) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Strategy: Keep-Both with timestamp-based resolution
      // 1. Backup local version
      const localBackup = await backupFile(conflict.path, `local.${timestamp}`);
      
      if (!localBackup) {
        await dashLog(`  ⚠️  ${conflict.file}: Skipping (backup failed)`, 'warn');
        resolutions.push({ file: conflict.file, resolution: 'skipped', reason: 'backup failed' });
        continue;
      }
      
      // 2. Stash local changes
      await git.stash(['push', '-u', '-m', `Auto-stash for conflict resolution ${timestamp}`]);
      
      // 3. Pull remote version
      await git.pull();
      
      // 4. Get remote version's mtime and hash
      const remoteMtime = await getFileMtime(conflict.path);
      const remoteHash = await getFileHash(conflict.path);
      
      // 5. Compare timestamps - keep newer version
      if (conflict.localMtime > remoteMtime) {
        // Local is newer - restore local version
        await fs.copyFile(localBackup, conflict.path);
        await dashLog(`  🔄 ${conflict.file}: Local newer (kept local, backed up remote)`, 'warn');
        
        // Backup remote version
        await backupFile(conflict.path, `remote.${timestamp}`);
        
        resolutions.push({
          file: conflict.file,
          resolution: 'local-newer',
          localBackup,
          remoteMtime,
          localMtime: conflict.localMtime
        });
      } else if (conflict.localHash === remoteHash) {
        // Same content - no conflict
        await dashLog(`  ✅ ${conflict.file}: Identical content (no conflict)`);
        resolutions.push({ file: conflict.file, resolution: 'identical' });
      } else {
        // Remote is newer - keep remote version
        await dashLog(`  🔄 ${conflict.file}: Remote newer (kept remote, backed up local)`, 'warn');
        
        // Backup remote version too
        await backupFile(conflict.path, `remote.${timestamp}`);
        
        resolutions.push({
          file: conflict.file,
          resolution: 'remote-newer',
          localBackup,
          remoteMtime,
          localMtime: conflict.localMtime
        });
      }
      
      // 6. Stage the resolved file
      await git.add(conflict.file);
      
    } catch (err) {
      await dashLog(`  ❌ ${conflict.file}: Resolution failed - ${err.message}`, 'error');
      resolutions.push({ file: conflict.file, resolution: 'failed', reason: err.message });
    }
  }
  
  return resolutions;
}

async function pullRepoSafe(repoPath) {
  const git = simpleGit(repoPath);
  const repoName = path.basename(repoPath);
  
  try {
    const status = await git.status();
    
    // Phase 1: Detect conflicts before pulling
    const conflictCheck = await detectConflicts(repoPath);
    
    if (conflictCheck.hasConflicts) {
      await dashLog(`  🔍 ${repoName}: Conflict detection triggered`);
      const resolutions = await resolveConflicts(repoPath, conflictCheck.conflicts);
      
      const resolvedCount = resolutions.filter(r => r.resolution !== 'failed' && r.resolution !== 'skipped').length;
      const failedCount = resolutions.filter(r => r.resolution === 'failed').length;
      const skippedCount = resolutions.filter(r => r.resolution === 'skipped').length;
      
      if (failedCount > 0) {
        await dashLog(`  ⚠️  ${repoName}: ${failedCount} conflict(s) failed, ${skippedCount} skipped, ${resolvedCount} resolved`, 'warn');
      }
      
      return {
        pulled: resolvedCount > 0 || skippedCount > 0,
        conflicts: conflictCheck.conflicts.length,
        resolved: resolvedCount,
        skipped: skippedCount,
        failed: failedCount,
        strategy: 'keep-both-timestamp'
      };
    }
    
    // Phase 2: No conflicts - safe to pull
    if (status.files.length > 0) {
      // Uncommitted changes but no conflicts
      await dashLog(`  ⚠️  ${repoName}: Uncommitted changes, stashing before pull`, 'warn');
      await git.stash(['push', '-u', '-m', 'Auto-stash before pull']);
    }
    
    const result = await git.pull();
    
    if (result.files && result.files.length > 0) {
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

async function pushRepoSafe(repoPath, commitMessage) {
  const git = simpleGit(repoPath);
  const repoName = path.basename(repoPath);
  
  try {
    const status = await git.status();
    
    if (status.files.length === 0) {
      await dashLog(`  ✅ ${repoName}: No changes to push`);
      return { pushed: false, reason: 'no changes' };
    }
    
    await dashLog(`  📝 ${repoName}: ${status.files.length} file(s) changed`);
    
    // Phase 1: Check if remote has new commits
    await git.fetch();
    
    const localCommit = await git.revparse(['HEAD']);
    const remoteCommit = await git.revparse([`origin/${status.current}`]);
    
    if (localCommit !== remoteCommit) {
      // Remote has new commits - pull first
      await dashLog(`  🔄 ${repoName}: Remote has new commits, pulling first...`);
      const pullResult = await pullRepoSafe(repoPath);
      
      if (!pullResult.pulled && pullResult.reason !== 'up to date') {
        return { pushed: false, reason: 'pull failed before push', pullResult };
      }
    }
    
    // Phase 2: Safe to commit and push
    await git.add('.');
    
    const date = new Date().toLocaleDateString();
    const message = commitMessage.replace('{date}', date);
    await git.commit(message);
    
    // Phase 3: Push with retry on rejection
    try {
      await git.push();
      await dashLog(`  ⬆️  ${repoName}: Committed and pushed`, 'success');
      return { pushed: true, files: status.files.length };
    } catch (pushErr) {
      // Push rejected - remote changed during commit
      await dashLog(`  ⚠️  ${repoName}: Push rejected, retrying with pull...`, 'warn');
      
      const pullResult = await pullRepoSafe(repoPath);
      
      if (pullResult.pulled || pullResult.reason === 'up to date') {
        // Try push again
        await git.push();
        await dashLog(`  ⬆️  ${repoName}: Pushed after conflict resolution`, 'success');
        return { pushed: true, files: status.files.length, retried: true };
      } else {
        throw new Error('Push rejected and pull failed');
      }
    }
    
  } catch (err) {
    await dashLog(`  ❌ ${repoName}: Push failed - ${err.message}`, 'error');
    return { pushed: false, reason: err.message };
  }
}

// GitHub API helpers (unchanged from v2)
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
    
    if (log.total === 0) return true;
    
    if (log.total === 1) {
      const files = await git.raw(['ls-tree', '--name-only', 'HEAD']);
      const fileList = files.trim().split('\n');
      
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
    await dashLog(`  🗑️  Would delete local repo: ${repoPath} (manual deletion required)`, 'warn');
    return { deleted: false, manual: true };
  } catch (err) {
    await dashLog(`  ❌ Failed to delete ${repoPath}: ${err.message}`, 'error');
    return { deleted: false, error: err.message };
  }
}

async function findLocalRepos(searchDirs, excludeDirs) {
  const repos = new Map();
  
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

async function main() {
  await initDashboard();
  
  await dashLog('🚀 Starting Conflict-Safe Bi-Directional Git Sync (v3)...');
  
  const configPath = path.join(__dirname, 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  
  if (!config.githubToken) {
    const error = 'GitHub token not configured!';
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
    failed: 0,
    conflictsResolved: 0
  };
  
  await dashLog(`\n📡 Phase 1: Fetching repos from GitHub...`);
  const githubRepos = await getAllRepos(config.username, config.githubToken);
  await dashLog(`  Found ${githubRepos.length} repos on GitHub\n`);
  
  await dashLog(`📂 Phase 2: Scanning local directories...`);
  const localRepos = await findLocalRepos(config.searchDirs, config.excludeDirs);
  await dashLog(`  Found ${localRepos.size} local repos\n`);
  
  const totalOps = githubRepos.length + localRepos.size;
  let currentOp = 0;
  
  await dashLog(`⬇️  Phase 3: Pulling updates from GitHub (with conflict detection)...\n`);
  
  for (const ghRepo of githubRepos) {
    currentOp++;
    await dashProgress(currentOp, totalOps);
    
    const repoName = ghRepo.name.toLowerCase();
    const localPath = localRepos.get(repoName);
    
    if (localPath) {
      const result = await pullRepoSafe(localPath);
      if (result.pulled) results.pulled++;
      else if (result.reason === 'up to date') results.upToDate++;
      else results.failed++;
      
      if (result.resolved) results.conflictsResolved += result.resolved;
      
      localRepos.delete(repoName);
    } else {
      const targetDir = path.join(config.searchDirs[0], ghRepo.name);
      const result = await cloneRepo(ghRepo.clone_url, targetDir, ghRepo.name);
      if (result.cloned) results.cloned++;
      else results.failed++;
    }
  }
  
  await dashLog(`\n⬆️  Phase 4: Pushing local changes (with conflict detection)...\n`);
  
  for (const [repoName, repoPath] of localRepos) {
    currentOp++;
    await dashProgress(currentOp, totalOps);
    
    const isEmpty = await isRepoEmpty(repoPath);
    
    if (isEmpty && config.deleteEmptyRepos) {
      await dashLog(`  🗑️  ${repoName}: Detected as empty`);
      await deleteLocalRepo(repoPath, config.dryRun);
      const ghResult = await deleteEmptyRepo(repoName, config.username, config.githubToken, config.dryRun);
      if (ghResult.deleted) results.emptyDeleted++;
    } else {
      const result = await pushRepoSafe(repoPath, config.commitMessage);
      if (result.pushed) results.pushed++;
      else if (result.reason === 'no changes') results.upToDate++;
      else results.failed++;
    }
  }
  
  const summary = `
✨ Conflict-Safe Sync Complete!
• Pulled updates: ${results.pulled} repos
• Pushed changes: ${results.pushed} repos
• Cloned new repos: ${results.cloned} repos
• Conflicts resolved: ${results.conflictsResolved} files
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
