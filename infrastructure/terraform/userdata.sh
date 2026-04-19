#!/bin/bash
set -e

# Install Node.js 22
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
yum install -y nodejs git

# Install Expo CLI globally
npm install -g expo-cli eas-cli

# Clone repo
mkdir -p /srv/stashpile
git clone ${repo_url} /srv/stashpile || true

# Install app deps
cd /srv/stashpile/apps/mobile
npm install

# Create systemd service so expo starts on boot
cat > /etc/systemd/system/expo-dev.service <<'EOF'
[Unit]
Description=Expo Metro Bundler
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/srv/stashpile/apps/mobile
ExecStartPre=/usr/bin/git -C /srv/stashpile pull
ExecStart=/usr/bin/npx expo start --lan --port 8081
Restart=on-failure
Environment=NODE_ENV=development
Environment=CI=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable expo-dev
