#!/bin/bash
set -e
exec > >(tee /var/log/userdata.log | logger -t userdata) 2>&1

echo "=== stashpile backend bootstrap ==="

# ─── System ───────────────────────────────────────────────────────────────────
dnf update -y
dnf install -y python3.11 python3.11-pip nginx postgresql15-server certbot python3-certbot-nginx

# ─── Postgres ─────────────────────────────────────────────────────────────────
postgresql-setup --initdb
systemctl enable postgresql
systemctl start postgresql

DB_PASSWORD=$(aws ssm get-parameter \
  --name "/stashpile/${environment}/db-password" \
  --with-decryption \
  --query "Parameter.Value" \
  --output text \
  --region us-east-1)

sudo -u postgres psql <<SQL
  CREATE DATABASE stashpile;
  CREATE USER stashpile WITH PASSWORD '$DB_PASSWORD';
  GRANT ALL PRIVILEGES ON DATABASE stashpile TO stashpile;
  ALTER DATABASE stashpile OWNER TO stashpile;
SQL

# ─── App user + directories ───────────────────────────────────────────────────
useradd -m -s /bin/bash stashpile
mkdir -p /opt/stashpile/api
chown -R stashpile:stashpile /opt/stashpile

# ─── Python deps ──────────────────────────────────────────────────────────────
# sentence-transformers downloads the model on first use (~90MB)
pip3.11 install \
  fastapi \
  "uvicorn[standard]" \
  sqlalchemy \
  psycopg2-binary \
  sentence-transformers \
  apscheduler \
  httpx \
  pydantic-settings

# ─── Write DB connection env file ─────────────────────────────────────────────
cat > /opt/stashpile/.env <<EOF
DATABASE_URL=postgresql://stashpile:$DB_PASSWORD@localhost/stashpile
ENVIRONMENT=${environment}
API_DOMAIN=${api_domain}
EOF
chown stashpile:stashpile /opt/stashpile/.env
chmod 600 /opt/stashpile/.env

# ─── systemd service ──────────────────────────────────────────────────────────
cat > /etc/systemd/system/stashpile-api.service <<EOF
[Unit]
Description=stashpile backend API
After=network.target postgresql.service

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

systemctl daemon-reload
systemctl enable stashpile-api

# ─── nginx ────────────────────────────────────────────────────────────────────
cat > /etc/nginx/conf.d/stashpile-api.conf <<EOF
server {
    listen 80;
    server_name ${api_domain};

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

# ─── SSL cert ─────────────────────────────────────────────────────────────────
# Runs after DNS has propagated and is pointing to this IP.
# Re-run manually once DNS is live:
#   certbot --nginx -d ${api_domain} --non-interactive --agree-tos -m ${admin_email}
#
# Auto-renewal is handled by certbot's systemd timer (installed with the package).

echo "=== Bootstrap complete ==="
echo "Next step: once DNS is pointing here, run:"
echo "  certbot --nginx -d ${api_domain} --non-interactive --agree-tos -m ${admin_email}"
