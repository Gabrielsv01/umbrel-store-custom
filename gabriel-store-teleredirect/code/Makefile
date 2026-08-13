.PHONY: install run serve stop logs test login


# Docker image configuration
IMAGE_NAME = teleredirect
REGISTRY = gabrielsv01
FULL_IMAGE_NAME = $(REGISTRY)/$(IMAGE_NAME)

# Plataformas do release publicado no registry: Umbrel roda tanto em ARM
# (Raspberry Pi) quanto em x86, então a imagem publicada precisa cobrir as
# duas — uma imagem só-arm64 não funcionaria num Umbrel x86, e vice-versa.
# Precisa de `docker buildx` + `--push` (não `docker build` comum): um
# manifest multi-plataforma não existe como imagem local única, só depois
# de publicado no registry.
PLATFORMS = linux/amd64,linux/arm64

# Build and start containers in detached mode
up:
	docker-compose up -d --build

# Just build the containers without starting
build:
	docker-compose build

# Build local (só a plataforma nativa desta máquina) pra testar antes de
# publicar — NÃO é multi-arch, é só pra rodar/inspecionar localmente.
build-version:
ifndef VERSION
	$(error VERSION is required. Usage: make build-version VERSION=1.2.3)
endif
	docker build -t $(IMAGE_NAME):$(VERSION) -t $(IMAGE_NAME):latest .

# ATENÇÃO: tag-version/push-version publicam só a plataforma nativa desta
# máquina (não multi-arch) — usar por engano depois de um `make release`
# SUBSTITUIRIA o manifest multi-arch por uma imagem de uma plataforma só.
# Pra publicar de verdade, use `make release`.
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

# Release completo: build multi-arch (amd64 + arm64) + push num só comando.
# make release VERSION=1.0.0
release:
ifndef VERSION
	$(error VERSION is required. Usage: make release VERSION=1.2.3)
endif
	@echo "Building and pushing $(FULL_IMAGE_NAME):$(VERSION) for $(PLATFORMS)..."
	docker buildx build --platform $(PLATFORMS) \
		-t $(FULL_IMAGE_NAME):$(VERSION) -t $(FULL_IMAGE_NAME):latest \
		--push .
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