# TeleRedirect

## Visão geral

**TeleRedirect** é um pequeno serviço web que funciona como intermediário entre um bot do Telegram e um grupo de destino:

1. **Escuta mensagens** enviadas por um bot específico (`forward.from_bot_id`).
2. **Reconstrói** o conteúdo dessas mensagens — texto ou mídia — e reenvia para um *grupo de destino* (`forward.to_group_id`). Isso é necessário porque muitos bots bloqueiam o forward nativo do Telegram; aqui o conteúdo é baixado e reenviado como se fosse novo.
3. Para mídia (vídeo, foto, documento): faz o **download para um cache local em disco** e, ao terminar, reenvia ao grupo com um link `/stream/...` apontando para o proxy local.
4. Enquanto o download está em andamento, a mídia já pode ser **assistida via streaming** na página web (`/`), na sua rede local, mesmo sem o download estar completo — o player evita deixar o usuário pedir um trecho que ainda não existe em cache.
5. Roda como **Flask** (interface web) + **Telethon** (cliente Telegram), em qualquer Linux (Umbrel, etc.).

---

## Estrutura do projeto

```
gabriel-store-teleredirect/
├─ code/
│   ├─ app.py                  # Flask: página web, /api/media, /api/media/<id>/progress, /stream/<file>
│   ├─ bot_manager.py          # Telethon: escuta o bot, baixa mídia, reenvia, reconciliação no boot
│   ├─ config.py               # loader único de config/config.yaml + variáveis de ambiente
│   ├─ media_store.py          # MediaStore: persistência + estado de cada mídia (RECEIVED/CACHING/READY/FORWARDED/ERROR)
│   ├─ remux.py                # detecta Matroska rotulado como .mp4 e remuxa (ffmpeg -c copy) pro player web
│   ├─ login_generate.py       # alternativa: gera string.session pelo terminal (rodar manualmente)
│   ├─ requirements.txt
│   ├─ Makefile                # install/run/serve/stop/logs/test/login (todos executados a partir de code/)
│   ├─ static/
│   │   └─ player.js           # controller do player: barra de cache + seek inteligente
│   ├─ templates/
│   │   ├─ index.html          # página web (biblioteca de mídia)
│   │   └─ login.html          # tela de login (telefone/código/senha), mostrada automaticamente sem sessão
│   └─ tests/                  # testes unitários (não tocam no Telegram real)
├─ config/
│   ├─ config.yaml             # config real (NÃO versionado — contém segredos)
│   └─ config.example.yaml     # template sem segredos, para copiar para config.yaml
└─ data/                   # dados de runtime, tudo NÃO versionado
    ├─ cache/               # cache local de mídia baixada
    ├─ string.session       # sessão Telethon (gerada por login_generate.py)
    ├─ media_store.json     # estado persistido de cada mídia
    └─ bot_activity.log     # log do BotManager
```

* `code/requirements.txt` contém: `telethon`, `flask`, `requests`, `pyyaml`, `qrcode[pil]`, `imageio-ffmpeg`.
* Todo valor de `config/config.yaml` pode ser sobrescrito por variável de ambiente (`TELETHON_API_ID`, `TELETHON_API_HASH`, `TELE_REDIRECT_FROM_BOT_ID`, `TELE_REDIRECT_TO_GROUP_ID`, `TELE_REDIRECT_BASE_URL`), que tem prioridade sobre o arquivo.
* `code/config.py` resolve `BASE_PATH` como a raiz do projeto (um nível acima de `code/`) — é onde ficam `config/` e `data/` (via `config.DATA_PATH`), independente de onde o código-fonte está.

---

## Como usar

### 1. Instalar dependências

```bash
cd gabriel-store-teleredirect/code
make install
```

(equivalente a `uv venv .venv && uv pip install -r requirements.txt`, dentro de `code/`)

### 2. Configurar credenciais

```bash
cd gabriel-store-teleredirect
cp config/config.example.yaml config/config.yaml
```

Edite `config/config.yaml` com seus valores reais (`telethon.api_id`, `telethon.api_hash`, `forward.from_bot_id`, `forward.to_group_id`, `proxy.base_url`), ou defina as variáveis de ambiente equivalentes. `config/config.yaml` já está no `.gitignore` — nunca é versionado.

Opcionalmente, `cache.retention_seconds` controla por quanto tempo (padrão 3600s) uma mídia já reenviada ao grupo continua disponível em `/stream` antes de ser removida do cache local.

### 3. Iniciar o serviço (login acontece dentro do próprio app)

```bash
cd gabriel-store-teleredirect/code
make run     # servidor de desenvolvimento (uv run app.py)
# ou, em produção:
make serve   # gunicorn + gevent, necessário para não travar durante os streams
make stop    # para o gunicorn
make logs    # acompanha os logs do gunicorn
```

Acesse `http://<IP_DA_MAQUINA>:5153/` na sua rede local. A porta pode ser trocada via variável de ambiente `PORT`.

- **Sem `string.session` ainda**: a própria página raiz já mostra o formulário de login — telefone → código recebido no Telegram → senha de verificação em duas etapas (se sua conta tiver). Ao concluir, a sessão é salva, o `BotManager` inicia automaticamente e você já é redirecionado direto pra biblioteca de mídia. Não precisa subir nenhum processo separado pra isso.
- **Já existe `string.session`**: a página raiz já abre direto na biblioteca de mídia, sem pedir login de novo.

Alternativa pelo terminal, se preferir não usar a página web de login (útil por exemplo se quiser gerar a sessão antes mesmo de configurar a rede/porta do app):

```bash
cd gabriel-store-teleredirect/code
make login
# ou: uv run login_generate.py
```

### 5. O que acontece

- O `BotManager` conecta ao Telegram em background e escuta apenas mensagens do bot configurado.
- Mensagem de texto → reenviada diretamente ao grupo.
- Mensagem com mídia → metadados salvos (nome, tamanho, mime, duração, se o Telegram já marca o arquivo como `supports_streaming`), download iniciado para `data/cache/`, e só depois de concluído o arquivo é reenviado ao grupo com o link `/stream/...`.
- Uma mensagem de status é enviada ao grupo assim que o download começa (`📥 Baixando: nome\nX%`), editada no próprio lugar a cada 20s conforme o progresso (baixando → processando → enviando), e apagada automaticamente quando o reenvio termina — ou trocada por uma mensagem de erro, se algo falhar.
- O cache local não é apagado imediatamente após o reenvio — fica disponível por `cache.retention_seconds` (contado a partir do último acesso via `/stream`), pra não cortar quem estiver assistindo no momento. Uma varredura roda a cada 5 min em segundo plano, independente de mensagens novas chegarem.
- Se o processo reiniciar no meio de um download, ele descarta o cache parcial e reinicia esse download do zero automaticamente (não tenta retomar por offset).

---

## Streaming e o player "inteligente"

O `/stream/<id>` é um proxy HTTP com suporte a `Range` requests: cada resposta entrega exatamente os bytes que já existem em disco naquele instante — nunca mais do que o `Content-Length` declarado. O `Content-Range` também sempre declara como "total" o que já existe em disco AGORA, nunca o tamanho final esperado do arquivo original — sem isso, o próprio navegador pode fazer prefetch/buffering interno (fora do alcance do player em JS) além do que já foi baixado, e um request assim batendo no vazio virava um `503` que o `<video>` trata como erro fatal de rede (o player parece "quebrado"). Se o navegador ainda assim pedir um trecho que não existe, espera até 30s (o download está ativamente avançando) antes de responder `503 Retry-After`.

O player (`static/player.js`) usa duas fontes de informação:
- **`/api/media/<id>/progress`** (bytes já em cache, duração, estado) — usado para estimar até que ponto do vídeo é seguro deixar o usuário avançar, e para desenhar a barra "Cache: mm:ss / mm:ss".
- **`video.seekable`** (o que o próprio navegador conseguiu interpretar) — usado como guarda final antes de qualquer seek programático.

Se o usuário arrasta a barra de progresso para um ponto além do que já foi baixado, o player redireciona a reprodução para a borda do cache, mostra "⏳ Aguardando o cache alcançar o ponto pedido..." e salta automaticamente para o ponto pedido assim que o download alcançar.

**Limitação conhecida (moov atom):** isso depende do arquivo MP4 ter a estrutura de índice (`moov atom`) posicionada de forma que o navegador consiga interpretar antes do download terminar. O próprio Telegram expõe esse sinal via `supports_streaming` nos metadados do vídeo; quando é `False`, a página mostra um aviso e o seek pode ficar limitado até o download terminar.

### Arquivos Matroska (.mkv) rotulados como .mp4

Muitos bots de redistribuição de filmes/séries mandam arquivos que são, na verdade, **Matroska (MKV)** com extensão e `mime_type` de `.mp4`. O `<video>` do navegador não decodifica Matroska de forma alguma — nesse caso, nenhum navegador reproduz o arquivo, independente de cache ou moov atom.

O `bot_manager.py` detecta isso automaticamente (assinatura EBML no início do arquivo) e, quando o download termina, **remuxa** (não recodifica — os codecs internos, tipicamente H.264/AAC, já são nativos do navegador) o arquivo para um `.web.mp4` usando `ffmpeg -c copy`. O `/stream` passa a servir esse arquivo remuxado automaticamente; o original (Matroska) continua sendo o que é reenviado ao grupo, sem alteração.

O `ffmpeg` usado é o binário empacotado pela dependência Python `imageio-ffmpeg` (já no `requirements.txt`) — `make install` resolve tudo, sem precisar de `sudo`/`apt-get` nem depender de nada pré-instalado no sistema. Se por algum motivo esse pacote não conseguir prover um binário pra sua plataforma, o código cai automaticamente para um `ffmpeg` do `PATH` do sistema, se houver um.

Se nenhum dos dois estiver disponível, o `BotManager` loga um aviso na inicialização e segue funcionando normalmente — só não remuxa; arquivos Matroska ficam disponíveis via VLC/mpv (que decodificam Matroska nativamente, incluindo enquanto o arquivo ainda está sendo baixado), mas não reproduzem no player web até o remux acontecer.

**Prévia parcial durante o download:** enquanto o cache ainda está sendo preenchido, o `bot_manager.py` gera periodicamente (a cada `PARTIAL_REMUX_INTERVAL_SECONDS`, se houver bytes novos suficientes) uma prévia web remuxando uma cópia congelada do que já existe em disco — ffmpeg lida bem com um Matroska cortado no meio (loga aviso, mas termina com sucesso, cobrindo exatamente o que já foi baixado). Isso é sobrescrito por um remux final completo quando o download termina. Se, por algum motivo, nenhuma prévia parcial ainda existir (ex.: logo no início do download), a página mostra o aviso e sugere abrir o link direto no VLC/mpv nesse meio-tempo.

**MP4 real sem faststart — moov buscado fora de ordem:** um MP4 de verdade (não Matroska) com o box `moov` no final não tem como gerar prévia parcial do jeito simples acima — sem o `moov`, nenhum demuxer (nem o próprio ffmpeg) sabe onde estão os frames dentro do `mdat`, então a tentativa falha com "moov atom not found" a cada ciclo até o download alcançar o `moov` de verdade (normalmente só perto do fim). Pra contornar isso, `_try_fetch_moov_tail` (em `bot_manager.py`) calcula onde o `moov` DEVERIA estar (`remux.find_moov_expected_offset`, válido só para o layout simples `ftyp → [boxes pequenos] → mdat → moov`) e busca exatamente esse trecho fora de ordem via `client.iter_download(offset=...)` — uma vez só por download, cacheado em `<arquivo>.moov_tail` ao lado do cache. Com o `moov` real em mãos, `remux.assemble_sparse_preview_source` monta um arquivo de entrada "esparso" (prefixo já baixado + buraco ainda não escrito, sem custo real de disco em filesystems POSIX + o `moov` na posição certa) que o ffmpeg processa normalmente. Quando o layout não bate com o padrão simples, a busca falha, ou o arquivo total passa de `MOOV_TAIL_MAX_TOTAL_SIZE` (limite pra não arriscar uso de disco temporário desproporcional, já que o remux de saída não preserva a esparsidade), essa técnica simplesmente não se aplica — sem prévia parcial nesse caso específico, mas o remux final ainda garante que fique reproduzível assim que o download terminar.

**Importante:** o `.web.mp4` produzido por essa técnica fica com tamanho em disco próximo do arquivo TOTAL desde a primeira vez que é gerado (o trecho ainda não baixado sai preenchido com zeros), mesmo quando só uma fração é conteúdo real — o `moov` buscado adiantado descreve a duração completa de verdade. Por isso o `/stream` nunca usa o tamanho em disco puro como teto pra esse arquivo: usa `remuxed_up_to_bytes` (quantos bytes da fonte crua eram reais na última prévia gerada) como limite de `Content-Range`/leitura, preservando a mesma garantia de nunca declarar disponível mais do que é de fato reproduzível.

---

## Testes

```bash
cd gabriel-store-teleredirect/code
make test
# ou
uv run -m unittest discover -s tests -v
```

Os testes usam um `BotManager` fake — não conectam ao Telegram real nem exigem `config/config.yaml` preenchido.

---

## Docker

```bash
cd gabriel-store-teleredirect
cp config/config.example.yaml config/config.yaml   # se ainda não existir — edite com seus valores reais
docker compose up -d --build
```

- Expõe a porta `5153` (`ports: 5153:5153` no `docker-compose.yml`; ajustável via `PORT`).
- `config/` e `data/` são montados como volumes (`./config:/app/config`, `./data:/app/data`) — segredos e estado (sessão, cache, `media_store.json`, log) ficam fora da imagem e sobrevivem a rebuilds.
- Sem `data/string.session` ainda: acesse `http://<IP_DA_MAQUINA>:5153/login` e complete o login normalmente — a sessão gerada fica salva em `data/`, no host.
- `docker compose logs -f` acompanha os logs do gunicorn; `docker compose down` para o container.
- O *build context* é a pasta `code/` (mesma convenção dos outros apps do repo) — dá pra rodar `docker build -t teleredirect .` direto de dentro de `code/`, ou os alvos `make build-version`/`make release` de lá também. O `Dockerfile` recria a pasta `code/` dentro da imagem (`/app/code`), porque `code/config.py` depende de `code/` estar uma pasta abaixo da raiz (`/app`) pra calcular `BASE_PATH` corretamente — segredos e dados (`config/`, `data/`) nunca entram na imagem, já que ficam fora do build context.

---

## Pontos importantes / boas práticas

| Recurso | Como está implementado | Observação |
|---------|-----------------------|------------|
| **Login** | Embutido no próprio `app.py` (`/login`, `/login/send_code`, `/login/sign_in`, `/login/password`): mostrado automaticamente na raiz enquanto não há `string.session`. Alternativa via terminal: `login_generate.py`. | `bot_manager` global fica `None` até o login terminar; um `before_request` redireciona tudo pra `/login` até lá. Ao concluir, o `BotManager` é criado e o usuário já vai direto pra biblioteca de mídia. |
| **Leitura de mensagens** | `events.NewMessage(from_users=bot_id)` — escuta apenas do bot especificado. | Não escuta mensagens de outros usuários. |
| **Encaminhamento** | Copia o conteúdo manualmente (download + `send_file`). | Contorna a restrição de *forward* que alguns bots impõem. Testado também: referenciar a mídia direto (`send_file(file=msg.media)`, sem baixar) — bloqueado com `ChatForwardsRestrictedError` em chats com conteúdo protegido, a mesma restrição do forward nativo. Não tem como contornar isso sem baixar os bytes pelo menos uma vez. |
| **Download e upload simultâneos** | Quando o tamanho final já é conhecido (metadado do próprio Telegram), `_download_and_upload_concurrently` faz as duas coisas ao mesmo tempo: o upload lê de `_GrowingFileUploadStream`, que bloqueia (via polling) só até alcançar o que o download ainda não escreveu. Tempo total passa a ser ~`max(download, upload)` em vez de ~soma dos dois. | Vale a pena principalmente quando o upload (banda de subida residencial, geralmente mais fraca que a de download) é o lado mais lento. Sem tamanho conhecido de antemão (raro), cai pro caminho sequencial de sempre (`_download_then_upload_sequential`). Pausar durante essa fase cancela os dois lados juntos — como upload não retoma (protocolo do Telegram), retomar depois sempre reenvia do zero. |
| **Estado de cada mídia** | `MediaStore` (`media_store.py`): `RECEIVED → CACHING → READY → UPLOADING → FORWARDED`, ou `ERROR`. | Substitui checagens implícitas de arquivo/lock. |
| **Progresso do upload** | `progress_callback` do Telethon, exposto em `/api/media/<id>/progress` (`uploaded_bytes`/`upload_total_bytes`). Pode avançar já durante `CACHING` (download+upload simultâneos, ver acima), não só em `UPLOADING`. | A mensagem de status no grupo mostra os dois progressos juntos quando simultâneo ("Baixando e enviando"); o player web reaproveita a mesma barra do cache pra mostrar "Enviando ao grupo: X/Y". |
| **Reenvio como vídeo de verdade** | `attributes=[DocumentAttributeVideo(supports_streaming=True, duration, w, h)]` no `send_file`, reaproveitando os atributos da mensagem original. | Sem isso, o Telegram trata o reenvio como documento genérico (sem player embutido). |
| **Retenção de cache** | Configurável via `cache.retention_seconds`; baseada em último acesso via `/stream`. Varredura roda em segundo plano a cada 5 min, independente de mensagens novas chegarem do bot. | Evita cortar quem está assistindo no momento do reenvio; não depende de tráfego pra limpar o cache expirado. |
| **Resiliência a restart** | Cache parcial órfão é descartado e o download reiniciado do zero. | Timeout de download proporcional ao tamanho do arquivo. |
| **Pausar/retomar/excluir** | Botões na página web, por item, enquanto ele não foi totalmente enviado. Pausar cancela a task ativa; retomar refaz o fetch da mensagem no Telegram. | Download retoma de verdade pelo byte exato (`client.iter_download(offset=...)`). Upload não tem como retomar de onde parou (protocolo do Telegram) — ao retomar, reenvia do zero, mas sem rebaixar (arquivo já em cache). Excluir cancela tudo, limpa cache + mensagem de status, e some da página. |
| **Mensagem de status no grupo** | Enviada ao começar o download, editada no lugar a cada 20s (baixando → processando → enviando), apagada no sucesso ou trocada por erro/pausado. | Usa `(chat_id, message_id)` salvos no store, não o objeto em memória — assim pausar/excluir também conseguem editá-la/apagá-la de fora do fluxo principal. |
| **Matroska/.mkv como .mp4** | Detectado pela assinatura EBML; remuxado (`ffmpeg -c copy -movflags +faststart`) para `.web.mp4`. | `ffmpeg` vem via `imageio-ffmpeg` (pip, escopado ao `.venv`); sem ele, degrada para "só funciona em VLC/mpv". |
| **MP4 real com moov no final** | `remux.needs_remux()` também detecta isso (box `moov` não aparece nos primeiros ~8MB) e aplica o mesmo remux com `+faststart` ao final do download. Durante o download, `_try_fetch_moov_tail` busca o `moov` fora de ordem por offset pra viabilizar prévia parcial também nesse caso. | Sem faststart, o navegador nunca fica sabendo que existe mais conteúdo pra buscar no final (por causa do `Content-Range` limitado ao que já existe em disco) e desiste achando que não há vídeo decodificável. A busca fora de ordem só funciona pro layout simples `ftyp → mdat → moov`; fora disso (ou arquivo maior que `MOOV_TAIL_MAX_TOTAL_SIZE`), degrada sem prévia parcial até o download terminar. |
| **Segurança** | Credenciais lidas de variáveis de ambiente ou `config/config.yaml` (fora do versionamento). | Use `config/config.example.yaml` como template. |

---

## Próximos passos / extensões possíveis

- **Interface de gerenciamento**: página para mudar `from_bot_id`/`to_group_id` sem editar `config/config.yaml`.
- **Persistência em banco**: se o volume crescer muito, migrar `media_store.json` para SQLite.

---

## Licença

Este projeto está licenciado sob a licença MIT.
