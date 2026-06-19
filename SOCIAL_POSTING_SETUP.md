# Social Media Posting Automation Setup

## 🚀 Getting Started

The social media posting system is now ready. To activate it, add the following secrets to your GitHub repository.

**⚠️ SECURITY WARNING:** Never commit these credentials to the repository. Always use GitHub Secrets.

## Step 1: Add GitHub Secrets

Go to: **Settings → Secrets and variables → Actions → New repository secret**

Add each of the following secrets:

### 1. Anthropic API Key
**Name:** `ANTHROPIC_API_KEY`
**Value:** Your Anthropic API key (starts with `sk-ant-api03-...`)

### 2. Twitter/X Bearer Token
**Name:** `TWITTER_BEARER_TOKEN`
**Value:** Your Twitter API v2 Bearer token

### 3. Bluesky Username
**Name:** `BLUESKY_USERNAME`
**Value:** Your Bluesky account email/identifier

### 4. Bluesky App Password
**Name:** `BLUESKY_PASSWORD`
**Value:** Your Bluesky app password (from Settings → App passwords)

## Step 2: Verify Installation

The workflow is configured to run:
- **07:00 UTC** (08:00 CET / 09:00 CEST) - Morning
- **13:00 UTC** (14:00 CET / 15:00 CEST) - Afternoon  
- **19:00 UTC** (20:00 CET / 21:00 CEST) - Evening

You can test manually by:
1. Going to **Actions → Post to Social Media (3x Daily)**
2. Click **Run workflow**

## How It Works

1. **Blog Selection**: Randomly selects from published blogs
2. **Teasing Copy**: Claude generates engaging, clickable copy
3. **Multi-platform**: Posts to both X (Twitter) and Bluesky
4. **State Tracking**: Avoids posting the same blog twice per day
5. **Link**: Always includes the blog URL (zenbtw.nl/blog/...)

## Monitoring

- Check workflow runs in **Actions → Post to Social Media (3x Daily)**
- Failed posts will show detailed error messages
- State is tracked in `.social-post-state.json`

## Customization

### Change posting times
Edit `.github/workflows/post-social-daily.yml` and modify the cron expressions:
```yaml
- cron: '0 7 * * *'   # Change the hour (first 0)
- cron: '0 13 * * *'
- cron: '0 19 * * *'
```

### Change prompt/copy style
Edit `scripts/post-to-social.js` in the `generateTeasingCopy()` function to modify Claude's prompt.

### Add media/screenshots
Set `SCREENSHOTS_ENABLED=true` in the workflow (requires Puppeteer setup).

## Troubleshooting

**"TWITTER_BEARER_TOKEN missing"**
- Verify the secret is added correctly in GitHub Settings

**"Bluesky login error"**
- Check username/app password are correct
- Ensure app password is enabled in Bluesky settings

**"No blog posts found"**
- Ensure blog `.html` files exist in `/blog` directory
- Check file naming (must be `.html` extension)

## Files

- `scripts/post-to-social.js` - Main posting script
- `.github/workflows/post-social-daily.yml` - Scheduling workflow
- `.social-post-state.json` - Tracks posted blogs (generated at runtime)
