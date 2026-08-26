# Progresso

Log cronológico. Mais recente no topo. **Atualizar a cada commit + push.**

---

## 2026-08-26 — Selo de completude, e o ciclo da cota respondido

**Um bug real, achado rodando a primeira carga.** O backfill parou no teto de páginas com só os
clientes carregados; a consolidação rodou assim mesmo e produziu **5.000 perfis com receita
R$ 0,00** — indistinguíveis de clientes que de fato não faturaram. Isso viola a regra de ouro do
projeto: zero e "ainda não carreguei" viraram a mesma coisa na tela. Pior, sobre esses zeros a
regra de tendência veria a base inteira despencando.

**Corrigido** com o selo de completude que o ADR-0011 documentava mas que eu não tinha codificado:

- `src/lib/intel/completude.ts` — `estadoDoEspelho()` diz, por entidade, se o backfill terminou
  (sem cursor pendente **e** com registros).
- A consolidação grava `procedencia: INDISPONIVEL` quando a fonte está incompleta.
- A UI mostra **"não disponível"** no lugar do valor, com aviso no topo; Top 5 e alerta de queda
  ficam suprimidos — um ranking sobre dado parcial aponta o cliente errado.

Verificado: com o espelho incompleto, os 5.000 perfis saíram marcados `INDISPONIVEL`.

**As três incógnitas do ciclo da cota foram respondidas** pelo responsável — ver
[perguntas-abertas.md](perguntas-abertas.md). Resumo: ciclo ancorado na **data de contratação**
(não no mês-calendário), **sem carry-over**, e excedente **abatido e cobrado**.

⚠ O exemplo dado (26/08 → 25/09 → novo em 26/09) descreve um **aniversário mensal**, não 30 dias
exatos. As duas leituras divergem ao longo do ano; adotado o aniversário do dia do mês.

**Isso reordena a Fase 3.** O responsável disse que o mais importante é medir se o cliente **usa
mais horas do que o plano oferece** — o sinal forte é o **excedente recorrente**, não o saldo
instantâneo. E o excedente é mais fácil de acertar: a dedução parcial deixa rastro na cobrança do
excedente, então dá para observá-lo sem depender de acertar o saldo ao minuto.

**Escopo novo:** acompanhar quem compra pacote de horas **fora do EV** (avulso, sem plano de
Endereço Fiscal atrelado).

---

## 2026-08-26 — Fase 1: espelho, métricas e telas

**Feito.** Espelho local do Conexa (clientes, contratos, planos, produtos, categorias, empresas,
vendas, cobranças), consolidação da inteligência comercial, autenticação e as seis telas.

**Estrutura.**

- `src/lib/money.ts` e `dates.ts` — dinheiro em Decimal, datas no relógio de parede da empresa.
- `src/lib/conexa/client.ts` — somente leitura por construção (método fixo em `GET`, sem `method`
  nem `body`), limitador a 15 req/min, retry em 429/5xx, paginação por `hasNext` com offset inicial
  para retomada.
- `src/lib/conexa/sync.ts` — cursor persistido em `SyncState` a cada página, gravado **depois** do
  upsert (morrer entre as duas coisas reprocessa a página, o que é inofensivo; o contrário pularia
  registros). Heartbeat no `SyncRun` para o enterro de zumbis não depender de "um container só".
- `src/lib/metrics/receita.ts` — a régua, como funções puras. 18 testes.
- `src/lib/intel/consolidar.ts` — receita mensal e perfil, materializados.
- `src/lib/intel/reconciliar.ts` — confere o espelho contra o Conexa, cobrança por cobrança.

**Critérios de aceite verificados no container real, com Postgres:**

| Critério | Resultado |
|---|---|
| `GET /api/health` → 200 | ✅ `{"status":"ok","db":"ok","env":"ok",…}` |
| Raiz redireciona para login | ✅ 307 → `/login` (e também `/clientes`, `/operacao`) |
| `POST /api/sync` sem segredo | ✅ 503 sem `CRON_SECRET`; 401 com segredo errado |
| Variação `NULL` quando o anterior é zero | ✅ teste dedicado |
| Mês corrente nunca alimenta tendência | ✅ teste no dia 3, virada de ano e último dia do mês |
| Nenhum número sem selo de procedência | ✅ componente `<Procedencia>` em todas as telas |
| Camada de disparo não existe | ✅ nem o diretório |

**Sincronizado contra a API de produção** (somente leitura, 7 requisições): 260 planos, 120
produtos, 25 categorias, 2 empresas. O mapeamento de cota bate com a Fase 0 no dado real:
Litoral **sem cota**, Batial **2h**, Abissal **8h**. "Panteão" está no espelho (3380 e 3381).

**Decisão de modelagem que vale registrar.** `Plan.horasInclusasMes` é `null` para plano **sem
cota**, e isso é diferente de zero: "sem horas inclusas" é característica do produto (é o Litoral),
"zero hora" seria uma cota vazia. A UI mostra "sem cota", nunca "0h". A regra 10 depende
inteiramente dessa distinção.

**Pendente para fechar a fase:** a reconciliação ao centavo contra um mês fechado exige o backfill
COMPLETO de cobranças — a tela está pronta e o critério é diferença de R$ 0,00 **e** contagem
idêntica (só o total batendo esconderia duas divergências que se cancelam).

---

## 2026-08-25 — Fase 0 executada · veredito GO

Rodadas as provas de acesso contra a **API de produção**, com token de admin, somente leitura
(~30 requisições a 15 req/min). Conclusões completas em
[fase-0-conclusoes.md](fase-0-conclusoes.md).

**Nenhum bloqueio de acesso — e duas regras saíram de "impossível" para viável.**

| Prova | Resultado |
|---|---|
| `/room/bookings` responde? | ✅ 200, com `deductedFromQuota` em dado real |
| Rate limit por token ou conta? | ⚠️ só indício — segue como pergunta à Conexa |
| `/contracts` devolve `extraFields`? | ✅ 20/20 — mas **nenhum preenchido** |
| `sale.quantity` carrega horas? | ✅ 20/20 pares concordam |
| `hourPlanQuota` preenchido? | ⚠️ 17/100 contratos ativos; **100% por grupo** |
| "Panteão" existe? | ✅ ids 3380 e 3381 |

**Três conclusões minhas caíram:**

1. **"Panteão não existe"** — existe. Eu tinha me baseado num **export manual** de produtos, não
   na API. O export estava incompleto.
2. **"O tier do Endereço Fiscal não é obtenível"** — é, e por um caminho melhor que o nome: a
   **cota do plano**. Litoral não tem cota (`hourQuotas: null`), Batial tem 2h, Abissal 8h,
   Comércio/Black 6h, Simples 4h. O predicado da regra 10 vira dado, não texto. E o "Batial (2h
   mensais inclusas)" do documento do cliente está **confirmado pela API**.
3. **"Cotas por grupo são irrecuperáveis"** — não são. Os endpoints de grupo realmente não
   existem (404 medido em 7 rotas), e 100% das cotas são por grupo (um único, `id: 2`). Mas saber
   quem está no grupo é desnecessário: **o Conexa marca a reserva abatida**. Isso devolve as
   regras 2 e 9 ao jogo.

Também revertido o rebaixamento de `sale.quantity`: a coleção Postman tipa como `integer` e
"quantidade de itens", mas o dado real carrega horas fracionárias — 20/20.

**O que continua em aberto:** o teto de 60 req/min é por token ou por conta (pergunta 1), e as
três incógnitas do ciclo da cota — âncora, carry-over e dedução parcial. Nenhuma tem resposta na
API; são comportamento de produto.

**Efeito no roadmap.** Fase 1 liberada. Fase 3 continua existindo, com escopo menor: falta medir o
**ciclo**, não a atribuição de consumo. Fase 8 encolhe — as regras 8 e 10 saem de lá.

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
   *(Confirmado na Fase 0, inclusive a derivação rodando num cliente real.)*
2. ~~**Duas regras estão bloqueadas por dado que não existe.**~~ **⚠ SUPERADO pela Fase 0** — as
   duas foram desbloqueadas. O "Panteão não existe" vinha de um export manual incompleto, e o tier
   do Endereço Fiscal se resolve pela **cota do plano**, não pelo nome. Ver a entrada da Fase 0
   no topo.
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
