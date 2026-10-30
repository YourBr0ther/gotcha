# Deploying Gotcha

One container plus its own Postgres 16. The image is a Next.js standalone
build with three precompiled tools next to it (the Cobblemon extractor, the
pokedex builder, the migrator). The Cobblemon jar is not in the image and
never will be; you copy it onto the data volume once and the pod does the
rest on first start.

The manifests in `deploy/k8s/` are generic. The values that tie a copy to a
particular cluster (host, registry, namespace, middleware names, storage
class) are placeholders, listed under "Adapting the placeholders" below.
Keep your filled-in copies outside this repository.

## What the image holds

| Path in the image | What it is |
|---|---|
| `/app/server.js`, `/app/.next`, `/app/public` | The Next.js standalone server and its static files |
| `/app/drizzle` | The SQL migrations, read by the migrator from the working directory |
| `/app/tools/extract.mjs` | The Cobblemon extractor, bundled from `packages/cobblemon-assets` |
| `/app/tools/pokedex.mjs` | The pokedex builder, bundled from `packages/pokedex` |
| `/app/tools/migrate.mjs` | `src/lib/db/migrate.ts`, bundled |
| `/app/entrypoint.sh` | `deploy/entrypoint.sh` |
| `/data` | The volume. `GOTCHA_DATA_DIR` and `COBBLEMON_CACHE_DIR` point here |

The tools exist because the extractor and the pokedex builder are
TypeScript meant for `tsx` on a laptop, and the image carries neither `tsx`
nor the full `node_modules`. The build stage bundles each with esbuild
(already present as a dependency of `tsx`) into one self-contained file, so
the entrypoint can run them with plain `node`. `deploy/tools/` holds the two
wrapper entry points; the migrator bundles as is.

`next.config.ts` sets `output: "standalone"`, which `next dev` ignores and
`next build` uses to write `.next/standalone/`.

`/api/ready` answers 503 with `pokedex: "warming"` until the pokedex cache
exists, so the Service sends no traffic to a pod that is still building it
on first start.

The image runs as the `node` user (uid 1000). It sets no `HEALTHCHECK`;
the Kubernetes probes own that.

## Building

Every target node is x86_64, so always build for `linux/amd64`, even from
an ARM laptop. `BUILD_ID` rides on the service worker URL so each deploy
invalidates the previous one's caches on phones; pass the tag.

```sh
TAG=$(date +%Y%m%d)-first-deploy
docker buildx build --platform linux/amd64 \
  --build-arg BUILD_ID=$TAG \
  -t registry.example.com/gotcha:$TAG --push .
```

To build without pushing, replace `--push` with `--load` and the registry
prefix with a local name such as `gotcha:local`. A cold build takes a few
minutes; the pnpm store is cached between builds with a BuildKit cache
mount, so later builds only reinstall when the lockfile changes.

## Running the image on its own

Useful before the first cluster deploy. Start the dev database from the
repo (`pnpm db:up`, listening on 5434), put the jar in an empty directory,
and run:

```sh
mkdir -p /tmp/gotcha-data
cp assets/cobblemon/cobblemon.jar /tmp/gotcha-data/
docker run --rm -p 3600:3000 \
  -e DATABASE_URL=postgres://gotcha:gotcha@host.docker.internal:5434/gotcha \
  -v /tmp/gotcha-data:/data \
  gotcha:local
```

Then `curl localhost:3600/api/health`, `curl localhost:3600/api/ready`,
and `curl localhost:3600/api/assets/eevee/species.json` once the
extraction log line says it finished.

## First start

`deploy/entrypoint.sh` runs on every start and does only what is missing:

1. If `/data/cobblemon-cache/index.json` is absent and `/data/cobblemon.jar`
   exists, it runs the extractor. This writes about 125 MB and took 40
   seconds in a local test under amd64 emulation; the server is not up
   yet, so the startup probe in the Deployment allows fifteen minutes
   before liveness applies, enough for a slow node. With no jar
   it logs a warning and starts anyway, with no models.
2. If `/data/pokedex-cache/species/index.json` is absent, it starts the
   pokedex build in the background. That fetches from PokeAPI and keeps the
   raw responses under `/data/pokedex-cache/pokeapi`, so a rebuild later is
   mostly local. If the build fails it deletes `index.json` so the next
   start retries.
3. It applies migrations (the Deployment's `migrate` initContainer already
   did; this keeps `docker run` self-sufficient).
4. It starts the server.

`/api/ready` currently answers `ok` as soon as the database is migrated,
whether or not the pokedex has finished. Until it reports a warming state,
check `kubectl logs` for `pokedex cache ready`.

To force a rebuild of either cache, delete its `index.json` and restart
the pod. To refresh after a new Cobblemon version, replace the jar and
delete `/data/cobblemon-cache/index.json`; the pokedex should be rebuilt
too since its species list comes from the extraction.

## Kubernetes

### Adapting the placeholders

| Placeholder | Where | Replace with |
|---|---|---|
| `registry.example.com/gotcha:TAG` | `deployment.yaml` (twice) | The image you pushed |
| `gotcha.example.com` | `ingressroute.example.yaml` | The hostname |
| `forward-auth`, `secure-headers` | `ingressroute.example.yaml` | Your Traefik middleware names |
| namespace `gotcha` | every file | An existing namespace if you prefer; delete `namespace.yaml` |
| `storageClassName` | absent from the PVCs | Set it if the cluster default is not a block volume |
| `America/New_York` | Deployment, both CronJobs, Postgres | Your zone. Keep all four the same |
| `change-me` | `secret.example.yaml` | Real values |

The identity header is the one thing with no default. Gotcha reads
`Remote-User` from the request and has no login screen, so the route must
sit behind a forward-auth middleware that sets that header. A Service
reachable without one lets anyone be anyone.

### Secret

```sh
cp deploy/k8s/secret.example.yaml /somewhere/private/gotcha-secret.yaml
pnpm tsx scripts/keygen.ts        # prints CPKMN_SIGNING_KEY and the matching public key
# edit the file, then
kubectl apply -f /somewhere/private/gotcha-secret.yaml
```

`POSTGRES_PASSWORD` and the password inside `DATABASE_URL` must agree.
`ROLLOVER_TOKEN` is any long random string; the CronJob sends it as a
bearer token.

### Apply order

```sh
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f /somewhere/private/gotcha-secret.yaml
kubectl apply -f deploy/k8s/postgres-pvc.yaml \
              -f deploy/k8s/postgres-deployment.yaml \
              -f deploy/k8s/postgres-service.yaml
kubectl apply -f deploy/k8s/data-pvc.yaml \
              -f deploy/k8s/deployment.yaml \
              -f deploy/k8s/service.yaml
kubectl apply -f deploy/k8s/rollover-cronjob.yaml \
              -f deploy/k8s/backup-cronjob.yaml
kubectl apply -f deploy/k8s/ingressroute.yaml   # your edited copy
```

### Copying the jar

The first app pod comes up without models, because the volume is empty.
Copy the jar in and restart:

```sh
POD=$(kubectl -n gotcha get pod -l app=gotcha -o jsonpath='{.items[0].metadata.name}')
kubectl -n gotcha cp assets/cobblemon/cobblemon.jar "$POD:/data/cobblemon.jar"
kubectl -n gotcha rollout restart deployment/gotcha
kubectl -n gotcha logs -f deployment/gotcha
```

`kubectl cp` of 140 MB over the API server takes a minute or two. Watch the
log for `extracted ... species` and later `pokedex cache ready`.

### DNS and TLS

Point the hostname at the cluster's ingress address (a CNAME to whatever
name your tunnel or dynamic DNS gives you) and let Traefik's certificate
resolver pick it up, the same way every other route on the cluster does.

### Upgrading

Build and push a new tag, change both `image:` lines in `deployment.yaml`,
apply. The Deployment uses `Recreate` because the data volume is
ReadWriteOnce, so there is a gap of a few seconds while the new pod mounts
the volume and passes readiness. Migrations run in the initContainer from
the new image before the new server starts.

### Backups and restore

The backup CronJob writes a verified `pg_dump` custom-format file to the
`gotcha-backups` volume at 02:30 local and keeps thirty. To restore one:

```sh
# list what is there
kubectl -n gotcha run -it --rm pg --image=postgres:16 --restart=Never \
  --overrides='{"spec":{"volumes":[{"name":"b","persistentVolumeClaim":{"claimName":"gotcha-backups"}}],"containers":[{"name":"pg","image":"postgres:16","command":["sleep","3600"],"volumeMounts":[{"name":"b","mountPath":"/backups"}]}]}}'
# inside: ls /backups, then
# pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" /backups/gotcha-<stamp>.dump
```

Scale the app to zero first so nothing writes during the restore.

### Running the rollover by hand

```sh
kubectl -n gotcha create job --from=cronjob/gotcha-rollover rollover-now
kubectl -n gotcha logs job/rollover-now
```

## Known rough edges

`src/lib/services/species.ts` joins a species id onto the cache path at
runtime, and Next's tracer answers that by tracing the whole project into
the standalone output. The build prints a warning about it. The image is
larger than it needs to be as a result; scoping that `path.join` the way
the warning suggests would shrink it.
