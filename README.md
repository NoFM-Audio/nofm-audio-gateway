# NoFM Audio Gateway

> **In development:** this project is still being built and may change before a stable release.

NoFM Audio provides a free, open-source way for visitors to hear a light show's
soundtrack on their phones. This gateway makes its standalone player publicly
accessible through a visitor-only interface. Playlist management and administration
remain separate from the public player.

## Architecture

```text
Visitor → NoFM Audio Gateway → NoFM Audio server
                                      ↑
                                FPP timecode (UDP)
```

The gateway proxies HTTP and WebSocket traffic only. It does not store audio,
process timecode, transcode media, poll FPP, or require admin tokens. FPP remains
the show player and sends UDP directly to the NoFM server. Choose the hosting,
public ingress, and administrative access arrangements that suit your deployment.

Proxy rules are baked into a custom image based on a version- and digest-pinned
[unprivileged Nginx image](https://github.com/nginx/docker-nginx-unprivileged).
Only the upstream address changes between deployments. Nginx runs as UID/GID 101,
with one worker, and can run with a read-only root filesystem and writable `/tmp`.

## Build and run

Requirements: Docker, Make, and Node 24 for tests. There are no npm dependencies or
install steps. From this directory:

```sh
make build

docker run --rm --name nofm-audio-gateway \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -p 127.0.0.1:18080:8080 \
  -e NOFM_UPSTREAM=host.docker.internal:8090 \
  nofm-audio-gateway:local
```

On Docker Desktop, `host.docker.internal` reaches a NoFM server published on the
host. On Linux, use a reachable server address or a container DNS name on a shared
Docker network. Open `http://localhost:18080/cast/`. The upstream must be reachable
from inside the container.

`NOFM_UPSTREAM` is required and accepts a DNS hostname or IPv4 address followed by
a TCP port, for example `nofm-audio-server:8090` or `192.0.2.10:8090`. Do not include
a URL scheme, path, credentials, or IPv6 address. Invalid values fail startup.
DNS is resolved when Nginx starts; restart the gateway when a DNS-backed upstream
changes address. Use a stable upstream address where possible.

No authentication token belongs in the gateway environment. Configure player
return links, audio storage, FPP authentication, and administrative access on the
NoFM server itself.

## Public routes

| Route | Behavior |
| --- | --- |
| `/` | Redirect to `/cast/` |
| `/cast/`, `/cast/index.html` | Player document |
| `/cast/style.css`, `/cast/player.js`, `/cast/playback.js` | Player assets |
| `/cast/api/status`, `/cast/api/time`, `/cast/api/player-config` | Public playback information |
| `/cast/audio/…` | Audio with encoded paths, byte ranges, HEAD, and ETags preserved |
| `/cast/ws` | WebSocket upgrade and playback updates |
| `/healthz` | Gateway process health; does not check upstream readiness |

Only GET/HEAD requests are allowed. Other methods return 405; unlisted paths return
404. Management routes remain blocked even if a visitor supplies an admin token.
Authorization and Cookie headers are stripped before proxying. Host and Origin
are preserved for the NoFM server's WebSocket origin checks. Proxy caching and
buffering are disabled.

The allowlist matches the current NoFM player assets and APIs. Review and test it
when a future player release introduces new routes. This image is designed for
HTTP upstream connections. Provide HTTPS for public access using your chosen
reverse proxy, load balancer, or other ingress. Protect administrative access
separately; exposing the NoFM server directly can bypass the gateway’s restrictions.

## Local validation

```sh
make build
make check
make lint
make test
```

`make check` validates JavaScript syntax, startup shell syntax, and rendered Nginx
configuration. `make lint` runs the pinned Super-Linter container with the same Dockerfile, shell,
GitHub Actions, JavaScript, JSON, and YAML checks used by CI. Rules live in
`.github/linters` and `biome.json`; Biome checks the ESM `.mjs` files. Local lint
output is ignored by Git.
`make test` builds a disposable Node HTTP/WebSocket fixture and runs the **built
gateway image**, without mounting replacement proxy configuration. It covers
public assets/APIs, credential stripping, blocked management/mutations, encoded
Unicode paths, Range/HEAD/ETag behavior, WebSocket messages and origin rejection,
non-root read-only execution, and invalid startup settings.

Tests publish only random loopback ports, use no real credentials, and remove
their own containers/network afterward. The fixture deliberately exposes
management paths, so tests verify that the gateway blocks them independently of
upstream authentication. Neither FPP nor another repository is required.

For optional compatibility coverage against the actual NoFM server, build its
image separately and run:

```sh
make test-server NOFM_TEST_IMAGE=nofm-audio-server:integration
```

This uploads fixture audio and checks the real player's public endpoints,
WebSocket upgrade, file ranges, private admin access, and management blocking.
The server image is required only for this optional target, not normal CI.

## CI and image releases

GitHub Actions is the primary build, test, and release path. It runs for main
pushes, pull requests, version tags, and manual runs. Docker’s pinned Buildx and
build/push actions build and load the gateway and fixture images, then integration
tests exercise the built gateway. Super-Linter checks source and workflow files
before builds. Release steps run only after those checks pass.
The Makefile provides a local fallback for build verification and troubleshooting.

The workflow uses one Ubuntu 24.04 job per run, pinned actions/tooling, and a
single test architecture. Checks need no production credentials or paid services. There is no
platform matrix or dependency cache to maintain.

After checks pass, pushing a `vMAJOR.MINOR.PATCH` tag publishes version and commit
SHA tags to Docker Hub. Configure these in the GitHub repository's Actions settings:

| Setting | Type | Value |
| --- | --- | --- |
| `DOCKERHUB_USERNAME` | Repository variable | Docker Hub login with write access to the image repository |
| `DOCKERHUB_IMAGE` | Repository variable | `namespace/nofm-audio-gateway`, without a registry prefix or tag |
| `DOCKERHUB_TOKEN` | Repository secret | Docker Hub access token with permission to push that image |

For the upstream project, `DOCKERHUB_IMAGE` is `nofmaudio/nofm-audio-gateway`.
Forks can publish under their own namespace. The Docker Hub login may differ
from the image namespace when publishing to an organization. Keep the token in
GitHub Actions secrets, outside source files and deployed containers.

Pull requests and ordinary branch pushes never publish. The publish build targets
Linux amd64 and arm64; runtime integration tests execute only on the amd64 GitHub
runner. Docker’s metadata action generates version/SHA tags and OCI labels, and
its login action handles registry authentication and cleanup. The image build only copies
configuration, so cross-platform compilation or emulation is unnecessary.

Review and approve release tags before pushing them. No `latest` tag is published.
Protect release tags in the repository settings and use a public Docker Hub
repository if deployments should pull without credentials. The workflow uses
[Docker Hub authentication for GitHub Actions](https://docs.docker.com/build/ci/github-actions/multi-platform/).
The pipeline remains unverified until it runs on GitHub.

## Deployment considerations

Use a published image version or digest and set `NOFM_UPSTREAM` to a reachable
NoFM server. Proxy configuration is included in the image; external template
mounts are unnecessary.

The container listens on port 8080 and runs as UID/GID 101. If using a read-only
root filesystem, provide a writable `/tmp` directory; the local example uses a
16MiB temporary filesystem. Ensure your container runtime gives the process
permission to write there.

Use `/healthz` for gateway process health checks. It deliberately does not check
the NoFM server, so an upstream outage does not require restarting the gateway.

If placing another proxy or ingress in front of the gateway, preserve WebSocket
upgrades and the public Host/Origin, retain the `/cast/` paths, and bypass caching
for playback APIs. Direct visitors or website listening links to the public
`/cast/` URL. Choose administrative access controls separately from this public
endpoint; the gateway does not provide an administrative interface.

## License

AGPL-3.0-or-later, consistent with the NoFM Audio server. See [LICENSE](LICENSE).
