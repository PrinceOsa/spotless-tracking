# Manual Deploy — One-Time Setup

The `deploy.yml` workflow ships this repo to the SpotlessDoc droplet by SSH.
It needs three things configured per-repo before the first run:

1. A dedicated **deploy SSH keypair** authorized on the droplet.
2. Two (optionally three) **GitHub Actions secrets**.
3. A human typing the word **`deploy`** into the workflow's confirm box.

After setup, deploys are a click in the Actions tab — exactly the same
behaviour as running `bash scripts/deploy.sh` locally, just on a fresh CI
runner with a known toolchain.

---

## 1. Generate a deploy key

Do this **once** per droplet (one key serves all three repos that deploy to
it). Keep the key out of any developer's personal `~/.ssh`.

```bash
# Generate the keypair (on your laptop)
ssh-keygen -t ed25519 -C "github-actions deploy" -f deploy_key -N ""
```

This creates:
- `deploy_key`     — the private key (NEVER commit, never paste in chat)
- `deploy_key.pub` — the public key

Copy the public key to the droplet's `root` account:

```bash
ssh root@68.183.130.208 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys" < deploy_key.pub
```

Verify it works:

```bash
ssh -i deploy_key root@68.183.130.208 'echo "deploy key ok"'
```

## 2. Capture the droplet's host key

This pins the SSH fingerprint so a CI run can't be silently MITM'd.

```bash
ssh-keyscan -H 68.183.130.208
```

Copy the entire output (it's typically three lines — RSA, ECDSA, ed25519).

## 3. Add GitHub Actions secrets

In each repo, **Settings → Secrets and variables → Actions → New repository
secret**. Add:

| Name                          | Value                                         | Required?                               |
|-------------------------------|-----------------------------------------------|-----------------------------------------|
| `DEPLOY_SSH_KEY`              | Contents of `deploy_key` (the private one)    | Yes                                     |
| `DEPLOY_KNOWN_HOSTS`          | Output of `ssh-keyscan` from step 2           | Recommended (falls back to accept-new)  |
| `DEPLOY_HOST`                 | `root@68.183.130.208`                         | Optional (defaults to that exact value) |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Live Stripe pk (**frontend repo only**)       | Optional (placeholder used if absent)   |

Tip: GitHub will refuse to print the secret back in any future logs, so save
the originals somewhere durable (1Password / your password manager) before
pasting them in.

## 4. Trigger a deploy

GitHub → repo → **Actions** tab → **Deploy (manual)** → **Run workflow** →
type **`deploy`** in the confirm box → **Run workflow**.

The workflow:
1. Checks the confirm input.
2. Writes the SSH key + known_hosts to the runner.
3. Invokes `scripts/deploy.sh` (the same script that runs locally — it
   excludes `.env`, syncs source, installs prod deps remotely, restarts pm2,
   waits for the health check).
4. Hits the public health endpoint(s) as a final smoke test.

A red box at any step aborts the run — pm2 stays on the previous version.

## 5. After the first successful deploy

- Rotate `DEPLOY_SSH_KEY` periodically (re-run step 1, add the new public key
  to the droplet, remove the old one from `~/.ssh/authorized_keys`).
- If `DEPLOY_KNOWN_HOSTS` was skipped initially, generate it later and add
  the secret — the workflow will use it on subsequent runs and the
  accept-new warning will stop appearing.

## What lives where

| Repo                       | Surface served                          | pm2 process        | Remote dir                    |
|----------------------------|------------------------------------------|--------------------|-------------------------------|
| `spotlessdoc-backend`      | `https://api.spotlessdoc.com`            | `spotlessdoc`      | `/opt/spotlessdoc-backend`    |
| `spotlessdoc-frontend`     | `https://spotlessdoc.com`                | n/a (static)       | `/var/www/spotlessdoc.com`    |
| `spotless-tracking`        | `https://tracking.spotlessdoc.com`       | `spotless-tracking`| `/opt/spotless-tracking-poc`  |

All three share the same droplet + the same deploy key.
