# 🛒 Umbrel Store Custom - Gabriel Vieira

Este repositório é uma **loja customizada de aplicativos para Umbrel**, criada por [Gabriel Vieira](https://github.com/gabrielvieira). O objetivo é disponibilizar apps que **não estavam presentes na loja oficial da Umbrel** ou que **não tinham versões compatíveis**, além de oferecer integrações e soluções para o ecossistema.

## 🚀 Sobre o Projeto

- **Apps Adaptados:** Alguns aplicativos foram portados ou adaptados para funcionar no Umbrel, incluindo ajustes de Docker, interface e integração.
- **Wrappers:** Para serviços que já existiam mas não tinham API ou interface amigável, foram criados wrappers REST, interfaces web ou gateways.
- **Apps Originais:** Alguns serviços foram desenvolvidos do zero, como APIs, automações e utilitários multimídia.

## 📦 Estrutura do Repositório

```
gabriel-store-ardour/                # Ardour (DAW)
gabriel-store-changedetection/       # Monitoramento de mudanças em sites
gabriel-store-docker-control-api/    # API para controle de containers Docker
gabriel-store-docling-server/        # Servidor Docling
gabriel-store-ffmpeg/                # API de processamento multimídia (vídeo/áudio)
gabriel-store-freecad/               # FreeCAD
gabriel-store-html-to-image-api/     # API para converter HTML em imagem
gabriel-store-jupyter-notebook/      # Jupyter Notebook
gabriel-store-kdenlive/              # Kdenlive (edição de vídeo)
gabriel-store-ngrok/                 # Gateway Ngrok
gabriel-store-telegram-webhook-api/  # API para webhooks do Telegram
gabriel-store-webhook-gateway/       # Gateway universal de webhooks
gabriel-store-webtop/                # Webtop (desktop no navegador)
gabriel-store-whisper-asr-box/       # Whisper ASR (transcrição)
```

## 🧩 Exemplos de Apps

- **gabriel-store-ffmpeg:** API REST para processamento de vídeo/áudio via FFmpeg, com sistema de jobs, fila, interface web e endpoints para upload/download.
- **gabriel-store-html-to-image-api:** Serviço para converter HTML em PNG usando Puppeteer.
- **gabriel-store-docker-control-api:** API Flask para gerenciar containers Docker remotamente.
- **gabriel-store-webhook-gateway:** Gateway universal para receber, filtrar e repassar webhooks de múltiplos serviços.

## 🛠️ Como Usar

1. Clone o repositório:
    ```bash
    git clone <url-do-repo>
    cd umbrel-store-custom
    ```
2. Entre na pasta do app desejado e siga as instruções do README específico (geralmente há um `docker-compose.yml` ou `Makefile`).
3. Suba o serviço:
    ```bash
    docker-compose up -d
    ```
4. Acesse a interface ou API conforme documentado em cada app.

## 📚 Documentação

Alguns apps possuem sua própria documentação em `code/src/doc/README.md` ou no README da pasta. Exemplos de endpoints, parâmetros e respostas estão detalhados para facilitar integração.

## 🤝 Contribuindo

- Fork o projeto
- Crie uma branch para sua feature
- Commit e push das mudanças
- Abra um Pull Request

## 🏷️ Tags

`umbrel` `custom-store` `docker` `api` `multimedia` `webhook` `automation` `typescript` `python` `node.js`

---

Desenvolvido com ❤️ por Gabriel Vieira.  
Para dúvidas, sugestões ou contribuições, abra uma issue ou entre em contato!
