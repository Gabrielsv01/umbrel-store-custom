.PHONY: up build start stop restart logs clean tag-version push-version release release-builder

# Docker image configuration
IMAGE_NAME = chatterbox-tts-ptbr
REGISTRY = gabrielsv01
FULL_IMAGE_NAME = $(REGISTRY)/$(IMAGE_NAME)

# Target platforms for `make release` (Umbrel runs on both amd64 boxes and
# arm64 boards like a Raspberry Pi). A plain `docker build` only produces an
# image for the machine you run it on, so multi-arch needs buildx instead.
PLATFORMS = linux/amd64,linux/arm64
BUILDER = chatterbox-multiarch

# Build and start containers in detached mode
up:
	docker-compose up -d --build

# Just build the containers without starting
build:
	docker-compose build

# Build image with version tag
build-version:
ifndef VERSION
	$(error VERSION is required. Usage: make build-version VERSION=1.2.3)
endif
	docker build -t $(IMAGE_NAME):$(VERSION) -t $(IMAGE_NAME):latest .

# Tag image with version
tag-version:
ifndef VERSION
	$(error VERSION is required. Usage: make tag-version VERSION=1.2.3)
endif
	docker tag $(IMAGE_NAME):latest $(FULL_IMAGE_NAME):$(VERSION)
	docker tag $(IMAGE_NAME):latest $(FULL_IMAGE_NAME):latest

# Push versioned image to registry
push-version: tag-version
	docker push $(FULL_IMAGE_NAME):$(VERSION)
	docker push $(FULL_IMAGE_NAME):latest

# One-time (or one-per-machine) setup: a buildx builder that can actually
# produce non-native-architecture images (uses QEMU emulation under the
# hood). Safe to re-run; does nothing if it already exists.
release-builder:
	docker buildx inspect $(BUILDER) >/dev/null 2>&1 || docker buildx create --name $(BUILDER) --use
	docker buildx use $(BUILDER)

# Multi-arch release: build for $(PLATFORMS) and push straight to the
# registry in one step. Requires `docker login` first, and buildx can't
# `--load` a multi-platform result locally, so this always pushes (there is
# no local-only equivalent — use `build-version` for that on your own arch).
# make release VERSION=1.0.0
release: release-builder
ifndef VERSION
	$(error VERSION is required. Usage: make release VERSION=1.2.3)
endif
	@echo "Building + pushing $(PLATFORMS) for version $(VERSION)..."
	docker buildx build \
		--platform $(PLATFORMS) \
		-t $(FULL_IMAGE_NAME):$(VERSION) \
		-t $(FULL_IMAGE_NAME):latest \
		--push \
		.
	@echo "Release $(VERSION) completed for $(PLATFORMS)!"

# Start existing containers
start:
	docker-compose start

# Stop containers
stop:
	docker-compose stop

# Restart containers
restart:
	docker-compose restart

# Show logs
logs:
	docker-compose logs -f

# Clean up containers, networks, and volumes
clean:
	docker-compose down -v --remove-orphans
