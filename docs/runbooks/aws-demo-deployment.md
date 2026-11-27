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
5. A deploy that CI starts ships only the newest commit on `main`. If a newer
   commit has landed by the time CI finishes, the run deploys that newer
   commit when its CI has passed, and otherwise skips, leaving it to the
   newer commit's own run (ADR 0096 Amendment 2). A deploy started by hand
   ("Run workflow") deploys the SHA you give it.

## Everyday operations

Use the GitHub Actions tab for these:

- **Deploy again, or deploy an older `main` commit (rollback):** "Deploy to AWS
  demo" → Run workflow → enter the SHA, or leave it empty for the latest.
- **Start or stop the simulator, the ingest host or the ML scorer:** "AWS demo
  services" → Run workflow → choose `sim`, `ingest` or `ml`, then `start`,
  `stop` or `status`. The choice survives later deploys. A deploy pulls the
  `ems-ml` image (2.8 GB) only while `ml` is on, so the first `ml start` only
  records the choice: run "Deploy to AWS demo" once to pull and start it (see
  [`apps/ml/README.md`](../../apps/ml/README.md)). Stop `ml` before a rollback
  to a commit from before ADR 0135's plan PR 5.

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

```bash
sudo bms-ctl ml status
```

### Stop the anomaly job and keep forecasts

The `ml` service runs two jobs each hour: forecasts, then anomaly scores
([ADR 0135 Amendment 5](../adr/0135-ml-serving-foundation.md)). The scores are
advisory and raise nothing. `ML_ANOMALY_ENABLED` in `/var/www/bms/.env`
switches the anomaly job alone; `bms-ctl ml stop` alone would stop forecasts
too. `bms-ctl` hands `.env` to Docker Compose with `--env-file`, so the value
reaches the container only when `ml` is created again.

To stop the anomaly job:

```bash
sudo sed -i '/^ML_ANOMALY_ENABLED=/d' /var/www/bms/.env
echo 'ML_ANOMALY_ENABLED=false' | sudo tee -a /var/www/bms/.env >/dev/null
sudo bms-ctl ml stop
sudo bms-ctl ml start
```

Check it: the new `serve_started` line lists `"jobs":["forecast"]`, and the
next hourly tick logs one `cycle_summary` line, with no `"job":"anomaly"` one.

```bash
sudo bms-ctl logs ml
```

The setting survives deploys. Scores already written stay in
`ml.anomaly_scores`; nothing deletes them. To start the job again, delete the
line, then stop and start `ml`:

```bash
sudo sed -i '/^ML_ANOMALY_ENABLED=/d' /var/www/bms/.env
sudo bms-ctl ml stop
sudo bms-ctl ml start
```

### Why an asset has no anomaly score

The anomaly job scores an asset only when every one of its target points is
ready ([ADR 0135 Amendment 5](../adr/0135-ml-serving-foundation.md) ruling 1). The
`eligibility` command lists each target point and its verdict. It runs one read
and writes nothing. Do not run it between HH:04 and HH:09, when the hourly cycle
runs. `bms-ctl` has no exec subcommand, so use `docker exec` on the `ml`
container, whose name `sudo bms-ctl status` prints:

```bash
sudo docker exec <ml container> python -m bms_ml eligibility --job anomaly
```

| Verdict | Meaning |
|---|---|
| `ready` | Scored next cycle |
| `too_few_days` | Fewer than 28 days with data |
| `low_coverage` | Data in under 80 % of the hours from its first hour to its newest |
| `stale` | The newest hour is more than 3 h before the cycle's hour |
| `no_data` | No hourly row at all |

To see what a different target list would return, without changing the running
service, set it for that one process only:

```bash
sudo docker exec -e ML_ANOMALY_TARGETS=water/flow_meter/treated_water_flow_klh <ml container> python -m bms_ml eligibility --job anomaly
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
