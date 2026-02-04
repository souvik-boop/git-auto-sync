# Git Auto-Sync + GitHub Profile Beautifier

Automatically sync your local git repositories and keep your GitHub profile looking fresh! 🚀

## Features

### 🔄 Git Auto-Sync
- Scans configured directories for git repositories
- Auto-commits changes with timestamp
- Pushes to remote
- Dashboard integration with live progress
- Dry-run mode for testing

### 🎨 GitHub Profile Generator
- Generates beautiful README for your GitHub profile
- Includes stats, activity graphs, trophies
- Auto-updated timestamp
- Customizable tech stack badges

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure

Edit `config.json`:

```json
{
  "searchDirs": [
    "C:\\dev",
    "C:\\Users\\YOUR_USER\\.openclaw\\workspace"
  ],
  "github": {
    "username": "your-github-username",
    "profileRepo": "your-github-username"
  }
}
```

### 3. Set Up GitHub Profile Repo

1. Create a GitHub repository with the **same name as your username**
   - Example: If your username is `johndoe`, create repo `johndoe`
2. Clone it to `C:\dev\your-username`
3. Run the profile generator (it will create/update README.md)

## Usage

### Sync All Repos

```bash
npm run sync
```

### Update GitHub Profile

```bash
npm run profile
```

### Do Both

```bash
npm run all
```

### Dry Run (test without committing)

Edit `config.json` and set `"dryRun": true`

## Automation

### Daily Auto-Sync with OpenClaw

The cron job will be set up to run daily at 2 AM:
- Syncs all git repos
- Updates GitHub profile
- Shows results on dashboard

## Dashboard

When running, check http://localhost:3737 to see:
- Live progress of repos being synced
- Success/failure status
- Summary of changes

## Customization

### Commit Message

Edit `config.json`:
```json
"commitMessage": "🤖 Auto-sync: {date}"
```

`{date}` will be replaced with current date.

### Tech Stack Badges

Edit `update-profile.js` and modify the badges section with your technologies.

### Recent Projects

Manually edit the generated README to add your featured projects.

## Tips

- Run `npm run sync` with `dryRun: true` first to see what would change
- Keep sensitive repos in excluded directories
- GitHub profile updates may take a few minutes to reflect

## Troubleshooting

**"Failed to push"**
- Make sure you have git credentials configured
- Check if remote exists: `git remote -v`

**"Not a git repo"**
- Make sure directories have been `git init`'d
- Check if `.git` folder exists

**Profile README not showing**
- Repo must be named exactly your username
- Must be public
- README.md must be in root
