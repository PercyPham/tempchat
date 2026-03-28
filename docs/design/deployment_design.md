# TempChat — Deployment Guide

## Table of contents

1. [Production deployment](#1-production-deployment)
2. [Cost summary](#2-cost-summary)
3. [Capacity reference](#3-capacity-reference)
4. [Nginx configuration](#4-nginx-configuration)
5. [TLS with Let's Encrypt](#5-tls-with-lets-encrypt)
6. [Hardening checklist](#6-hardening-checklist)

---

## 1. Production deployment

### Droplet spec

| Setting  | Value                               |
| -------- | ----------------------------------- |
| Provider | DigitalOcean                        |
| Region   | Singapore (SGP1)                    |
| Plan     | Basic — 1 vCPU, 1 GB RAM, 25 GB SSD |
| OS       | Ubuntu 24.04 LTS                    |
| Services | Nginx, Go binary (systemd), Redis   |

### Memory layout

| Component        | Budget       | Notes                                         |
| ---------------- | ------------ | --------------------------------------------- |
| OS + Nginx       | ~150 MB      | Stable baseline                               |
| Go binary (idle) | ~30 MB       | Grows ~8 KB per active WebSocket goroutine    |
| Redis            | 200 MB       | Hard cap via `maxmemory`                      |
| Go heap buffer   | ~644 MB      | Available for goroutine stacks and runtime GC |
| **Total**        | **~1024 MB** |                                               |

### Traffic flow

```
Browser
  │  wss://api.yourdomain.com/v1/rooms/:roomId/ws  (port 443, TLS)
  │  https://api.yourdomain.com/v1/                (port 443, TLS)
  ▼
Nginx  ←  TLS termination
  │  ws://127.0.0.1:8080/v1/rooms/:roomId/ws       (internal only)
  │  http://127.0.0.1:8080/v1/                     (internal only)
  ▼
Go (Gin)  ←  127.0.0.1:8080
  │
  ▼
Redis  ←  127.0.0.1:6379
```

### Step 1 — Initial system setup

```bash
apt update && apt upgrade -y
apt install -y ufw fail2ban unattended-upgrades
```

Enable automatic security patches:

```bash
dpkg-reconfigure --priority=low unattended-upgrades
# Accept the defaults — this enables automatic security updates only.
```

### Step 2 — SSH hardening

Edit `/etc/ssh/sshd_config`:

```
 PasswordAuthentication no
 PermitRootLogin no
```

Restart SSH and verify you can still log in with your key before closing the session:

```bash
systemctl restart sshd
```

fail2ban ships with an SSH jail enabled by default on Ubuntu. Verify it is active:

```bash
fail2ban-client status sshd
```

### Step 3 — Firewall (UFW)

Allow only the three ports the server needs; deny everything else:

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP → HTTPS redirect
ufw allow 443/tcp    # HTTPS + WSS
ufw enable
ufw status
```

### Step 4 — Swap

A 512 MB swap file acts as a safety net against OOM kills during traffic spikes. It does not increase throughput — it buys time to notice a memory leak before the process crashes.

```bash
fallocate -l 512M /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Use swap only as a last resort, not for routine paging.
echo 'vm.swappiness=10' >> /etc/sysctl.conf
sysctl -p
```

### Step 5 — Redis

Redis must only bind to localhost — never expose it publicly:

```bash
# /etc/redis/redis.conf

bind 127.0.0.1

# Increased from 128mb — safe given the memory layout above.
# Leaves ~644 MB for the Go process.
maxmemory 200mb
maxmemory-policy allkeys-lru

# Required for room expiry cleanup (keyspace notifications).
notify-keyspace-events Ex

# --- Persistence ---

# RDB snapshots — point-in-time backup to disk.
# Snapshot if at least N keys changed within the given interval.
# These three rules cover idle servers, moderate traffic, and bursts.
dir /var/lib/redis
save 900 1
save 300 10
save 60 10000
rdbcompression yes
rdbfilename dump.rdb

# AOF — append-only log for crash recovery between snapshots.
# everysec flushes to disk once per second — at most 1 second of data
# lost on a hard crash. "always" is too expensive on 1 vCPU.
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec

# Rewrite the AOF file when it doubles in size, but only if it has grown
# past 64 MB. This keeps the file from ballooning over time.
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
```

> **Disk impact**: the RDB snapshot for 200 MB of Redis data compresses to roughly 40–80 MB. The AOF file stays under ~200 MB between rewrites. Total persistence overhead is well under 500 MB on the 25 GB SSD.

> **Startup behaviour**: on restart Redis loads the AOF first (more complete) and falls back to the RDB if the AOF is absent or corrupt. Active rooms whose TTLs haven't expired will survive a reboot or crash automatically.

Ensure the data directory exists and is owned by the Redis user:

```bash
mkdir -p /var/lib/redis
chown redis:redis /var/lib/redis
```

Restart Redis after editing:

```bash
systemctl restart redis
```

Verify persistence is active:

```bash
redis-cli CONFIG GET save
redis-cli CONFIG GET appendonly
redis-cli INFO persistence   # check aof_enabled:1, rdb_last_bgsave_status:ok
```

### Step 6 — systemd service

Create a dedicated system user and place the compiled binary:

```bash
useradd -r -s /bin/false tempchat
mkdir -p /opt/tempchat
cp ./server /opt/tempchat/server
chown -R tempchat:tempchat /opt/tempchat
```

Create `/etc/systemd/system/tempchat.service`:

```ini
[Unit]
Description=TempChat Go server
After=network.target

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
Environment=ALLOWED_ORIGINS=https://app.yourdomain.com
Environment=GOMAXPROCS=1

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable tempchat
systemctl start tempchat
```

View live logs:

```bash
journalctl -u tempchat -f
```

---

## 2. Cost summary

| Item                              | Cost       |
| --------------------------------- | ---------- |
| Firebase Hosting                  | Free       |
| DigitalOcean Droplet (Go + Redis) | $6/mo      |
| Let's Encrypt TLS                 | Free       |
| **Total**                         | **~$6/mo** |

---

## 3. Capacity reference

Estimates based on the memory layout above (200 MB Redis, ~644 MB Go heap).
Per-room Redis cost assumes 512-byte encrypted message payloads.

| Tier                        | Redis cost / room | Redis limit (200 MB) | Go goroutine limit (~644 MB) | **Practical ceiling** |
| --------------------------- | ----------------- | -------------------- | ---------------------------- | --------------------- |
| Free (5 users, 50 events)   | ~37 KB            | ~5,400 rooms         | ~1,600 rooms                 | **~1,600 rooms**      |
| Plus (10 users, 100 events) | ~83 KB            | ~2,500 rooms         | ~800 rooms                   | **~800 rooms**        |
| Pro (50 users, 200 events)  | ~370 KB           | ~540 rooms           | ~160 rooms                   | **~160 rooms**        |

The practical ceiling is always the Go goroutine heap, not Redis — each active WebSocket connection costs a minimum of 8 KB of goroutine stack. Redis fills up first only for Pro-tier rooms.

The biggest single lever for increasing free-tier capacity is reducing encrypted message payload size. Halving the payload from 512 B to 256 B cuts per-room Redis cost by ~40% and meaningfully increases the Redis-side limit, though the goroutine ceiling remains the binding constraint.

---

## 4. Nginx configuration

Install Nginx:

```bash
apt update && apt install nginx -y
```

### Worker tuning (nginx.conf)

Set `worker_processes` to match the vCPU count, then add rate-limiting zones inside the existing `http { }` block in `/etc/nginx/nginx.conf`:

```nginx
worker_processes 1;        # 1 vCPU — no benefit from more workers

events {
    worker_connections 1024;
}

http {
    # Rate limiting: max 20 REST requests/second per IP, burst of 40.
    limit_req_zone  $binary_remote_addr  zone=api:10m  rate=20r/s;

    # Connection limiting: max 10 simultaneous WebSocket connections per IP.
    limit_conn_zone $binary_remote_addr  zone=ws:10m;

    # ... rest of existing http block
}
```

### Site config

Create `/etc/nginx/sites-available/tempchat`:

```nginx
server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options    "nosniff"                             always;
    add_header X-Frame-Options           "DENY"                                always;
    add_header Referrer-Policy           "no-referrer"                         always;

    # All /v1/ traffic — REST and WebSocket — proxied to Go.
    # Gin handles routing internally. Upgrade headers are safe to pass
    # for all requests; REST endpoints ignore them.
    location /v1/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        # Required for WebSocket upgrade handshake.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $http_connection;

        proxy_set_header Host       $host;
        proxy_set_header X-Real-IP  $remote_addr;

        # Must exceed the maximum room lifetime (pro tier = 7 days = 604800s).
        # Nginx default is 60s — it will silently kill idle WS connections.
        proxy_read_timeout 604800s;
        proxy_send_timeout 604800s;

        # Reject bodies larger than 4 KB (REST endpoints).
        client_max_body_size 4k;

        # Rate limiting — allow short bursts, queue excess, reject beyond that.
        limit_req  zone=api burst=40 nodelay;

        # Limit concurrent connections per IP (covers WebSocket).
        limit_conn ws 10;
    }

    # Health check — no rate limiting, no auth
    location /v1/health {
        proxy_pass http://127.0.0.1:8080;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

Enable the site and reload:

```bash
ln -s /etc/nginx/sites-available/tempchat /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

---

## 5. TLS with Let's Encrypt

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d api.yourdomain.com
```

Certbot edits the Nginx config automatically and installs a systemd timer for auto-renewal. Test renewal anytime with:

```bash
certbot renew --dry-run
```

---

## 6. Hardening checklist

Run through this after every fresh deployment:

- [ ] UFW enabled — only ports 22, 80, 443 open (`ufw status`)
- [ ] SSH password auth disabled (`grep PasswordAuthentication /etc/ssh/sshd_config`)
- [ ] fail2ban active for SSH (`fail2ban-client status sshd`)
- [ ] unattended-upgrades enabled (`systemctl status unattended-upgrades`)
- [ ] Swap file active (`swapon --show`)
- [ ] `vm.swappiness=10` set (`cat /proc/sys/vm/swappiness`)
- [ ] Redis bound to localhost only (`redis-cli CONFIG GET bind`)
- [ ] Redis `maxmemory` set to 200mb (`redis-cli CONFIG GET maxmemory`)
- [ ] Redis keyspace notifications on (`redis-cli CONFIG GET notify-keyspace-events`)
- [ ] Redis RDB snapshots enabled (`redis-cli CONFIG GET save`)
- [ ] Redis AOF enabled (`redis-cli CONFIG GET appendonly`)
- [ ] Redis persistence healthy (`redis-cli INFO persistence | grep -E 'aof_enabled|rdb_last_bgsave_status'`)
- [ ] `ALLOWED_ORIGINS` set correctly in systemd service
- [ ] `GIN_MODE=release` set in systemd service
- [ ] `GOMAXPROCS=1` set in systemd service
- [ ] Nginx `worker_processes 1` set (`nginx -T | grep worker_processes`)
- [ ] Nginx config valid (`nginx -t`)
- [ ] TLS certificate issued and auto-renewal configured (`certbot renew --dry-run`)
- [ ] Health check reachable (`curl https://api.yourdomain.com/v1/health`)
