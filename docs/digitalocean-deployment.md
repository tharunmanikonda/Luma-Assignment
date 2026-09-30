# DigitalOcean deployment

The production review environment runs the web process, worker, PostgreSQL, and Caddy on one Droplet. PostgreSQL data and generated assets use named Docker volumes, so routine deployments do not remove them.

## One-time setup

1. Add an SSH public key to the Droplet's `root` account.
2. Copy `deploy/bootstrap.sh` to the Droplet and run it as root.
3. Add these GitHub Actions repository secrets:
   - `DROPLET_HOST`: `192.241.148.87`
   - `DROPLET_USER`: `root`
   - `DROPLET_SSH_PORT`: `22`
   - `DROPLET_SSH_KEY`: the private deployment key
4. Push or manually run the `Test and deploy` workflow.

The bootstrap creates `/opt/luma/.env.production.local` with generated database and authentication secrets. It starts with `LUMA_PROVIDER=fake`. To perform a controlled paid-provider test, edit that file on the server, set `LUMA_PROVIDER=real`, add `LUMA_API_KEY`, and redeploy. Never commit the key.

## Deployment behavior

Every push to `main` runs formatting, linting, type checking, tests, and a production build. A successful run publishes a commit-addressed image to GitHub Container Registry, migrates the database, and updates the Droplet. The first successful deployment seeds Maya and Ellie.

The deployment waits for `/api/ready`. If readiness fails, it restores the previous application image. Database migrations are forward-only, so schema changes should remain backward-compatible with the previous image.

For the current IP-only deployment, the site address is `http://192.241.148.87`. After attaching a domain, update `SITE_ADDRESS`, `APP_ORIGIN`, and `BETTER_AUTH_URL` in `/opt/luma/.env.production.local`; Caddy will then provision HTTPS automatically.
