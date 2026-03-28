#!/usr/bin/env bash
# setup-server.sh — one-time production server provisioning.
#
# Usage:
#   TEMPCHAT_HOST=root@<droplet-ip> bash scripts/setup-server.sh
#
# Runs remotely via SSH as root. Safe to re-run (idempotent where possible).
set -euo pipefail

HOST="${TEMPCHAT_HOST:?Set TEMPCHAT_HOST=root@<droplet-ip>}"
DOMAIN="${TEMPCHAT_DOMAIN:?Set TEMPCHAT_DOMAIN=api.yourdomain.com}"
ALLOWED_ORIGINS="${TEMPCHAT_ALLOWED_ORIGINS:?Set TEMPCHAT_ALLOWED_ORIGINS=https://app.yourdomain.com}"

CYAN='\033[0;36m'; RESET='\033[0m'
log() { echo -e "${CYAN}[setup-server]${RESET} $*"; }

log "Provisioning $HOST for domain $DOMAIN …"

ssh "$HOST" bash -s -- "$DOMAIN" "$ALLOWED_ORIGINS" << 'REMOTE'
set -euo pipefail
DOMAIN="$1"
ALLOWED_ORIGINS="$2"

# In case these value are empty, should throw error
if [ -z "$DOMAIN" ]; then echo "DOMAIN is empty"; exit 1; fi
if [ -z "$ALLOWED_ORIGINS" ]; then echo "ALLOWED_ORIGINS is empty"; exit 1; fi


echo "==> 1. System packages"
# DEBIAN_FRONTEND=noninteractive skips all UI prompts.
# -o Dpkg::Options::=... handles the specific config file choice.
export DEBIAN_FRONTEND=noninteractive

apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q ufw fail2ban unattended-upgrades nginx certbot python3-certbot-nginx redis-server

dpkg-reconfigure --priority=low unattended-upgrades || true

echo "==> 2. SSH hardening"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
# Ubuntu 24.04 uses ssh.service; reload both to be safe and compatible
systemctl reload ssh || systemctl reload sshd

echo "==> 3. Firewall (UFW)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> 4. Swap (512 MB)"
if [ ! -f /swapfile ]; then
  fallocate -l 512M /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
grep -q 'vm.swappiness=10' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
sysctl -p

echo "==> 5. Redis"
# 1. Create and permission directories first
mkdir -p /var/lib/redis
mkdir -p /var/log/redis
chown redis:redis /var/lib/redis
chown redis:redis /var/log/redis

# 2. Write the config
cat > /etc/redis/redis.conf << 'REDISCONF'
bind 127.0.0.1
protected-mode yes
port 6379

# Critical for Ubuntu 24.04 systemd
supervised systemd
daemonize no
logfile /var/log/redis/redis-server.log

# Memory & Persistence
maxmemory 200mb
maxmemory-policy allkeys-lru
notify-keyspace-events Ex
dir /var/lib/redis
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec
REDISCONF

# 3. FIX FILE PERMISSIONS
# If Redis can't read this file, the "control process" fails.
chown redis:redis /etc/redis/redis.conf
chmod 640 /etc/redis/redis.conf

# 4. Start the service
systemctl daemon-reload
systemctl enable redis-server
systemctl stop redis-server 2>/dev/null || true
sleep 1
systemctl start redis-server

# Wait until Redis is actually accepting connections (up to 30 s)
for i in $(seq 1 30); do
  redis-cli ping 2>/dev/null | grep -q PONG && break
  [ "$i" -eq 30 ] && { journalctl -u redis-server -n 30 --no-pager; exit 1; }
  sleep 1
done

echo "==> 6. tempchat system user + directory"
id tempchat &>/dev/null || useradd -r -s /bin/false tempchat
mkdir -p /opt/tempchat
chown -R tempchat:tempchat /opt/tempchat

echo "==> 6b. deploy user"
id deploy &>/dev/null || useradd -m -s /bin/bash deploy
mkdir -p /home/deploy/.ssh
if [ -f /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
  chown -R deploy:deploy /home/deploy/.ssh
  chmod 700 /home/deploy/.ssh
  chmod 600 /home/deploy/.ssh/authorized_keys
fi

cat > /etc/sudoers.d/deploy-tempchat << 'SUDOEOF'
deploy ALL=(root) NOPASSWD: /usr/bin/install -o tempchat -g tempchat -m 0755 /tmp/server /opt/tempchat/server
deploy ALL=(root) NOPASSWD: /usr/bin/install -o tempchat -g tempchat -m 0640 /tmp/.env.production /opt/tempchat/.env
deploy ALL=(root) NOPASSWD: /bin/rm /tmp/server
deploy ALL=(root) NOPASSWD: /bin/rm /tmp/.env.production
deploy ALL=(root) NOPASSWD: /bin/systemctl restart tempchat
deploy ALL=(root) NOPASSWD: /bin/systemctl is-active --quiet tempchat
deploy ALL=(root) NOPASSWD: /bin/journalctl -u tempchat -n 20 --no-pager
SUDOEOF
chmod 440 /etc/sudoers.d/deploy-tempchat

echo "==> 7. systemd service"
cat > /etc/systemd/system/tempchat.service << SVCEOF
[Unit]
Description=TempChat Go server
After=network.target redis-server.service

[Service]
Type=simple
User=tempchat
WorkingDirectory=/opt/tempchat
ExecStart=/opt/tempchat/server
Restart=on-failure
RestartSec=5
Environment=GIN_MODE=release
Environment=REDIS_ADDR=127.0.0.1:6379
Environment=PORT=8080
Environment=ALLOWED_ORIGINS=${ALLOWED_ORIGINS}
Environment=GOMAXPROCS=1

[Install]
WantedBy=multi-user.target
SVCEOF
systemctl daemon-reload
systemctl enable tempchat

echo "==> 8. Nginx — global config"
cat > /etc/nginx/nginx.conf << 'NGINXMAIN'
user www-data;
worker_processes 1;
pid /run/nginx.pid;
include /etc/nginx/modules-enabled/*.conf;

events {
    worker_connections 1024;
}

http {
    sendfile on;
    tcp_nopush on;
    types_hash_max_size 2048;
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;
    gzip on;

    limit_req_zone  $binary_remote_addr  zone=api:10m  rate=20r/s;
    limit_conn_zone $binary_remote_addr  zone=ws:10m;

    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
NGINXMAIN

# Step 8a: HTTP-only config so nginx starts cleanly before certs exist.
# certbot --nginx will add the SSL stanza itself.
# Use printf to avoid nested-heredoc variable expansion issues.
printf 'server {\n    listen 80;\n    server_name %s;\n\n    location /v1/health {\n        proxy_pass http://127.0.0.1:8080;\n    }\n\n    location /v1/ {\n        proxy_pass         http://127.0.0.1:8080;\n        proxy_http_version 1.1;\n        proxy_set_header   Upgrade    $http_upgrade;\n        proxy_set_header   Connection $http_connection;\n        proxy_set_header   Host       $host;\n        proxy_set_header   X-Real-IP  $remote_addr;\n        proxy_read_timeout 604800s;\n        proxy_send_timeout 604800s;\n        client_max_body_size 4k;\n        limit_req  zone=api burst=40 nodelay;\n        limit_conn ws 10;\n    }\n}\n' "${DOMAIN}" > /etc/nginx/sites-available/tempchat

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/tempchat /etc/nginx/sites-enabled/tempchat
nginx -t
systemctl reload nginx

echo "==> 9. TLS certificate (certbot)"
# certbot --nginx edits the site config to add SSL + redirect automatically.
certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email \
  -d "${DOMAIN}"

# Step 9b: Append security headers to the SSL server block certbot created.
# certbot adds the SSL server block at the end of the file; we patch it in place.
python3 - "${DOMAIN}" << 'PYEOF'
import sys, re

domain = sys.argv[1]
path = f"/etc/nginx/sites-available/tempchat"
text = open(path).read()

headers = """
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff"                             always;
    add_header X-Frame-Options           "DENY"                                always;
    add_header Referrer-Policy           "no-referrer"                         always;
"""

# Insert headers after the ssl_certificate_key line in the SSL block
patched = re.sub(
    r'(ssl_certificate_key [^\n]+;\n)',
    r'\1' + headers,
    text,
    count=1
)

if patched == text:
    print("WARNING: could not insert security headers — add manually")
else:
    open(path, 'w').write(patched)
    print("Security headers added to SSL block.")
PYEOF

nginx -t
systemctl reload nginx

echo ""
echo "==> Setup complete. Run 'make deploy-be' to push the first binary."
echo "    Then: journalctl -u tempchat -f"
REMOTE

log "Done. Server provisioned at $HOST"
