#!/bin/bash
set -e
exec > >(tee /var/log/userdata.log | logger -t userdata) 2>&1

echo "=== stashpile backend bootstrap ==="

# ─── System ───────────────────────────────────────────────────────────────────
dnf update -y
dnf install -y python3.11 python3.11-pip nginx sqlite

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
# Restores DB from the S3 backup on first deploy (empty instance).
cat > /usr/local/bin/stashpile-backend-deploy <<DEPLOY
#!/bin/bash
set -e
aws s3 sync s3://${sync_bucket}/apps/backend/ /opt/stashpile/api/ --delete
chown -R stashpile:stashpile /opt/stashpile/api

if [ ! -f /var/lib/stashpile/stashpile.db ]; then
  if aws s3 ls "s3://${sync_bucket}/backups/db/latest.db" 2>/dev/null | grep -q latest.db; then
    echo "No local DB found — restoring from S3 backup..."
    aws s3 cp "s3://${sync_bucket}/backups/db/latest.db" /var/lib/stashpile/stashpile.db
    chown stashpile:stashpile /var/lib/stashpile/stashpile.db
    echo "DB restored."
  else
    echo "No S3 backup found — starting with empty DB."
  fi
fi

systemctl restart stashpile-api
DEPLOY
chmod +x /usr/local/bin/stashpile-backend-deploy

# ─── DB backup script ─────────────────────────────────────────────────────────
# Uses the SQLite online backup API (.backup) for a consistent snapshot.
# Keeps timestamped hourly copies for 7 days; always updates latest.db.
cat > /usr/local/bin/stashpile-db-backup <<BACKUPEOF
#!/bin/bash
set -e
DB=/var/lib/stashpile/stashpile.db
BUCKET="${sync_bucket}"
TIMESTAMP=\$(date -u +%Y-%m-%dT%H)
TMP=/tmp/stashpile-backup-\$\$.db

[ -f "\$DB" ] || { echo "No DB file, skipping backup."; exit 0; }

sqlite3 "\$DB" ".backup \$TMP"
aws s3 cp "\$TMP" "s3://\$BUCKET/backups/db/\$TIMESTAMP.db"
aws s3 cp "\$TMP" "s3://\$BUCKET/backups/db/latest.db"
rm -f "\$TMP"

# Delete snapshots older than 7 days
CUTOFF=\$(date -u -d '7 days ago' +%Y-%m-%d)
aws s3 ls "s3://\$BUCKET/backups/db/" | awk '{print \$4}' | grep -v '^latest' | while read key; do
  kdate=\$(echo "\$key" | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}')
  if [ -n "\$kdate" ] && [[ "\$kdate" < "\$CUTOFF" ]]; then
    aws s3 rm "s3://\$BUCKET/backups/db/\$key"
  fi
done

echo "DB backup complete: \$TIMESTAMP"
BACKUPEOF
chmod +x /usr/local/bin/stashpile-db-backup

# ─── Hourly backup timer ──────────────────────────────────────────────────────
cat > /etc/systemd/system/stashpile-db-backup.service <<EOF
[Unit]
Description=stashpile DB backup to S3

[Service]
Type=oneshot
User=stashpile
ExecStart=/usr/local/bin/stashpile-db-backup
EOF

cat > /etc/systemd/system/stashpile-db-backup.timer <<EOF
[Unit]
Description=Hourly stashpile DB backup

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable stashpile-api
systemctl enable --now stashpile-db-backup.timer

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
