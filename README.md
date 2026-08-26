# Seahub Comercial

Dashboard de **inteligência comercial** da [Seahub Coworking](https://seahubcoworking.com.br)
(Natal/RN). Consolida o perfil de cada cliente a partir do ERP **Conexa** e aponta, por **regras
determinísticas**, onde existe potencial de venda adicional — abrindo uma task no **ClickUp** para
o vendedor responsável.

> Sistema single-tenant. Roda como container único no **Easypanel** da empresa, ao lado do
> [Dashboard Financeiro](../../Dashboard%20Financeira%20Seahub/seahub_financeiro).

## O que ele é

1. **Espelho local e auditável** dos dados comerciais do Conexa — clientes, contratos, planos,
   vendas, cobranças e **reservas de sala** (inédito no ecossistema Seahub).
2. **Perfil consolidado por cliente** — receita no ano, receita mês a mês com variação, Top 5,
   uso de horas, saldo de cota, segmentos, vendedor. Cada número com **procedência declarada**.
3. **Motor de regras determinístico e parametrizável** — regra é *dado* (linha em banco, editável
   pelo time comercial); família de regra é *código puro*, testado e backtestável. As 10 regras
   do documento de especificação colapsam em **6 famílias**.
4. **Camada de disparo isolada e desligada por padrão** — cria task no ClickUp, com idempotência
   garantida por constraint de banco.

## O que ele NÃO é

| Não é | Por quê |
|---|---|
| Um sistema de IA | As regras são checagens de data/threshold. Não há modelo, score aprendido nem "provavelmente". |
| Um segundo dashboard financeiro | Sem DRE, despesa, fornecedor ou conciliação bancária. Receita existe só como atributo do cliente, com a **mesma régua** do financeiro. |
| Um sistema que escreve no Conexa | O cliente HTTP tem método fixo em `GET`, sem parâmetro de `method` nem `body`. Garantia **estrutural**. |
| **Um robô que fala com o cliente final** | **Nenhuma mensagem sai para o cliente, nunca.** Toda saída é interna, para o vendedor, que decide como abordar. |
| Um sistema que inventa número | `INDISPONIVEL ⇒ NULL`, garantido por `CHECK` no Postgres. Lacuna vira tarefa de cadastro, nunca zero nem estimativa silenciosa. |
| Um sistema com 10 regras no dia 1 | Duas estão bloqueadas por dado que não existe; duas dependem de uma reconciliação que pode reprovar. Ver [regras-comerciais.md](docs/context/regras-comerciais.md). |

## Stack

Next.js 15 (App Router) · TypeScript · PostgreSQL · Prisma · Tailwind · Recharts · Vitest.
Mesma do projeto irmão, de propósito — ver [ADR-08](docs/context/decisions.md).

## Documentação

Toda a memória de desenvolvimento vive em [`docs/context/`](docs/context/) e é **versionada junto
com o código**:

| Documento | Conteúdo |
|---|---|
| [decisions.md](docs/context/decisions.md) | Decisões de arquitetura (ADRs) |
| [regras-comerciais.md](docs/context/regras-comerciais.md) | As 10 regras, viabilidade e fórmula de cada uma |
| [conexa-integration.md](docs/context/conexa-integration.md) | API Conexa v2: auth, limites, endpoints, campos confirmados |
| [integracoes-saida.md](docs/context/integracoes-saida.md) | ClickUp e Chatwoot, e as salvaguardas da camada de disparo |
| [roadmap.md](docs/context/roadmap.md) | Fases, entregáveis e critérios de aceite |
| [riscos.md](docs/context/riscos.md) | Riscos e o que os mitiga |
| [perguntas-abertas.md](docs/context/perguntas-abertas.md) | O que precisa ser respondido, por quem e o que bloqueia |
| [progress.md](docs/context/progress.md) | Log cronológico — atualizar a cada commit |

## Desenvolvimento local

Pré-requisitos: Node 20+, Docker.

```bash
npm install
cp .env.example .env          # preencha SESSION_SECRET
docker compose up -d db       # Postgres na porta 5433 (5432 é do financeiro)
npm run prisma:migrate
npm run db:seed               # dados SINTÉTICOS — não precisa de token do Conexa
npm run dev                   # http://localhost:7000
```

Login do seed: **admin@seahub.local** / **seahub-dev-123**.

> O seed existe para o sistema ser utilizável **sem credencial de produção**. Sem
> ele, a única forma de ver uma tela com número seria apontar a máquina de
> desenvolvimento para a API real e gastar ~1.270 requisições do teto
> compartilhado. Os dados são inventados e ficam numa faixa de id (900000+) que
> não colide com o Conexa.
>
> Depois do seed, rode **Motor → Consolidar inteligência** para as telas de
> receita se preencherem.

| Script | Ação |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | `prisma generate` + build de produção |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | testes (Vitest) |
| `npm run prisma:migrate` | cria/aplica migrations (dev) |
| `npm run db:seed` | popula o banco com dados sintéticos (sem token) |
| `npm run fase0` | as provas de acesso da Fase 0 |

## Fase 0 — provas de acesso

Seis medições contra a API que decidem o escopo real do projeto. **Rodar antes da Fase 1.**

```bash
CONEXA_API_TOKEN=<token> npm run fase0
```

Somente leitura por construção: o método é fixo em `GET`, sem parâmetro de `method` nem `body`.
Ritmo default de 15 req/min e disjuntor em 80 requisições, para não competir com o dashboard
financeiro pelo teto compartilhado. Gera `docs/context/fase-0-resultado.md` (ignorado pelo git —
pode conter dado de cliente real).

## Deploy

### Publicação da imagem — automática

`.github/workflows/docker-publish.yml` builda e publica no GHCR **a cada push na `main`** (e sob
demanda via "Run workflow"). Não é preciso rodar `docker build` à mão — só dar push.

Publica sempre **duas tags**: `ghcr.io/basilio-byte/dashboard-comercial:latest` e
`:sha-<short-sha>`. Nunca só `latest` — sem a tag de sha não há como saber qual commit está
rodando em produção.

> O nome da imagem sai de `github.repository`, então o namespace acompanha o dono do repositório
> sozinho. Não há nome hard-coded para errar.

### Easypanel

**Guia completo, com todas as variáveis: [`docs/context/deploy-easypanel.md`](docs/context/deploy-easypanel.md).**

Resumo: serviço **Postgres próprio** + serviço **Docker Image** apontando para
`ghcr.io/basilio-byte/dashboard-comercial:latest`, porta `7000`, healthcheck em
`GET /api/health`, **uma réplica**.

Mínimo de variáveis para subir: `DATABASE_URL`, `SESSION_SECRET`, `APP_URL`,
`CONEXA_API_TOKEN`, `CRON_SECRET`, e `ADMIN_EMAIL`/`ADMIN_PASSWORD` no primeiro boot.
Todo o resto tem default seguro — e **todos os defaults de disparo fecham**.

Migrations, primeiro admin e o **agendador embutido** sobem sozinhos no boot. A
carga histórica também: o agendador a continua a cada 10 min até o fim, sem
ninguém clicar em nada.

## Estado atual

**No ar no Easypanel**, porta 7000, com agendador embutido continuando a carga sozinho.

**Funciona hoje:** espelho do Conexa por janela mensal (clientes, contratos, planos, produtos,
categorias, vendas, cobranças, reservas) · receita por cliente e por mês com variação · consumo de
horas por ciclo com o sinal de **excedente recorrente** · reconciliação · as telas
**Radar · Carteira · Gatilhos · Confiança · Motor**.

**Ainda NÃO existe:** motor das 10 regras (`src/lib/regras/`), camada de disparo
(`src/lib/disparo/`) e cadastro de vendedor. Nenhuma task é criada no ClickUp.

🔴 **Bloqueio atual:** o vendedor responsável **não é resolvível pela API** — ver
[perguntas-abertas.md](docs/context/perguntas-abertas.md). Sem ele, um sinal não tem dono.

Ponto de retomada detalhado: [progress.md](docs/context/progress.md) e
[roadmap.md](docs/context/roadmap.md).

## Regra permanente

> **Atualizar `docs/context/` a cada `commit` + `push`.** No mínimo `progress.md`; e os demais
> quando algo mudar. (Mesma disciplina do projeto irmão.)
