# The Spact web app, served by Caddy with real security headers (docs/DECISIONS.md ADR-025).
# Railway builds this file from the repository root; locally: docker build -t spact-web .
# Build settings come in as build args. Railway passes service variables through ARG lines.

FROM node:22.23.3-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@spact/web..."

ARG VITE_NEAR_NETWORK=testnet
ARG VITE_NEAR_RPC_URL=https://test.rpc.fastnear.com
# empty: a site with only the landing page and the Security Lab (ADR-023)
ARG VITE_VAULT_ID=
# Optional second network, offered by the site's network switch (ADR-031). Empty vault: no switch.
ARG VITE_TESTNET_VAULT_ID=
ARG VITE_TESTNET_RPC_URL=https://test.rpc.fastnear.com
ARG VITE_MAINNET_VAULT_ID=
ARG VITE_MAINNET_RPC_URL=https://rpc.mainnet.fastnear.com
# Optional: more vaults per network with labels for the vault picker (ADR-033), e.g.
# VITE_EXTRA_VAULTS="vault.0xileri.near=P0 vault"
ARG VITE_VAULT_LABEL=
ARG VITE_EXTRA_VAULTS=
ARG VITE_TESTNET_VAULT_LABEL=
ARG VITE_TESTNET_EXTRA_VAULTS=
ARG VITE_MAINNET_VAULT_LABEL=
ARG VITE_MAINNET_EXTRA_VAULTS=
# 1Click through this image's own Caddy proxy (Caddyfile /1click/*); empty turns the 1Click features off
ARG VITE_ONECLICK_URL=/1click
# The CI-built report published with the GitHub Pages site, read by the browser at runtime.
ARG VITE_SECURITY_REPORT_URL=https://0xileri.github.io/SpactVault/security-report.json
ARG VITE_REPO_URL=https://github.com/0xileri/SpactVault
ARG VITE_SITE_URL=
ARG VITE_EXPLORER_TX_URL=
ARG VITE_EXPLORER_ACCOUNT_URL=
# Railway-provided; used for the share card when VITE_SITE_URL is not set
ARG RAILWAY_PUBLIC_DOMAIN=
RUN VITE_SITE_URL="${VITE_SITE_URL:-${RAILWAY_PUBLIC_DOMAIN:+https://$RAILWAY_PUBLIC_DOMAIN}}" \
    pnpm --filter @spact/web build

FROM caddy:2.11.7-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
# The image's default command runs /etc/caddy/Caddyfile, which listens on $PORT (Railway sets it).
