# GitHub Deployment Guide

## Overview
Second Brain is now a Git repository. Follow this guide to push to GitHub and manage deployments securely.

## Prerequisites

1. **Git installed**: https://git-scm.com/download
2. **GitHub account**: https://github.com/signup
3. **SSH key configured** (recommended) or GitHub token

## Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. **Repository name**: `2ndbrain-v2` (or your preferred name)
3. **Description**: "Second Brain - Open-source student productivity app"
4. **Visibility**: Choose Public or Private
5. **Initialize**: Do NOT initialize with README (we have one)
6. Click "Create repository"

## Step 2: Add Remote & Push

```bash
# Navigate to project folder
cd "d:\all project name\2nd brain\2ndbrain-v2\2ndbrain-v2"

# Add GitHub as remote (replace USERNAME/REPO)
git remote add origin https://github.com/USERNAME/2ndbrain-v2.git

# Or use SSH (if configured)
git remote add origin git@github.com:USERNAME/2ndbrain-v2.git

# Verify remote
git remote -v

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 3: Verify on GitHub

- Open https://github.com/USERNAME/2ndbrain-v2
- Check files are there
- Verify `.gitignore` is working (no secrets exposed)

## GitHub Security Best Practices

### ✅ Enable Branch Protection

1. Go to Settings → Branches
2. Add rule for `main` branch:
   - ✓ Require pull request reviews
   - ✓ Dismiss stale reviews
   - ✓ Require status checks
   - ✓ Require branches to be up to date

### ✅ Set Up Secret Scanning

1. Settings → Security → Secret scanning
2. Enable: "Push protection"
3. This prevents accidental credential commits

### ✅ Require Signed Commits

```bash
# Generate GPG key (optional but recommended)
gpg --gen-key

# Configure git to sign commits
git config --global user.signingkey YOUR_KEY_ID
git config --global commit.gpgsign true
```

### ✅ Set Repository Visibility

- Private for internal team
- Public for open-source (mask sensitive URLs)

## Managing Secrets

### What to NEVER commit:
- API keys (Gemini, Groq, etc.)
- Firebase service account keys
- Admin credentials
- Database passwords
- Private GitHub tokens

### Use GitHub Secrets for CI/CD

1. Settings → Secrets and variables → Actions
2. Add secrets needed for deployment:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_PRIVATE_KEY`
   - `ADMIN_EMAIL`

Example in workflow:
```yaml
- name: Deploy to Firebase
  env:
    FIREBASE_PROJECT_ID: ${{ secrets.FIREBASE_PROJECT_ID }}
  run: firebase deploy
```

## Deployment Workflow

### Development Branch
```bash
# Create feature branch
git checkout -b feature/your-feature

# Make changes, commit
git add .
git commit -m "feat: Add new feature"

# Push to GitHub
git push origin feature/your-feature

# Create Pull Request on GitHub
# → Review → Merge to main
```

### Production Deployment

1. **Merge to main branch**: Via Pull Request
2. **Tag release**: 
   ```bash
   git tag -a v1.0.0 -m "Version 1.0.0 - Release"
   git push origin v1.0.0
   ```
3. **Deploy to Firebase**: 
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy
   ```

## Continuous Integration (Optional)

### GitHub Actions Example

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy to Firebase

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to Firebase
        run: |
          npm install -g firebase-tools
          firebase deploy --token ${{ secrets.FIREBASE_TOKEN }}
```

## Git Best Practices

### 1. Commit Messages
```
feat: Add new feature description
fix: Fix bug description
docs: Update documentation
style: Format changes
refactor: Code restructuring
chore: Maintenance tasks
```

### 2. Keep History Clean
```bash
# Amend last commit
git commit --amend

# Interactive rebase (last 3 commits)
git rebase -i HEAD~3

# Never force push to main!
git push --force-with-lease  # Only if absolutely necessary
```

### 3. Code Review Checklist
- [ ] No secrets committed
- [ ] Tests passing
- [ ] Documentation updated
- [ ] Security implications considered
- [ ] Performance impact reviewed

## Disaster Recovery

### If Secrets Accidentally Committed

```bash
# IMMEDIATELY:
1. Rotate compromised credentials
2. Remove from GitHub history

# Use BFG Repo Cleaner
git clone --mirror https://github.com/USERNAME/2ndbrain-v2.git
bfg --delete-files "secret.key" 2ndbrain-v2.git/
cd 2ndbrain-v2.git
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --mirror

# Or use git-filter-branch (slower)
git filter-branch --tree-filter 'rm -f path/to/secret' HEAD
```

### Rollback Deployment
```bash
# Find previous working commit
git log --oneline

# Revert to previous commit
git revert COMMIT_HASH

# Or reset (careful!)
git reset --hard COMMIT_HASH
git push --force-with-lease origin main
```

## Maintaining Security

### Weekly
- [ ] Check for GitHub security alerts
- [ ] Review recent commits
- [ ] Verify branch protection rules

### Monthly
- [ ] Audit user access (Collaborators)
- [ ] Review protected branch rules
- [ ] Check for stale dependencies

### Quarterly
- [ ] Security audit of codebase
- [ ] Penetration testing
- [ ] Review and update SECURITY.md

## Collaboration Guidelines

### For Teams

1. **Invite collaborators**
   - Settings → Collaborators
   - Require pull requests for all changes

2. **Code owners** (`.github/CODEOWNERS`)
   ```
   * @lead-developer
   /admin/ @admin-lead
   /js/auth.js @security-team
   ```

3. **PR template** (`.github/pull_request_template.md`)
   ```markdown
   ## Changes
   - [ ] List changes

   ## Security Impact
   - No impact / Low / Medium / High

   ## Testing
   - [ ] Manual testing
   - [ ] Unit tests
   - [ ] Integration tests
   ```

## Useful GitHub Features

### 1. Issue Templates
Create `.github/ISSUE_TEMPLATE/bug_report.md`

### 2. Discussions
Enable GitHub Discussions for community Q&A

### 3. Wiki
Document architecture and deployment in Wiki

### 4. Projects
Use GitHub Projects for task management

## Monitoring & Alerts

### Set Up Notifications

1. GitHub → Settings → Notifications
2. Watch for:
   - Security alerts
   - Pull request reviews
   - Discussion mentions

### Enable Email Alerts
Settings → Notifications → Email preferences

## Troubleshooting

### Authentication Error
```bash
# Clear Git credentials
git credential-cache exit

# Re-authenticate
git push origin main
```

### Push Rejected
```bash
# Fetch latest changes
git fetch origin

# Rebase and push
git rebase origin/main
git push origin feature/your-feature
```

### Large Files
```bash
# Check file size
git ls-files -lS | head -10

# Use Git LFS for large files
git lfs install
git lfs track "*.psd"
```

## Resources

- [GitHub Docs](https://docs.github.com)
- [Git Best Practices](https://git-scm.com/book/en/v2)
- [Security Hardening](https://docs.github.com/en/code-security)

## Support

For issues or questions:
1. Check GitHub Issues
2. Review SECURITY.md
3. Consult Git documentation

---

**Last Updated**: May 13, 2026
**Maintained By**: Development Team
