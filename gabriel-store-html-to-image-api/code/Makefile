.PHONY: up build start stop restart logs clean tag-version push-version release

# Docker image configuration
IMAGE_NAME = html-to-image-api
REGISTRY = gabrielsv01
FULL_IMAGE_NAME = $(REGISTRY)/$(IMAGE_NAME)

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

# Complete release: build, tag and push
# Faz tudo: build + tag + push em um comando
# make release VERSION=1.0.0
release:
ifndef VERSION
	$(error VERSION is required. Usage: make release VERSION=1.2.3)
endif
	@echo "Building version $(VERSION)..."
	docker build -t $(IMAGE_NAME):$(VERSION) -t $(IMAGE_NAME):latest .
	docker tag $(IMAGE_NAME):latest $(FULL_IMAGE_NAME):$(VERSION)
	docker tag $(IMAGE_NAME):latest $(FULL_IMAGE_NAME):latest
	@echo "Pushing version $(VERSION) to registry..."
	docker push $(FULL_IMAGE_NAME):$(VERSION)
	docker push $(FULL_IMAGE_NAME):latest
	@echo "Release $(VERSION) completed!"

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