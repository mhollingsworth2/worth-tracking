# Merge & Setup — One Command

Run this from the root of the repository to merge all three PRs and complete setup automatically.

## Prerequisites

Install the [GitHub CLI](https://cli.github.com) and authenticate:

```bash
# macOS
brew install gh

# Linux / WSL
sudo apt install gh          # Debian/Ubuntu
# or: https://github.com/cli/cli/blob/trunk/docs/install_linux.md

# Authenticate
gh auth login
```

`curl` and `jq` are also required (both are pre-installed on most systems).

## One-Command Run

```bash
chmod +x scripts/auto-setup.sh && ./scripts/auto-setup.sh
```

That's it. The script will prompt you for your Railway app URL if it isn't already set as an environment variable.

### Optional — skip the prompt

If you know your Railway URL ahead of time, export it first:

```bash
export RAILWAY_PUBLIC_DOMAIN="https://your-app.up.railway.app"
./scripts/auto-setup.sh
```

## What the Script Does

| Step | Action |
|------|--------|
| 1 | Checks that `gh`, `curl`, and `jq` are installed and that `gh` is authenticated |
| 2 | Detects the GitHub repository automatically from your local git config |
| 3 | Merges PR #1, #2, and #3 using `gh pr merge --squash` |
| 4 | Polls your Railway URL every 10 seconds (up to 5 minutes) until the deployment is live |
| 5 | Runs `scripts/setup.sh` if it exists |
| 6 | Runs `scripts/health-check.sh` (or an inline health check if the file doesn't exist yet) |
| 7 | Prints a summary and next steps |

## After the Script Finishes

1. Open your Railway URL in a browser
2. Log in with the default admin credentials:
   - **Username:** `admin`
   - **Password:** `worthcreative2026`
3. **Change the admin password immediately**
4. Add your first business and configure AI API keys under Settings

## Troubleshooting

### `gh: command not found`
Install the GitHub CLI: <https://cli.github.com>

### `gh auth status` fails
Run `gh auth login` and follow the prompts to authenticate with your GitHub account.

### PR merge fails with "review required"
The repository may have branch protection rules that require an approved review before merging. Approve the PRs in the GitHub UI first, then re-run the script — it will skip already-merged PRs and continue from where it left off.

### Deployment never becomes healthy
- Check the Railway dashboard for build or runtime errors.
- Make sure a volume is mounted at `/data` for SQLite persistence.
- Verify the `DATA_DIR=/data` environment variable is set in Railway.

### Script exits with a non-zero status
Re-run the script — it is safe to run multiple times. Already-merged PRs are detected and skipped automatically.
