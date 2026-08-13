.PHONY: install run serve stop logs test login


# Docker image configuration
IMAGE_NAME = teleredirect
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

# Clean up containers, networks, and volumes
clean:
	docker-compose down -v --remove-orphans

# Cria o virtualenv (se não existir) e instala as dependências
install:
	uv venv .venv
	uv pip install -r requirements.txt

# Servidor de desenvolvimento Flask — se não houver string.session ainda,
# a própria página raiz mostra o login (telefone/código/senha); depois de
# concluído, já entra direto na biblioteca de mídia.
run:
	uv run app.py

# Alternativa pelo terminal (telefone + código digitados aqui), pra quem
# preferir não usar a página web de login
login:
	uv run login_generate.py

# Testes unitários (não conectam ao Telegram de verdade)
test:
	uv run -m unittest discover -s tests -v

# Servidor de produção (async, não trava com streams)
serve:
	nohup uv run --with gunicorn --with gevent -- gunicorn -w 1 -k gevent -b 0.0.0.0:$${PORT:-5153} app:app > /tmp/opencode/gunicorn.log 2>&1 &
	@echo "Servidor iniciado. Logs: /tmp/opencode/gunicorn.log"

# Para o servidor gunicorn
stop-gunicorn:
	pkill -f "gunicorn -w 1 -k gevent" || true

# Acompanha os logs
logs:
	tail -f /tmp/opencode/gunicorn.log