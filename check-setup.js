#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Checking git-auto-sync setup...\n');

// Load config
const configPath = path.join(__dirname, 'config.json');
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  console.error('❌ Could not load config.json');
  process.exit(1);
}

// Check GitHub token
if (!config.githubToken || config.githubToken === '') {
  console.log('⚠️  GitHub token not configured!');
  console.log('');
  console.log('📖 Setup instructions: C:\\dev\\GITHUB_SETUP.md');
  console.log('');
  console.log('Quick steps:');
  console.log('  1. Visit: https://github.com/settings/tokens');
  console.log('  2. Generate new token (classic) with `repo` and `delete_repo` scopes');
  console.log('  3. Copy the token (starts with ghp_...)');
  console.log('  4. Edit config.json and paste it in "githubToken" field');
  console.log('');
  process.exit(1);
}

// Check username
if (!config.username || config.username === '') {
  console.log('❌ GitHub username not configured!');
  process.exit(1);
}

// Check search dirs
if (!config.searchDirs || config.searchDirs.length === 0) {
  console.log('❌ No search directories configured!');
  process.exit(1);
}

// All good!
console.log('✅ GitHub token: Configured');
console.log(`✅ Username: ${config.username}`);
console.log(`✅ Search dirs: ${config.searchDirs.join(', ')}`);
console.log(`✅ Delete empty repos: ${config.deleteEmptyRepos ? 'Enabled' : 'Disabled'}`);
console.log(`✅ Dry run: ${config.dryRun ? 'ON (testing mode)' : 'OFF (live mode)'}`);
console.log('');
console.log('🚀 Setup complete! You can run:');
console.log('   npm run sync:v2');
console.log('');
console.log('📊 Watch progress at: http://localhost:3737');
console.log('');
