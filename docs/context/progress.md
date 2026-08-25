# Progresso

Log cronológico. Mais recente no topo. **Atualizar a cada commit + push.**

---

## 2026-08-25 — Esqueleto e cadeia de deploy, verificados

**Feito.** Projeto Next.js 15 + Prisma + Tailwind, `Dockerfile` multi-stage, `docker-entrypoint.sh`,
`docker-compose.yml`, `.env.example` e o workflow de publicação no GHCR.

**Verificado de ponta a ponta, não presumido:**

- `npm run typecheck` e `npm run build` passam; `/api/health` sai como rota dinâmica;
- imagem Docker builda;
- subindo com Postgres real: migrations aplicam no boot, admin é criado, app sobe;
- **idempotência**: no restart, "No pending migrations" e "usuário já existe — senha preservada";
- `GET /api/health` → `200 {"status":"ok","db":"ok","env":"ok","timezone":"America/Fortaleza",
  "conexa":"sem token","notificador":"off","modo":"dry-run"}` — o healthcheck confirma **de fora**
  que o deploy subiu com o disparo fechado;
- `docker stop` → código 0 em ~500 ms.

**Correção de rota — a fonte do deploy.** O que roda em produção é o `skill-financeiro`, sob a
conta `basilio-byte`, com imagem `ghcr.io/basilio-byte/skill-financeiro:latest` publicada
**automaticamente** por GitHub Actions. O README do `seahub_financeiro` (que eu havia usado como
referência) fala em `ghcr.io/basiliolp/` e publicação manual por cota esgotada — está
desatualizado. O workflow do comercial usa `IMAGE_NAME: ${{ github.repository }}`, então o
namespace sai certo sozinho.

**Correção de rota — segredos.** Sem 1Password. O documento de especificação manda usá-lo, mas
isso era artefato do ambiente OpenClaw onde o protótipo rodou. Segredos vivem nas **ENV do
Easypanel**; localmente, num `.env` coberto pelo `.gitignore`.

**Um achado de auditoria caiu na verificação.** A auditoria afirmava que o container não trata
SIGTERM e que todo redeploy terminaria em SIGKILL. **Falso, medido nas duas variantes da mesma
imagem:** o standalone do Next instala o handler sozinho
(`next/dist/server/lib/start-server.js` → `process.on('SIGTERM', cleanup)`), e `docker stop` sai
com código 0 em ~500 ms **com e sem `tini`**. O que sobra de verdadeiro é a falta de **drenagem de
aplicação** — o Next fecha o HTTP, mas não conhece o agendador nem o backfill em voo. Corrigido em
`decisions.md` (ADR-0008), `riscos.md` e no comentário do `Dockerfile`. O `tini` ficou, pelo que
de fato entrega.

**Próximo passo.** Rodar a Fase 0 com o token real.

---

## 2026-08-25 — Planejamento

Repositório clonado vazio. Nenhum código de aplicação escrito ainda.

**Feito.**

- Estudo do documento de especificação ("Sistema de Inteligência Comercial — Conexa + ClickUp",
  de Diego) e mapeamento das 10 regras contra a API Conexa v2, uma a uma, usando a coleção Postman
  como fonte da verdade.
- Levantamento das convenções do projeto irmão (Dashboard Financeiro) — stack, Docker, entrypoint,
  deploy no Easypanel, disciplina de `docs/context/`.
- Especificação das integrações de saída e descoberta de código reaproveitável.
- Três propostas de arquitetura independentes, consolidadas num plano único.
- Três auditorias adversariais (veracidade técnica · operação e deploy · risco de negócio) mais um
  crítico de completude: **46 achados, 10 críticos**, todos incorporados.
- Documentação inicial desta pasta.

**Descobertas que mudaram o plano.**

1. **A "limitação conhecida" do documento é parcialmente falsa.** A concessão de horas
   (`plan.hourQuotas`, `contract.hourPlanQuota`, `recurringSale.packageId`) **e** o consumo
   (`booking.startTime`/`finalTime` + `status: deductedFromQuota`) são expostos pela API. O que
   não existe é o **saldo** — que é derivável, com três incógnitas (âncora do ciclo, carry-over,
   dedução parcial). Virou uma fase de medição que pode reprovar ([ADR-0005](decisions.md)).
2. **Duas regras estão bloqueadas por dado que não existe.** "Panteão" não está em nenhum dos 217
   produtos do Conexa; e o tier do Endereço Fiscal (Litoral, Batial, Abissal…) **não é campo da
   API** — todos caem na mesma categoria de serviço.
3. **O rate limit de 60 req/min é compartilhado** com um sistema já em produção, e a mitigação
   óbvia ("janelas desencontradas") é inimplementável com o agendador que se pretendia copiar.
4. **A especificação diz quando ofertar e nunca quando NÃO ofertar.** Faltava gate de elegibilidade
   e supressão por "já possui" / "já recusou" ([ADR-0010](decisions.md)).
5. **Existe código de integração pronto e testado** (ClickUp, Chatwoot, Conexa) em
   `Seahub-agentes-chatwoot` — incluindo a armadilha do token sem `Bearer`. Mas o método de envio
   do Chatwoot tem default perigoso, que manda a mensagem ao cliente se o parâmetro for omitido.

**Decisões do dono do projeto.**

- A task do ClickUp vai numa **lista definida**, não em qualquer lugar.
- A mensagem do Chatwoot é para o **time comercial**, não para todas as pessoas.
- **O sistema nunca fala com o cliente final** — sempre passa pelo vendedor.
- **ClickUp primeiro.** O Chatwoot vem depois; a abordagem (inbox exclusiva vs. notas internas)
  ainda será desenhada.
- Cada canal tem **toggle de ligar/desligar**, e existe uma **página de Configurações**.

**Ferramenta da Fase 0 pronta.** `scripts/fase-0-provas.mjs` roda as seis medições contra a API e
gera `docs/context/fase-0-resultado.md` (ignorado pelo git — pode conter dado de cliente real).
Somente leitura por construção: método fixo em `GET`, sem parâmetro de `method` nem `body`. Ritmo
default de 15 req/min e disjuntor de 80 requisições, para não competir com o financeiro.
Verificado contra servidor mock com as formas reais da coleção, incluindo o caminho de 403.

```bash
CONEXA_API_TOKEN=<token do 1Password> node scripts/fase-0-provas.mjs
```

**Próximo passo — rodar a Fase 0.** Nenhuma linha de aplicação antes disso.

**Bloqueios.** As perguntas 🔴 de [perguntas-abertas.md](perguntas-abertas.md), especialmente:
o teto de 60 req/min é por token ou por conta; o token tem acesso a `/room/bookings`; e qual é o
`list_id` da lista alvo no ClickUp.

**Nota de infraestrutura.** O repositório é da conta `basilio-byte` e o git local commita como
`basiliolp` — o primeiro push deu 403 até o dono conceder acesso. O projeto irmão publica a imagem
sob `ghcr.io/basiliolp/`, ou seja, a **outra** conta: decidir conscientemente onde a imagem do
comercial vai morar.
