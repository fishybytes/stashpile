#!/bin/bash
set -e
exec > >(tee /var/log/userdata.log | logger -t userdata) 2>&1

echo "=== stashpile backend bootstrap ==="

# ─── System ───────────────────────────────────────────────────────────────────
dnf update -y
dnf install -y python3.11 python3.11-pip nginx postgresql15-server

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

# Use md5 auth for TCP connections (default ident auth rejects password-based connections)
sed -i "s/host    all             all             127.0.0.1\/32            ident/host    all             all             127.0.0.1\/32            md5/" /var/lib/pgsql/data/pg_hba.conf
sed -i "s/host    all             all             ::1\/128                 ident/host    all             all             ::1\/128                 md5/" /var/lib/pgsql/data/pg_hba.conf
systemctl reload postgresql

# ─── App user + directories ───────────────────────────────────────────────────
useradd -m -s /bin/bash stashpile
mkdir -p /opt/stashpile/api
chown -R stashpile:stashpile /opt/stashpile

# ─── Python deps ──────────────────────────────────────────────────────────────
# CPU-only torch first (190MB vs 530MB for the CUDA build)
pip3.11 install torch --index-url https://download.pytorch.org/whl/cpu
# sentence-transformers and the rest of the API dependencies
pip3.11 install \
  "sentence-transformers" \
  fastapi \
  "uvicorn[standard]" \
  psycopg2-binary \
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
# SSL terminates at CloudFront; nginx just proxies HTTP from CloudFront to uvicorn.
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
