# Deploying Reclipper on Oracle Cloud Free Tier

This runs the backend on a **free, always-on** Oracle Cloud ARM server
(4 cores / 24 GB RAM / 200 GB disk). The frontend stays on Vercel.

Total cost: **$0/month**. Comfortably handles 10–15 users.

---

## Part 1 — Create the free Oracle server (~15 min)

1. Sign up at <https://www.oracle.com/cloud/free/>. You need a card for
   identity verification, but the "Always Free" resources are never charged.
2. In the Oracle Cloud console: **Menu → Compute → Instances → Create Instance**.
3. Configure:
   - **Image**: Ubuntu 22.04 (Canonical Ubuntu)
   - **Shape**: click *Change Shape* → **Ampere** → `VM.Standard.A1.Flex`
     → set **4 OCPUs** and **24 GB RAM** (all free)
   - **Networking**: keep "Assign a public IPv4 address" checked
   - **SSH keys**: click *Save private key* and keep the downloaded file safe
4. Click **Create**. When it's running, copy the **Public IP address**.

> If you get "Out of host capacity", pick a different Availability Domain
> in the create screen, or try again later — it's a known free-tier quirk.

### Open the firewall (ports 80 + 443)

1. On the instance page → **Virtual Cloud Network** → **Security Lists** →
   **Default Security List** → **Add Ingress Rules**:
   - Source `0.0.0.0/0`, IP Protocol **TCP**, Destination port **80**
   - Source `0.0.0.0/0`, IP Protocol **TCP**, Destination port **443**
2. Save.

---

## Part 2 — Point your domain at the server

In your domain registrar's DNS settings for `clippar.online`, add an **A record**:

| Type | Name | Value |
|------|------|-------|
| A    | `api`  | *your server's public IP* |

This makes `api.clippar.online` resolve to your server. (Wait a few minutes
for it to take effect — you can check with `ping api.clippar.online`.)

---

## Part 3 — Install Docker and deploy (~10 min)

1. SSH into the server (from your computer's terminal):
   ```bash
   ssh -i /path/to/your-private-key ubuntu@YOUR_SERVER_IP
   ```

2. Install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker ubuntu
   newgrp docker
   ```

3. Clone the repo and enter it:
   ```bash
   git clone https://github.com/Ajaykant24/reclippernodejs.git
   cd reclippernodejs
   ```

4. Create your secrets file:
   ```bash
   cp deploy.env.example deploy.env
   nano deploy.env
   ```
   Fill in your real `GEMINI_API_KEY`. Confirm `API_DOMAIN=api.clippar.online`
   and that `CORS_ORIGINS` lists your Vercel URL. Save with `Ctrl+O`, `Enter`,
   then exit with `Ctrl+X`.

5. Launch it:
   ```bash
   docker compose --env-file deploy.env up -d --build
   ```
   The first build takes a few minutes (installing FFmpeg). Caddy will
   automatically fetch an HTTPS certificate for `api.clippar.online`.

6. Verify it's live:
   ```bash
   curl https://api.clippar.online/health
   ```
   You should see `{"status":"ok"}`.

---

## Part 4 — Point the frontend at the new backend

1. In **Vercel → your project → Settings → Environment Variables**, set:
   ```
   VITE_API_URL = https://api.clippar.online
   ```
2. Redeploy the frontend (Vercel → Deployments → Redeploy), or push any commit.

Done. Your app now runs on a free, always-on server.

---

## Everyday commands

```bash
cd reclippernodejs

# See logs
docker compose --env-file deploy.env logs -f api

# Update after pushing new code
git pull
docker compose --env-file deploy.env up -d --build

# Restart
docker compose --env-file deploy.env restart

# Stop
docker compose --env-file deploy.env down
```

Your data (accounts, projects, clips) is in the `reclipper-data` Docker
volume and is **not** deleted by `down`, rebuilds, or reboots. To back it up:

```bash
docker run --rm -v reclippernodejs_reclipper-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/reclipper-backup.tar.gz -C /data .
```
