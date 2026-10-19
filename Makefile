IMAGE ?= nofm-audio-gateway:local
FIXTURE_IMAGE ?= nofm-audio-gateway-fixture:local
SUPER_LINTER_IMAGE ?= ghcr.io/super-linter/super-linter:slim-v9.0.0@sha256:7d0b4d3387deaac975e86e0787c7a05a25d530469b27d74c2b4599ab5800d9e4

.PHONY: build check lint test test-server
build:
	docker build --tag "$(IMAGE)" .

check:
	npm run check
	docker run --rm --entrypoint sh "$(IMAGE)" -n /docker-entrypoint.d/19-validate-upstream.sh
	docker run --rm --env NOFM_UPSTREAM=127.0.0.1:8090 "$(IMAGE)" nginx -t

lint:
	docker run --rm \
		--env RUN_LOCAL=true \
		--env VALIDATE_ALL_CODEBASE=true \
		--env USE_FIND_ALGORITHM=true \
		--env ENABLE_GITHUB_PULL_REQUEST_SUMMARY_COMMENT=false \
		--env MULTI_STATUS=false \
		--env VALIDATE_DOCKERFILE_HADOLINT=true \
		--env VALIDATE_BASH=true \
		--env VALIDATE_GITHUB_ACTIONS=true \
		--env VALIDATE_BIOME_LINT=true \
		--env VALIDATE_JSON=true \
		--env VALIDATE_YAML=true \
		--volume "$(CURDIR):/tmp/lint" \
		"$(SUPER_LINTER_IMAGE)"

test:
	docker build --file test/fixture/Dockerfile --tag "$(FIXTURE_IMAGE)" test/fixture
	GATEWAY_TEST_IMAGE="$(IMAGE)" GATEWAY_FIXTURE_IMAGE="$(FIXTURE_IMAGE)" npm test

# Optional compatibility run against an already-built, actual NoFM server image.
test-server:
	GATEWAY_TEST_IMAGE="$(IMAGE)" NOFM_TEST_IMAGE="$(NOFM_TEST_IMAGE)" node --test test/server.test.mjs
