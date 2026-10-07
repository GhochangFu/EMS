# Runbook — the AWS demo deployment (bms.demosites.co.in)

Decision record: [ADR 0096](../adr/0096-aws-demo-deployment-and-continuous-deployment.md).

| Item | Value |
|------|-------|
| Public URL | https://bms.demosites.co.in |
| Host | `3.108.117.92` (EC2, `ap-south-1`, arm64, shared with other applications) |
| Administrator login | `ssh -i EuphoriaKey.pem ubuntu@3.108.117.92` (key kept off the repository) |
| Deploy login | `bmsdeploy` — forced command, runs `bms-ctl` only |
| Stack directory | `/var/www/bms` (`.env`, `repo/`, `runtime/`, `state/`) |
| Compose project | `bms` |
| Reverse proxy | Caddy, `/etc/caddy/sites/bms.demosites.co.in.caddy` → `127.0.0.1:5175` |

## How a change reaches the site

1. A pull request merges to `main`.
2. `CI` runs on the push to `main`.
3. If `CI` passes, "Deploy to AWS demo" builds the arm64 images, pushes them to
   `ghcr.io/ghochangfu/ems-{api,web,sim}:<sha>`, and runs
   `bms-ctl deploy <sha>` on the host.
4. The job fails if `https://bms.demosites.co.in/health` does not answer.

## Everyday operations

Use the GitHub Actions tab for these:

- **Deploy again, or deploy an older `main` commit (rollback):** "Deploy to AWS
  demo" → Run workflow → enter the SHA, or leave it empty for the latest.
- **Start or stop the simulator or the ingest host:** "AWS demo services" →
  Run workflow → choose `sim` or `ingest`, then `start`, `stop` or `status`.
  The choice survives later deploys.

On the host, as the administrator:

```bash
sudo bms-ctl status
```

```bash
sudo bms-ctl logs api
```

```bash
sudo bms-ctl rollback
```

```bash
sudo bms-ctl sim start
```

```bash
sudo bms-ctl ingest status
```

## Logins

The seeded demo logins (`admin@bms.local`, `operator@bms.local`,
`viewer@bms.local`, `wc-admin@bms.local`, and more) all use one password. It is
`DEMO_PASSWORD` in `/var/www/bms/.env`:

```bash
sudo grep ^DEMO_PASSWORD= /var/www/bms/.env
```

The Keycloak `master` administrator password is `KEYCLOAK_ADMIN_PASSWORD` in
the same file. The Keycloak admin console is not published.

## Secrets

All secrets are in `/var/www/bms/.env` (root, mode 0600). `setup-server.sh`
generated them and never overwrites the file. To add an LLM provider for the
onboarding agent, set `LLM_PROVIDER` and its key in that file. Then re-deploy.

The ingest host uses the PHE pilot broker login, `MQTT_USERNAME` and
`MQTT_PASSWORD` in the same file ([ADR 0096 Amendment 1](../adr/0096-aws-demo-deployment-and-continuous-deployment.md#amendment-1--the-ingest-host-on-the-live-phe-broker-2026-10-07)).
`bms-ctl ingest start` refuses to start while either is empty.

CAUTION: Do not change a database password in `.env` after the first deploy.
The roles keep their old passwords, and the API then cannot connect.

The GitHub repository secret `BMS_DEPLOY_SSH_KEY` holds the private half of the
`bmsdeploy` key. To replace the key, run `setup-server.sh` with the new public
key, then update the secret.

## Change the host scripts

`bms-ctl` and `bms-ctl-ssh` run from `/usr/local/sbin`, not from the
checkout. After a change to `deploy/aws/bms-ctl.sh`, `bms-ctl-ssh.sh` or
`setup-server.sh` merges, re-install them as the administrator:

```bash
sudo git -C /var/www/bms/repo fetch origin main
```

```bash
sudo git -C /var/www/bms/repo checkout --detach origin/main
```

```bash
sudo bash /var/www/bms/repo/deploy/aws/setup-server.sh
```

## First-time setup (done 2026-10-07)

1. Generate an ed25519 key pair for `bmsdeploy`.
2. Copy `deploy/aws/` to the host, then run
   `sudo bash setup-server.sh bms_deploy.pub`. The script adds the swapfile,
   the user, the sudoers rule, the scripts, the clone and `.env`.
3. Edit `/etc/caddy/sites/bms.demosites.co.in.caddy` (keep a `.bak-<date>`
   copy), run `caddy validate`, then `systemctl reload caddy`.
4. Set the repository secret `BMS_DEPLOY_SSH_KEY` to the private key.
5. Deploy the first commit.

## When the deploy fails

- **`<sha> is not on origin/main`:** the workflow ran for a commit that is not
  merged. Only `main` deploys.
- **`not healthy after 300 s`:** the job prints `docker compose ps` and the
  last log lines of `api`, `migrate` and `keycloak-provision`. Read them
  first. Then run `sudo bms-ctl rollback` if the site must come back at once.
- **`GHCR login or pull failed`:** the image for that SHA does not exist, or
  the token cannot read the package. Make sure that the build job passed.
- **Memory:** run `free -h` and `docker stats --no-stream`. Each BMS service
  has a `mem_limit`. A service at its limit restarts. It does not stop the
  other applications on the host.
