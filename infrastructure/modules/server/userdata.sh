#!/bin/bash
set -e

# Install Node.js 22 + AWS CLI
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
yum install -y nodejs aws-cli

# Install Expo CLI globally
npm install -g expo-cli

# Prepare app directory
mkdir -p /srv/stashpile/apps/mobile
chown -R ec2-user:ec2-user /srv/stashpile

# Create systemd service
cat > /etc/systemd/system/expo-dev.service <<'EOF'
[Unit]
Description=Expo Metro Bundler
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/srv/stashpile/apps/mobile
ExecStart=/usr/bin/npx expo start --lan --port 8081
Restart=on-failure
Environment=NODE_ENV=development
Environment=CI=1

[Install]
WantedBy=multi-user.target
EOF

# Deploy script — called by SSM send-command on each deploy
cat > /usr/local/bin/stashpile-deploy <<DEPLOY
#!/bin/bash
set -e
aws s3 sync s3://${bucket_name}/apps/mobile/ /srv/stashpile/apps/mobile/ --delete
cd /srv/stashpile/apps/mobile
npm install --prefer-offline
systemctl restart expo-dev
DEPLOY

chmod +x /usr/local/bin/stashpile-deploy
chown ec2-user:ec2-user /usr/local/bin/stashpile-deploy

systemctl daemon-reload
systemctl enable expo-dev
