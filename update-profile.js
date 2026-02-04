const fs = require('fs').promises;
const path = require('path');

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

async function initDashboard() {
  try {
    const taskId = 'github-profile-update';
    await fetch(`${DASHBOARD_URL}/api/task/${taskId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'GitHub Profile Update',
        status: 'running',
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

async function generateProfileReadme(config) {
  const username = config.github.username;
  
  const readme = `
# Hi there! 👋 I'm ${username}

<div align="center">

![Profile Views](https://komarev.com/ghpvc/?username=${username}&color=blueviolet&style=flat-square)
[![GitHub followers](https://img.shields.io/github/followers/${username}?label=Follow&style=social)](https://github.com/${username})

</div>

## 🚀 About Me

<!-- TODO: Add your bio here -->
Building cool stuff and automating everything 🤖

## 🛠️ Tech Stack

<!-- Badges for your tech stack -->
![JavaScript](https://img.shields.io/badge/-JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/-Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/-Python-3776AB?style=flat-square&logo=python&logoColor=white)
![Git](https://img.shields.io/badge/-Git-F05032?style=flat-square&logo=git&logoColor=white)
![VS Code](https://img.shields.io/badge/-VS%20Code-007ACC?style=flat-square&logo=visual-studio-code&logoColor=white)

## 📊 GitHub Stats

<div align="center">

![GitHub Stats](https://github-readme-stats.vercel.app/api?username=${username}&show_icons=true&theme=radical&hide_border=true&include_all_commits=true&count_private=true)

![Top Languages](https://github-readme-stats.vercel.app/api/top-langs/?username=${username}&layout=compact&theme=radical&hide_border=true)

![GitHub Streak](https://github-readme-streak-stats.herokuapp.com/?user=${username}&theme=radical&hide_border=true)

</div>

## 🏆 GitHub Trophies

<div align="center">

![Trophies](https://github-profile-trophy.vercel.app/?username=${username}&theme=radical&no-frame=true&no-bg=true&row=1&column=7)

</div>

## 📈 Activity Graph

[![Activity Graph](https://github-readme-activity-graph.vercel.app/graph?username=${username}&theme=react-dark&hide_border=true)](https://github.com/${username})

## 💼 Recent Projects

<!-- Auto-generated or manually add your top projects -->
- 🤖 **Git Auto-Sync** - Automated git repository synchronization
- 📊 **Live Updates Dashboard** - Real-time task monitoring
- 📧 **Gmail Cleanup** - Smart spam detection and cleanup

## 📫 How to reach me

<!-- Add your contact info -->
- 💼 LinkedIn: [Your LinkedIn](https://linkedin.com/in/yourprofile)
- 🐦 Twitter: [@yourhandle](https://twitter.com/yourhandle)
- 📧 Email: your.email@example.com

---

<div align="center">

*✨ Auto-updated by [git-auto-sync](https://github.com/${username}/git-auto-sync) • Last updated: ${new Date().toLocaleDateString()}*

</div>
`;

  return readme.trim();
}

async function main() {
  await initDashboard();
  
  await dashLog('🎨 Generating GitHub profile README...');
  
  // Load config
  const configPath = path.join(__dirname, 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  
  if (config.github.username === 'YOUR_GITHUB_USERNAME') {
    await dashLog('⚠️  Please update config.json with your GitHub username', 'warn');
    await completeDashboard('Config not set up');
    return;
  }
  
  // Generate README
  const readme = await generateProfileReadme(config);
  
  // Save to profile repo (if exists locally)
  const profileRepoPath = path.join('C:\\dev', config.github.profileRepo);
  
  try {
    const readmePath = path.join(profileRepoPath, 'README.md');
    await fs.writeFile(readmePath, readme);
    await dashLog(`✅ Updated ${readmePath}`, 'success');
    await dashLog('\n💡 Commit and push the changes to see it on your profile!', 'info');
    await completeDashboard('Profile README generated successfully');
  } catch (err) {
    await dashLog(`⚠️  Could not write to profile repo: ${err.message}`, 'warn');
    
    // Write to current directory instead
    const fallbackPath = path.join(__dirname, 'PROFILE-README.md');
    await fs.writeFile(fallbackPath, readme);
    await dashLog(`📝 Saved to ${fallbackPath} instead`, 'info');
    await dashLog('\nℹ️  Clone your GitHub profile repo to C:\\dev to auto-update', 'info');
    await completeDashboard('Generated to fallback location');
  }
}

main().catch(console.error);
