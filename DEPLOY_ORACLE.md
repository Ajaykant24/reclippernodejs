# Complete Beginner Guide — Deploy Reclipper on Oracle Cloud Free

This guide takes you from zero to a live backend running 24/7 for **$0/month**.
Every single step is written out — nothing is skipped.

**What you'll end up with:**
- Backend running on Oracle's free server (4 cores, 24 GB RAM)
- Frontend on Vercel (already free)
- HTTPS automatically set up (no manual SSL config)
- All your videos and user data saved permanently

---

## Before You Start — What You Need

- An Oracle Cloud account (free — you already made this)
- Your domain (`clippar.online`) — access to DNS settings at your registrar
- Your Gemini API key (from Google AI Studio)
- A computer with a terminal (Mac: use Terminal app, Windows: use PowerShell)

---

## PART 1 — Create the Free Server on Oracle Cloud

### Step 1: Go to Create Instance

1. Log in at [cloud.oracle.com](https://cloud.oracle.com)
2. Click the **hamburger menu** (three lines, top-left)
3. Click **Compute** → **Instances**
4. Click the blue **Create instance** button

---

### Step 2: Basic Information section

- **Name**: Type `reclipper` (or leave default)
- **Availability domain**: Leave as **AD-1** for now
  - If you get "Out of capacity" later, come back and change to AD-2 or AD-3
- **Capacity type**: Select **On-demand capacity**
- Everything else in this section: leave default, skip past it

---

### Step 3: Image and Shape section — IMPORTANT

This is where you pick the free ARM server.

**Change the Image:**
1. Click **Change image**
2. Click **Ubuntu**
3. Select **Ubuntu 22.04**
4. Click **Select image** (blue button at bottom)

**Change the Shape:**
1. Click **Change shape**
2. Click **Ampere** tab (this is the free ARM tier)
3. Select **VM.Standard.A1.Flex**
4. Below the shape list, you'll see sliders for OCPU and Memory:
   - Set **Number of OCPUs** = `4`
   - Memory will automatically change to **24 GB**
5. Click **Select shape** (blue button at bottom)

> **Why this matters:** The default shape is paid. VM.Standard.A1.Flex with 4 OCPUs / 24 GB is Oracle's Always Free allocation. You will not be charged.

---

### Step 4: Networking section

1. You'll see a message about subnet — click **Create new virtual cloud network**
2. Oracle auto-fills everything — don't change any of it
3. Make sure **Assign a public IPv4 address** is switched **ON** (it should be by default)

---

### Step 5: SSH Keys section — CRITICAL, DO NOT SKIP

This key is how you log into your server. Without it you're locked out forever.

1. Select **Generate a key pair for me**
2. Click **Save private key** — a file ending in `.key` downloads to your computer
3. **Move this file somewhere safe** — your Desktop or a folder called "Oracle"
4. Remember where you saved it — you'll need it in Part 4

---

### Step 6: Everything else

- **Boot volume**: Leave all defaults, don't change anything
- **Cloud init script**: Leave blank
- **Advanced options**: Leave blank / skip
- **Security attributes**: Leave blank / skip

---

### Step 7: Create the Instance

1. Scroll to the very bottom
2. Click the **Create** button (blue, bottom right)
3. Wait about **2 minutes** — the status will change from "Provisioning" to **Running**
4. Once it says Running, look for **Public IP address** on the instance details page
5. **Copy and save this IP address** — you'll use it in the next steps

> Example IP: `158.101.45.123` (yours will be different)

---

## PART 2 — Open the Firewall

By default Oracle blocks all traffic. You need to allow ports 80 (HTTP) and 443 (HTTPS).

### Step 1: Get to the Security List

1. On your instance details page, scroll down to find **Primary VNIC**
2. Click the link under **Subnet** (something like `subnet-20240101-xxxx`)
3. On the subnet page, click **Default Security List for vcn-xxxx** (under Security Lists)
4. Click **Add Ingress Rules** button

### Step 2: Add Port 80

Fill in the form:
- **Source CIDR**: `0.0.0.0/0`
- **IP Protocol**: TCP
- **Destination Port Range**: `80`
- Click **+ Another Row**

### Step 3: Add Port 443

In the new row:
- **Source CIDR**: `0.0.0.0/0`
- **IP Protocol**: TCP
- **Destination Port Range**: `443`

### Step 4: Save

Click **Add Ingress Rules** (blue button at bottom)

---

## PART 3 — Point Your Domain at the Server

You need `api.clippar.online` to point to your Oracle server IP.

Go to wherever you bought/manage your domain (GoDaddy, Namecheap, Cloudflare, etc.) and add a DNS record:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `api` | `YOUR_SERVER_IP` | 300 |

Replace `YOUR_SERVER_IP` with the IP you copied in Part 1 Step 7.

**To verify it worked** (wait 5 minutes then run this on your computer):
```
ping api.clippar.online
```
You should see your server IP in the output.

---

## PART 4 — SSH Into the Server

This is how you connect to your server from your computer's terminal.

### On Mac or Linux (Terminal app):

```bash
chmod 400 /path/to/your-key.key
ssh -i /path/to/your-key.key ubuntu@YOUR_SERVER_IP
```

Replace `/path/to/your-key.key` with the actual path to the `.key` file you downloaded.

**Example:**
```bash
chmod 400 ~/Desktop/ssh-key-2024-01-01.key
ssh -i ~/Desktop/ssh-key-2024-01-01.key ubuntu@158.101.45.123
```

### On Windows (PowerShell):

```powershell
ssh -i C:\Users\YourName\Desktop\your-key.key ubuntu@YOUR_SERVER_IP
```

### What to expect:

- First time: it will say "Are you sure you want to continue connecting?" — type `yes` and press Enter
- You'll see a prompt like `ubuntu@instance-xxxx:~$` — you're now inside the server

---

## PART 5 — Install Docker

Run these commands one at a time inside the server. Wait for each to finish.

**Install Docker:**
```bash
curl -fsSL https://get.docker.com | sudo sh
```
(Takes 1–2 minutes)

**Add yourself to the docker group:**
```bash
sudo usermod -aG docker ubuntu
newgrp docker
```

**Verify Docker works:**
```bash
docker --version
```
You should see something like `Docker version 25.0.3`

---

## PART 6 — Deploy the App

### Step 1: Clone the repo

```bash
git clone https://github.com/Ajaykant24/reclippernodejs.git
cd reclippernodejs
```

### Step 2: Create your secrets file

```bash
cp deploy.env.example deploy.env
nano deploy.env
```

The nano editor opens. You'll see:

```
API_DOMAIN=api.clippar.online
GEMINI_API_KEY=your_gemini_key_here
GEMINI_MODEL=gemini-2.0-flash
CORS_ORIGINS=https://reclippernodejs.vercel.app,https://clippar.online
```

Change `your_gemini_key_here` to your actual Gemini API key.

- **To move the cursor**: use arrow keys
- **To save**: press `Ctrl+O`, then press `Enter`
- **To exit**: press `Ctrl+X`

### Step 3: Start the app

```bash
docker compose --env-file deploy.env up -d --build
```

This takes **3–5 minutes** the first time (downloading FFmpeg etc.).
You'll see a lot of output — that's normal.
Wait until you see `✔ Container ... Started`.

### Step 4: Verify it's working

```bash
curl https://api.clippar.online/health
```

You should see: `{"status":"ok"}`

If you see that — **your backend is live!**

---

## PART 7 — Connect the Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) and open your Reclipper project
2. Click **Settings** (top nav)
3. Click **Environment Variables** (left sidebar)
4. Click **Add New**:
   - **Key**: `VITE_API_URL`
   - **Value**: `https://api.clippar.online`
5. Click **Save**
6. Go to **Deployments** tab → click **...** on the latest deployment → click **Redeploy**

Wait ~1 minute for it to finish.

---

## PART 8 — Test Everything

1. Open your Vercel frontend URL
2. Sign up for a new account
3. Upload a short test video (30 seconds is fine)
4. Wait for it to process
5. Download the clip

If the clip downloads — everything is working perfectly.

---

## Everyday Commands

SSH into the server first, then `cd reclippernodejs`, then run:

```bash
# See live logs (press Ctrl+C to stop)
docker compose --env-file deploy.env logs -f api

# Update after new code is pushed to GitHub
git pull
docker compose --env-file deploy.env up -d --build

# Restart
docker compose --env-file deploy.env restart

# Stop
docker compose --env-file deploy.env down
```

---

## Backup Your Data

Your videos and accounts are stored in a Docker volume (`reclipper-data`).
It survives restarts and rebuilds. To make a manual backup:

```bash
cd reclippernodejs
docker run --rm \
  -v reclippernodejs_reclipper-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/reclipper-backup.tar.gz -C /data .
```

This saves a `reclipper-backup.tar.gz` file on the server.

---

## Troubleshooting

**"Out of host capacity" when creating VM**
Go back and change the Availability Domain from AD-1 to AD-2 or AD-3.

**SSH: Permission denied**
Make sure you ran `chmod 400 your-key.key` before the ssh command (Mac/Linux only).

**`curl https://api.clippar.online/health` times out**
1. Check that ports 80 and 443 are open in the Oracle Security List (Part 2)
2. Check your DNS A record is set correctly (Part 3)
3. Run `docker compose --env-file deploy.env logs api` to see if there's an error

**Frontend still shows "Cannot reach backend"**
Make sure you set `VITE_API_URL` in Vercel AND redeployed after saving it.

**App running but login/signup not working**
Wait 30 seconds — on first boot it creates the data files. Try again.
