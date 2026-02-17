# Baby Class Finder (VPS)

This script logs into `melodymagicmusic.opus1.io`, checks the Tuesday class, and sends a Pushover alert when availability is detected.

## What it checks
- Class: `Level 1 Tuesdays 10:00`
- Day filter: `Tuesday`
- Instructor/location are optional filters for clarity in alerts

## Local setup (for testing)
```bash
npm install
cp .env.example .env
# fill in .env values
npm run check
```

## Pushover
Create an app in Pushover and set:
- `PUSHOVER_APP_TOKEN`
- `PUSHOVER_USER_KEY`

## Alert behavior
Set `ALERT_MODE` in `.env`:
- `available` (default): alert only when available
- `always`: alert every run (useful for test runs)
- `test`: same as `always`
- `on-change`: alert when status changes
- `never`: disable alerts

## VPS deploy (DigitalOcean)
1. Create a Droplet (Ubuntu 22.04) and SSH in.
2. Install Node and Playwright:
```bash
sudo apt update
sudo apt install -y curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
npm -v
node -v

# Install Playwright deps
sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libx11-xcb1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpangocairo-1.0-0 libpango-1.0-0 libcairo2 libgtk-3-0
```
3. Copy this repo onto the VPS (git clone or scp).
4. Install dependencies:
```bash
cd baby-class-finder
npm install
```
5. Create `.env` on the VPS:
```bash
cp .env.example .env
nano .env
chmod 600 .env
```
Set `SCHEDULE_URL` to the direct booking URL (with your `serviceId`, `creditId`, and `clientId`) so the script can jump straight to the booking screen after login.
6. Install Playwright browsers:
```bash
npx playwright install chromium
```

## Cron (every 15 minutes)
```bash
crontab -e
```
Add:
```
*/15 * * * * cd /path/to/baby-class-finder && /usr/bin/node scripts/check-class.js >> /var/log/baby-class-finder.log 2>&1
```

## Troubleshooting
- Set `DEBUG=true` to capture `debug.png` on failures.
- Run `npm run check:headed` for a visible browser session during local debugging.
# automated-class-notifier
