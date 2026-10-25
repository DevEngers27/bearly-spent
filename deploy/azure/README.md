# Deploying MoneyQuest to a small Ubuntu VM (Azure)

1. Create an Ubuntu 24.04 VM with ports 22, 80 and 443 open and your SSH key.
2. One-time server setup (installs Node 22, Caddy, a system user and a systemd unit;
   HTTPS is automatic for the hostname you pass — `<ip>.sslip.io` works without owning a domain):

       scp deploy/azure/setup-server.sh <user>@<ip>:/tmp/ && ssh <user>@<ip> 'bash /tmp/setup-server.sh <ip-with-dashes>.sslip.io'

3. Put secrets in `/etc/moneyquest.env` on the server (mode 600), then deploy a git ref:

       deploy/azure/deploy.sh <user>@<ip> v0.5.0

   `deploy.sh` builds the client locally from `git archive`, installs production dependencies,
   rsyncs the result to `/opt/moneyquest` (without sources, tests or the art source packs) and
   restarts the service. Data lives in `/var/lib/moneyquest/moneyquest.sqlite`.
4. Logs: `journalctl -u moneyquest -f`. Caddy: `journalctl -u caddy -f`.

Demo mode (`MQ_DEMO=1`) exposes "Try the demo family"; unset it for a real deployment.
