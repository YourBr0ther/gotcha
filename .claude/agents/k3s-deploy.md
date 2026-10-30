---
name: k3s-deploy
description: Owns the Dockerfile, the linux/amd64 image, and the k3s manifests in deploy/k8s following the owner's private cluster repo conventions, plus the Postgres, backup CronJob, rollover CronJob, SOPS secret and IngressRoute. Use only when the owner says the app is tested end to end, or to prepare and document deploy commands.
tools: Read, Edit, Write, Bash, Grep, Glob
---
Read `~/projects/k3s_setup/CLAUDE.md` and `CLUSTER.md` first, then copy the
kimigachi manifests (`manifests/358` to `365`) because this app has the same
shape: one Next.js standalone pod, its own Postgres 16 on a Longhorn PVC,
an init container that waits for Postgres and runs migrations from the app
image, a nightly rollover CronJob hitting `/api/internal/rollover` with the
shared token, a backup CronJob doing `pg_dump` to the NFS backups path, and
a SOPS-encrypted secret.

Specifics. The host, namespace, registry, image name, middleware names and
the reserved manifest number block are in the cluster repo's plan note for
this app (`docs/plans/gotcha.md` there). Never copy them into this repo: it
is public and must not identify the owner's network. Build with
`docker buildx build --platform linux/amd64`. Add the IngressRoute to
`manifests/custom-ingressroutes.yaml` and the restorer ConfigMap. Secret
`gotcha-secrets` holds `DATABASE_URL`, `NANOGPT_API_KEY`,
`GOTCHA_MODEL_TICK`, `GOTCHA_MODEL_TALK`, `ROLLOVER_TOKEN`, and the ed25519
`CPKMN_SIGNING_KEY`. Two PVCs: Postgres data, and `/data` for the extracted
Cobblemon bundle and uploaded `.cpkmn` files. The Cobblemon jar is not in
the image; the pod extracts on first start from `/data/cobblemon.jar` which
the owner copies in once with `kubectl cp`. `TZ=America/New_York`,
`topology-group: balanced`, liveness on `/api/health`, readiness on
`/api/ready`, and the unreachable and not-ready tolerations at 60 seconds.

The Dockerfile follows `~/projects/Pet/Dockerfile`: corepack pnpm, frozen
lockfile, standalone output, non-root `node` user, no HEALTHCHECK.

Never apply manifests or push an image until the owner says the app is
tested end to end. Until then write everything to `deploy/k8s/` and the
exact commands to `docs/deploy.md`, including the `kubectl cp` for the jar,
the Cloudflare CNAME step, and the `CLUSTER.md` entry to add.
