# Infrastructure setup

Step-by-step runbook for standing up the production environment.
Design rationale is in `ARCHITECTURE.md`; this file is the doing.

**Target:** Railway, Hobby plan, running the NestJS/Fastify API (which also serves the
built SPA via `@fastify/static`) plus a Railway-managed Postgres service, behind
Cloudflare for DNS/CDN/edge rate-limiting.
**Cost:** $5/month minimum usage (Hobby plan floor), plus the domain.
**Time:** an hour or two — most of the Oracle runbook's waiting (ARM capacity, dual
firewalls) doesn't apply here.

Do these in order. Oracle Cloud Always Free — the previous primary target, now the
**$0 fallback** — is fully preserved in **Appendix A** below; nothing there was deleted,
only reordered.

The **domain and Cloudflare** setup is deliberately near the end (§7): everything before
it runs on Railway's generated `*.up.railway.app` URL, so you don't need to own the
domain — or wait on nameserver propagation — to stand the app up.

### Testing on Railway's Free plan first

For a small pilot (≈20 or fewer users, not production) the same steps below work
unchanged on Railway's **Free** plan instead of Hobby — same `railway.json`, same
variable set, just skip §7 (domain) and use the generated `*.up.railway.app` URL.
Worth doing before paying for Hobby, with caveats:

- **0.5GB RAM / 1 vCPU is per service, not shared.** The API and Postgres are separate
  Railway services, so this isn't the same risk as cramming everything onto one small
  VPS box (see Appendix A's `XS 1.1` warning) — each gets its own allowance. For ~20
  users doing occasional enqueue/done taps plus a handful of open SSE connections, this
  is genuinely light load and should be fine on both sides.
- **Verify services don't sleep when idle — this is the one that actually matters.**
  `railway.json`'s `sleepApplication: false` exists because sleeping kills every open
  SSE connection, silently breaking the live-updates requirement (`ARCHITECTURE.md` §1).
  Confirm Free-tier behavior directly (check current Railway docs/dashboard, or leave it
  idle 30+ minutes mid-test and confirm a stream stays open) rather than assuming Hobby's
  guarantee carries over.
- **No region selection on Free** — testers in `Asia/Jakarta` will see worse latency
  than a Singapore Hobby deploy. Fine for validating functionality, not representative
  of production feel.
- **Custom domains are limited/unavailable on Free** — not a problem here, since this
  path is meant to skip §7 entirely and use the generated URL.
- The 1GB figure often quoted is *ephemeral disk* (the build/container filesystem), not
  the Postgres volume (0.5GB on Free) — watch the first build's logs in case a pnpm
  monorepo build pushes close to that ceiling.

Treat this as a functional pilot, not a load or production rehearsal — move to Hobby
(the rest of this runbook) once it's time for real users.

---

## 0. Prerequisites

| Thing              | Notes                                                          |
| ------------------- | -------------------------------------------------------------- |
| Domain name         | ~$10–15/year. Any registrar. Not registered until §7.          |
| Cloudflare account  | Free tier                                                      |
| Railway account     | Hobby plan, $5/mo minimum usage                                 |
| GitHub account      | Repo + Railway's GitHub deploy integration                      |
| Cloudflare R2 bucket | Free tier (10 GB) — backup destination                        |

No SSH keypair needed for this path — Railway deploys don't use SSH. Keep one around
only if you plan to also stand up the Oracle or paid-VPS fallback in Appendix A.

---

## 1. Create the Railway project

1. New Project → **Deploy from GitHub repo** → select this repository. Railway will
   likely auto-detect this as a monorepo and offer to scaffold a service per package it
   finds, each with its own **Root Directory** pre-filled (e.g. `apps/api`) and its own
   auto-generated `pnpm --filter <package> build`/`start` commands. **Decline that for
   the API service** — this repo is what Railway's own docs call a "shared" monorepo
   (`packages/shared` is consumed by both `apps/api` and `apps/web` via `workspace:*`),
   and shared monorepos should **not** have a Root Directory set. If Root Directory is
   pinned to `apps/api`, `pnpm install` runs from inside that folder, can't see the
   workspace root's `pnpm-lock.yaml`/`pnpm-workspace.yaml`, and fails to resolve
   `workspace:*` — which looks exactly like "can't deploy because the server is in a
   subdirectory." Leave the API service's Root Directory **blank** (repo root) and let
   it use the `railway.json` from §2 instead, which already has the right
   `buildCommand`/`startCommand` from the repo root. The root `package.json`'s
   `packageManager: "pnpm@…"` field is also load-bearing here — it's what stops
   Nixpacks from silently defaulting to `npm` despite the `pnpm-lock.yaml` being
   present, a separate, common cause of the same symptom.
2. Add a **Postgres** service to the same project (Railway's built-in plugin, not a
   manually configured container). It provisions its own volume and injects a
   `DATABASE_URL` reference variable that the API service can consume directly — no
   manual connection-string assembly.
3. **Region:** pick Singapore/Southeast Asia if it's offered for Hobby-tier services.
   Railway has shifted region availability between tiers before, so confirm at creation
   time rather than assuming it's there — the goal is the nearest available region to
   `Asia/Jakarta`, not a specific name.
4. On the API service, set **Replicas: 1**. This isn't a cost optimization — it matches
   the single-instance assumption behind the in-process `EventEmitter` realtime fan-out
   (`ARCHITECTURE.md` → Realtime flow). Do not scale horizontally without first swapping
   that implementation for Postgres `LISTEN/NOTIFY`.

---

## 2. Build and deploy configuration

Add `railway.json` at the repo root:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pnpm install --frozen-lockfile && pnpm build"
  },
  "deploy": {
    "startCommand": "node apps/api/dist/main.js",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "numReplicas": 1,
    "sleepApplication": false
  }
}
```

**`sleepApplication` must stay `false`.** App sleeping would kill every SSE connection
and reintroduce cold starts — the exact failure mode `ARCHITECTURE.md`'s "Deliberately
not doing" section rules out elsewhere. This is the single most important line in this
file to get right; everything else fails soft, this one fails silently (it just looks
like live updates stopped working).

There's no `docker-compose.yml`/Caddy step here: Nixpacks builds from source per deploy,
and the API serves the built SPA itself via `@fastify/static` — one service, one origin.

---

## 3. Secrets

Unlike the Oracle path, there's no `.env` file on a VM — set these as **Variables** on
the API service in the Railway dashboard (Service → Variables).

Generate them locally with `scripts/generate-prod-env.sh` rather than running
`openssl rand` by hand for each one:

```bash
./scripts/generate-prod-env.sh          # writes .env.production, prompts for admin email
./scripts/generate-prod-env.sh --push   # also pushes each value via the Railway CLI
```

Open the generated file and copy each value into the Railway dashboard (or let `--push`
do it, if the Railway CLI is installed and linked), then **delete the file** — it's a
staging artifact, not something Railway or the app reads directly, and it's already
gitignored (`.env.*`) so it can't be committed by accident. The script deliberately
doesn't generate `DATABASE_URL` — see the table below for why — and it skips the
rate-limit/cooldown variables entirely, since those already default correctly in code
(`.env.example`) and aren't secrets.

Set these variables on the API service:

| Variable               | Value                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`          | Reference the Postgres service's variable (Railway can wire this automatically — check the "reference variable" picker rather than copy-pasting) |
| `NODE_ENV`               | `production`                                                       |
| `TRUST_PROXY`            | `1` — Railway terminates TLS at its own edge; without this, `@nestjs/throttler` sees one client and rate-limits the entire userbase as a single bucket |
| `DEVICE_TOKEN_SECRET`    | `openssl rand -base64 32`                                          |
| `SESSION_SECRET`         | `openssl rand -base64 32`                                          |
| `IP_HASH_SALT`           | `openssl rand -base64 16`                                          |
| `SESSION_COOKIE_SECURE`  | `1`                                                                |
| `ADMIN_SEED_EMAIL`       | your email — first superadmin login (see §4)                      |
| `ADMIN_SEED_PASSWORD`    | `openssl rand -base64 24` — note it down, it's your first login    |

**This variable set is the only unversioned state besides the database.** Back up
`DEVICE_TOKEN_SECRET` somewhere safe — losing it invalidates every issued device token
and silently disables the one-active-entry-per-device rule.

---

## 4. First deploy

Trigger the first deploy (push to the connected branch, or use the dashboard's manual
deploy button). Watch the build logs until the health check at `/api/health` goes
green.

**Admin access is available immediately.** On its first boot the API creates the initial
superadmin from `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` (§3) if no superadmin exists —
no manual seed step. Log in at `/admin`, then change the password from within the console.
The seed values are ignored on every subsequent boot, so they never override a password
you later set. (The `pnpm db:seed` script is dev-only — it also inserts fixture locations
and games and must not be run against production.)

Railway serves the app on a generated `*.up.railway.app` URL (API service → **Settings →
Networking → Generate Domain** if one isn't shown yet). You don't need your own domain to
verify the deploy — that comes last, in §7. On the generated URL, confirm:

1. `https://<service>.up.railway.app/api/health` returns 200.
2. `https://<service>.up.railway.app/admin` loads and the seeded superadmin can log in.

---

## 5. CI/CD

This is the biggest mechanical difference from the Oracle path: **no GHCR, no SSH, no
multi-arch build required for day-to-day deploys.** Railway watches the connected
GitHub branch and builds + deploys on every push using Nixpacks.

- **Deploy:** `git push` to the connected branch. That's the whole pipeline.
- **Rollback:** Railway keeps deployment history — pick a previous deployment in the
  dashboard and redeploy it. No `TAG` env-var pinning dance needed.
- **Keep the multi-arch GHCR build workflow around anyway**, even though this path
  doesn't consume it. It's what keeps Appendix A (Oracle) and Phase 3 (paid VPS) in
  `ARCHITECTURE.md` a same-day fallback instead of a from-scratch CI setup if you ever
  need them. Don't delete it just because the primary path doesn't need it day to day.

---

## 6. Backups

Only `locations`, `games`, `admin_users`, and `admin_location_grants` matter. Queue
data is disposable by definition — a restore that loses the current day's queue is an
acceptable outcome.

There's no VM to put a cron job on, so run the backup as a **scheduled GitHub Actions
workflow** instead — `.github/workflows/backup.yml`:

```yaml
name: Nightly backup
on:
  schedule:
    - cron: '0 18 * * *'   # 01:00 Asia/Jakarta — after rollover, before morning traffic
  workflow_dispatch: {}

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Install Postgres client + rclone
        run: |
          sudo apt-get update && sudo apt-get install -y postgresql-client
          curl https://rclone.org/install.sh | sudo bash

      - name: Configure rclone for R2
        run: |
          mkdir -p ~/.config/rclone
          cat > ~/.config/rclone/rclone.conf <<EOF
          [r2]
          type = s3
          provider = Cloudflare
          access_key_id = ${{ secrets.R2_ACCESS_KEY_ID }}
          secret_access_key = ${{ secrets.R2_SECRET_ACCESS_KEY }}
          endpoint = ${{ secrets.R2_ENDPOINT }}
          EOF

      - name: Dump and upload
        run: |
          STAMP=$(date -u +%Y%m%dT%H%M%SZ)
          pg_dump "${{ secrets.DATABASE_PUBLIC_URL }}" | gzip > db-$STAMP.sql.gz
          rclone copy db-$STAMP.sql.gz r2:arcade-backups/
          rclone delete r2:arcade-backups/ --min-age 14d
```

`DATABASE_PUBLIC_URL` (store it as a GitHub Actions secret) is **not** the same value as
the `DATABASE_URL` reference variable used in §3 — that one only resolves inside
Railway's private network and GitHub's runners can't reach it. Enable a public
connection for the Postgres service (its **Connect** tab in the Railway dashboard) and
use that externally-reachable string instead. Exact wording of this setting has moved
around in Railway's dashboard before, so if the field names above don't match what you
see, look for "public networking" / "TCP proxy" on the Postgres service.

**Then test a restore into a throwaway container.** An untested backup is a rumour, and
this is the only irreplaceable data in the system.

---

## 7. Domain and Cloudflare

Everything above runs on Railway's generated `*.up.railway.app` URL — you only need your
own domain to put the app on a real address behind Cloudflare's edge (DNS, CDN, and the
rate-limiting rule in §8). Do this once the deploy is green.

1. Register the domain (any registrar, ~$10–15/year).
2. Add the site to Cloudflare, change the nameservers at your registrar, and wait for
   activation (minutes to a few hours).
3. **SSL/TLS → Overview → set encryption mode to "Full (strict)".** Mismatched modes
   cause the most common Cloudflare-plus-origin bugs, even though Railway (not Caddy)
   terminates TLS here.
4. On the API service: **Settings → Networking → Custom Domain** → add your domain.
   Railway gives you a CNAME target (something like `<service>.up.railway.app`).
5. In Cloudflare, add a `CNAME` record pointing your domain (or subdomain) at that
   target.
6. Railway provisions and renews the TLS certificate for the custom domain itself once
   the CNAME resolves — unlike the self-hosted Caddy path in Appendix A, you generally
   don't need to grey-cloud the DNS record first. Cloudflare **Proxied (orange cloud)**
   from the start is normally fine. If certificate issuance stalls, temporarily switching
   the record to **DNS-only (grey cloud)** can help, the same troubleshooting fallback as
   the Caddy path — it just isn't required by default.

Once the custom domain resolves, confirm:

1. `https://yourdomain/api/health` returns 200.
2. `https://yourdomain/admin` loads and the seeded superadmin can log in.
3. Cloudflare SSL/TLS mode is still **Full (strict)**.

---

## 8. Monitoring

Minimum viable:

- **UptimeRobot or Better Stack** hitting `https://yourdomain/api/health` every 5
  minutes, alerting to email.
- **Railway's own dashboard** for CPU/RAM/disk/network metrics and deploy/build logs —
  there's no `docker compose logs` here, it's all in the service's Observability tab.
- A second check that opens the SSE endpoint and confirms a heartbeat arrives — a
  buffering issue at any proxy layer can break live updates while `/api/health` stays
  green. (There's no Caddyfile to misconfigure on this path, but verify anyway — if
  heartbeats never arrive while everything else looks healthy, this is the first thing
  to check.)

### Usage visibility and spending guards — not optional on this host

Because Railway is metered, this section is load-bearing, not a nice-to-have (see
`ARCHITECTURE.md` → Cost and load self-governance):

- Set Railway's **opt-in hard spending limit** in project settings, with email alerts.
  It's reported as an imperfect stop — set it anyway, and don't treat it as sufficient
  on its own.
- Add a genuinely conservative **Cloudflare rate-limiting rule** on `POST /api/*` — this
  is the layer that actually protects the bill, because it never reaches Railway at all
  when it trips.
- Run the daily reconciliation loop described in `ARCHITECTURE.md` (queries Railway's
  GraphQL usage API, flips the app to Maintenance if projected month-end cost exceeds a
  configured budget). This is the backstop for slow bleeds that never trip the
  real-time in-app governor.
- Railway's GraphQL API and dashboard both show per-service usage if you want to
  eyeball it manually instead of automating the check.

---

## 9. Verification checklist

Don't call it done until all of these pass **against the public domain**, not localhost.

- [ ] `https://yourdomain` serves the SPA; a deep link like `/l/some-slug` returns the
      app rather than a 404 (SPA fallback works)
- [ ] `GET /api/health` returns 200
- [ ] An SSE stream stays open past 60 seconds and delivers a heartbeat
      (`curl -N https://yourdomain/api/games/<id>/stream`)
- [ ] Joining a queue in one browser appears in a second browser without a refresh
- [ ] Two devices enqueueing produce sequential ticket numbers
- [ ] The enqueue throttle rejects at its boundary — this is what proves `trustProxy`
      is configured; if it never rejects, every request looks like Railway's edge IP
- [ ] `service_date` on a new entry matches today in `Asia/Jakarta`, not UTC
- [ ] The PWA install prompt appears on Android Chrome, and the app opens standalone
- [ ] Restarting the API service from the Railway dashboard brings everything back
      without manual intervention, and the admin bootstrap does **not** reseed or
      overwrite the password you already set

That last one matters more than it sounds. Test it before you have users.

---

## 10. Routine operations

| Cadence   | Task                                                                     |
| --------- | -------------------------------------------------------------------------- |
| Automatic | TLS renewal (Railway-managed), nightly backup (GitHub Actions)            |
| Monthly   | Review Railway's usage/billing dashboard against the budget; check the reconciliation loop actually ran |
| Quarterly | Restore a backup into a throwaway container and confirm it works           |
| On alert  | Check the Railway deployment logs and Observability tab before anything else |

Budget well under an hour a month — there's no OS to patch, no VM to reboot. If ops work
somehow grows past that, something's off; see `ARCHITECTURE.md`'s migration triggers.

---

## 11. Things that will go wrong

| Symptom                                          | Cause                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Site unreachable, deploy shows healthy             | Custom domain CNAME not resolving yet, or Cloudflare proxy status mismatched with cert issuance (§7)      |
| Infinite redirect loop                             | Cloudflare SSL mode is "Flexible" instead of "Full (strict)"                                              |
| Live updates never arrive; everything else fine    | Check Railway's edge isn't buffering the SSE stream (no Caddyfile to fix here — this is the first thing to isolate, same symptom as the Caddy `flush_interval` bug) |
| Throttle never triggers                            | `TRUST_PROXY` not set to `1`; all traffic reads as Railway's edge IP                                       |
| App suddenly cold-starts, SSE connections drop      | `sleepApplication` got reset to `true` — check `railway.json` / service settings                          |
| Unexpected Railway bill                            | The hard spending limit didn't hold, or the Cloudflare rate-limit rule wasn't actually applied — check both, and the reconciliation loop's last run |
| Backup workflow fails silently                     | `DATABASE_PUBLIC_URL` secret is stale, or the Postgres service's public networking got disabled            |
| Build fails inside `pnpm i --frozen-lockfile` — `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` or `packages field missing or empty` | Nixpacks doesn't support pnpm 11 yet (confirmed open bug, railwayapp/nixpacks#1419) — pin `packageManager` in the root `package.json` to a pnpm 10.x release instead (`corepack use pnpm@10`, then commit the regenerated `pnpm-lock.yaml`) |

---

## 12. If you need to move

Full runbook is in `ARCHITECTURE.md` under "Migration runbook" — applies to any target.
Short version of where each fallback is documented:

- **Oracle Cloud Always Free** ($0, if the $5/mo floor needs to go away): Appendix A
  below.
- **Render** ($13/mo fixed, if you want an SLA and predictable billing): `ARCHITECTURE.md`
  Phase 2b.
- **Paid VPS** (Biznet Gio / DigitalOcean / Vultr / Hetzner, if you want full self-hosted
  control): `ARCHITECTURE.md` Phase 3 — it reuses Appendix A's Docker Compose / Caddy
  mechanics almost unchanged.

Because the queue is ephemeral, cutover risk is close to zero regardless of target —
schedule it for early morning in `Asia/Jakarta` and the worst case is losing one day's
queue at one game center, which would have been deleted at local midnight anyway.

---

## Appendix A — Oracle Cloud Always Free ($0 fallback)

This is the complete former primary runbook, unchanged in substance, kept here in full
so switching to it (or to the paid VPS path in `ARCHITECTURE.md` Phase 3, which reuses
almost all of it) stays a same-day operation rather than a from-scratch rebuild.

**Target:** one Ampere ARM VM in `ap-singapore-1`, running `caddy` + `api` + `postgres`
under Docker Compose, behind Cloudflare.
**Cost:** $0/month plus the domain.
**Time:** roughly half a day, most of it waiting on Oracle.

Steps A.0/A.1 overlap with the main runbook's Prerequisites (§0) and Domain and
Cloudflare (§7) sections (same domain, same Cloudflare account) — reuse what you already
set up there. Steps A.2 onward are genuinely
different from the Railway path.

### A.0. Prerequisites

| Thing                | Notes                                                          |
| -------------------- | -------------------------------------------------------------- |
| Domain name          | Same domain as the main runbook.                                |
| Cloudflare account   | Same account as the main runbook.                               |
| Oracle Cloud account | Free tier; needs a card for identity verification, not billing |
| GitHub account       | For the repo, CI, and GHCR image hosting                       |
| SSH keypair          | `ssh-keygen -t ed25519 -C "machi2"`                      |

### A.1. Domain and Cloudflare

Same as the main runbook's Domain and Cloudflare section (§7) — register the domain, add it to Cloudflare, set
**SSL/TLS → Overview → Full (strict)**, and leave DNS record creation for A.3c (you
don't have an IP yet).

### A.2. Provision the Oracle VM

Console → Compute → Instances → Create instance.

- **Region:** `ap-singapore-1` (Singapore). ~25 ms from Jakarta, and it actually has
  ARM capacity. Region is fixed per tenancy for the home region, so choose deliberately.
- **Image:** Canonical Ubuntu 24.04
- **Shape:** Ampere → `VM.Standard.A1.Flex` → **2 OCPU, 12 GB RAM**
  (the current Always Free ceiling — it was 4/24 until June 2026)
- **Boot volume:** 50 GB
- **SSH key:** paste your public key
- **Networking:** create a new VCN with an internet gateway, assign a public IPv4

#### When you hit "Out of host capacity"

You probably will. ARM capacity in free tenancies is contended. Options, in order of
effort:

1. Retry the create dialog periodically — capacity frees up in waves.
2. Try a different availability domain / fault domain in the same region.
3. Script it: a loop calling the `LaunchInstance` API every few minutes. Several
   community tools do exactly this; it's a well-worn path.
4. Fall back to two `VM.Standard.E2.1.Micro` AMD instances (1 GB RAM each) as a
   stopgap. Tight for Postgres plus Node, but it runs.

Note the public IP once it's up.

#### A.2a. If capacity never frees up

Give the retry loop a day or two, not a week. If it's still "Out of host capacity"
after that, you're already trying to reach the $0 fallback — consider Render
(`ARCHITECTURE.md` Phase 2b, $13/mo fixed, least ops work) or a paid VPS
(`ARCHITECTURE.md` Phase 3, $4–9/mo, reuses this appendix's Docker Compose/Caddy setup
almost unchanged) instead of continuing to fight Oracle capacity.

**Do not** reach for a fourth target on your own (Fly.io, Koyeb, other free/scale-to-zero
PaaS) — `ARCHITECTURE.md` rules these out explicitly because scale-to-zero is
incompatible with holding open the SSE connections this app depends on for live updates
(portability contract point 7).

Before giving up on Oracle entirely, note that if you saved the instance form as a
Resource Manager **Stack**, you can re-run `Apply` on it (Resource Manager → Stacks →
your stack → Plan → Apply) without refilling the console form each time — a lower-effort
version of the scripted-retry option above.

### A.3. Networking — you must open the firewall twice

This is the step that eats an afternoon if you miss it. Oracle's Ubuntu images ship
with local `iptables` rules **in addition to** the cloud-level security list. Opening
one and not the other looks exactly like a broken app.

#### A.3a. Cloud level (OCI security list)

VCN → Security Lists → default → Add ingress rules:

| Source CIDR | Protocol | Port |
| ----------- | -------- | ---- |
| `0.0.0.0/0` | TCP      | 80   |
| `0.0.0.0/0` | TCP      | 443  |

SSH on 22 is already open by default.

#### A.3b. Host level (iptables)

```bash
sudo iptables -L INPUT --line-numbers        # find the REJECT rule's number
sudo iptables -I INPUT <N> -p tcp --dport 80  -m state --state NEW -j ACCEPT
sudo iptables -I INPUT <N> -p tcp --dport 443 -m state --state NEW -j ACCEPT
sudo netfilter-persistent save
```

Insert **above** the catch-all `REJECT` rule — appending puts your rules after it,
where they do nothing. Verify with `sudo iptables -L INPUT --line-numbers` again and
confirm the ACCEPT lines come first.

#### A.3c. DNS

In Cloudflare, add an `A` record for your domain pointing at the VM's public IP.
**Set the proxy to DNS-only (grey cloud) for now** — A.6 explains why.

### A.4. Bootstrap the host

```bash
ssh ubuntu@<public-ip>

sudo apt update && sudo apt upgrade -y
sudo apt install -y unattended-upgrades fail2ban
sudo dpkg-reconfigure --priority=low unattended-upgrades

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
# log out and back in for the group change to apply

# 2 GB swap — cheap insurance against an OOM kill during a build or migration
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

mkdir -p ~/app && cd ~/app
```

Confirm you're on ARM before going further — this determines how CI must build images:

```bash
uname -m        # expect: aarch64
```

### A.5. Secrets

Create `~/app/.env` on the VM. **This file is the only unversioned state besides the
database.** Back it up somewhere safe — a lost `DEVICE_TOKEN_SECRET` invalidates every
issued device token and silently disables the one-active-entry-per-device rule.

```bash
cat > ~/app/.env <<EOF
POSTGRES_PASSWORD=$(openssl rand -base64 32)
DEVICE_TOKEN_SECRET=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -base64 32)
IP_HASH_SALT=$(openssl rand -base64 16)
SESSION_COOKIE_SECURE=1
# Initial admin. On first boot, if no superadmin exists yet, the API creates one
# from these. Once any superadmin exists the values are ignored, so change the
# password from inside the console afterwards rather than editing this file.
ADMIN_SEED_EMAIL=you@example.com
ADMIN_SEED_PASSWORD=$(openssl rand -base64 24)
TAG=latest
EOF
chmod 600 ~/app/.env
echo "Note the ADMIN_SEED_PASSWORD above — it's your first login."
```

Copy `docker-compose.yml` and `Caddyfile` from `ARCHITECTURE.md` (Phase 2a) into
`~/app/`. Set your real domain in the `Caddyfile`.

(`scripts/generate-prod-env.sh --vps` generates the same values locally if you'd rather
not type a heredoc over SSH — but then you're copying secrets from your machine to the
VM instead of generating them in place, which is the less safe direction. The heredoc
above stays the recommended path for this appendix; the script exists mainly for the
Railway path in §3, where there's no VM to SSH into at all.)

### A.6. First deploy and TLS

Caddy obtains a certificate from Let's Encrypt using an HTTP-01 challenge, which needs
to reach your origin directly. With Cloudflare's proxy on, that's unreliable. So:
**issue the certificate while DNS-only (grey cloud), then turn the proxy on.**

```bash
cd ~/app
docker compose up -d
docker compose logs -f caddy      # watch for "certificate obtained successfully"
```

Once the certificate is issued:

1. Cloudflare → DNS → switch the `A` record to **Proxied (orange cloud)**.
2. Confirm SSL/TLS mode is still **Full (strict)**.
3. Reload the site. You're now behind Cloudflare's CDN and DDoS protection.

**Admin access is available immediately.** On its first boot the API creates the initial
superadmin from `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` (A.5) if no superadmin exists —
no manual seed step. Log in at `/admin`, then change the password from within the console.
The seed values are ignored on every subsequent boot, so they never override a password
you later set. (The `pnpm db:seed` script is dev-only — it also inserts fixture locations
and games and must not be run against production.)

Caddy renews automatically every 60 days. Renewal happens through the proxy and
generally works, but if a renewal ever fails, grey-cloud briefly and re-run.

_Alternative:_ build Caddy with the Cloudflare DNS plugin and use a DNS-01 challenge.
Cleaner long-term, but it means a custom image — not worth it at this size.

### A.7. CI/CD

#### Build images for ARM

Ampere is `aarch64`; GitHub Actions runners are x86. An x86 image builds fine and then
dies on the VM with an exec-format error. In `.github/workflows/deploy.yml`:

```yaml
- uses: docker/setup-qemu-action@v3
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v6
  with:
    platforms: linux/amd64,linux/arm64
    push: true
    tags: ghcr.io/${{ github.repository }}-api:${{ github.sha }}
```

Build both platforms so the same tag also runs on a paid VPS later — that's the
portability contract point 6 in `ARCHITECTURE.md`.

#### Deploy over SSH

Store `SSH_HOST`, `SSH_USER`, and `SSH_PRIVATE_KEY` as repository secrets, then:

```yaml
- uses: appleboy/ssh-action@v1
  with:
    host: ${{ secrets.SSH_HOST }}
    username: ${{ secrets.SSH_USER }}
    key: ${{ secrets.SSH_PRIVATE_KEY }}
    script: |
      cd ~/app
      sed -i "s/^TAG=.*/TAG=${{ github.sha }}/" .env
      docker compose pull && docker compose up -d
      docker image prune -f
```

**Never build on the VM.** Two OCPUs will crawl, and you'd be building on the same box
that's serving traffic.

**Rollback** is pinning `TAG` to a previous commit SHA and re-running `docker compose
up -d`. Keep the last five tags in GHCR.

### A.8. Backups

Only `locations`, `games`, `admin_users`, and `admin_location_grants` matter. Queue
data is disposable by definition — a restore that loses the current day's queue is an
acceptable outcome.

Create a Cloudflare R2 bucket (10 GB free) and an API token, then a nightly cron:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd ~/app
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T postgres pg_dump -U arcade arcade | gzip > /tmp/db-$STAMP.sql.gz
rclone copy /tmp/db-$STAMP.sql.gz r2:arcade-backups/
rm /tmp/db-$STAMP.sql.gz
rclone delete r2:arcade-backups/ --min-age 14d
```

`0 18 * * *` UTC is 01:00 in `Asia/Jakarta` — after the daily queue rollover, before
morning traffic.

**Then test a restore into a throwaway container.** An untested backup is a rumour, and
this is the only irreplaceable data in the system.

### A.9. Monitoring

Minimum viable, all free:

- **UptimeRobot or Better Stack** hitting `https://yourdomain/api/health` every 5
  minutes, alerting to email. This doubles as protection against Oracle's idle-instance
  reclamation.
- **`restart: unless-stopped`** on every container (already in the Compose file).
- **`docker compose logs`** with 7-day rotation configured in the daemon.
- A second check that opens the SSE endpoint and confirms a heartbeat arrives — a
  proxy misconfiguration can break live updates while `/api/health` stays green.

#### Usage visibility and spending guards

- **Oracle:** set an OCI **Budget** alert at $1 (Governance → Budgets). It's a soft
  limit — it emails you, it does not stop anything. On a true Always Free account its
  only real job is to warn you if you ever accidentally upgrade to Pay-As-You-Go, which
  is the only way a bill becomes possible. Metrics live in the Monitoring API and the
  "Limits, Quotas and Usage" console page.
- **Cloudflare:** the GraphQL Analytics API (`https://api.cloudflare.com/client/v4/graphql`)
  reports requests and bytes per zone — the best external view of real traffic, since it
  sits in front of the origin.

### A.10. Verification checklist

Don't call it done until all of these pass **against the public domain**, not localhost.

- [ ] `https://yourdomain` serves the SPA; a deep link like `/l/some-slug` returns the
      app rather than a 404 (SPA fallback works)
- [ ] `GET /api/health` returns 200
- [ ] An SSE stream stays open past 60 seconds and delivers a heartbeat
      (`curl -N https://yourdomain/api/games/<id>/stream`)
- [ ] Joining a queue in one browser appears in a second browser without a refresh
- [ ] Two devices enqueueing produce sequential ticket numbers
- [ ] The enqueue throttle rejects at its boundary — this is what proves `trustProxy`
      is configured; if it never rejects, every request looks like Cloudflare's IP
- [ ] `service_date` on a new entry matches today in `Asia/Jakarta`, not UTC
- [ ] The PWA install prompt appears on Android Chrome, and the app opens standalone
- [ ] Rebooting the VM brings everything back unattended (`sudo reboot`, then re-check)

That last one matters more than it sounds. Test it before you have users.

### A.11. Routine operations

| Cadence   | Task                                                                  |
| --------- | --------------------------------------------------------------------- |
| Automatic | Security patches (`unattended-upgrades`), TLS renewal, nightly backup |
| Monthly   | `sudo apt upgrade`, reboot if a new kernel landed, check disk usage   |
| Quarterly | Restore a backup into a throwaway container and confirm it works      |
| On alert  | Check `docker compose ps` and `logs` before anything else             |

Budget about an hour a month. If it consistently exceeds two, that's a signal to
reconsider whether this fallback is worth staying on versus Railway or Render.

### A.12. Things that will go wrong

| Symptom                                         | Cause                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Site unreachable, VM is up                      | Opened the OCI security list but not `iptables`, or vice versa (A.3)                                    |
| Infinite redirect loop                          | Cloudflare SSL mode is "Flexible" instead of "Full (strict)"                                            |
| Certificate never issues                        | Cloudflare proxy was on during the ACME challenge (A.6)                                                 |
| Container exits instantly, exec-format error    | Image built for x86, VM is ARM (A.7)                                                                     |
| Live updates never arrive; everything else fine | Missing `flush_interval -1` in the Caddyfile — Caddy is buffering the SSE stream                        |
| Throttle never triggers                         | `trustProxy` not enabled in Fastify; all traffic reads as one IP                                        |
| Instance stopped without warning                | Oracle policy change or idle reclamation — see `ARCHITECTURE.md`                                        |
| Unexpected Oracle bill                          | Account was upgraded to Pay-As-You-Go and something exceeded the free allowance. Set a $1 budget alert. |

### A.13. If you need to move

Full runbook is in `ARCHITECTURE.md` under "Migration runbook". Short version: the
same Compose file redeploys unchanged on any paid VPS (`ARCHITECTURE.md` Phase 3), and
moving to Railway (the primary target) or Render means following this file's main
runbook or `ARCHITECTURE.md` Phase 2b instead.

Because the queue is ephemeral, cutover risk is close to zero — schedule it for early
morning in `Asia/Jakarta` and the worst case is losing one day's queue at one game
center, which would have been deleted at local midnight anyway.
