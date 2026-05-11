.PHONY: up build start stop restart logs clean build-amd64 release-amd64

# Project configuration
APP_DIR := ..
COMPOSE_FILE := $(APP_DIR)/docker-compose.yml

# Docker image configuration
IMAGE_NAME := mcp-hub
REGISTRY := gabrielsv01
FULL_IMAGE_NAME := $(REGISTRY)/$(IMAGE_NAME)
PLATFORM := linux/amd64

# Local app runtime
APP_PORT ?= 5146
APP_DATA_DIR ?= .appdata

# Build and start containers in detached mode
up:
	APP_PORT=$(APP_PORT) APP_DATA_DIR=$(APP_DATA_DIR) docker compose -f $(COMPOSE_FILE) build --no-cache
	APP_PORT=$(APP_PORT) APP_DATA_DIR=$(APP_DATA_DIR) docker compose -f $(COMPOSE_FILE) up -d

# Just build the containers without starting
build:
	docker compose -f $(COMPOSE_FILE) build

# Start existing containers
start:
	docker compose -f $(COMPOSE_FILE) start

# Stop containers
stop:
	docker compose -f $(COMPOSE_FILE) stop

# Restart containers
restart:
	docker compose -f $(COMPOSE_FILE) restart

# Show logs
logs:
	docker compose -f $(COMPOSE_FILE) logs -f

# Clean up containers, networks, and volumes
clean:
	docker compose -f $(COMPOSE_FILE) down -v --remove-orphans

# Build Intel/AMD64 image locally (no push)
build-amd64:
	docker buildx build --platform $(PLATFORM) -f Dockerfile -t $(FULL_IMAGE_NAME):latest --load .

# Build and push Intel/AMD64 image with version tag
# Usage: make release-amd64 VERSION=1.0.0
release-amd64:
ifndef VERSION
	$(error VERSION is required. Usage: make release-amd64 VERSION=1.2.3)
endif
	@echo "Building and pushing $(FULL_IMAGE_NAME):$(VERSION) ($(PLATFORM))..."
	docker buildx build \
		--platform $(PLATFORM) \
		-f Dockerfile \
		-t $(FULL_IMAGE_NAME):$(VERSION) \
		-t $(FULL_IMAGE_NAME):latest \
		--push \
		.
	@echo "Release $(VERSION) completed for $(PLATFORM)!"