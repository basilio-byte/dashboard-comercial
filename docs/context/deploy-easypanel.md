# Deploy no Easypanel — passo a passo

## 0. Pré-requisito: a imagem precisa existir no GHCR

O deploy consome uma imagem já publicada. `.github/workflows/docker-publish.yml`
publica a cada push na `main`, em `ghcr.io/basilio-byte/dashboard-comercial`,
sempre com **duas tags**: `latest` e `sha-<short-sha>`.

**Conferir se rodou:** `github.com/basilio-byte/dashboard-comercial/actions`.

Se não houver execução nenhuma, o motivo costuma ser um destes:

- **Actions desabilitado no repositório** → Settings → Actions → General →
  "Allow all actions".
- **Cota de Actions esgotada na conta** → publicar à mão (abaixo).
- **O workflow falhou** → abrir a execução e ler o log.

### Publicar à mão (alternativa)

```bash
SHA=$(git rev-parse --short HEAD)
IMG=ghcr.io/basilio-byte/dashboard-comercial

docker build -t $IMG:latest -t $IMG:$SHA .

# PAT com escopo write:packages
echo $GITHUB_PAT | docker login ghcr.io -u basilio-byte --password-stdin

docker push $IMG:$SHA
docker push $IMG:latest
```

> **Sempre publique a tag do sha junto com `latest`.** Sem ela não há como saber
> qual commit está rodando.

### Visibilidade do pacote

Um pacote novo no GHCR nasce **privado**. Duas opções:

- deixar público (é o que o `skill-financeiro` faz): página do pacote →
  Package settings → Change visibility → Public. O Easypanel então puxa sem
  credencial;
- manter privado: cadastrar usuário GitHub + PAT com `read:packages` nas
  credenciais de registry do Easypanel.

---

## 1. Serviço Postgres

Criar um **Postgres próprio**, não compartilhado com o financeiro
([ADR-0001](decisions.md)): o `docker-entrypoint.sh` roda `prisma migrate deploy`
no boot, e dois `schema.prisma` no mesmo banco acabam com um propondo `DROP` das
tabelas do outro.

Anotar a connection string — ela vira `DATABASE_URL`.

## 2. Serviço App

Tipo **Docker Image** → `ghcr.io/basilio-byte/dashboard-comercial:latest`

- **Porta:** `3000`
- **Healthcheck:** `GET /api/health`
- **Réplicas: 1.** Ver ADR-0003 — dois agendadores competem pelo mesmo teto de
  requisições do Conexa. Numa réplica extra, `SYNC_SCHEDULER=off` é obrigatório.

## 3. Variáveis de ambiente

### Obrigatórias — sem elas o app não sobe

| Variável | Valor |
|---|---|
| `DATABASE_URL` | connection string do Postgres do passo 1 |
| `SESSION_SECRET` | `openssl rand -base64 48` |

### Necessárias para o sistema fazer algo

| Variável | Valor | Sem ela |
|---|---|---|
| `APP_URL` | URL pública do serviço | cookies e redirects erram o domínio |
| `CONEXA_API_TOKEN` | token permanente de admin do Conexa | **nada sincroniza** |
| `CRON_SECRET` | `openssl rand -hex 24` | `POST /api/sync` responde **503** |

### Primeiro boot — pode remover depois

| Variável | Valor |
|---|---|
| `ADMIN_EMAIL` | e-mail do primeiro administrador |
| `ADMIN_PASSWORD` | senha forte, mínimo 8 caracteres |
| `ADMIN_NAME` | nome exibido (opcional) |

O `bootstrap-admin` é **idempotente**: se o usuário já existe, a senha é
preservada. Deixar as variáveis não sobrescreve nada.

### Têm default seguro — só mexer com motivo

| Variável | Default | O que faz |
|---|---|---|
| `APP_TIMEZONE` | `America/Fortaleza` | fuso de todo corte de dia |
| `CONEXA_BASE_URL` | API v2 da Seahub | — |
| `CONEXA_RATE_LIMIT_PER_MIN` | `35` | teto, não alvo. Ver ADR-0002 |
| `SYNC_SCHEDULER` | `on` | carga histórica + incremental |
| `INTEL_SCHEDULER` | `on` | consolidação (não usa API) |
| `NOTIFICADOR` | **`off`** | kill-switch do disparo |
| `NOTIFICADOR_MODO` | **`dry-run`** | — |
| `CLICKUP_ENABLED` | **`off`** | — |
| `CHATWOOT_ENABLED` | **`off`** | — |

> **Todos os defaults de disparo fecham** ([ADR-0004](decisions.md)). Um deploy
> que esqueça de configurar não escreve em lugar nenhum. Como a camada de
> disparo ainda **não existe**, essas variáveis são só a trava prévia.

---

## 4. Primeiro boot

O `docker-entrypoint.sh` faz tudo sozinho:

1. `prisma migrate deploy` — cria o schema;
2. cria o primeiro admin, se `ADMIN_EMAIL`/`ADMIN_PASSWORD` estiverem definidos;
3. sobe a aplicação, e o `instrumentation.ts` liga o **agendador embutido**.

Confirmar no log do container:

```
[entrypoint] Aplicando migrations do banco (prisma migrate deploy)...
[bootstrap-admin] Administrador ... criado.
[agendador] ligado: carga histórica a cada 10min · sincronização incremental a cada 30min · consolidação da inteligência a cada 30min
```

Se o agendador listar menos tarefas, falta `CONEXA_API_TOKEN`.

## 5. Conferir de fora

```bash
curl https://SEU-DOMINIO/api/health
```

Esperado — repare que o healthcheck **confirma que o disparo subiu fechado**:

```json
{"status":"ok","db":"ok","env":"ok","timezone":"America/Fortaleza",
 "conexa":"configurado","notificador":"off","modo":"dry-run"}
```

Outras verificações:

```bash
curl -o /dev/null -w '%{http_code}\n' https://SEU-DOMINIO/          # 307 → /login
curl -o /dev/null -w '%{http_code}\n' -X POST https://SEU-DOMINIO/api/sync   # 401
```

## 6. A primeira carga

**Não precisa fazer nada.** O agendador continua a carga histórica a cada 10
minutos, sozinho, 20 janelas por vez.

Acompanhar em **Operação** → *Progresso da carga, por janela mensal*. Enquanto o
fundo do histórico não é alcançado, o total aparece como **`?`** — desconhecido
nunca é completo.

Para acelerar, o botão *Carregar dados* na mesma tela força uma rodada.

Volumes medidos (2026-08-26): ~68.500 vendas · ~28.000 cobranças · ~21.345
reservas · ~5.600 clientes · ~3.000 contratos. A 35 req/min, a carga inteira leva
algumas horas — e é **uma vez só**. Depois disso o incremental gasta ~50
requisições por dia.

## 7. Enquanto a carga não termina

As telas mostram **"não disponível"** em vez de números, e o Top 5 e o alerta de
queda ficam suprimidos. É de propósito: um R$ 0,00 sobre carga parcial é
indistinguível de um cliente que não faturou, e um ranking sobre dado parcial
aponta o cliente errado.

---

## O que este deploy AINDA NÃO faz

Para não haver surpresa:

- **não cria task no ClickUp nem manda mensagem no Chatwoot** — a camada de
  disparo não existe, nem o diretório;
- **não avalia as 10 regras** — o motor de regras é fase seguinte;
- **o saldo de horas não foi validado** contra a tela do Conexa. A tela
  **Validação** existe para essa conferência, e até ela passar as regras 2 e 9
  ficam desligadas.

O que ele **faz** hoje: espelho do Conexa carregado e conferível, receita por
cliente e por mês com variação, Top 5, perfil do cliente, consumo de horas por
ciclo com o sinal de excedente, reconciliação contra a API e a tela de operação.
