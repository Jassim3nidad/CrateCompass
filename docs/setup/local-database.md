# Running the local database

Status: verified on Windows 11 without administrator rights  
Last reviewed: 2026-08-05

The Supabase CLI needs a container runtime. Docker Desktop is the usual answer
and requires local administrator rights; installing Docker Engine inside WSL
requires `sudo`. Neither was available on the development machine, so this
setup uses **rootless Podman**, which needs neither.

If you already have Docker Desktop, ignore this page — `npm run db:*` will work
as written.

## One-time setup

1. Download the portable Podman build (`podman-remote-release-windows_amd64.zip`
   from the official releases) and extract it to
   `%LOCALAPPDATA%\Programs\podman`. No installer, no elevation.
2. Add `%LOCALAPPDATA%\Programs\podman\podman-<version>\usr\bin` to your user
   `PATH`.
3. Create and start the machine:

   ```bash
   podman machine init --cpus 4 --memory 4096 --disk-size 40
   podman machine start
   ```

4. Disable netavark's firewall driver. The WSL2 kernel has no `nftables` and
   the machine image ships no `iptables`, so container creation fails with
   `netavark (exit code 1): nftables error` until this is set. Rootless port
   publishing goes through a userspace proxy and does not need firewall rules:

   ```bash
   podman machine ssh "mkdir -p ~/.config/containers && printf '[network]\nfirewall_driver = \"none\"\n' > ~/.config/containers/containers.conf"
   ```

## Every session

`win-sshproxy.exe` fails to start on this machine, so the usual
`npipe:////./pipe/docker_engine` forwarding is unavailable. Expose the API on
loopback TCP instead and point `DOCKER_HOST` at it:

```bash
podman machine start
podman machine ssh "systemd-run --user --unit=podman-tcp --collect podman system service --time=0 tcp://127.0.0.1:2375"
```

Then set `DOCKER_HOST=tcp://127.0.0.1:2375` in your environment.

**Security note.** This is an unauthenticated container API, which is why it is
bound to `127.0.0.1` inside the machine rather than `0.0.0.0`. It is the same
arrangement as Docker Desktop's documented "expose daemon on tcp://localhost
without TLS" option. Do not use this shape on a shared or public host.

## Starting the stack

Two services cannot start under Podman because the CLI passes a Windows project
path as a container `workdir`, which does not exist inside the machine. Exclude
them:

```bash
npx supabase start -x edge-runtime,studio,imgproxy,logflare,vector,mailpit,realtime,storage-api,supavisor
```

Everything the database gates need — Postgres, GoTrue, PostgREST, Kong — is
included. Studio is not; use `psql` or the REST API instead.

After that, the ordinary scripts work unchanged:

```bash
npm run db:reset
npm run db:test
npm run db:lint
npm run db:types
```

## Known differences from a Docker Desktop setup

- `supabase gen types typescript --local` does not emit the
  `__InternalSupabase` block that `--linked` does. It is preserved by hand in
  `types/database.ts`; re-add it after regenerating.
- `supabase status` shells out to a `docker` binary and reports it as missing.
  Use `podman ps` instead.
