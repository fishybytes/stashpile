#!/bin/bash
set -e
exec > >(tee /var/log/userdata.log | logger -t userdata) 2>&1

echo "=== stashpile backend bootstrap ==="

# ─── System ───────────────────────────────────────────────────────────────────
dnf update -y
dnf install -y python3.11 python3.11-pip nginx

# ─── App user + directories ───────────────────────────────────────────────────
useradd -m -s /bin/bash stashpile
mkdir -p /opt/stashpile/api /var/lib/stashpile
chown -R stashpile:stashpile /opt/stashpile /var/lib/stashpile

# ─── Python deps ──────────────────────────────────────────────────────────────
# CPU-only torch first (190MB vs 530MB for the CUDA build)
pip3.11 install torch --index-url https://download.pytorch.org/whl/cpu
pip3.11 install \
  "sentence-transformers" \
  fastapi \
  "uvicorn[standard]" \
  pydantic-settings

# ─── Write env file ───────────────────────────────────────────────────────────
cat > /opt/stashpile/.env <<EOF
DB_PATH=/var/lib/stashpile/stashpile.db
ENVIRONMENT=${environment}
EOF
chown stashpile:stashpile /opt/stashpile/.env
chmod 600 /opt/stashpile/.env

# ─── systemd service ──────────────────────────────────────────────────────────
cat > /etc/systemd/system/stashpile-api.service <<EOF
[Unit]
Description=stashpile backend API
After=network.target

[Service]
User=stashpile
WorkingDirectory=/opt/stashpile/api
EnvironmentFile=/opt/stashpile/.env
ExecStart=/usr/bin/python3.11 -m uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# ─── Deploy script (called by SSM on each code push) ─────────────────────────
cat > /usr/local/bin/stashpile-backend-deploy <<DEPLOY
#!/bin/bash
set -e
aws s3 sync s3://${sync_bucket}/apps/backend/ /opt/stashpile/api/ --delete
chown -R stashpile:stashpile /opt/stashpile/api
systemctl restart stashpile-api
DEPLOY
chmod +x /usr/local/bin/stashpile-backend-deploy

systemctl daemon-reload
systemctl enable stashpile-api

# ─── nginx ────────────────────────────────────────────────────────────────────
# SSL terminates at CloudFront; nginx proxies HTTP from CloudFront to uvicorn.
cat > /etc/nginx/conf.d/stashpile-api.conf <<EOF
server {
    listen 80 default_server;

    location / {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }
}
EOF

systemctl enable nginx
systemctl start nginx

echo "=== Bootstrap complete ==="
