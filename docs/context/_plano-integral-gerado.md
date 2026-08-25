> **Apêndice — plano integral gerado no planejamento de 2026-08-25.**
>
> Este é o documento longo e bruto produzido na fase de planejamento, antes das auditorias e antes
> das decisões do dono do projeto sobre canal e configuração. Ele é mais detalhado que os demais
> documentos desta pasta (traz o schema Prisma proposto, o desenho de telas e o detalhamento de
> cada regra), mas **não é a fonte da verdade**: onde ele divergir de `decisions.md`,
> `roadmap.md`, `regras-comerciais.md` ou `riscos.md`, valem estes.
>
> Divergências conhecidas: aqui o Chatwoot aparece como fase planejada com abordagem definida
> (ficou pendente de desenho); não há gate de elegibilidade, selo de frescor do sync, nem página
> de Configurações (todos incorporados depois, ver ADR-0009 a ADR-0012); e a premissa de "janela
> de data imutável" na fase de reservas foi derrubada pela auditoria.

---

# Dashboard Comercial Seahub — Plano de Desenvolvimento

> Documento consolidado a partir das três propostas independentes, do mapa das 10 regras contra a API Conexa, das convenções herdadas do Dashboard Financeiro e das especificações de ClickUp/Chatwoot.
> **Nenhuma chamada ao vivo foi feita** (sem credenciais nesta sessão). Toda afirmação sobre API vem da coleção `c:/Users/User/Desktop/Dashboard Financeira Seahub/seahub_financeiro/docs/API v2 Conexa.postman_collection.json`, do código real do dashboard financeiro, ou dos repositórios `agentes-chatwoot`/`seahub_agentes`. O que não pôde ser confirmado está marcado **NÃO CONFIRMADO**, com o método de confirmação ao lado.

---

## 1. O que o sistema é (e o que não é)

### 1.1 O que é

Um **sistema de inteligência comercial determinística** para a Seahub Coworking, composto por quatro coisas, nesta ordem de importância:

1. **Um espelho local, correto e auditável** dos dados comerciais do Conexa (clientes, contratos, planos, vendas, cobranças, vendas recorrentes e — inédito no ecossistema Seahub — **reservas de sala**).
2. **Um perfil consolidado por cliente**: receita no ano, receita mês a mês com variação, Top 5, uso de horas, saldo de cota, segmentos ativos, vendedor responsável. Cada número com **procedência declarada**.
3. **Um motor de regras determinístico e parametrizável**, onde *regra é dado* (linha em banco, editável pelo Diego) e *família de regra é código* (função pura, testada, backtestável). As 10 regras do documento colapsam em **6 famílias**.
4. **Uma camada de disparo isolada e desligada por padrão**, que cria task no ClickUp e nota privada no Chatwoot, com idempotência garantida por constraint de banco.

### 1.2 O que NÃO é

| Não é | Por quê |
|---|---|
| **Um sistema de IA** | O documento do Diego é explícito: regras determinísticas sobre data/threshold. Não há modelo, não há score aprendido, não há "provavelmente". `Signal.priority` só **ordena a fila** — nunca decide se dispara. |
| **Um segundo dashboard financeiro** | Não há DRE, despesa, fornecedor, conciliação bancária, MDR ou data de crédito. A receita existe aqui apenas como **atributo do cliente**, com a mesma régua do financeiro para não divergir. |
| **Um sistema que escreve no Conexa** | O cliente HTTP do Conexa é copiado com a garantia **estrutural** do ADR-0009 do financeiro: método fixo em GET, sem parâmetro de `method` nem de `body`. Não existe caminho de código capaz de escrever no ERP. |
| **Um robô que fala com o cliente final** | Na v1, **nenhuma mensagem sai para o cliente**. ClickUp (destino interno) é o canal primário e obrigatório; Chatwoot entra apenas como **nota privada** (`private: true`). |
| **Um sistema que inventa número** | `INDISPONIVEL` implica `NULL` — garantido por `CHECK` no Postgres, não por disciplina de código. Lacuna vira tarefa de cadastro em `/operacao/lacunas`, nunca zero, nunca estimativa silenciosa. |
| **Um sistema com 10 regras funcionando no dia 1** | Duas das dez estão **bloqueadas por dado que não existe** (Panteão não está no catálogo; o *tier* do Endereço Fiscal não é campo da API) e duas dependem de uma reconciliação de saldo de horas que pode reprovar. Isso é entrega, não recuo. |

### 1.3 Espinha dorsal escolhida e enxertos

**Espinha dorsal: Proposta 1 — faseamento por risco.**
É a única das três que é uma *estrutura de entrega*, e não apenas uma estrutura de código. O critério que a torna superior: **cada fase pode parar e ainda ter entregue valor**, e nenhuma fase risca um sistema de terceiro antes de o dado que a sustenta ter sido provado. As Propostas 2 e 3 têm arquiteturas melhores em pontos específicos, mas nenhuma das duas resolve "o que entregar primeiro se o `/room/bookings` devolver 403".

**Enxerto 1 (o mais valioso) — o motor de regras da Proposta 3: `regra = dado, família = código`.**
Esta é a decisão **mais cara de reverter** do projeto inteiro. Se as 10 regras nascerem como 10 arquivos `.ts` com `enum RuleKey`, a regra 15 custa migration + deploy + PR, e a regra 30 nunca chega. Com 6 famílias parametrizadas, a regra 11 é um `INSERT`. Adotado integralmente, incluindo `RuleChange` (auditoria de quem mexeu no threshold), `RuleSimulation` (backtest persistido) e a **guarda de promoção** (`LIVE` exige backtest recente com os params exatos).

**Enxerto 2 — os portões de reconciliação da Proposta 2.**
Reconciliação deixa de ser relatório e vira **impedimento**: receita divergente do financeiro **trava a promoção de regras para LIVE**; saldo de horas com critério de reprovação explícito (§2 ADR-05). Adotado também o `CHECK` constraint de procedência e o teste de contrato de schema.

**Enxerto 3 — a máquina de estados por regra da Proposta 3** (`OFF → SOMBRA → DRY_RUN → LIVE`), que é estritamente melhor que o kill-switch binário da Proposta 1, porque permite promover **uma regra por vez** sem tocar em variável de ambiente.

**Enxerto 4 — segmentos declarativos da Proposta 3** (`/admin/segmentos`). É o que permite a regra 10 existir no dia em que o cliente homologar o mapa `planId → tier`, sem deploy — e é o que impede alguém de classificar por substring de nome do plano.

### 1.4 O que foi descartado, e por quê

| Descartado | De onde vinha | Por quê |
|---|---|---|
| **`postgres_fdw` como fonte primária no dia 1** | Proposta 2 | Acopla o comercial ao **schema físico** do financeiro num momento em que o comercial ainda não sabe se metade dos seus dados existe. Adiciona superfície de operação (user mapping, `IMPORT FOREIGN SCHEMA`, modo degradado, teste de contrato) **antes** de haver qualquer valor entregue. E o ganho — economia de rate limit — é resolvível por uma variável de ambiente. **Mantido como Etapa 2 com gatilho medido** (ideia da Proposta 3), não como decisão de dia 1. Ver ADR-01. |
| **`enum RuleKey` no Prisma** | Resultado 4 e Proposta 1 | Segurança de tipo comprada ao preço da extensibilidade: cada regra nova viraria migration. Substituído por `key String` + `family` validada contra o registry, com `params` validado por zod **em toda escrita** e o baseline versionado em `prisma/seeds/rules.seed.ts` (que continua sendo código revisado em PR). |
| **10 arquivos de regra, um por regra** | Propostas 1 e 2 | Colapsam em 6 famílias. Manter 10 arquivos significa 10 lugares para corrigir o mesmo bug de `addMonthsClamp`. |
| **"Conexa Gateway" compartilhado como projeto** | Proposta 1 (já descartado lá) | 3–4 semanas refatorando um sistema financeiro auditado antes da primeira tela. Confirmado o descarte. |
| **Criar conversa no Chatwoot** | Proposta 1 (avaliado) | Endpoint **NÃO CONFIRMADO**, e fora da janela de 24h do WhatsApp a Meta exige template aprovado — a conversa criada é um registro que o cliente nunca recebe. |
| **Export XLSX (ADR-0017 do financeiro)** | herança | O comercial não vive de exportar. CSV simples nas telas de simulação e fila basta. |
| **Modelos `Bill`, `Supplier`, `Method`, `creditDateKey()`, competência contábil** | herança | Domínio financeiro puro. O comercial trabalha com **datas de evento** (contrato, reserva, venda). |
| **Réplica única como *defesa* contra disparo duplicado** | Propostas 1 e 2 | É a primeira camada, não a defesa. A defesa real é a `@@unique` no Postgres + `pg_advisory_lock` por tarefa (Proposta 3). Réplica única continua sendo a configuração recomendada, mas o sistema não pode *depender* dela. |

---

## 2. Decisões de arquitetura (ADRs)

### ADR-01 — Banco de dados fisicamente separado, sync próprio, FDW como promoção condicional

**Contexto.** O dashboard financeiro (`c:/Users/User/Desktop/Dashboard Financeira Seahub/seahub_financeiro`) já espelha 8 das 9 entidades que o comercial precisa (Customer, Plan, Contract, Sale, Charge, Product, ServiceCategory, RecurringSale) num Postgres em produção, validado ao centavo contra o Conexa (junho/2026: 1.182/1.182 cobranças, R$ 444.143,59 = R$ 444.143,59). Três caminhos: (A) usar o mesmo banco, (B) banco separado com sync próprio, (C) transformar o financeiro em hub de ingestão e consumir por `postgres_fdw`.

A opção A é inaceitável por um motivo operacional concreto: o `docker-entrypoint.sh` do comercial roda `prisma migrate deploy` **no boot do container**. Duas tabelas `_prisma_migrations` no mesmo schema, dois `schema.prisma` que não se conhecem — um `migrate dev` de qualquer um dos dois "vê" as tabelas do outro e propõe `DROP`. É um acidente com data marcada, num banco de dinheiro.

A opção C é arquitetonicamente superior e resolve de vez a duplicação e o risco de divergência de receita. Mas ela exige alterar um sistema em produção (criar `CREATE SCHEMA export` com views versionadas), configurar `postgres_fdw` + user mapping, e implementar um modo degradado — **tudo isso antes de a primeira tela existir**, e num momento em que ainda não sabemos se `GET /room/bookings` sequer responde 200 para o token da Seahub.

**Decisão.**
- **Banco físico separado** (`seahub_comercial`), na mesma instância Postgres do Easypanel (economia de recurso e latência), com role `comercial` **sem privilégio algum** no database do financeiro.
- **Sync próprio** das entidades que o comercial usa. O comercial **não** sincroniza `bills`, `suppliers`, `expenses`, `methods`.
- **`/room/bookings` é do comercial, sempre** — o financeiro nunca chamou esse endpoint (zero referências a `room` em `src/lib/conexa/client.ts`) e não tem motivo para chamar.
- **Proibido**: o comercial rodar `prisma migrate` contra o banco do financeiro; o comercial ter `INSERT/UPDATE/DELETE` em qualquer objeto do financeiro; a UI consultar dado do financeiro dentro de um request.
- **Etapa 2 (FDW) é promoção condicional, com gatilho medido**, não decisão de projeto. Promove-se quando **qualquer um** de: (i) ≥ 3 respostas `429` em 24h em qualquer dos dois serviços; (ii) o sync de cadastros do comercial passar de 20 min; (iii) `requestsMade` somado dos dois `SyncRun` passar de 60.000/dia; (iv) a reconciliação de receita (ADR-06) acusar divergência recorrente que não seja bug de régua.

**Consequência.**
- Duplicação de ingestão custa ~850 requisições de backfill (uma vez, ~57 min a 15 req/min) e ~40 req/hora em regime. É ruído, não argumento.
- O risco real que sobra é **divergência de receita**, e ele é neutralizado pelo ADR-06 (reconciliação bloqueante ao centavo), não por esperança.
- Um restore, uma migration errada ou um incidente do comercial não tocam o financeiro. Blast radius = só o comercial.
- Se o FDW for promovido, o espelho local continua sendo a fonte única do motor de regras — o FDW alimenta uma tarefa `MIRROR_PULL`, nunca um request de UI.

---

### ADR-02 — Rate limit do Conexa é compartilhado; orçamento repartido por env até haver resposta sobre tokens

**Contexto.** O limitador de `src/lib/conexa/client.ts` é **por processo Node** — comentário literal do repo: *"Vale por processo Node (o container do Easypanel roda um único processo)"* — e espaça requisições em `ceil((60_000/60)*1.05) ≈ 1.050 ms`. Se dois containers usarem o mesmo token, **cada um acredita ter os 60 req/min inteiros**, e o consumido combinado é ~120/min contra um teto de 60. O financeiro tem retry de 7 tentativas (~61s de insistência) e sobrevive — mas cada backfill/reconcile dele passa a levar 2–3× mais tempo, e a degradação é **lenta**, portanto descoberta tarde.

**Se o teto de 60 req/min for por API key e não por conta, o problema simplesmente desaparece** com um segundo token. Isso é **NÃO CONFIRMADO** e é a pergunta nº 1 do projeto (§11, Q1).

**Decisão.**
1. **Perguntar à Conexa** (`suporte@conexa.app`) se o teto é por token ou por conta, e **solicitar um segundo `api_key`** dedicado ao comercial — independentemente da resposta, porque um token separado é revogável isoladamente.
2. **Enquanto não houver resposta**, orçamento repartido por variável de ambiente, registrado no README dos **dois** repositórios:
   ```
   dashboard-financeiro   CONEXA_RATE_LIMIT_PER_MIN = 40   (era 60)
   dashboard-comercial    CONEXA_RATE_LIMIT_PER_MIN = 15
   ────────────────────────────────────────────────────────
   soma                                              = 55   ≤ 60, com margem
   ```
   O limiter aplica +5% de margem por cima disso em cada lado.
3. **Fases desencontradas.** O financeiro roda reconcile a cada 15 min a partir de +2 min do boot e reparos/cadastros em 10/20/25/30 min. O comercial roda nos minutos `:07 / :22 / :37 / :52` e usa atrasos iniciais fora daquela faixa. O backfill do comercial roda **em janela noturna** (`SYNC_JANELA_PESADA=02:00-05:00 America/Fortaleza`).
4. **Monitoramento é obrigatório**, não opcional: `/operacao` mostra `requestsMade` somado das últimas 24h e qualquer `429` vira `IntegrationFailure(kind: RATE_LIMIT)`.

**Consequência.**
- O reconcile do financeiro fica ~1,5× mais lento (de ~1s/página para ~1,5s/página). Como ele fecha o mês em minutos contra um intervalo de 15 min, é invisível.
- Baixar o teto do financeiro é **mudança de variável de ambiente, zero código** — reversível em um redeploy.
- Critério de validação (Fase 1): **zero `429` no log dos dois serviços por 7 dias corridos**.

---

### ADR-03 — Agendador embutido, com trava de banco em vez de trava de processo

**Contexto.** Todas as três propostas convergiram para agendador embutido, pelo motivo registrado no comentário-cabeçalho de `src/lib/conexa/scheduler.ts` do financeiro: *"um cron externo é um passo que se ESQUECE, e esquecer é silencioso — o dashboard simplesmente para de atualizar e ninguém percebe até os números estarem velhos. **Aconteceu**: o sistema rodou em produção sem nenhum cron configurado."* O container já é um processo Node de longa duração; ele mesmo se agenda.

A divergência real entre as propostas é o mecanismo de exclusão mútua. As Propostas 1 e 2 dependem de "réplica única, documentada". A Proposta 3 propõe `pg_advisory_lock`. No financeiro isso era aceitável porque um segundo agendador só desperdiçaria rate limit; **no comercial, um segundo agendador pode criar duas tasks para o mesmo cliente**.

**Decisão.**
- Agendador **embutido**, ligado pelo gancho oficial `src/instrumentation.ts` (**só no runtime `nodejs`** — o `register` também roda no Edge, onde não há timers nem Prisma).
- Herdadas sem alteração: trava por tarefa (se a execução anterior ainda roda, a próxima é **pulada e logada**, nunca empilhada), `.unref?.()` nos timers, guarda de prioridade do backfill, e **`enterrarZumbis()` no boot** — sem ele, um `SyncRun` `RUNNING` órfão de processo morto faz a guarda de backfill achar que há sempre um backfill rodando e **silencia o agendador para sempre** (zumbi de 14h já observado em teste no financeiro).
- **Acrescentado: `pg_advisory_lock` por tarefa.** Se um dia houver 2 réplicas, a segunda não pega o lock e não roda. Custa ~5 linhas e remove uma restrição de operação que ninguém lembra de respeitar.
- **Três chaves independentes**, não uma:
  - `SYNC_SCHEDULER` (default `on`) — leitura;
  - `INTEL_SCHEDULER` (default `on`) — consolidação + motor de regras;
  - `NOTIFICADOR` (default **`off`**) — disparo.
- O caminho HTTP continua existindo: `POST /api/sync?mode=…` e `POST /api/rules/run` com header `x-cron-secret`. É a porta para um cron do Easypanel caso um dia se escale, e é como o backfill é disparado à mão.

**Consequência.** Réplica única continua sendo a configuração recomendada e documentada no serviço, mas o sistema não depende dela para correção. `SYNC_SCHEDULER=off` + cron externo é um caminho suportado, não um plano B improvisado.

---

### ADR-04 — Camada de disparo: DRY-RUN é infraestrutura, e todo default fecha

**Contexto.** O financeiro é 100% read-only por construção. O comercial escreve em ferramentas de terceiros, e essa escrita tem quatro propriedades que a leitura não tem:

1. **Não existe rollback.** Task criada por engano se apaga na mão, uma a uma. Mensagem `outgoing` enviada pelo WhatsApp **não se desenvia** — e carrega a régua comercial interna.
2. **O erro é multiplicativo.** São 11 regras × ~5.505 clientes num job diário. Um bug de fuso na regra "11 meses" não gera *um* disparo errado: gera **um por cliente de Endereço Fiscal, de uma vez**. Um sinal invertido num limiar (`< 5h` vs `> 5h`) inverte a base inteira.
3. **O dano cai sobre terceiros.** Quem vê o estrago é o vendedor com 300 tasks às 6h, ou o cliente que recebe uma oferta sem sentido. O time técnico não sente o sinal de erro rápido o bastante.
4. **Estourar o limite quebra vizinhos.** 100 req/min do ClickUp é **por token**.

Além disso, o backoff de 7 tentativas (~61s) do `client.ts` do Conexa é seguro para GET e **perigoso para POST**: um `500` pode ter criado a task antes de falhar.

**Decisão.**
- **A prévia é um caminho de código SEPARADO, não uma flag.** A interface `Notificador` tem `previa()` (pura: sem rede, sem escrita) e `disparar()`. Se o dry-run passasse por `disparar()` com uma flag interna, um `if (!dryRun)` esquecido em qualquer branch escreveria em produção. Separando, **uma prévia é estruturalmente incapaz de escrever**.
- **Nenhum `Notificador` conhece kill-switch, idempotência ou dry-run.** Tudo isso vive no orquestrador; se cada implementação checasse, bastaria uma esquecer. Ordem das guardas (a ordem importa):
  ```
  1. kill-switch global NOTIFICADOR=off        → antes do banco, para parar tudo sem tocar em dados
  2. modo da regra (OFF/SOMBRA)                → SOMBRA nunca chega ao canal
  3. reconciliação vermelha (ADR-06)           → divergência de dado BLOQUEIA escrita
  4. lacuna bloqueante no sinal                → não sai oferta com número que não existe
  5. claim outbox (INSERT com @@unique)        → concorrência resolvida pelo BANCO,
                                                  nunca por SELECT-depois-INSERT
  6. teto por execução (NOTIFICADOR_MAX_...)   → disjuntor contra bug multiplicativo; run vira HALTED
  7. kill-switch por canal
  8. dry-run  →  previa()   |   live  →  disparar()
  ```
  **Idempotência vem ANTES do dry-run** de propósito: assim a prévia mostra exatamente o conjunto que a execução real produziria. Um dry-run que ignorasse o histórico exibiria disparos que nunca aconteceriam, e a revisão humana estaria conferindo ficção.
- **Padrão outbox.** `DispatchLog` gravado como `PENDENTE` **antes** da chamada HTTP. Cobre o pior caso: *a escrita deu certo e a resposta se perdeu na rede*. Um `PENDENTE` com mais de 10 min é **suspeito, não falho**: a reconciliação consulta o ClickUp pelo custom field `chave_disparo` e decide entre `ENVIADO` e `FALHOU`. **Reconciliar é mais barato que duplicar.**
- **Retry classificado por erro** (nunca o backoff de GET):

  | Situação | Ação |
  |---|---|
  | `429` | Retry aguardando `X-RateLimit-Reset`. **Não confiar em `Retry-After`** (NÃO CONFIRMADO no ClickUp). Máx. 3. |
  | `5xx` / timeout / rede | Backoff exponencial + jitter: 1s → 4s → 15s. Máx. 3. |
  | `401` / `403` | ❌ **Nunca retry.** É credencial. Abre incidente e **desliga o canal automaticamente**. |
  | `400` / `404` / `422` | ❌ Nunca retry. É payload ou id de config errado; retry mascara o bug. |
- **Rate limiter próprio por destino.** Jamais reutilizar a instância singleton calibrada em 60/min do Conexa.
- **Todos os defaults fecham**: `NOTIFICADOR=off`, `NOTIFICADOR_MODO=dry-run`, `CLICKUP_ENABLED=off`, `CHATWOOT_ENABLED=off`, `CHATWOOT_PERMITE_OUTGOING=off`, regra nova nasce em `SOMBRA`. Um deploy que esqueça de configurar não dispara nada.
- **Promoção regra a regra**, via `Rule.mode`, e nunca duas regras novas no mesmo ciclo.

**Consequência.** A primeira execução real do sistema nunca é a primeira vez que alguém vê o que ele decidiu. O custo é uma fase inteira do roadmap (Fase 6) gasta em dry-run antes da primeira task real.

---

### ADR-05 — Saldo de horas é DERIVADO e só existe depois de uma reconciliação com critério de reprovação explícito

**Contexto.** O documento do cliente afirma que *"a API não expõe quota/saldo de horas por pacote nem preço por hora a nível de produto"*. Isso é **parcialmente falso**, e a diferença muda 5 regras.

**Confirmado na coleção Postman:** a **concessão** é exposta em três lugares —
`plan.hourQuotas[] {id, name, spaceId, groupId, quantity, validityType: Daily|Weekly|Monthly}`,
`contract.hourPlanQuota[] {quantity, spaceId, groupId}` (e ela vem no **LIST** `/contracts`, não só no detalhe — um único varrimento paginado traz a cota de todos os contratos),
e `recurringSale.packageId + quantity + frequency`.

**O consumo também é derivável, com precisão:** `booking.startTime`/`finalTime` são W3C completos e `booking.status` inclui o valor **`deductedFromQuota`** — *o próprio Conexa marca quais reservas foram abatidas da cota*. A duração bate com fonte cruzada independente: booking de 10:30 a 13:15 = 2,75 h ↔ `sale.quantity = 2.75`.

**O que NÃO é exposto é o SALDO.** E a derivação `concedido − consumido` depende de três coisas que a documentação **não** diz: a âncora do ciclo (`Monthly` reseta no dia 1? no `dueDay`? no dia do mês do `startDate`?), o acúmulo de horas não usadas (carry-over), e o comportamento de dedução parcial. Errar a âncora move o saldo em **até um ciclo inteiro**.

**Decisão.**
- `HourQuotaBalance` guarda **três parcelas com procedência separada**: `entitled` (API, se veio de `hourPlanQuota`/`hourQuotas`; MANUAL se veio de `HourPackage.hoursIncluded`; senão INDISPONIVEL), `consumed` (sempre DERIVADO), `balance` (DERIVADO, e **só existe se `entitled` for conhecido**).
- **`INDISPONIVEL ⇒ NULL`, garantido por `CHECK` no Postgres.** Nunca `0`. "0h de saldo" é uma afirmação forte (o cliente esgotou a cota); "saldo desconhecido" é outra coisa, e confundir as duas dispara a regra errada.
- **Cotas por `groupId` são BLOQUEADAS.** Não existe endpoint `/rooms`, `/spaces`, `/privateSpaces` nem `/spaceGroups` na coleção (67 rotas verificadas), e o financeiro **mediu 404**. Sem a lista de quais salas compõem cada grupo, não há como saber quais reservas consomem a cota. Marcadas `INDISPONIVEL`, nunca estimadas.
- **Portão de reprovação explícito (Fase 3).** O cliente exporta a tela de saldo do Conexa para **≥ 20 clientes reais** (cobrindo: cota por `spaceId`, cota por `groupId`, cliente com pacote recorrente, cliente com contrato + pacote, cliente que estourou a cota). Critérios:
  - ≥ 95% dos baldes dentro de **± 0,25 h**;
  - **100% de concordância no sinal do gatilho** — nenhum caso em que o derivado diz "abaixo de 5h" e o Conexa diz "acima", ou vice-versa. **Um único erro aqui reprova a fase.**
- **Se reprovar**, as famílias `SALDO_COTA` (regras 2 e 9) ficam em `OFF` permanente, a lacuna vai para `/operacao/lacunas`, e um ADR registra a razão **com os números da medição**. A regra 4 sobrevive, porque o gatilho ">5h de uso avulso" não depende de saldo.
- Na UI, o saldo é **sempre** marcado `ƒ derivado`, com a fórmula e as parcelas no tooltip — a mesma honestidade do `competenceIsFallback` do financeiro, que já provou valor.

**Consequência.** Regras 2 e 9 são as últimas a subir, e podem não subir. Isso é preferível a disparar oferta de pacote para quem tem 20h de saldo.

---

### ADR-06 — Receita: mesma régua do financeiro, com reconciliação diária BLOQUEANTE

**Contexto.** Dois sistemas somando `charges` com réguas ligeiramente diferentes mostram números diferentes para o mesmo cliente. Na primeira reunião, "receita do cliente X" no comercial ≠ no financeiro, e o dashboard novo perde a credibilidade para sempre. É o risco de maior severidade **de produto** do projeto.

**Decisão.**
- **Fonte é `/charges`, não `/sales`.** `Charge` tem `customerId` + as três datas + os valores; a venda só tem `referenceDate` e pode ser faturada em outro mês.
- **Regime padrão: EMISSÃO** (`createdAt` do Conexa convertido para `America/Fortaleza`, somando `currentAmount` — com juros/multa). É o regime que o financeiro da Seahub usa e o **único validado ao centavo** contra a tela do Conexa (ADR-0013: junho/2026, 1.182/1.182 cobranças, R$ 444.143,59 = R$ 444.143,59, R$ 0,00 de diferença). Competência e Caixa ficam disponíveis, com o regime **declarado na tela**, nunca implícito.
- **`isRecognizedCharge` é copiado literalmente** de `src/lib/metrics/compute.ts:68-79`: exclui `cancelled`/`cancelDate` **e também `negotiated`**. `negotiated` é a cobrança original que uma renegociação substituiu — a Conexa cria uma cobrança nova que já entra nos totais; somar as duas gerou **~R$ 132 mil de receita-fantasma em 2026** (medido).
- **Comparação mês a mês usa apenas meses FECHADOS.** O mês corrente é sempre incompleto; comparar corrente contra anterior faz **todo cliente parecer em queda no dia 3**. Precedente medido: aplicar a definição literal de inadimplência ao mês corrente deu 50,88% contra 10,53% reais — 5× de erro, em vermelho, na tela.
- **Divisão por zero não vira 0%.** `deltaPct` é `NULL` quando `prevRevenue = 0`; a UI mostra "sem base de comparação", nunca `−100%`.
- **Reconciliação diária às 05:00, com tolerância R$ 0,00.** A tela `/reconciliacao` compara mês a mês a receita do comercial com a do financeiro (número colado manualmente na Fase 1; via consulta direta se o FDW for promovido). **Δ ≠ 0 abre `IntegrationFailure` e trava a promoção de qualquer regra para `LIVE`.**

**Consequência.** Divergência vira um número vermelho na tela no dia seguinte, não uma descoberta em reunião. E o sistema se recusa a escrever no CRM de alguém enquanto os seus próprios números não fecham.

---

### ADR-07 — Motor de regras: regra é DADO, família é CÓDIGO PURO

**Contexto.** Hoje são 10 gatilhos; o documento do Diego é claramente o começo de uma lista. Se cada regra for um arquivo `.ts` + entrada em `enum` + migration + deploy, a regra 15 vira negociação de sprint e a regra 30 nunca acontece. Quem vai querer mexer em "5h", "30%", "11 meses" é o Diego, não o dev.

**Decisão.**
- **6 famílias cobrem as 10 regras**: `MARCO_CONTRATO` (1, 6, 7, 8), `SALDO_COTA` (2, 9), `USO_SEM_COTA` (4), `TENDENCIA` (3 + queda de receita), `PRIMEIRO_EVENTO` (5), `EVENTO_EM_SEGMENTO` (10).
- **A `avaliar()` de uma família é PURA**: sem `fetch`, sem Prisma, sem `next/*`, sem `process.env`, **sem `new Date()`/`Date.now()`**. O relógio é **injetado** (`hoje: DataLocal` em `America/Fortaleza`). Verificado por teste de CI:
  ```
  grep -rE "from \"@/lib/db\"|next/|Date\.now\(\)|new Date\(\)" src/lib/intel/rules/families/ && exit 1
  ```
- É a pureza que entrega, de graça e ao mesmo tempo: **teste unitário com fixture**, **backtest** (é só trocar `hoje` e `data`), **explicabilidade negativa** ("por que o cliente 652 NÃO disparou?" — é só ligar `explain`) e **shadow mode**. Sem pureza, cada uma dessas quatro vira um sistema separado.
- **O motor nunca chama a API do Conexa.** Ele lê o espelho local. Isso permite rodar as regras 500× num backtest sem tocar no rate limit compartilhado.
- **`Rule` é linha em banco** (`key String @id`, `family`, `params Json`, `version`, `mode`, `channels`, `cooldownDays`, `maxPorExecucao`), com `params` validado por zod contra o `paramsSchema` da família **em toda escrita** — e o baseline versionado em `prisma/seeds/rules.seed.ts`, que continua sendo código revisado em PR.
- **`paramsUi` gera o formulário do admin.** Adicionar um parâmetro novo numa família faz o campo aparecer na tela sem tocar em JSX.
- **Máquina de estados por regra**: `OFF → SOMBRA → DRY_RUN → LIVE`. Nenhuma regra pula etapa. `LIVE` é recusado se não houver `RuleSimulation` dos últimos 30 dias **com os params exatos**, ou se a simulação mostrar volume acima de `maxPorExecucao`, ou se houver gap bloqueante, ou se a reconciliação estiver vermelha (ADR-06).
- **`RuleChange`** grava toda alteração (autor, campo, de → para, motivo). Quando um vendedor perguntar "por que isso mudou em setembro", a resposta está no banco.

**Consequência.** A regra 11 ("Meu Depósito completa 3 meses → ofertar upgrade") é um `INSERT`: zero código, zero deploy. O teste de aceite da extensibilidade é cronometrado: **criar regra nova só pela UI em < 15 min**.

**Contrapartida honesta do backtest:** o espelho guarda o **estado atual** de campos mutáveis (`isActive`, `status`), não o histórico deles. Logo `Dataset.asOf(d)` é aproximação. Em vez de esconder, o sistema classifica e exibe a **fidelidade** por família — `ALTA` (só fatos datados: `PRIMEIRO_EVENTO`, `TENDENCIA` sobre receita), `MEDIA` (depende de `isActive`: `MARCO_CONTRATO`, `EVENTO_EM_SEGMENTO`, `USO_SEM_COTA`), `BAIXA` (depende de cadastro manual que não existia no passado: `SALDO_COTA`) — com o motivo escrito na tela.

---

### ADR-08 — Stack e deploy: cópia disciplinada do dashboard financeiro

**Contexto.** O financeiro roda em Easypanel, no mesmo servidor, com imagem Docker publicada no GHCR. Cada peça do seu `Dockerfile` existe por uma falha medida em produção. Reinventar qualquer uma delas é comprar de volta um bug já pago.

**Decisão — copiar sem alterar a estrutura:**

| Peça | Por que existe |
|---|---|
| **Stage `prisma-cli` isolado** | O entrypoint roda `migrate deploy` no boot ⇒ o CLI é dependência de **runtime**. O bundle standalone do Next não traz `node_modules/.bin`: deu `sh: prisma: not found` e o container morreu com **exit 127** sem aplicar migration. Copiar só `node_modules/prisma` deu `Cannot find module 'effect'`. |
| **Versão do CLI extraída do `package-lock`** | Um CLI 6.20 aplicando migrations com client 6.19 é drift silencioso. |
| **`binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`** | Sem o segundo, a engine do Prisma não carrega no Alpine. |
| **`.gitattributes` com `*.sh text eol=lf`** | `docker-entrypoint.sh` com CRLF quebra no `sh` do Alpine e o container morre no boot. |
| **`runner` copia `scripts/` + `node_modules/bcryptjs`** | O Next embute o bcryptjs no bundle do servidor; ele some para scripts avulsos. Funciona porque bcryptjs 2.x não tem dependências — migrar para 3.x ou `bcrypt` nativo quebra o atalho. |
| **`bootstrap-admin.mjs` idempotente e não-destrutivo** | Um deploy novo sobe sem nenhum usuário e é impossível entrar. **Nunca sobrescreve senha** — senão quem tem acesso às variáveis de ambiente redefine a senha do admin a cada restart. |
| **`.githooks/pre-commit`** bloqueando commit sem `docs/context/progress.md` staged | Memória persistente versionada é pedido explícito do dono do projeto, e um hook é a única forma de ela não apodrecer. |

Versões travadas pelo `package-lock` do financeiro: Next **15.5.20**, React **19.2.7**, TypeScript **5.9.3**, Prisma/@prisma/client **6.19.3** (idênticas, obrigatório), zod 3.25.76, Tailwind 3.4.19, Recharts 2.15.4, Vitest 2.1.9, decimal.js 10.6.0, jose 5.10.0, bcryptjs 2.4.3, date-fns 4.4.0 / date-fns-tz 3.2.0. Node 22-alpine, Postgres 16-alpine.

**Adições do comercial ao entrypoint** (idempotentes):
```sh
node ./scripts/aplicar-sql.mjs prisma/sql/001_checks_procedencia.sql   # CHECK: INDISPONIVEL ⇒ NULL
node ./scripts/seed-rules.mjs                                          # upsert por key; NÃO sobrescreve
                                                                       # params de regra já existente
```

**Regra de processo, herdada de um erro real:** no financeiro, uma imagem foi buildada e publicada **antes** de o commit passar; o pre-commit bloqueou e a tag `:04d00d3` no GHCR ficou apontando para código que não está no commit `04d00d3`. **Commitar primeiro, buildar depois, com o SHA já commitado. Sempre publicar o short-sha junto com `latest`.**

**Consequência.** O build do financeiro é manual porque a cota do GitHub Actions esgotou — não é preferência arquitetural. **Para o comercial, usar GitHub Actions se houver cota** (workflow `on: push: tags`). É a primeira melhoria de processo do projeto novo.

---

### ADR-09 — Escrita externa isolada em dois arquivos, verificado por CI

**Contexto.** A garantia read-only do Conexa é estrutural. O comercial precisa escrever no ClickUp e no Chatwoot, e o grep global do financeiro (`grep -rE 'method:\s*"(POST|PATCH|PUT|DELETE)"' src/`) deixa de servir.

**Decisão.** Três testes de CI:
```bash
# 1. Conexa continua estruturalmente somente-leitura
grep -rE 'method:\s*"(POST|PATCH|PUT|DELETE)"' src/lib/conexa/ && exit 1
# 2. só dois arquivos escrevem em terceiros
grep -rlE 'method:\s*"(POST|PATCH|PUT|DELETE)"' src/ \
  | grep -vE 'src/lib/(clickup|chatwoot)/client\.ts' && exit 1
# 3. famílias de regra são puras
grep -rE 'from "@/lib/db"|next/|Date\.now\(\)|new Date\(\)' src/lib/intel/rules/families/ && exit 1
```
`import "server-only"` no topo de `env.ts`, dos três `client.ts`, de `sync.ts`, `ingest.ts`, `scheduler.ts`, `session.ts`, `webhook.ts` e de todo `src/lib/intel/dispatch/`.

**Consequência.** A invariante deixa de ser promessa e vira build quebrado. Nota relevante da documentação do Conexa: *"em requisições de escrita com API Token é preciso enviar `sellerId`"* — o token de admin **consegue** escrever no ERP; a barreira estrutural é o que impede.

---

## 3. Arquitetura

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  APIs DE TERCEIROS                                                                   │
│  Conexa Suite v2 (ERP)          ClickUp v2 (CRM)            Chatwoot v1               │
│  60 req/min ← TETO COMPARTILHADO  100 req/min (plano?)       Rack::Attack             │
│  SOMENTE LEITURA (estrutural)     LEITURA + ESCRITA          LEITURA + ESCRITA        │
└────┬─────────────────────────────────┬────────────────────────────┬──────────────────┘
     │ GET paginado (hasNext)          │ GET tasks/fields           │ GET agents/filter
     │ id[]=1&id[]=2 (REPETIDO!)       │ POST task ──────────┐      │ POST message ───┐
     │ webhook (gatilho, não fonte)    │                     │      │ (private:true)  │
     ▼                                 ▼                     │      ▼                 │
┌────────────────────────────────────────────────────────────┼────────────────────────┼─┐
│  CONTAINER dashboard-comercial  ·  Easypanel  ·  1 réplica │                        │ │
│  ══════════════════════════════════════════════════════════┼════════════════════════┼═│
│                                                            │                        │ │
│  ┌─ (A) INGESTÃO  src/lib/{conexa,clickup,chatwoot}/ ──────┼────────────────────────┼┐│
│  │  client.ts   rate limiter POR DESTINO · retry 7× (GET)  │  paginação hasNext     ││
│  │              CONEXA_RATE_LIMIT_PER_MIN=15  (ADR-02)     │                        ││
│  │  sync.ts     BACKFILL │ RECONCILE │ REPAIR(id[]) │ WEBHOOK │ MIRROR_PULL(fut.)   ││
│  │  ingest.ts   upsert em LOTE por conexaId → idempotente por construção            ││
│  └────────────────────────────┬────────────────────────────────────────────────────┘│
│                               ▼ escreve                                              │
│  ┌─ (B) ESPELHO  ·  Postgres seahub_comercial (BANCO PRÓPRIO — ADR-01) ────────────┐ │
│  │  dim_*   companies · customers · customer_tags · persons · plans · products      │ │
│  │          service_categories · rooms(DERIVADA) · room_prices(MANUAL)              │ │
│  │          hour_packages(MANUAL) · cost_centers                                    │ │
│  │  fact_*  contracts · sales · recurring_sales · charges · ROOM_BOOKINGS ★novo     │ │
│  │  crm_*   sellers · clickup_tasks · crm_statuses                                  │ │
│  └────────────────────────────┬────────────────────────────────────────────────────┘ │
│                               ▼ job INTELLIGENCE — ZERO chamadas ao Conexa (ADR-07)  │
│  ┌─ (C) CONSOLIDAÇÃO  src/lib/intel/dataset/ ─────────────────────────────────────┐  │
│  │  1. build-profiles  → intel_customer_profiles      (1 linha/cliente)            │  │
│  │  2. revenue/monthly → intel_customer_monthly_revenue (1 linha/cliente/mês)      │  │
│  │  3. quota/balance   → intel_hour_quota_balances    (1 linha/cota/ciclo)         │  │
│  │     cada parcela com PROCEDÊNCIA: API │ DERIVADO │ MANUAL │ INDISPONIVEL        │  │
│  │     CHECK no Postgres:  source='INDISPONIVEL' ⇒ valor IS NULL                   │  │
│  └────────────────────────────┬────────────────────────────────────────────────────┘  │
│                               ▼ 4. dataset/load → Dataset IMUTÁVEL (asOf) ← PONTO DE  │
│  ┌─ (D) MOTOR DE REGRAS  src/lib/intel/rules/ ──────────────────────────── CORTE ──┐  │
│  │                                                                                  │  │
│  │   Rule (LINHA EM BANCO)              RuleFamily (CÓDIGO PURO — 6 famílias)       │  │
│  │   ├ key   "fiscal-11-meses"  ──────▶ MARCO_CONTRATO      avaliar(ctx)→RuleHit[] │  │
│  │   ├ family "MARCO_CONTRATO"          SALDO_COTA          ✗ fetch                │  │
│  │   ├ params {meses:11, tol:7, …}      USO_SEM_COTA        ✗ Prisma               │  │
│  │   ├ mode  OFF│SOMBRA│DRY_RUN│LIVE    TENDENCIA           ✗ Date.now()           │  │
│  │   ├ version, cooldownDays            PRIMEIRO_EVENTO     ✓ hoje INJETADO        │  │
│  │   └ maxPorExecucao                   EVENTO_EM_SEGMENTO  ⇒ testável·backtestável│  │
│  │                                                                                  │  │
│  │   runner.ts   → upsert Signal   @@unique(customer, ruleKey, cycleKey) ← BARREIRA │  │
│  │   explain.ts  → trace por predicado: por que disparou E POR QUE NÃO disparou     │  │
│  │   backtest.ts → avaliar sobre Dataset.asOf(d), d ∈ janela · fidelidade declarada │  │
│  └────────────────────────────┬────────────────────────────────────────────────────┘  │
│                               ▼ intel_signals (SOMBRA │ ABERTO)                       │
│  ┌─ (E) DISPARO  src/lib/intel/dispatch/ ──────────────────────────────────────────┐  │
│  │  orquestrador (ADR-04):                                                         │  │
│  │    kill-switch global → modo da regra → reconciliação vermelha? → lacuna         │  │
│  │    → claim OUTBOX (@@unique) → teto por execução → kill-switch canal             │  │
│  │    → dry-run? previa() : disparar()                                              │──┼┘
│  │  intel_dispatch_log   @@unique(signalId,channel) + @@unique(idempotencyKey)      │──┼┘
│  │  ops_integration_failures  ← TRILHA SEPARADA da fila do vendedor                 │  │
│  └────────────────────────────┬────────────────────────────────────────────────────┘  │
│                               ▼                                                       │
│  ┌─ (F) RECONCILIAÇÃO  ·  o guarda-costas (ADR-06) ────────────────────────────────┐  │
│  │  1. receita comercial × financeiro, por mês         → tolerância R$ 0,00         │  │
│  │  2. completude de reservas (busca binária no offset) → contagem == contagem      │  │
│  │  3. saldo derivado × tela do Conexa (planilha)      → ≥95% ±0,25h · 100% sinal   │  │
│  │  4. DispatchLog PENDENTE >10min × ClickUp (chave, operador ==)                   │  │
│  │  QUALQUER VERMELHO  ⇒  BLOQUEIA promoção de regra para LIVE                      │  │
│  └────────────────────────────┬────────────────────────────────────────────────────┘  │
│                               ▼                                                       │
│  ┌─ (G) UI  ·  Next.js App Router · server components · sessão server-side ────────┐  │
│  │  /sinais · /clientes/[id] ("por que não disparou?") · /regras/[key]/simular      │  │
│  │  /reconciliacao · /operacao/lacunas · /disparos                                  │  │
│  │  todo número renderizado por <Numero valor source evidencia/>                    │  │
│  └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                       │
│  AGENDADOR EMBUTIDO (ADR-03) · instrumentation.ts · pg_advisory_lock por tarefa        │
│  enterrarZumbis() no boot · trava por tarefa (pula, nunca empilha) · timers .unref()   │
└───────────────────────────────────────────────────────────────────────────────────────┘

FRONTEIRA COM O DASHBOARD FINANCEIRO (ADR-01):
  banco seahub_financeiro  ─── SEM ACESSO na v1 ───  banco seahub_comercial
  acoplamento = apenas o TETO de 60 req/min do Conexa, repartido por env (ADR-02)
  Etapa 2 (condicional, gatilho medido): export.v_*_v1 via postgres_fdw → MIRROR_PULL
```

---

## 4. Modelo de dados

```prisma
// =============================================================================
// Dashboard Comercial Seahub — schema.prisma
//
// CONVENÇÕES HERDADAS do Dashboard Financeiro (mesmo ERP, mesmo servidor):
//   • `conexaId` como PK natural  → idempotência do upsert
//   • `raw Json`                  → payload bruto, auditoria e resgate de campo novo
//   • `syncedAt`                  → quando este espelho foi atualizado
//   • prefixos `dim_` / `fact_`
//   • dinheiro SEMPRE Decimal(14,2). NUNCA Float, NUNCA number para somar.
//   • O espelho do Conexa NÃO usa @relation entre si (só colunas *ConexaId + índice):
//     o sync pagina entidades em ordens diferentes e uma FK real quebraria o upsert
//     quando a venda chega antes do cliente. As tabelas INTERNAS usam relação real.
//
// CONVENÇÕES NOVAS deste projeto:
//   • todo número que a UI exibe e que NÃO veio literal de um campo da API carrega
//     um par (valor, procedência). `INDISPONIVEL` ⇒ valor NULL, garantido por CHECK.
//   • regra é DADO (model Rule), família de regra é CÓDIGO (src/lib/intel/rules/families)
// =============================================================================

generator client {
  provider      = "prisma-client-js"
  // native = dev Windows; linux-musl-openssl-3.0.x = Alpine no Easypanel.
  // Sem o segundo, a engine não carrega no container.
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// =============================================================================
// PROCEDÊNCIA — o coração da regra "nunca inventar dado"
// =============================================================================

/// De onde veio um número que a UI exibe.
///  API          : campo literal de uma resposta. Rastreável 1:1 (o `raw` prova).
///  DERIVADO     : nossa conta, por fórmula determinística e documentada.
///  MANUAL       : humano digitou porque a API não expõe. Carrega quem e quando.
///  INDISPONIVEL : não sabemos. O valor É NULL — nunca 0, nunca estimativa.
enum DataSource { API DERIVADO MANUAL INDISPONIVEL }

// =============================================================================
// AUTENTICAÇÃO — copiada do Dashboard Financeiro
// =============================================================================

enum UserRole {
  ADMIN      // integrações, usuários, params de regra, promover LIVE, sync manual
  COMERCIAL  // fila de sinais, marcar ganho/perdido, rodar simulação, PROPOR params
  VIEWER     // somente leitura
}

model User {
  id           String    @id @default(cuid())
  email        String    @unique
  name         String
  passwordHash String                       // bcryptjs, 12 rounds
  role         UserRole  @default(VIEWER)
  isActive     Boolean   @default(true)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  lastLoginAt  DateTime?

  sellerId String?
  seller   Seller? @relation(fields: [sellerId], references: [id], onDelete: SetNull)

  sessions      Session[]
  loginEvents   LoginEvent[]
  signalReviews Signal[]     @relation("SignalReviewer")
  manualEntries ManualFact[]
  ruleChanges   RuleChange[]

  @@index([sellerId])
  @@map("users")
}

/// Sessão server-side REVOGÁVEL. O JWT no cookie carrega só ids;
/// a validade autoritativa está aqui.
model Session {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())
  userAgent String?
  ip        String?

  @@index([userId])
  @@index([expiresAt])
  @@map("sessions")
}

model LoginEvent {
  id        String   @id @default(cuid())
  userId    String?
  user      User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  email     String
  success   Boolean
  reason    String?                          // sempre gravado; a resposta ao usuário é única
  ip        String?
  userAgent String?
  createdAt DateTime @default(now())

  @@index([email])
  @@index([createdAt])
  @@map("login_events")
}

// =============================================================================
// ESPELHO DO CONEXA — DIMENSÕES
// =============================================================================

/// Unidade. GET /companies.
/// ⚠ contract NÃO traz companyId na resposta (embora /contracts ACEITE o filtro
/// companyId[]). Segmentar por unidade usa customer.companyId ou plan.companyId.
model Company {
  conexaId  Int      @id
  tradeName String?
  legalName String?
  cnpj      String?
  city      String?
  state     String?
  timeZone  String?
  isActive  Boolean  @default(true)
  raw       Json
  syncedAt  DateTime @default(now())
  @@map("dim_companies")
}

/// Cliente. GET /customers.
model Customer {
  conexaId          Int       @id            // customers[].customerId
  companyConexaId   Int?                     // customers[].companyId
  name              String?
  tradeName         String?
  isActive          Boolean   @default(true)
  isBlocked         Boolean   @default(false)
  isJuridicalPerson Boolean   @default(false)
  cnpj              String?                  // legalPerson.cnpj
  cpf               String?                  // naturalPerson.cpf
  fieldOfActivity   String?
  cellNumber        String?
  phones            String[]
  emailsMessage           String[]
  emailsFinancialMessages String[]
  city              String?                  // address.city
  state             String?                  // address.state.abbreviation
  notes             String?
  /// customers[].extraFields = [{id,name,value}] — "UTM", "External ID".
  /// Json porque o conjunto é configurável no Conexa (GET /extraFields lista as
  /// definições); promover a coluna seria chutar.
  extraFields       Json?
  /// customers[].tagsId. ⚠ NÃO existe endpoint /tags (67 rotas verificadas):
  /// temos o id, nunca o nome → ver CustomerTag.
  tagIds            Int[]
  createdAtConexa   DateTime?
  raw               Json
  syncedAt          DateTime  @default(now())

  @@index([companyConexaId])
  @@index([isActive])
  @@index([createdAtConexa])
  @@map("dim_customers")
}

/// LACUNA: a API expõe customer.tagsId e o filtro tagId[], mas NÃO o cadastro
/// das tags. O nome é sempre MANUAL. Enquanto ninguém digitar, a UI mostra
/// "Tag #3 (nome não disponível via API)".
model CustomerTag {
  conexaId    Int        @id
  name        String?
  source      DataSource @default(INDISPONIVEL)
  notedById   String?
  updatedAt   DateTime   @updatedAt
  @@map("dim_customer_tags")
}

/// Pessoa/contato. GET /persons. (booking.personId aponta para cá.)
model Person {
  conexaId         Int      @id
  customerConexaId Int?
  companyConexaId  Int?
  name             String?
  email            String?
  cellNumber       String?
  jobTitle         String?
  isActive         Boolean  @default(true)
  raw              Json
  syncedAt         DateTime @default(now())
  @@index([customerConexaId])
  @@map("dim_persons")
}

/// GET /serviceCategories — PLURAL (no singular a API devolve 404).
/// É a chave de elegibilidade das regras 1, 5, 6, 7, 8 e 10.
/// ⚠ ARMADILHA MEDIDA: o catálogo real da Seahub tem 3 grafias para Sebrae
/// ("Salas Privativas -  Sebrae" com 2 espaços, "Salas Privativas Sebrae") e
/// 2 caixas para "Outros Serviços". Normalizar (trim + colapsar espaços + lower)
/// ANTES de comparar, senão clientes somem silenciosamente.
model ServiceCategory {
  conexaId       Int      @id
  name           String?
  /// name normalizado, materializado — para comparar por índice, não por função.
  nameNormalized String?
  raw            Json
  syncedAt       DateTime @default(now())
  @@index([nameNormalized])
  @@map("dim_service_categories")
}

/// GET /plans. Todos os campos abaixo confirmados na coleção.
model Plan {
  conexaId                Int      @id
  companyConexaId         Int?
  name                    String?
  description             String?
  serviceCategoryConexaId Int?
  costCenterConexaId      Int?
  fidelityMonths          Int?
  membershipFee           Decimal? @db.Decimal(14, 2)
  refundValue             Decimal? @db.Decimal(14, 2)
  /// {monthly, bimonthly, quarterly, semester, yearly} — o conjunto de chaves varia
  /// por plano. Base do "quanto economiza migrando p/ Bianual" (regra 1).
  paymentPeriodicities    Json?
  /// >>> hourQuotas = [{id, name, spaceId, groupId, quantity, validityType}]
  /// validityType observado: Monthly | Weekly | Daily.
  /// DIREITO A HORAS no nível do PLANO — contradiz a "limitação" do documento.
  /// FALLBACK: se o contrato trouxer hourPlanQuota, ELE manda (ver ADR-05).
  hourQuotas              Json?
  productQuotas           Json?                 // [{id, productId, quota}]
  discountOnRooms         Decimal? @db.Decimal(6, 2)
  discountOnWorkstation   Decimal? @db.Decimal(6, 2)
  privateSpaceIds         Int[]
  bookingModels           Json?
  serviceCorrespondenceQuotas Json?
  isActive                Boolean  @default(true)
  createdAtConexa         DateTime?
  updatedAtConexa         DateTime?
  raw                     Json
  syncedAt                DateTime @default(now())

  @@index([serviceCategoryConexaId])
  @@index([isActive])
  @@map("dim_plans")
}

/// GET /products.
/// ⚠ LIÇÃO DO FINANCEIRO (ADR-0014): /products só cobre o CATÁLOGO. Salas/espaços
/// vendidos dão 404 "no permission" — 118 de 164+ produtos acessíveis. Por isso
/// priceSource existe, e por isso o preço/hora vem de RoomPrice (MANUAL) ou de
/// sale.amount / sale.quantity (preço EFETIVO pago, já com desconto).
model Product {
  conexaId                Int        @id
  companyConexaId         Int?
  name                    String?
  description             String?
  price                   Decimal?   @db.Decimal(14, 2)
  priceSource             DataSource @default(INDISPONIVEL)
  serviceCategoryConexaId Int?
  /// DESNORMALIZADO de propósito: as categorias do Conexa têm nomes duplicados em
  /// ids diferentes; agrupar por id espalharia a mesma categoria em duas linhas.
  serviceCategoryName     String?
  categorySource          DataSource @default(INDISPONIVEL)
  isActive                Boolean    @default(true)
  raw                     Json
  syncedAt                DateTime   @default(now())
  @@index([serviceCategoryConexaId])
  @@map("dim_products")
}

/// Sala/espaço. NÃO EXISTE ENDPOINT: /rooms, /spaces, /privateSpaces e /spaceGroups
/// estão ausentes das 67 rotas e o financeiro MEDIU 404. Esta dimensão é DERIVADA de
/// room/bookings[].place = {id, name} — o único lugar onde o nome da sala aparece.
/// Sala nunca reservada simplesmente não existe aqui.
/// ★ place.id == spaceId (das cotas) == productId — MESMO espaço de identificadores,
///   verificado por coincidência em fixtures independentes (plano 555 hourQuotas
///   spaceId 2106 ↔ booking 1 place.id 2106 ↔ sale 13 productId 2106 "Sala de Reunião 1").
model Room {
  conexaId        Int        @id
  name            String?
  companyConexaId Int?
  source          DataSource @default(DERIVADO)
  isPrivateSpace  Boolean    @default(false)   // true se o id aparece em contract.privateSpaceId
  firstSeenAt     DateTime   @default(now())
  syncedAt        DateTime   @default(now())
  @@map("dim_rooms")
}

/// Preço/hora — MANUAL por construção. Insumo obrigatório da REGRA 4 ("mostrar a
/// economia vs avulso"). Sem uma linha aqui, a regra 4 DISPARA (uso > 5h é derivável)
/// mas a UI NÃO exibe economia: mostra a lacuna.
model RoomPrice {
  id                      String     @id @default(cuid())
  roomConexaId            Int?
  serviceCategoryConexaId Int?                              // alternativa: preço por categoria
  hourlyPrice             Decimal    @db.Decimal(14, 2)
  currency                String     @default("BRL")
  source                  DataSource @default(MANUAL)
  validFrom               DateTime   @db.Date
  validTo                 DateTime?  @db.Date
  enteredById             String?
  createdAt               DateTime   @default(now())
  @@index([roomConexaId, validFrom])
  @@map("dim_room_prices")
}

/// PACOTE DE HORAS — a lacuna central do projeto.
/// A API dá: recurringSales[].packageId ("ID do Pacote de Horas", doc oficial).
/// A API NÃO dá: qualquer endpoint para LER esse pacote. Não sabemos quantas horas
/// ele vale nem quanto custa a hora. NÃO EXISTE /packages.
///
/// Portanto hoursIncluded NASCE NULO com hoursSource = INDISPONIVEL. As famílias
/// SALDO_COTA (regras 2 e 9) NÃO geram Signal para um pacote sem hoursIncluded:
/// geram IntegrationFailure(LACUNA_DE_DADO), que vira linha em /operacao/lacunas.
///
/// HIPÓTESE **NÃO CONFIRMADA**: no Postman, plan 555 tem hourQuotas.id 78/79/80 e há
/// recurringSales com packageId 78/79/80, com validityType e frequency casando
/// (Monthly/Monthly/Daily ↔ monthly/monthly/daily). São fixtures DIFERENTES.
/// hourQuotaConexaId existe para registrar isso DEPOIS de validado com dado real.
/// COMO CONFIRMAR: GET /recurringSales?customerId[]=X da Seahub + GET /plans, e ver
/// se todo packageId aparece como hourQuotas[].id de algum plano contratado.
model HourPackage {
  conexaId            Int        @id
  name                String?
  hoursIncluded       Decimal?   @db.Decimal(10, 2)
  validityType        String?                            // "Monthly" | "Weekly" | "Daily"
  hoursSource         DataSource @default(INDISPONIVEL)
  hourQuotaConexaId   Int?
  hourQuotaLinkSource DataSource @default(INDISPONIVEL)
  pricePerPackage     Decimal?   @db.Decimal(14, 2)      // MANUAL — insumo da regra 4
  priceSource         DataSource @default(INDISPONIVEL)
  notes               String?
  enteredById         String?
  firstSeenAt         DateTime   @default(now())
  updatedAt           DateTime   @updatedAt
  @@map("dim_hour_packages")
}

model CostCenter {
  conexaId Int      @id
  name     String?
  raw      Json
  syncedAt DateTime @default(now())
  @@map("dim_cost_centers")
}

// =============================================================================
// ESPELHO DO CONEXA — FATOS
// =============================================================================

/// Contrato. GET /contracts (variante "Conexa Coworking" da coleção).
/// ★ DESCOBERTA DE ARQUITETURA: /contracts (LISTA) devolve o MESMO modelo de
///   /contract/{id} — documentado na descrição do endpoint. O job diário NÃO precisa
///   de N chamadas /contract/{id}: uma paginação traz cotas, sala privativa e
///   serviços complementares de TODOS os contratos.
/// ⚠ **NÃO CONFIRMADO** que a instância da Seahub devolva a variante Coworking
///   (com hourPlanQuota/privateSpaceId) e não a variante "Recorrência".
///   COMO CONFIRMAR: GET /contracts?limit=1 com o token real — é o teste nº 2 da Fase 0.
///   Se vier Recorrência, as regras 2, 6, 7, 8 e 9 perdem a base.
model Contract {
  conexaId           Int       @id
  customerConexaId   Int?
  planConexaId       Int?
  costCenterConexaId Int?
  /// ⚠ DIVERGÊNCIA REAL entre list e detail, confirmada na coleção:
  ///   GET /contracts     → creatorUserId
  ///   GET /contract/{id} → sellerId
  /// Guardamos os dois; effectiveSeller resolve `sellerId ?? creatorUserId`.
  sellerConexaId          Int?
  creatorUserConexaId     Int?
  effectiveSellerConexaId Int?                          // DERIVADO
  amount             Decimal   @db.Decimal(14, 2)
  /// Monthly|Bimonthly|Quarterly|Semester|Yearly (MAIÚSCULA na resposta,
  /// minúscula no filtro `frequency`). É a periodicidade de PAGAMENTO —
  /// não necessariamente a vigência do plano.
  paymentFrequency   String?
  startDate          DateTime? @db.Date                 // ★ base das regras 1, 6, 7, 8
  endDate            DateTime? @db.Date
  isActive           Boolean   @default(true)
  dueDay             Int?                               // candidato a âncora do ciclo de cota
  fidelityDate       DateTime? @db.Date                 // ★ âncora ALTERNATIVA da regra 1 (Q13)
  dateSalesGeneration DateTime? @db.Date                // ★ âncora alternativa das regras 6/7/8
  contractSummary    String?
  notes              String?
  salesQuantity      Int?
  endReasonId        Int?
  hadProrata         Boolean   @default(false)
  lastContractualReadjustment DateTime? @db.Date
  refundAmount       Decimal?  @db.Decimal(14, 2)

  // --- bloco Conexa Coworking ---
  /// >>> hourPlanQuota = [{quantity, spaceId, groupId}] — DIREITO A HORAS no nível
  /// do CONTRATO. Tem PRECEDÊNCIA sobre plan.hourQuotas (ADR-05).
  /// Quando nulo, cai para o plano; quando os dois são nulos, o cliente não tem cota
  /// (é 100% avulso) — o que por si só é o gatilho da REGRA 4.
  hourPlanQuota      Json?
  productQuotas      Json?
  /// >>> "ID do Escritório Privativo ou Sala Privativa vinculada ao contrato".
  /// Marcador ESTRUTURADO de sala privativa (regras 6, 7, 8) — não depende de nome.
  /// Ressalva: nos exemplos oficiais vários contratos coworking têm isto NULL.
  privateSpaceConexaId Int?
  discountOnRooms       Decimal? @db.Decimal(6, 2)
  discountOnWorkstation Decimal? @db.Decimal(6, 2)
  serviceCorrespondenceQuotas Json?
  bookingModels        Json?
  /// Só CONFIRMADO em GET /contract/{id}; **NÃO CONFIRMADO** no LIST.
  complementaryServices Json?
  /// contract.extraFields = [{id,name,value}], type='contract'.
  /// ★ CAMINHO DE DESBLOQUEIO DA REGRA 10: se a Seahub preencher "Tipo de contrato"
  ///   com o tier (Litoral/Batial/...), este é o dado VIVO que dispensa o mapa manual.
  ///   **NÃO CONFIRMADO** que venha preenchido — nenhum exemplo da coleção o traz.
  extraFields          Json?

  createdAtConexa    DateTime?
  updatedAtConexa    DateTime?
  raw                Json
  syncedAt           DateTime  @default(now())

  @@index([customerConexaId])
  @@index([planConexaId])
  @@index([isActive])
  @@index([startDate])
  @@index([endDate])
  @@index([fidelityDate])
  @@index([privateSpaceConexaId])
  @@index([effectiveSellerConexaId])
  @@map("fact_contracts")
}

/// Venda (linha). GET /sales.
/// ⚠ FILTRO DE DATA: dateFrom/dateTo (filtram referenceDate) é a ÚNICA janela
///   utilizável. createdAtFrom/To está DOCUMENTADO na coleção mas devolve
///   400 "Field validation error" — MEDIDO em produção (sync.ts:172-174).
model Sale {
  conexaId              Int       @id
  companyConexaId       Int?
  customerConexaId      Int?
  productConexaId       Int?
  /// product.name vem EMBUTIDO na venda. Guardado de propósito: a maioria dos
  /// produtos vendidos (salas) não existe em /products. Sem isto a tela mostraria
  /// "Produto 2880".
  productName           String?
  contractConexaId      Int?
  recurringSaleConexaId Int?
  sellerConexaId        Int?
  requesterConexaId     Int?
  /// paid|billed|cancelled|notBilled|deductedFromQuota|billedCancelled|
  /// billedNegociated|partiallyPaid
  status                String?
  /// DERIVADO: status === 'deductedFromQuota'. Coluna materializada para a query de
  /// consumo usar índice em vez de comparar string por linha.
  isQuotaDeduction      Boolean   @default(false)
  amount                Decimal   @db.Decimal(14, 2)
  originalAmount        Decimal?  @db.Decimal(14, 2)
  discountValue         Decimal?  @db.Decimal(14, 2)
  /// Pode ser fracionário (2.75 na amostra) → Decimal, não Int.
  /// ★ Para reserva de sala, quantity é a DURAÇÃO EM HORAS — fonte cruzada
  ///   independente do cálculo finalTime−startTime.
  quantity              Decimal?  @db.Decimal(14, 4)
  referenceDate         DateTime?
  /// DERIVADO: referenceDate em America/Fortaleza, truncado. Materializado para
  /// o índice funcionar nas agregações mensais.
  referenceDateLocal    DateTime? @db.Date
  notes                 String?
  createdAtConexa       DateTime?
  updatedAtConexa       DateTime?
  raw                   Json
  syncedAt              DateTime  @default(now())

  @@index([customerConexaId, referenceDateLocal])
  @@index([contractConexaId])
  @@index([recurringSaleConexaId])
  @@index([productConexaId])
  @@index([status])
  @@index([isQuotaDeduction])
  @@map("fact_sales")
}

/// Venda recorrente. GET /recurringSales.
/// É AQUI que vive o Pacote de Horas contratado (productId nulo + packageId != nulo).
/// ★ O financeiro JÁ persiste packageConexaId (mappers.ts:226) — prova de que
///   packageId chega preenchido em dados REAIS da Seahub.
model RecurringSale {
  conexaId                 Int       @id
  customerConexaId         Int?
  productConexaId          Int?                        // "null se existir um packageId"
  packageConexaId          Int?                        // "ID do Pacote de Horas"
  /// DERIVADO de packageConexaId != null.
  isHourPackage            Boolean   @default(false)
  recurringSaleContractConexaId Int?
  sellerConexaId           Int?
  creatorUserConexaId      Int?
  requesterConexaId        Int?
  amount                   Decimal   @db.Decimal(14, 2)
  /// ⚠ SEMÂNTICA AMBÍGUA nos exemplos oficiais: packageId 34 → quantity 80,
  /// amount 1000 (parece 80h por R$1.000); packageId 69/78/79/80 → quantity 1,
  /// amount 0 (parece 1 unidade de cota herdada do plano). Sem dado real não dá
  /// para decidir se quantity é HORAS ou UNIDADES. Ver Q19.
  quantity                 Decimal?  @db.Decimal(14, 4)
  frequency                String?
  occurrenceQuantity       Int?
  generatedQuantity        Int?
  startDate                DateTime? @db.Date
  endDate                  DateTime? @db.Date
  lastAdjustmentDate       DateTime? @db.Date
  isActive                 Boolean   @default(true)
  isCalculateProRata       Boolean   @default(false)
  notes                    String?
  createdAtConexa          DateTime?
  updatedAtConexa          DateTime?
  raw                      Json
  syncedAt                 DateTime  @default(now())

  @@index([customerConexaId])
  @@index([packageConexaId])
  @@index([isHourPackage])
  @@index([isActive])
  @@map("fact_recurring_sales")
}

/// Cobrança = receita faturada. GET /charges.
/// MESMA RÉGUA DO FINANCEIRO, de propósito (ADR-06).
model Charge {
  conexaId             Int       @id
  companyConexaId      Int?
  customerConexaId     Int?
  status               String?
  type                 String?
  origin               String?
  amount               Decimal   @db.Decimal(14, 2)
  /// COM juros/multa — é o campo somado no regime de EMISSÃO (o da Seahub).
  currentAmount        Decimal?  @db.Decimal(14, 2)
  paidAmount           Decimal?  @db.Decimal(14, 2)
  discountAmount       Decimal?  @db.Decimal(14, 2)
  competenceDate       DateTime? @db.Date               // valor CRU (pode ser nulo)
  /// competenceDate ?? dueDate, MATERIALIZADA na ingestão para que SQL e agregação
  /// concordem por construção (ADR-0012 do financeiro).
  competenceEffective  DateTime? @db.Date
  competenceIsFallback Boolean   @default(false)        // exposto na tela
  dueDate              DateTime? @db.Date
  paymentDate          DateTime? @db.Date
  cancelDate           DateTime? @db.Date
  /// createdAt do Conexa convertido para America/Fortaleza e truncado em Date.
  /// "Cobrança criada 30/06 às 22h é de JUNHO" — converter na CONSULTA descartaria
  /// o índice, por isso é coluna (ADR-0013 do financeiro).
  emissionDate         DateTime? @db.Date
  /// DERIVADO: isRecognizedCharge() — exclui cancelled/cancelDate E 'negotiated'.
  /// Materializado porque TODA agregação de receita filtra por ele.
  isRecognized         Boolean   @default(true)
  salesIds             Int[]                            // rateio charge → sales → produto
  createdAtConexa      DateTime?
  updatedAtConexa      DateTime?
  raw                  Json
  syncedAt             DateTime  @default(now())

  @@index([customerConexaId, emissionDate])
  @@index([customerConexaId, competenceEffective])
  @@index([isRecognized, emissionDate])
  @@index([status])
  @@index([dueDate])
  @@index([paymentDate])
  @@map("fact_charges")
}

/// RESERVA DE SALA — modelo NOVO (o financeiro não tem; nunca chamou /room/bookings).
/// Espinha dorsal das regras 4, 5, 9 e 10 e do consumo das regras 2 e 9.
/// ⚠ **NÃO CONFIRMADO** que o token da Seahub tenha acesso: a coleção documenta
///   403 "The booking endpoint is only available for authorized customers.
///   To request access, contact Conexa support". COMO CONFIRMAR: GET /room/bookings?limit=1
///   — é o teste nº 1 da Fase 0 e o GO/NO-GO de 6 das 10 regras.
model RoomBooking {
  conexaId          Int       @id
  saleConexaId      Int?
  customerConexaId  Int?
  personConexaId    Int?
  roomConexaId      Int?                                // place.id
  roomName          String?                             // place.name — EMBUTIDO (não há /rooms)
  companyConexaId   Int?
  /// billed|notBilled|billedCancelled|partiallyPaid|paid|cancelled|deductedFromQuota
  status            String?
  /// ★ DERIVADO: status === 'deductedFromQuota'. É o CONEXA quem diz que a reserva
  /// foi abatida da cota — não somos nós que adivinhamos. Base do saldo (ADR-05).
  isQuotaDeduction  Boolean   @default(false)
  isActive          Boolean   @default(true)
  isBilled          Boolean   @default(false)
  completed         Boolean   @default(false)           // no-show: completed=false
  cancellationReason String?
  recurringBookingConexaId Int?
  /// ⚠ São startTime/finalTime, NÃO startAt — o documento do cliente alerta
  /// exatamente para este erro e a coleção confirma o alerta. W3C com offset.
  startTime         DateTime?
  finalTime         DateTime?
  /// DERIVADO: (finalTime − startTime) em horas. MATERIALIZADO porque toda regra de
  /// horas soma esta coluna; calcular no SQL descartaria o índice.
  /// NULL (nunca 0) se qualquer ponta faltar — não assumimos duração padrão.
  durationHours     Decimal?  @db.Decimal(10, 4)
  /// DERIVADO: startTime em America/Fortaleza, truncado. Chave das agregações mensais
  /// e do "dia da primeira reserva" (regra 5).
  bookingDate       DateTime? @db.Date
  notes             String?
  visitors          Json?
  settings          Json?
  createdAtConexa   DateTime?
  updatedAtConexa   DateTime?
  raw               Json
  syncedAt          DateTime  @default(now())

  @@index([customerConexaId, bookingDate])
  @@index([customerConexaId, isQuotaDeduction, bookingDate])
  @@index([roomConexaId])
  @@index([bookingDate])
  @@index([createdAtConexa])
  @@map("fact_room_bookings")
}

// =============================================================================
// CRM — a ponte entre três sistemas que não se conhecem
// =============================================================================

/// VENDEDOR. LACUNA: o Conexa NÃO tem /users nem /sellers (67 rotas verificadas).
/// sellerId é um inteiro OPACO. O nome é sempre MANUAL. Por isso este modelo tem
/// PK própria (cuid): nenhum dos três sistemas é dono da identidade.
/// CONCILIAR SEMPRE POR E-MAIL, nunca por nome (nome muda, tem acento, tem homônimo).
model Seller {
  id              String     @id @default(cuid())
  name            String
  email           String?    @unique
  conexaSellerId  Int?       @unique
  clickupUserId   String?    @unique
  /// ⚠ NÃO é @unique e nunca deve ser tratado como global: as tabelas User e AgentBot
  /// do Chatwoot têm sequências INDEPENDENTES e COLIDEM. Constatado em produção:
  /// nesta conta o AgentBot é id 4 e a agente Maria Eduarda também é id 4.
  /// Sempre parear com chatwootAssigneeType.
  chatwootAgentId      Int?
  chatwootAssigneeType String?                          // "User" | "AgentBot"
  mappingSource   DataSource @default(MANUAL)
  isActive        Boolean    @default(true)
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  users    User[]
  profiles CustomerProfile[]
  signals  Signal[]
  @@index([isActive])
  @@map("crm_sellers")
}

enum CrmStage { EM_ANDAMENTO GANHO PERDIDO DESCONHECIDO }

/// Opção do campo customizado "Status CRM" do ClickUp (type: drop_down).
/// ⚠ NÃO confundir com o status NATIVO da task (task.status.status, que tem
/// "aguardando pagamento", "sem contato"). São objetos completamente diferentes
/// que coexistem na mesma task — o documento do cliente está certo em separá-los.
/// Espelhado aqui para o histórico não quebrar se renomearem uma opção no ClickUp.
model CrmStatus {
  clickupOptionId String   @id                          // type_config.options[].id (uuid)
  clickupFieldId  String
  name            String
  orderIndex      Int?
  color           String?
  normalized      CrmStage @default(DESCONHECIDO)       // regra não depende do texto exato
  raw             Json
  syncedAt        DateTime @default(now())
  tasks ClickUpTask[]
  @@index([clickupFieldId])
  @@map("crm_statuses")
}

model ClickUpTask {
  taskId            String     @id
  listId            String?
  spaceId           String?
  name              String?
  url               String?
  nativeStatus      String?                             // task.status.status — NÃO é o Status CRM
  crmStatusOptionId String?
  crmStatus         CrmStatus? @relation(fields: [crmStatusOptionId], references: [clickupOptionId], onDelete: SetNull)
  assigneeClickupUserId String?
  customerConexaId  Int?
  /// Como o vínculo task↔cliente foi feito: API (custom field), DERIVADO (casamento
  /// por CNPJ), MANUAL. Nunca exibido como API se não for.
  linkSource        DataSource @default(INDISPONIVEL)
  /// custom field chave_disparo — a redundância que permite reconciliar quando o
  /// banco local for restaurado de backup ou alguém apagar a task na mão.
  chaveDisparo      String?
  dateCreated       DateTime?
  dateUpdated       DateTime?
  dateClosed        DateTime?
  customFields      Json?                               // cru — auditoria da decodificação
  raw               Json
  syncedAt          DateTime   @default(now())

  @@index([customerConexaId])
  @@index([chaveDisparo])
  @@index([assigneeClickupUserId])
  @@index([listId])
  @@map("crm_clickup_tasks")
}

// =============================================================================
// INTELIGÊNCIA — consolidação
// =============================================================================

/// SEGMENTO DECLARATIVO — o que permite a regra 10 existir sem deploy e o que
/// impede alguém de classificar cliente por substring do nome do plano.
/// definition: {"tipo":"serviceCategory","ids":[31]}
///           | {"tipo":"contractField","campo":"privateSpaceConexaId","operador":"notNull"}
///           | {"tipo":"planTierMap","tier":"Litoral","planIds":[3248,3252,...]}   ← MANUAL
///           | {"tipo":"contractExtraField","fieldId":108,"valor":"Litoral"}       ← API (vivo)
model Segment {
  key         String     @id                            // "endereco-fiscal" | "sala-privativa"
  name        String
  description String?
  definition  Json
  /// API quando vem de extraField do Conexa; MANUAL quando é mapa homologado.
  source      DataSource @default(MANUAL)
  isActive    Boolean    @default(true)
  updatedById String?
  updatedAt   DateTime   @updatedAt
  @@map("intel_segments")
}

/// PERFIL CONSOLIDADO — 1 linha por cliente, saída do job diário.
/// Existe para que as regras leiam UM registro em vez de reagregar 5 fatos.
model CustomerProfile {
  customerConexaId        Int      @id

  activeServiceCategories String[]                       // DERIVADO: contrato→plano→categoria
  activeSegments          String[]                       // DERIVADO: chaves de Segment
  hasFiscalAddress        Boolean  @default(false)
  hasPrivateRoom          Boolean  @default(false)
  hasHourPackage          Boolean  @default(false)
  isPayPerUseOnly         Boolean  @default(false)       // reservou mas não tem cota

  firstContractStart      DateTime? @db.Date
  activeContractsCount    Int       @default(0)
  primaryContractConexaId Int?

  revenueCurrentYear      Decimal   @db.Decimal(14, 2) @default(0)
  revenueLast12Months     Decimal   @db.Decimal(14, 2) @default(0)
  revenueLastClosedMonth  Decimal   @db.Decimal(14, 2) @default(0)
  revenuePrevClosedMonth  Decimal   @db.Decimal(14, 2) @default(0)
  /// NULL quando revenuePrev = 0 — divisão por zero NÃO vira "−100%" nem "0%":
  /// vira "sem base de comparação".
  revenueMoMDeltaPct      Decimal?  @db.Decimal(8, 4)
  revenueDropAlert        Boolean   @default(false)
  revenueRank             Int?                            // 1 = melhor. NULL se sem receita.

  firstBookingAt          DateTime?
  firstBookingConexaId    Int?                            // ★ âncora do cycleKey da regra 5
  lastBookingAt           DateTime?
  bookingsLast30d         Int       @default(0)
  hoursUsedLast30d        Decimal?  @db.Decimal(10, 2)
  hoursOnDemandLast30d    Decimal?  @db.Decimal(10, 2)
  hoursFromQuotaLast30d   Decimal?  @db.Decimal(10, 2)

  sellerId                String?
  seller                  Seller?   @relation(fields: [sellerId], references: [id], onDelete: SetNull)
  sellerSource            DataSource @default(INDISPONIVEL)
  crmStage                CrmStage   @default(DESCONHECIDO)
  primaryClickupTaskId    String?

  computedAt              DateTime  @default(now())
  computedByRunId         String?                         // rastreabilidade total

  @@index([revenueRank])
  @@index([sellerId])
  @@index([revenueDropAlert])
  @@map("intel_customer_profiles")
}

/// RECEITA MENSAL POR CLIENTE — sustenta "receita no ano", "últimos meses",
/// "queda de X%" e "Top 5". A UI lê 12 linhas, não varre fact_charges.
model CustomerMonthlyRevenue {
  id               String   @id @default(cuid())
  customerConexaId Int
  month            DateTime @db.Date                      // primeiro dia do mês

  /// EMISSÃO + currentAmount, isRecognized=true. PADRÃO (ADR-06).
  revenueEmission    Decimal @db.Decimal(14, 2) @default(0)
  revenueCompetence  Decimal @db.Decimal(14, 2) @default(0)
  revenueCash        Decimal @db.Decimal(14, 2) @default(0)
  /// Soma de Sale.amount. NÃO é igual às de cima (venda pode não estar faturada).
  /// Existe só para abrir a receita POR PRODUTO. NUNCA somar com as outras.
  revenueSales       Decimal @db.Decimal(14, 2) @default(0)
  fallbackShare      Decimal? @db.Decimal(6, 4)           // % com competência inferida

  /// DERIVADOS, materializados: a MESMA variação é lida pela tela E pela regra
  /// QUEDA_RECEITA. Se uma calculasse e a outra recalculasse, divergiriam no dia
  /// em que alguém mudasse o threshold.
  prevRevenue        Decimal? @db.Decimal(14, 2)
  deltaPct           Decimal? @db.Decimal(8, 4)           // NULL se prev = 0
  isDrop             Boolean  @default(false)
  isClosedMonth      Boolean  @default(false)             // ★ mês corrente NUNCA entra em Δ

  bookingsCount      Int      @default(0)
  hoursUsed          Decimal? @db.Decimal(10, 2)
  computedAt         DateTime @default(now())

  /// Idempotência do job: recalcular o mês faz UPDATE, nunca duplica linha.
  @@unique([customerConexaId, month])
  @@index([month, revenueEmission])
  @@index([isDrop])
  @@map("intel_customer_monthly_revenue")
}

/// SALDO DE HORAS — o modelo mais delicado (ADR-05).
/// Uma linha por (cliente, fonte da cota, balde, ciclo).
/// entitled/consumed/balance com PROCEDÊNCIA SEPARADA.
/// CHECK no banco: balanceSource='INDISPONIVEL' ⇒ balanceHours IS NULL.
model HourQuotaBalance {
  id                  String   @id @default(cuid())
  customerConexaId    Int
  /// Exatamente um dos dois é não-nulo.
  contractConexaId    Int?
  hourPackageConexaId Int?
  /// Balde da cota. Uma cota de 10h na Sala A não cobre a Sala B.
  spaceConexaId       Int?
  /// ⚠ BLOQUEADO: não existe endpoint de grupos (/spaceGroups ausente, 404 medido).
  /// Cota por groupId nasce com balanceSource = INDISPONIVEL, sempre.
  groupConexaId       Int?

  cycleKey            String                              // 'YYYY-MM' ou 'YYYY-MM-DD'
  cycleStart          DateTime @db.Date
  cycleEnd            DateTime @db.Date
  validityType        String?                             // Monthly | Weekly | Daily
  validitySource      DataSource @default(INDISPONIVEL)
  /// ★ **NÃO CONFIRMADO** (Q20): 'Monthly' reseta no dia 1, no dueDay ou no dia do
  /// mês do startDate? Errar move o saldo em ATÉ UM CICLO INTEIRO.
  cycleAnchor         String?                             // "mes-civil"|"dueDay"|"startDate"

  entitledHours       Decimal?   @db.Decimal(10, 2)
  entitledSource      DataSource @default(INDISPONIVEL)
  /// Texto curto para o tooltip: "contract.hourPlanQuota[0].quantity",
  /// "plan 555 hourQuotas[2]", "digitado por Diego em 12/08". Auditoria em 1 linha.
  entitledEvidence    String?

  consumedHours       Decimal?   @db.Decimal(10, 2)
  consumedSource      DataSource @default(DERIVADO)
  /// Se 0, a UI diz "nenhuma reserva no ciclo" — não "0h consumidas", que soaria
  /// como dado apurado.
  consumedBookings    Int        @default(0)

  balanceHours        Decimal?   @db.Decimal(10, 2)
  balanceSource       DataSource @default(INDISPONIVEL)

  computedAt          DateTime   @default(now())

  @@unique([customerConexaId, contractConexaId, hourPackageConexaId, spaceConexaId, groupConexaId, cycleKey])
  @@index([customerConexaId, cycleKey])
  @@index([balanceSource])
  @@map("intel_hour_quota_balances")
}

// =============================================================================
// INTELIGÊNCIA — motor de regras (ADR-07)
// =============================================================================

enum RuleMode {
  OFF       // não avalia
  SOMBRA    // avalia e grava Signal(status=SOMBRA). NÃO cria DispatchLog.
  DRY_RUN   // avalia, grava DispatchLog(SIMULADO) com o payload exato. Não envia.
  LIVE      // envia
}

enum CycleKind {
  CONTRACT_MILESTONE   // contract:{id}:m{n}
  CUSTOMER_ONCE        // customer:{id}:{evento}
  MONTHLY              // {YYYY-MM}
  QUOTA_CYCLE          // quota:{balanceId}:{cycleKey}
  PER_EVENT            // booking:{id}
}

enum SignalStatus {
  SOMBRA      // gerado em modo sombra; visível na UI, nunca despachado
  ABERTO
  DESPACHADO
  EM_CONTATO
  GANHO
  PERDIDO
  DESCARTADO  // falso positivo — alimenta o ajuste de threshold
  EXPIRADO
}

enum DispatchChannel { CLICKUP_TASK CHATWOOT_NOTA IN_APP }
enum DispatchStatus  { PENDENTE SIMULADO ENVIADO FALHOU SUPRIMIDO }

/// REGRA = DADO. Adicionar a regra 11 é um INSERT (ADR-07).
/// `family` é validada contra o registry em runtime E no boot (falha rápida).
/// `params` é validado por zod contra family.paramsSchema em TODA escrita.
/// O baseline das 11 regras vive versionado em prisma/seeds/rules.seed.ts.
model Rule {
  key            String   @id                            // "fiscal-11-meses" (slug estável)
  family         String                                  // "MARCO_CONTRATO" | ...
  name           String
  description    String?
  params         Json
  version        Int      @default(1)                    // ++ a cada mudança de params
  mode           RuleMode @default(OFF)
  channels       DispatchChannel[]
  cooldownDays   Int      @default(0)
  maxPorExecucao Int      @default(50)                   // disjuntor POR REGRA
  prioridadeBase Int      @default(50)
  /// Guarda de promoção: LIVE exige simulação recente com os params EXATOS.
  lastSimulationId String?
  approvedById   String?
  approvedAt     DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  signals     Signal[]
  changes     RuleChange[]
  simulations RuleSimulation[]
  @@index([mode])
  @@map("intel_rules")
}

/// Auditoria de quem mexeu no threshold. Quando um vendedor perguntar
/// "por que isso mudou em setembro", a resposta está no banco.
model RuleChange {
  id       String   @id @default(cuid())
  ruleKey  String
  rule     Rule     @relation(fields: [ruleKey], references: [key], onDelete: Cascade)
  campo    String                                        // "params.limiarValor" | "mode"
  de       Json?
  para     Json?
  motivo   String?
  autorId  String?
  autor    User?    @relation(fields: [autorId], references: [id], onDelete: SetNull)
  criadoEm DateTime @default(now())
  @@index([ruleKey, criadoEm])
  @@map("intel_rule_changes")
}

/// BACKTEST persistido. É o artefato que a guarda de promoção exige.
model RuleSimulation {
  id            String   @id @default(cuid())
  ruleKey       String
  rule          Rule     @relation(fields: [ruleKey], references: [key], onDelete: Cascade)
  params        Json                                     // os params SIMULADOS
  paramsHash    String                                   // p/ a guarda comparar exatidão
  janelaDe      DateTime @db.Date
  janelaAte     DateTime @db.Date
  totalDisparos Int
  disparosPorMes Json                                    // [{mes, n}]
  porSegmento   Json
  /// Quantos clientes teriam recebido 2+ ofertas no mesmo mês (fadiga de contato).
  sobreposicao  Json
  amostra       Json                                     // até 20 sinais com evidência
  /// ALTA | MEDIA | BAIXA + motivo. O backtest é aproximação porque o espelho guarda
  /// o estado ATUAL de campos mutáveis (isActive), não o histórico.
  fidelidade    String
  motivoFidelidade String
  gapsBloqueantes  String[]
  autorId       String?
  criadoEm      DateTime @default(now())
  @@index([ruleKey, criadoEm])
  @@map("intel_rule_simulations")
}

/// SINAL / OPORTUNIDADE — A tabela do produto.
model Signal {
  id               String       @id @default(cuid())
  customerConexaId Int
  ruleKey          String
  rule             Rule         @relation(fields: [ruleKey], references: [key], onDelete: Restrict)
  /// Congelados no momento do disparo: sinais antigos continuam explicáveis com o
  /// threshold que valia na época.
  ruleVersion      Int
  paramsSnapshot   Json
  cycleKind        CycleKind
  /// ★ Derivado APENAS de dado imutável ou datado. NUNCA de now(): se dependesse do
  /// relógio, rodar às 23:59 e às 00:01 produziria duas chaves e dois disparos.
  cycleKey         String

  status           SignalStatus @default(ABERTO)
  /// 0..100. DERIVADO da regra, nunca de IA. Só ORDENA a fila — jamais decide
  /// se dispara (o documento é explícito: regras determinísticas).
  priority         Int          @default(50)

  /// POR QUE este sinal existe, em dados, não em prosa:
  /// { inputs:{...ids e campos lidos...}, thresholds:{...}, computed:{...},
  ///   sources:{campo:"API"|"DERIVADO"|"MANUAL"}, trace:[{predicado,passou,...}] }
  /// A tela "por que recebi isto?" renderiza este objeto. Sem ele, o sinal é palpite.
  evidence         Json
  /// Não-vazio ⇒ faixa âmbar no card: "esta oferta tem dado faltando".
  gaps             String[]

  offerHeadline    String?
  offerProduct     String?
  /// NULL quando não há preço confiável. NUNCA 0 como placeholder.
  estimatedValue   Decimal?  @db.Decimal(14, 2)
  estimatedValueSource DataSource @default(INDISPONIVEL)

  sellerId         String?
  seller           Seller?   @relation(fields: [sellerId], references: [id], onDelete: SetNull)

  detectedAt       DateTime  @default(now())
  expiresAt        DateTime?
  reviewedAt       DateTime?
  reviewedById     String?
  reviewedBy       User?     @relation("SignalReviewer", fields: [reviewedById], references: [id], onDelete: SetNull)
  outcomeNotes     String?
  /// Amarra o sinal ao snapshot que o gerou.
  datasetRunId     String?

  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  dispatches       DispatchLog[]

  /// >>> BARREIRA 1 — impede DETECÇÃO repetida. O job roda 30× no mês; da 2ª em
  /// diante o upsert encontra a linha e não cria nada.
  @@unique([customerConexaId, ruleKey, cycleKey])
  @@index([status, sellerId])
  @@index([sellerId, status, priority])
  @@index([ruleKey, status])
  @@index([customerConexaId, detectedAt])
  @@index([expiresAt])
  @@map("intel_signals")
}

/// HISTÓRICO DE DISPAROS — "para não repetir a mesma oferta no mesmo ciclo".
/// Signal garante que a REGRA não redispara; este log garante que o ENVIO não
/// se duplica por canal (ex.: o job caiu DEPOIS de criar a task e ANTES de gravar).
model DispatchLog {
  id           String          @id @default(cuid())
  signalId     String
  signal       Signal          @relation(fields: [signalId], references: [id], onDelete: Cascade)
  channel      DispatchChannel
  status       DispatchStatus  @default(PENDENTE)        // PENDENTE gravado ANTES do POST

  targetRef    String?                                    // list_id, conversation_id, e-mail
  externalId   String?                                    // task.id, message.id
  externalUrl  String?
  /// Payload EXATO enviado, SEM headers. Se o vendedor disser "recebi errado",
  /// dá para provar o que saiu.
  requestBody  Json?
  responseBody Json?
  httpStatus   Int?
  error        String?
  attempts     Int             @default(0)
  /// "{ruleKey}:{customerConexaId}:{cycleKey}:{channel}" — vai também para o custom
  /// field chave_disparo no ClickUp, para reconciliação (operador ==, nunca =).
  idempotencyKey String
  dispatchedAt DateTime?
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  /// >>> BARREIRA 2 — um envio por sinal por canal.
  @@unique([signalId, channel])
  /// >>> BARREIRA 3 — rede de segurança se um backfill criar dois Signal para o
  /// mesmo par lógico.
  @@unique([idempotencyKey])
  @@index([status])
  @@index([channel, status])
  @@map("intel_dispatch_log")
}

// =============================================================================
// OPERAÇÃO
// =============================================================================

enum IntegrationSystem { CONEXA CLICKUP CHATWOOT INTERNO }

enum FailureKind {
  HTTP_ERROR       // 5xx, timeout, conexão recusada
  AUTH_ERROR       // 401/403 — token expirado/revogado
  RATE_LIMIT       // 429
  SCHEMA_MISMATCH  // campo esperado sumiu ou mudou de tipo
  CONFIG_ERROR     // list_id/field_id mudou — NINGUÉM percebe sozinho
  /// Dado que a API simplesmente não expõe. NÃO é bug: é a LACUNA declarada.
  /// Vira tarefa de cadastro em /operacao/lacunas, não plantão.
  LACUNA_DE_DADO
  JOB_ERROR
  RECONCILIACAO    // divergência de receita / saldo / completude
}

model IntegrationFailure {
  id           String            @id @default(cuid())
  system       IntegrationSystem
  kind         FailureKind
  operation    String                                    // "GET /room/bookings" | "rule:pacote-5h"
  endpoint     String?
  httpStatus   Int?
  message      String
  detail       Json?
  entity       String?
  entityRef    String?
  /// hash(system|kind|operation|entityRef). Sem ele, um endpoint fora do ar por 2h
  /// gera 480 linhas e ninguém lê nenhuma.
  fingerprint  String
  occurrences  Int               @default(1)
  firstSeenAt  DateTime          @default(now())
  lastSeenAt   DateTime          @default(now())
  resolvedAt   DateTime?
  resolvedById String?
  syncRunId    String?

  @@unique([fingerprint, firstSeenAt])
  @@index([system, kind])
  @@index([resolvedAt])
  @@index([fingerprint])
  @@map("ops_integration_failures")
}

/// Todo dado que um humano digitou porque a API não dá. Responde numa consulta a
/// pergunta de auditoria: "o que neste dashboard NÃO veio de API?"
model ManualFact {
  id          String     @id @default(cuid())
  targetModel String                                     // "HourPackage.hoursIncluded"
  targetKey   String
  field       String
  value       Json
  source      DataSource @default(MANUAL)
  reason      String?
  enteredById String?
  enteredBy   User?      @relation(fields: [enteredById], references: [id], onDelete: SetNull)
  validFrom   DateTime   @default(now())
  validTo     DateTime?
  createdAt   DateTime   @default(now())
  @@index([targetModel, targetKey])
  @@map("ops_manual_facts")
}

/// Resultado de cada execução de reconciliação (ADR-06). Vermelho aqui BLOQUEIA
/// a promoção de regra para LIVE e o despacho.
model ReconciliationRun {
  id         String   @id @default(cuid())
  tipo       String                                      // "receita"|"reservas"|"saldo"|"disparos"
  referencia String                                      // "2026-07" | "amostra-20-clientes"
  esperado   Json
  obtido     Json
  diferenca  Json
  aprovado   Boolean
  detalhe    String?
  executadoEm DateTime @default(now())
  @@index([tipo, executadoEm])
  @@map("ops_reconciliation_runs")
}

enum SyncMode {
  BACKFILL INCREMENTAL RECONCILE REPAIR WEBHOOK
  INTELLIGENCE          // recomputa perfis/receita/saldos e roda as regras
  MIRROR_PULL           // Etapa 2 (FDW) — ADR-01
}
enum SyncStatus { RUNNING SUCCESS FAILED HALTED }

model SyncRun {
  id               String     @id @default(cuid())
  entity           String
  mode             SyncMode
  windowFrom       DateTime?
  windowTo         DateTime?
  startedAt        DateTime   @default(now())
  finishedAt       DateTime?
  status           SyncStatus @default(RUNNING)
  recordsProcessed Int        @default(0)
  requestsMade     Int        @default(0)
  signalsCreated   Int        @default(0)
  signalsSkipped   Int        @default(0)                // barrados pela unique/cooldown
  dispatchesSent   Int        @default(0)
  error            String?
  @@index([entity])
  @@index([mode])
  @@index([startedAt])
  @@map("sync_runs")
}

model SyncState {
  key       String   @id
  value     Json
  updatedAt DateTime @updatedAt
  @@map("sync_state")
}

enum WebhookStatus { RECEIVED PROCESSING PROCESSED FAILED IGNORED }

model WebhookEvent {
  id             String            @id @default(cuid())
  receivedAt     DateTime          @default(now())
  system         IntegrationSystem @default(CONEXA)
  eventType      String?
  rawEventName   String?
  entity         String?
  entityConexaId String?
  signatureValid Boolean           @default(false)
  /// ⚠ x-webhook-secret e authorization são REMOVIDOS antes de persistir.
  headers        Json?
  rawBody        Json
  status         WebhookStatus     @default(RECEIVED)
  attempts       Int               @default(0)
  processedAt    DateTime?
  error          String?
  @@index([status])
  @@index([entity, entityConexaId])
  @@map("webhook_events")
}
```

**SQL fora do Prisma** (`prisma/sql/001_checks_procedencia.sql`, aplicado pelo entrypoint, idempotente):

```sql
ALTER TABLE intel_hour_quota_balances
  DROP CONSTRAINT IF EXISTS ck_balance_indisponivel,
  ADD  CONSTRAINT ck_balance_indisponivel
       CHECK ("balanceSource" <> 'INDISPONIVEL' OR "balanceHours" IS NULL),
  DROP CONSTRAINT IF EXISTS ck_entitled_indisponivel,
  ADD  CONSTRAINT ck_entitled_indisponivel
       CHECK ("entitledSource" <> 'INDISPONIVEL' OR "entitledHours" IS NULL);

ALTER TABLE dim_products
  DROP CONSTRAINT IF EXISTS ck_price_indisponivel,
  ADD  CONSTRAINT ck_price_indisponivel
       CHECK ("priceSource" <> 'INDISPONIVEL' OR "price" IS NULL);

ALTER TABLE dim_hour_packages
  DROP CONSTRAINT IF EXISTS ck_hours_indisponivel,
  ADD  CONSTRAINT ck_hours_indisponivel
       CHECK ("hoursSource" <> 'INDISPONIVEL' OR "hoursIncluded" IS NULL);

ALTER TABLE intel_signals
  DROP CONSTRAINT IF EXISTS ck_estimated_indisponivel,
  ADD  CONSTRAINT ck_estimated_indisponivel
       CHECK ("estimatedValueSource" <> 'INDISPONIVEL' OR "estimatedValue" IS NULL);

-- Exatamente uma fonte de cota por linha de saldo.
ALTER TABLE intel_hour_quota_balances
  DROP CONSTRAINT IF EXISTS ck_uma_fonte_de_cota,
  ADD  CONSTRAINT ck_uma_fonte_de_cota
       CHECK (num_nonnulls("contractConexaId", "hourPackageConexaId") = 1);
```

---

## 5. As 10 regras de negócio

Legenda de status: **✅ VIÁVEL** · **⚠️ VIÁVEL COM RESSALVA** (depende de resposta do cliente ou de reconciliação) · **⛔ BLOQUEADA POR DADO** (o dado não existe na API) · **❓ PRECISA DEFINIÇÃO** (a regra não está definida o bastante para virar código).

| # | Regra · Família | Dados de entrada (endpoint → campo) | Fórmula | Ciclo / idempotência | Ação | Status |
|---|---|---|---|---|---|---|
| **1** | Fiscal 11 meses → Plano Bianual · `MARCO_CONTRATO` | `/contracts` → `contractId, customerId, planId, startDate, endDate, isActive, paymentFrequency, fidelityDate, amount` · `/plans` → `serviceCategoryId` · `/serviceCategories` → `name` · `/customers` → `isActive, isBlocked` | `segmento(c) ∈ Fiscal` ∧ `c.isActive` ∧ `c.paymentFrequency ∈ params.periodicidades` ∧ `aniv = addMonthsClamp(c[params.ancora], 11)` ∧ `aniv ≤ hoje ≤ aniv + params.toleranciaDias` ∧ `¬jáPossui(params.naoOfertarSePossui)` | `CONTRACT_MILESTONE` · `contract:{id}:m11` — o marco é do **contrato**, não do cliente: renovação gera contrato novo e novo marco | Task ClickUp → vendedor (`sellerId ?? creatorUserId`) | ⚠️ **Q13–Q16**: `startDate` ou `fidelityDate`? Renovação reinicia? Vale para todos os tiers (**só existem 2 produtos "Bianual" no catálogo, ambos SEATECH: 3248, 3252**)? Dispara para quem já é Anual? |
| **2** | Pacote de horas acabando · `SALDO_COTA` | `/contracts` → `hourPlanQuota[]{quantity,spaceId,groupId}` · `/plans` → `hourQuotas[]{id,quantity,validityType,spaceId,groupId}` · `/recurringSales` → `packageId, quantity, frequency, isActive` · `/room/bookings` → `startTime, finalTime, status, place.id, isActive, cancellationReason` | `concedido = hourPlanQuota ?? plan.hourQuotas ?? HourPackage.hoursIncluded` (precedência ADR-05) · `consumido = Σ durationHours` onde `isQuotaDeduction ∧ balde ∧ ciclo` · `saldo = concedido − consumido` · dispara se `saldo/concedido ≤ params.limiarPct` ∧ `diasRestantes ≥ params.minDias` | `QUOTA_CYCLE` · `quota:{balanceId}:{cycleKey}` — a cota renova por ciclo, e há cotas `Daily` | Task ClickUp | ⚠️ **Depende do portão do ADR-05.** Cotas por `groupId` **⛔ BLOQUEADAS** (não há endpoint de grupos, 404 medido). Âncora do ciclo e carry-over **NÃO CONFIRMADOS** (Q20, Q21). Limiar indefinido (Q23). |
| **3** | Padrão de compra irregular · `TENDENCIA` | `/sales` → `quantity, productId, referenceDate, status` (janela `dateFrom/dateTo`) **ou** `/room/bookings` → duração | `serie = [m(m−3), m(m−2), m(m−1)]` sobre **meses fechados** · dispara se `serie[0] > 0` ∧ estritamente decrescente ∧ `serie[2] ≤ serie[0]·(1−params.quedaPct)` · meses de `params.sazonaisIgnorados` ficam fora | `MONTHLY` · `{YYYY-MM}` do mês de avaliação | Task ClickUp | ❓ **"Irregular" não está definido.** "Comprou 20h" é compra **ou** consumo (Q26)? Quantos meses, qual queda (Q27)? E **não há como identificar com segurança uma venda de pacote em `/sales`**: só 1 produto tem "Pacote" no nome (id 1); os pacotes reais são `recurringSale.packageId`, e não está documentado qual `productId` a Conexa grava na venda gerada. |
| **4** | Avulso com uso alto (>5h) · `USO_SEM_COTA` | `/room/bookings` → duração, `status` · `/contracts` → `hourPlanQuota` vazio · `/recurringSales` → sem `packageId` · `/sales` → `amount, quantity` (preço efetivo) · `RoomPrice`/`HourPackage.pricePerPackage` (**MANUAL**) | `SEM_COTA(c)` ∧ `horasAvulsas(mês fechado) > params.minHoras` · `precoHoraEfetivo = Σ sale.amount / Σ horas` (não depende do catálogo, já vem com desconto) · `economia = gastoAvulso − precoPacote` | `MONTHLY` · `{YYYY-MM}` | Task ClickUp **com a economia** — ou, se `pricePerPackage` não estiver cadastrado, **com `gaps: ["preço do pacote não cadastrado"]` e sem número de economia** | ⚠️ O **gatilho** é sólido e não depende do saldo. A **economia** depende de tabela de preços MANUAL (Q29). "Só avulso" precisa de definição: sem nenhum contrato ou sem cota (Q30)? |
| **5** | Primeira reserva → Endereço Fiscal + SeaBox · `PRIMEIRO_EVENTO` | `/room/bookings` (**backfill COMPLETO obrigatório**) → `bookingId, createdAt, startTime, place.id, status, isActive` · `/contracts`+`/plans`+`/serviceCategories` (para não ofertar o que já tem) | `primeira = min(b[params.ancora])` sobre reservas ativas, não canceladas, com `EH_SALA(place.id)` via mapa `productId→categoria` · `primeira.createdAt ≥ params.dataCorteBackfill` · ofertas = `["Endereço Fiscal","SeaBox"] − o que já tem` | `CUSTOMER_ONCE` · `customer:{id}:primeira-reserva`, com `evidence.bookingId` guardado — **se uma reserva anterior aparecer depois no espelho, o sistema registra correção**, não redispara | Task ClickUp | ⚠️ **Risco alto de disparo em massa**: sem backfill total, todo cliente antigo parece "primeira reserva". `dataCorteBackfill` é parâmetro **obrigatório**. Q22: criação ou uso? Cancelada conta? Qualquer espaço ou só sala de reunião? |
| **6** | Privativa 1 mês → Registro de Marca · `MARCO_CONTRATO` | `/contracts` → `privateSpaceId, startDate, dateSalesGeneration, isActive` · `/plans`→`serviceCategoryId` · `/sales` → `productId ∈ {2811, 2951, 3076}` | `segmento(c) ∈ SalaPrivativa` ∧ `aniv = addMonthsClamp(c[params.ancora], 1)` ∧ dentro da janela ∧ `¬jáPossui(RegistroDeMarca)` | `CONTRACT_MILESTONE` · `contract:{id}:m1` | Task ClickUp | ⚠️ Q17–Q19: `privateSpaceId` ou categoria do plano? **Estação de coworking conta?** (a categoria "Salas Privativas - Seaway Center" inclui "Estação 01 - Coworking L21"). `startDate` ou `dateSalesGeneration`? Produtos 2811/2951/3076 confirmados no catálogo derivado, **a homologar**. |
| **7** | Privativa 2 meses → SeaBox (benefício) · `MARCO_CONTRATO` | idem 6 + `/sales`/`/recurringSales` → `productId ∈ {3156,3157,3178,3179,3182}` | idem 6 com `meses = 2` e `naoOfertarSePossui = SeaBox` | `CONTRACT_MILESTONE` · `contract:{id}:m2` | Task ClickUp | ⚠️ **"Benefício" sugere cortesia, não venda.** Se o SeaBox for dado de graça e não virar venda nem contrato, **o sistema nunca saberá que o cliente já recebeu** (Q20 do bloco de regras). Variante Básico/Pro indefinida. |
| **8** | Privativa até 6 meses → Panteão · `MARCO_CONTRATO` | idem 6 + `/products` → produto "Panteão" | idem 6 com `meses = 6` **(interpretação a)**; ou janela aberta **(interpretação b)**, que não é gatilho e precisa de evento âncora | `CONTRACT_MILESTONE` · `contract:{id}:m6`, com `expiresAt = startDate + 6m` | Task ClickUp | ⛔ **BLOQUEADA POR DADO.** "Panteão" **NÃO EXISTE** em nenhum dos 217 produtos exportados do Conexa (busca por "panteao"/"panteão" → zero). Sem o produto: não dá para confirmar que a oferta existe, verificar se o cliente já tem, nem precificar. **+ ❓** "até o 6º mês" é o aniversário ou uma janela? (Q33) |
| **9** | Pacote < 5h → novo pacote · `SALDO_COTA` | idem 2 | idem 2 com `limiarTipo = absoluto`, `limiarValor = 5` | `QUOTA_CYCLE` · `quota:{balanceId}:{cycleKey}` — a unique é por `(cliente, **ruleKey**, cycleKey)`, então 2 e 9 coexistem no banco; a **UI colapsa** e o disparo emite **um** contato | Task ClickUp | ⚠️ Mesmo portão do ADR-05. **É caso particular da regra 2** — Q23: são a mesma coisa? Se sim, fica só o limiar de 5h. Saldo por balde ou somado (Q24)? Saldo negativo entra (Q25)? |
| **10** | Endereço Litoral + reserva → Pacote ou upgrade Batial · `EVENTO_EM_SEGMENTO` | `/contracts`→`planId` · `/plans`→`name, hourQuotas` · `/serviceCategories` (**devolve "Endereço Fiscal - RN" para TODOS os tiers**) · `/room/bookings` · `/extraFields?type=contract` | `segmento(c) == "Litoral"` ∧ existe reserva ativa no ciclo ∧ `¬deduzidaDeCota` → ofertar `["Pacote de Horas", "Upgrade Batial (Nh/mês)"]`, onde `N = Σ planoBatial.hourQuotas[validityType=Monthly].quantity` | `MONTHLY` · `{YYYY-MM}` (ou `PER_EVENT` · `booking:{id}`, trocando um parâmetro) | Task ClickUp | ⛔ **BLOQUEADA POR DADO.** **O tier NÃO é campo da API**: Simples, Litoral, Batial, Abissal, Black e Comércio caem todos em `serviceCategory = "Endereço Fiscal - RN"`. O tier só existe dentro de `plan.name`, e classificar por substring viola a regra de ouro (29 produtos de Endereço Fiscal em 3 prefixos e 5 periodicidades — regex ingênuo produz falso positivo **e** falso negativo). **Desbloqueio:** `Segment{tipo:"planTierMap"}` homologado por escrito **ou** — melhor, porque não envelhece — a Seahub preencher o extraField de contrato "Tipo de contrato" (Q35, Q36). |
| **11** | *(bônus — métrica do documento, não é uma das 10)* Queda de receita ≥ X% · `TENDENCIA` | `intel_customer_monthly_revenue` → `revenueEmission, prevRevenue, isClosedMonth` | `isClosedMonth` ∧ `prevRevenue > 0` ∧ `deltaPct ≤ −params.quedaPct` | `MONTHLY` · `{YYYY-MM}` do **mês fechado** | Task ClickUp ou só `IN_APP` | ⚠️ Q9: qual é o X%? `prevRevenue = 0` **não é queda**: é "sem base de comparação". |

**Sobreposições que precisam de política, não de gambiarra:**
- Regras **2 e 9** são a mesma mecânica com limiares diferentes → dedupe no orquestrador por `offerProduct` + `customerConexaId` + ciclo.
- Regras **6, 7 e 8** disparam para o mesmo contrato em 1, 2 e 6 meses → um cliente de privativa recebe 3 ofertas em 6 meses. **`NOTIFICADOR_MAX_CONTATOS_CLIENTE_MES` + `cooldownDays`, com o número decidido pelo Diego** (Q34), não pelo desenvolvedor.
- Regras **5 e 7** podem ofertar SeaBox ao mesmo cliente no mesmo mês → dedupe por `offerProduct`.
- O **relatório de sobreposição** do backtest existe exatamente para tornar isso visível **antes** de ligar a regra.

---

## 6. Telas e rotas

| Rota | Papel | Conteúdo | Acesso |
|---|---|---|---|
| `/login` | Autenticação | Form. **Hash-isca** de custo 12 executado **sempre**, inclusive para e-mail inexistente — sem isso o timing revela quais e-mails são válidos (achado de auditoria adversarial no financeiro). Resposta invariável: "Credenciais inválidas." Todo login vira `LoginEvent` com `reason`. | público |
| `/` | Visão geral | 4 KPIs (receita do mês · clientes ativos · clientes em queda ≥ X% · sinais abertos), gráfico de 13 meses com o **mês corrente hachurado e rotulado "em curso"**, Top 5 do ano com Δ, alertas de queda **ordenados por R$ perdidos** (não por %), fila por regra, rodapé "sincronizado há N min · último job de inteligência às HH:MM". Todo card **declara o regime** de receita. | todos |
| `/clientes` | Lista | Busca por nome/`tradeName`/CNPJ. Filtros: unidade (`customer.companyId` — **nunca supor que o contrato traz a unidade**), segmento, vendedor, faixa de receita, `hasHourPackage`, `hasPrivateRoom`, `revenueDropAlert`. Paginação server-side, export CSV. | todos |
| `/clientes/[conexaId]` | **A tela âncora** | 7 blocos: **(1) Identificação** (com "Tag #3 — nome não disponível via API" enquanto ninguém cadastrar); **(2) Contratos** com **régua visual de marcos** `1m · 2m · 6m · 11m · 24m`, marco atingido destacado e a data exata do próximo — é a regra 1/6/7/8 **como informação, antes de ser automação**; **(3) Receita** 13 meses + tabela gêmea + regime declarado no cabeçalho; **(4) Horas e reservas** com direito/consumido/saldo e cada número com selo `ƒ derivado`; **(5) Sinais**; **(6) CRM** (Status CRM decodificado + link para a task); **(7) Auditoria** (última sync, link para o `raw` — ADMIN). **Aba "Por que não disparou?"**: roda todas as regras ativas em modo `explain` para este cliente e lista, regra a regra, **qual predicado reprovou** ("`saldo = 12h` não é `< 5h`"). | todos |
| `/receita` | Receita agregada | Por mês, quebra por unidade/categoria/produto (rateio `charge.salesIds → sales → product`), Top 20 do período, tabela de quedas por R$. **Todo gráfico tem tabela gêmea** (ADR-0008 do financeiro). | todos |
| `/sinais` | **Fila de trabalho** | `SOMBRA / ABERTO / DESPACHADO / EM_CONTATO`, ordenados por `priority DESC, detectedAt ASC`. Filtros por regra/vendedor/segmento/"tem lacuna". **Aba "sem dono"** (`sellerId IS NULL`) — o caso que sempre esquecem. Sinal em SOMBRA com selo cinza **"não foi disparado — regra em observação"**; nunca some da tela. Faixa âmbar em sinal com `gaps[]`. | COMERCIAL, ADMIN |
| `/sinais/[id]` | **"Por que recebi isto?"** | Renderiza `Signal.evidence` inteiro: `inputs` (com link para o registro), `thresholds` **vigentes no disparo** (`paramsSnapshot`, `ruleVersion`), `computed` parcela por parcela, `sources` campo a campo, `gaps`. Bloco "O que saiu": canal, payload, HTTP status, resposta, link para a task. Ações: assumir · GANHO · PERDIDO · **DESCARTAR como falso positivo** (alimenta o ajuste de threshold). | COMERCIAL, ADMIN |
| `/regras` | **Catálogo** | 1 linha por `Rule`: nome, família, `mode` com cor, disparos em 30d, **precisão** (`ganhos / (ganhos+perdidos+descartados)`), data do último backtest, badge "params alterados há 3d". | todos veem |
| `/regras/[key]` | **Edição declarativa** | Formulário **gerado do `paramsSchema`** (rótulo, unidade, min/max e ajuda vindos de `paramsUi`) — adicionar um param novo na família faz o campo aparecer sem tocar em JSX. Histórico de `RuleChange`. Salvar grava em `SOMBRA` por padrão; promover para `LIVE` mostra o **checklist do que falta** quando é recusado. | ADMIN edita; COMERCIAL **propõe** |
| `/regras/[key]/simular` | **Backtest / what-if** | Janela + params (pré-preenchidos). Saída: disparos por mês (barras), total, distribuição por segmento/unidade, **20 sinais de amostra com evidência clicável**, **relatório de sobreposição**, **aviso de fidelidade** (ALTA/MÉDIA/BAIXA + motivo). Modo **comparar A × B**. Resultado persistido em `RuleSimulation` e exportável em CSV. | ADMIN, COMERCIAL |
| `/regras/nova` | Instanciar | Escolhe **família**, preenche params, nomeia. Zero código. | ADMIN |
| `/reconciliacao` | **A tela de rigor** | 4 blocos: (1) receita comercial × financeiro por mês, Δ em R$ e contagem de cobranças; (2) completude de reservas por janela (busca binária no offset); (3) saldo de horas — última conferência, % de acerto, quando expira; (4) disparos `PENDENTE`/órfãos. **Verde só com Δ = R$ 0,00. Qualquer vermelho BLOQUEIA a promoção de regra para LIVE** (ADR-06). | ADMIN |
| `/disparos` | Auditoria de saída | Todos os `DispatchLog`: canal, status, `httpStatus`, `externalId`, tentativas. "Reprocessar" só quando `externalId IS NULL`. | ADMIN |
| `/operacao` | Saúde | `SyncRun` recentes, `IntegrationFailure` abertas agrupadas por `fingerprint`, estado dos kill-switches, **consumo estimado do rate limit do Conexa em 24h**. Sync manual em **background** (nunca `await` do trabalho longo: no financeiro o proxy do Easypanel matava a requisição e "o botão não fazia nada"). | ADMIN |
| `/operacao/lacunas` | **Lacuna vira trabalho** | Pacotes sem `hoursIncluded`, salas sem preço, tags sem nome, vendedores sem `clickupUserId`, planos sem tier. Cada linha com o **impacto quantificado**: *"3 regras não conseguem avaliar 12 clientes"*. Sem esta tela, "lacuna declarada" vira silêncio. | ADMIN |
| `/admin/segmentos` | Segmento declarativo | "Endereço Fiscal" = categorias {31}; "Sala Privativa" = `privateSpaceId IS NOT NULL` **ou** categorias {…}; "Endereço Litoral" = mapa `planId → tier` homologado, com procedência. Editável sem deploy. | ADMIN |
| `/admin/vendedores` | Ponte 3 sistemas | `Seller`: nome, **e-mail (chave de conciliação)**, `conexaSellerId`, `clickupUserId`, `chatwootAgentId` **+ `assigneeType`**. Avisa quando um `sellerId` aparece nos dados e não está mapeado. | ADMIN |
| `/admin/usuarios` | Usuários e papéis | Com as guardas puras em transação Serializable. | ADMIN |
| `/minha-conta` | Conta | Trocar senha (revoga as **outras** sessões, mantém a atual), ver sessões ativas. | todos |

**Componente transversal `<Numero valor source evidencia/>`** — não é enfeite; é a materialização da regra de ouro:

| `DataSource` | Renderização | Tooltip |
|---|---|---|
| `API` | número normal, sem adorno | "Conexa · GET /contracts · `hourPlanQuota[0].quantity` · sincronizado há 14 min" |
| `DERIVADO` | número + `ƒ` discreto | "12h = 20h de direito − 8h consumidas (4 reservas abatidas da cota, 01–31/08)" + link "ver as 4 reservas" |
| `MANUAL` | número + ponto âmbar | "Informado por Diego em 12/08/2026 — a API do Conexa não expõe este dado" + editar (ADMIN) |
| `INDISPONIVEL` | **`—` + rótulo `sem dado`. Nunca um número.** | "O Conexa não expõe as horas do Pacote #78 (não há endpoint de pacotes na API v2). Cadastre para habilitar os alertas de saldo." + CTA "Cadastrar" |

**Regra de agregação:** um total que soma linhas com `INDISPONIVEL` recebe o sufixo **"(parcial — N de M clientes sem dado)"**. Nunca somar ausente como zero.

---

## 7. Integrações de saída (ClickUp / Chatwoot) e salvaguardas

### 7.1 Reaproveitamento

Existe código pronto, testado, em português, com achados de produção datados nos comentários, em
`c:\Users\User\Desktop\Seahub-agentes-chatwoot\agentes-chatwoot\src\server\integrations\`:

| Copiar quase inteiro | Escrever do zero |
|---|---|
| `clickup/{client,campos,tipos,formatacao,config}.ts` + testes (~1.400 linhas) | A camada de disparo (orquestrador, kill-switch, DRY-RUN, outbox, teto) |
| `chatwoot/{client,atendentes,config,rodizio}.ts` + testes | O filtro de conversas por vendedor (`POST /conversations/filter`) — **não existe em nenhum código** |
| Padrão de segredo cifrado (`credenciais.ts`), se um dia precisar ficar no banco | O histórico de idempotência |

Busca por `DRY_RUN`/`dryRun`/`simulacao`/`modoSeco` nos quatro repositórios: **zero ocorrências**. A camada de disparo é código novo.

**Dois erros de autenticação já resolvidos lá** (causa nº 1 de 401 nas duas APIs):
```ts
// ClickUp — token CRU no Authorization. SEM "Bearer".
headers: { Authorization: this.token, "Content-Type": "application/json" }
// Chatwoot — header próprio. Também SEM "Bearer".
headers: { api_access_token: token, "Content-Type": "application/json" }
```

### 7.2 ClickUp — as quatro decisões que ditam o desenho

**1. Criar a task já completa, em UMA requisição.** `PUT /task/{id}` **não aceita custom fields** (doc verbatim: *"To update Custom Fields on a task, you must use the Set Custom Field endpoint"*); atualizar 3 campos custa 3 requisições, sem endpoint de lote. Contra um teto de 100 req/min, criar-e-depois-atualizar é a diferença entre 200 tasks/dia e 60.

```http
POST /api/v2/list/{CLICKUP_LIST_ID}/task
Authorization: pk_…
{
  "name": "Oportunidade — Fiscal 11 meses — ACME Ltda",
  "markdown_content": "**Regra:** Fiscal 11 meses\n**Cliente:** ACME Ltda (Conexa #652)\n…",
  "assignees": [183],                       // int[] no CREATE; {add,rem} no UPDATE
  "status": "novo",                         // precisa CASAR EXATO com um status da lista
  "priority": 3,                            // 1 urgente · 2 alta · 3 normal · 4 baixa
  "tags": ["oportunidade","fiscal-11m"],
  "custom_fields": [
    { "id": "<uuid_chave_disparo>",   "value": "fiscal-11-meses:652:contract:8421:m11:CLICKUP_TASK" },
    { "id": "<uuid_conexa_customer>", "value": "652" },
    { "id": "<uuid_regra>",           "value": "<uuid_opcao>" }
  ]
}
```

**2. `==`, NUNCA `=`, no filtro por custom field.** Doc verbatim: `=` é *contains (fuzzy)*; `==` é *exact match* para custom fields de texto. Com `=`, a chave `652:…` casaria com `6521:…` — o prefixo de um `customerId` colide com outro cliente real, e o sistema "acha" que já disparou para quem nunca recebeu nada. **É o risco de correção de maior severidade da camada de saída.** Guardar a chave sempre em `short_text` e usar **um único filtro** com a chave composta.
> **NÃO CONFIRMADO:** que `==` funcione em `number`/`phone`/`email`; se múltiplos filtros em `custom_fields` combinam com AND ou OR; se `include_closed=true` faz a task fechada aparecer no filtro por custom field. **Como confirmar:** três chamadas contra a lista real, na Fase 0 (item 5).

**3. Usuário-robô dedicado.** Um token pessoal **age como aquele humano**. Se um vendedor sair da empresa e for desativado, as tasks criadas por ele viram órfãs e — pior — **os webhooks criados por ele param de disparar silenciosamente**. E o fuso do robô tem de ser `America/Fortaleza`: campo `date` com exibição de hora desligada volta como *"4:00 am no fuso do usuário autorizado"*, e isso é deriva de um dia direto nas regras 1, 6, 7 e 8.

**4. Decodificação do "Status CRM".** O valor lido/gravado **nunca é o rótulo** — é o UUID da opção, que só existe em `type_config.options`. `campos.ts` já resolve: casa por id exato, depois por rótulo normalizado (sem acento/caixa), e **devolve ambiguidade em vez de escolher**. Usar `GET /list/{id}/field` (o endpoint **de lista** — `GET /team/{id}/field` só devolve campos criados no nível do workspace).
> **NÃO CONFIRMADO:** na **leitura** de `GET /task/{id}`, o `value` de um `drop_down` vem como UUID ou como `orderindex` numérico? A pesquisa cobre bem a escrita, não a leitura. **Como confirmar:** capturar uma resposta real na Fase 0.
> **NÃO CONFIRMADO:** o plano do workspace (100 req/min Business vs 1.000 Business Plus) e a existência de `Retry-After` no 429.

**A ser mapeado antes de rodar** (nada disso é descobrível em runtime — cada salto custa req/min): `team_id`, `space_id`, `list_id`, `list_id` de triagem, `statuses[]` válidos, UUIDs dos custom fields e das opções, `user_id` de cada vendedor, plano do workspace, fuso do robô.

### 7.3 Chatwoot — as três decisões que evitam um incidente com o cliente final

**1. `private: true` é o default, e não negociável na v1.**
`message_type: "outgoing"` + `private: false` **envia a mensagem AO CLIENTE**, pelo canal real (WhatsApp). O documento do Diego pede notificação *"p/ o time comercial"*. Implementar isso literalmente com `outgoing` numa conversa de cliente faz o cliente receber, no WhatsApp dele, o alerta interno de oportunidade — com o gatilho, a régua e a oferta. **Não dá para desenviar.**
`CHATWOOT_PERMITE_OUTGOING=off` por padrão. Teste de CI: qualquer `message_type: "outgoing"` fora de um guard dessa variável **quebra o build**.

**2. Token de USUÁRIO, não de Agent Bot.**
O Chatwoot tem uma **allowlist hard-coded** (`BOT_ACCESSIBLE_ENDPOINTS` em `access_token_auth_helper.rb`) que permite a bots apenas `conversations#{show,toggle_status,toggle_typing_status,toggle_priority,create,update,custom_attributes}`, `messages#create`, `assignments#create` e `labels#{index,create}`. Tudo o mais → **401 "Access to this endpoint is not authorized for bots"**. Confirmado em produção (2026-07-31, comentário datado no `client.ts`). Como precisamos de `POST /conversations/filter` e de `GET /agents`, **o token tem de ser de um usuário de integração dedicado**.

**3. Não criar conversa.** Se não houver conversa aberta, registrar `IGNORADO { motivo: "SEM_CONVERSA" }` e seguir — **a task do ClickUp já cobriu o caso**. Fora da janela de 24h do WhatsApp a Meta exige template aprovado; criar conversa só produz um registro no painel que o cliente nunca recebe. Para o resumo diário do time, usar uma **conversa interna fixa** (`CHATWOOT_CONVERSA_INTERNA_ID`), evitando de vez o problema.

**Filtro por vendedor:**
```http
POST /api/v1/accounts/{account_id}/conversations/filter?status=open
api_access_token: <token de USUÁRIO>
{ "payload": [ { "attribute_key": "assignee_id", "filter_operator": "equal_to",
                 "values": [7], "query_operator": null } ] }
```
> **NÃO CONFIRMADO:** que `agent_id` seja mesmo ignorado no `GET /conversations` (vem do documento do cliente, não verificado em código); que `attribute_key` seja exatamente `"assignee_id"` (o formato do payload está confirmado para `POST /contacts/filter`, e é por analogia); se `{conversation_id}` no caminho de `POST .../messages` é o `display_id` ou o id interno. **Como confirmar:** três chamadas com uma conversa real, na Fase 0.

**Ao LER o responsável:** usar `meta.assignee.id` **e `meta.assignee_type`** juntos. Achado de produção datado (17/08/2026): *"`assignee_id` não existe na resposta desta API: o responsável vem só em `meta.assignee`"* — e as duas tabelas (User e AgentBot) têm sequências independentes e **colidem**: nesta conta, o AgentBot é id 4 e a agente Maria Eduarda também é id 4. Um `agent_id` sozinho é ambíguo entre pessoa e robô.

### 7.4 Alertas de falha de integração (trilha separada)

O histórico de disparos responde *"o cliente 652 já recebeu a oferta neste ciclo?"*. Falhas de integração respondem *"a integração está de pé?"*. Públicos diferentes, ciclos de vida diferentes — misturar faz a falha sumir no volume.

| Gatilho | Severidade | Ação automática |
|---|---|---|
| Qualquer `AUTH_ERROR` | 🔴 crítico | **Desliga o canal**, alerta imediato, **sem retry**. Token do ClickUp não expira, mas morre com a desativação do usuário. |
| ≥ 5 `HTTP_ERROR` em 15 min | 🟠 alto | Pausa o canal e reagenda. |
| Qualquer `CONFIG_ERROR` | 🟠 alto | `list_id`/`field_id` mudou. **Ninguém percebe sozinho**: uma lista recriada no ClickUp ganha id novo e o dashboard passa a escrever no vazio. |
| `RATE_LIMIT` recorrente | 🟡 médio | Reduzir o limiter; verificar se outro sistema divide o token. |
| Qualquer `RECONCILIACAO` | 🔴 crítico | **Bloqueia promoção de regra para LIVE e o despacho** (ADR-06). |

---

## 8. Deploy no Easypanel

### 8.1 Lista COMPLETA de variáveis de ambiente

```bash
# ═══ APLICAÇÃO ══════════════════════════════════════════════════════════════════
NODE_ENV=production
APP_URL=https://comercial.seahub.<dominio>
APP_TIMEZONE=America/Fortaleza          # relógio de TODO corte de dia. Não mudar.
DATABASE_URL=postgres://comercial:<senha>@<host-pg>:5432/seahub_comercial
SESSION_SECRET=                         # SECRET · openssl rand -base64 48 (mín. 16 chars)

# ═══ BOOTSTRAP DO PRIMEIRO ADMIN (remover após o 1º acesso) ═════════════════════
ADMIN_EMAIL=
ADMIN_PASSWORD=                         # SECRET · mín. 10 caracteres

# ═══ CONEXA — SOMENTE LEITURA ═══════════════════════════════════════════════════
CONEXA_BASE_URL=https://seahubcoworking.conexa.app/index.php/api/v2
CONEXA_API_TOKEN=                       # SECRET · token PRÓPRIO do comercial (ADR-02)
CONEXA_RATE_LIMIT_PER_MIN=15            # ⚠ TETO COMPARTILHADO: comercial + financeiro ≤ 55
                                        #   (o financeiro DEVE ir de 60 para 40)
CONEXA_WEBHOOK_SECRET=                  # SECRET · valida SÓ o webhook
DATA_SOURCE=mock                        # mock | live      ← default seguro

# ═══ AGENDADOR ══════════════════════════════════════════════════════════════════
SYNC_SCHEDULER=on                       # leitura (ADR-03)
SYNC_JANELA_PESADA=02:00-05:00          # backfill/reparos/cadastros (fuso do app)
INTEL_SCHEDULER=on                      # consolidação + motor de regras
INTEL_RUN_AT=06:00                      # hora local de Fortaleza
INTEL_REVENUE_MONTHS=24                 # profundidade da série mensal
BOOKINGS_BACKFILL_DESDE=2024-01-01
CRON_SECRET=                            # SECRET · header x-cron-secret
                                        #   ⚠ SEPARADO do CONEXA_WEBHOOK_SECRET (de propósito)

# ═══ ESPELHO DO FINANCEIRO — Etapa 2 condicional (ADR-01) ═══════════════════════
MIRROR_MODE=off                         # off | fdw
MIRROR_FDW_SCHEMA=financeiro_ro
MIRROR_FDW_HOST=
MIRROR_FDW_DBNAME=seahub_financeiro
MIRROR_FDW_USER=                        # SECRET · role SOMENTE-LEITURA
MIRROR_FDW_PASSWORD=                    # SECRET
MIRROR_MAX_STALENESS_MIN=90             # acima disso → fallback p/ API direta + IntegrationFailure

# ═══ MOTOR DE REGRAS ════════════════════════════════════════════════════════════
RULES_ENABLED=on                        # avalia (despachar é outra chave)
RULES_DEFAULT_MODE=SOMBRA               # modo de regra recém-criada
RULES_MAX_SIGNALS_PER_RUN=1000          # disjuntor global do runner
BACKTEST_MAX_MONTHS=24

# ═══ CAMADA DE DISPARO — TODOS OS DEFAULTS FECHAM (ADR-04) ══════════════════════
NOTIFICADOR=off                         # on | off   ← mata TUDO
NOTIFICADOR_MODO=dry-run                # dry-run | live
NOTIFICADOR_MAX_POR_EXECUCAO=200        # disjuntor de volume; estourar ⇒ run HALTED
NOTIFICADOR_MAX_CONTATOS_CLIENTE_MES=2  # política de fadiga (regras 6/7/8)
NOTIFICADOR_JANELA_HORA=8               # hora local do despacho diário
CLICKUP_ENABLED=off
CHATWOOT_ENABLED=off

# ═══ CLICKUP ════════════════════════════════════════════════════════════════════
CLICKUP_TOKEN=                          # SECRET · pk_… do USUÁRIO-ROBÔ, NUNCA de um vendedor
CLICKUP_TEAM_ID=
CLICKUP_LIST_ID=                        # lista de oportunidades
CLICKUP_LIST_TRIAGEM_ID=                # sinais sem vendedor mapeado
CLICKUP_DEFAULT_STATUS=                 # tem que CASAR EXATO com um status da lista
CLICKUP_FIELD_CHAVE_DISPARO=            # uuid do custom field short_text
CLICKUP_FIELD_CONEXA_CUSTOMER_ID=       # uuid
CLICKUP_FIELD_REGRA=                    # uuid (drop_down)
CLICKUP_FIELD_STATUS_CRM=               # uuid (drop_down) — leitura do CRM
CLICKUP_RATE_LIMIT_PER_MIN=80           # margem sobre 100 do plano Business (NÃO CONFIRMADO)

# ═══ CHATWOOT ═══════════════════════════════════════════════════════════════════
CHATWOOT_BASE_URL=https://chatwoot.seahealth.io
CHATWOOT_ACCOUNT_ID=
CHATWOOT_USER_TOKEN=                    # SECRET · token de USUÁRIO (bot não filtra conversas)
CHATWOOT_CONVERSA_INTERNA_ID=           # resumo diário sem precisar criar conversa
CHATWOOT_PERMITE_OUTGOING=off           # ⚠ off = APENAS nota privada
CHATWOOT_RATE_LIMIT_PER_MIN=60          # NÃO CONFIRMADO — verificar Rack::Attack da instância
```

> **Todo default é o seguro.** Um deploy que esqueça de configurar não dispara nada — falha fechada, não aberta. É o **inverso** do financeiro (onde `SYNC_SCHEDULER` liga sozinho), e está certo: **ler sozinho é bom, escrever sozinho não.**

### 8.2 Publicação da imagem

```bash
# 1. COMMITAR PRIMEIRO. Depois buildar. Nunca o contrário.
git add -A && git commit          # o pre-commit exige docs/context/progress.md staged
SHA=$(git rev-parse --short HEAD)
IMG=ghcr.io/basiliolp/dashboard-comercial
docker build -t $IMG:latest -t $IMG:$SHA .
docker push $IMG:$SHA && docker push $IMG:latest
```
**Sempre publicar o short-sha junto com `latest`** — sem isso não há como saber qual commit está em produção. Se houver cota de GitHub Actions, automatizar com `on: push: tags`.

### 8.3 Teste local da imagem ANTES de publicar

```bash
docker run --rm -p 3000:3000 --env-file .env.teste $IMG:$SHA
```
Conferir **cinco**:
1. `GET /api/health` → `200 {"status":"ok","db":"ok"}`
2. `GET /` → **307** (redireciona para `/login`)
3. `POST /api/sync` sem segredo → **401**
4. `POST /api/rules/run` sem segredo → **401**
5. `POST /api/dispatch/run` com segredo e `NOTIFICADOR=off` → **200 `{"suprimido":"kill-switch"}`**

### 8.4 Passo a passo no Easypanel

1. **Banco.** No serviço Postgres existente: `CREATE DATABASE seahub_comercial;` + `CREATE ROLE comercial LOGIN PASSWORD '…';` + `GRANT ALL ON DATABASE seahub_comercial TO comercial;`. **Nenhum `GRANT` no database do financeiro.** (Se houver recurso, um serviço Postgres novo é preferível — isolamento de CPU/memória/backup.)
2. **Ajustar o financeiro.** `CONEXA_RATE_LIMIT_PER_MIN=40` no serviço `seahub_financeiro`, redeploy, e **conferir no log** que ele subiu com o novo valor. Registrar em `docs/context/progress.md` dos **dois** repositórios. *Este é o único toque no sistema financeiro em toda a v1.*
3. **Criar o serviço App** do tipo **Docker Image**, apontando para `ghcr.io/basiliolp/dashboard-comercial:latest` (credenciais de registry se privado). **1 réplica.** O entrypoint roda `prisma migrate deploy` no boot — **não é preciso passo extra**.
4. **Secrets:** colar do 1Password tudo marcado `# SECRET` na §8.1. Primeiro deploy com `DATA_SOURCE=mock` e `NOTIFICADOR=off`.
5. **Healthcheck:** `GET /api/health`, intervalo 30s, porta 3000.
6. **Domínio + TLS:** `comercial.seahub.<dominio>`.
7. **Primeiro boot:** conferir no log `[entrypoint] Aplicando migrations…`, `[entrypoint] CHECKs de procedência aplicados`, `[seed-rules] 11 regras (0 criadas, 11 já existentes)`, `[agendador] ligado: …`.
8. **Login** com `ADMIN_EMAIL`, trocar a senha, **remover `ADMIN_PASSWORD` das variáveis**.
9. **Ligar em degraus:** `DATA_SOURCE=live` → disparar o backfill por `POST /api/sync?mode=backfill` com `x-cron-secret` → conferir integridade → `RULES_ENABLED=on` (tudo em `SOMBRA`) → **só depois de `/reconciliacao` ficar verde**, promover regras para `DRY_RUN` → **só depois de um ciclo revisado por humano**, `NOTIFICADOR=on` + `NOTIFICADOR_MODO=live` + `CLICKUP_ENABLED=on`, **uma regra por vez**.
10. **Backup:** snapshot diário do volume Postgres. **Testar o restore uma vez** — backup não testado é fé.

---

## 9. Roadmap em fases

Esforço em **pontos relativos**: 1 ponto ≈ 1 dia-agente de trabalho focado com o repositório de referência à mão. **Total: 42 pontos.**

---

### **Fase 0 — Provas de acesso (GO / NO-GO)** · 2 pts

**Objetivo.** Derrubar as incógnitas que mudariam a arquitetura, **antes** de escrever código que dependa delas. Meio dia de esforço evita descobrir na semana 6 que metade das regras não tem dado.

**Entregáveis.** `scripts/provas/*.mjs` rodados à mão com credenciais reais; `docs/context/lacunas.md` preenchido com **respostas HTTP reais capturadas**, datadas; um dump JSON por endpoint em `docs/samples/`.

**Critério de aceite (todos objetivos, binários):**
- [ ] `GET /room/bookings?limit=1` devolve **200**, não 403. **Se 403: as regras 2, 3, 4, 5, 9 e 10 estão bloqueadas** — abrir chamado em `suporte@conexa.app` **no dia 1** e reescopar o roadmap para as regras de contrato.
- [ ] `GET /contracts?limit=1` traz **`hourPlanQuota` e `privateSpaceId`** (variante "Conexa Coworking"). Se vier "Recorrência", regras 2/6/7/8/9 viram `LACUNA_DE_DADO`.
- [ ] `GET /plans?limit=1` traz `hourQuotas[].validityType` preenchido em ao menos um plano da Seahub.
- [ ] `GET /room/bookings?createdAtFrom=…` devolve 200 ou 400 — **registrado**. (O análogo em `/sales` dá 400, medido.)
- [ ] `recurringSale.packageId` casa com algum `plan.hourQuotas[].id` **em dados reais** — sim/não registrado.
- [ ] Resposta da Conexa sobre **rate limit por token ou por conta**, e segundo `api_key` emitido (ou negado).
- [ ] Dump de `GET /list/{CLICKUP_LIST_ID}/field`: UUIDs de campos e opções; **formato de leitura de `drop_down`** (uuid ou orderindex) capturado; `==` testado com chave composta; `include_closed=true` testado com filtro por custom field; plano do workspace registrado.
- [ ] `POST /conversations/filter?status=open` com `assignee_id` devolve 200; `attribute_key` real e `display_id` vs id interno registrados.

---

### **Fase 1 — Esqueleto, espelho e as métricas do documento** · 9 pts

> **Critério que define o escopo desta fase: ela não depende de NENHUMA resposta incerta.** Tudo aqui usa endpoints que o dashboard financeiro já exercita em produção. Se a Fase 0 devolver 403 em `/room/bookings`, a Fase 1 entrega igual.

**Objetivo.** O time comercial consultando **perfil do cliente, receita e Top 5** em produção, com dados reais. **Zero escrita em sistema de terceiro. Zero regra.**

**Entregáveis.**
- Repositório com `Dockerfile`, entrypoint, `.gitattributes`, hooks, `tsconfig`, `vitest.config`, `docs/context/` (8 documentos) e a coleção Postman copiada.
- `schema.prisma` completo **menos** `RoomBooking`/`HourQuotaBalance` populados, + `001_checks_procedencia.sql`.
- `src/lib/conexa/{client,types,mappers,ingest,sync,scheduler,webhook}.ts` copiados/adaptados.
- Backfill de 24 meses: companies, serviceCategories, plans, products, costCenters, customers, persons, contracts, recurringSales, sales, charges.
- `intel/revenue` (com `isRecognizedCharge` copiado literalmente) + `intel/profile`.
- Telas: `/login`, `/`, `/clientes`, `/clientes/[id]` (blocos 1–3 e 7), `/receita`, `/reconciliacao` (bloco 1), `/operacao`, `/admin/usuarios`. Componente `<Numero>`.
- ADR-01…ADR-09 escritos em `docs/context/decisions.md`.

**Critério de aceite:

**Critério de aceite:**
- [ ] `GET /api/health` → `200 {"status":"ok","db":"ok"}`; `/` → 307; `POST /api/sync` sem segredo → 401.
- [ ] `verificarIntegridade()` (busca binária no `offset`, ~17 req/entidade — a API descontinuou `totalItems`) confirma **100%** dos registros de cada entidade contra a API. Diferença zero.
- [ ] **Receita de um mês fechado bate ao centavo com o dashboard financeiro** (regime emissão + `currentAmount`, excluindo `cancelled`/`cancelDate` **e `negotiated`**). Δ = **R$ 0,00** na tela `/reconciliacao`, e a contagem de cobranças bate 1:1.
- [ ] Top 5 do ano conferido manualmente contra o Conexa pelo Diego.
- [ ] `deltaPct` é `NULL` quando `prevRevenue = 0`; teste prova que no dia 3 do mês **nenhum** cliente é marcado `isDrop` por causa do mês corrente.
- [ ] `/clientes/[id]` de 5 clientes reais (1 fiscal, 1 privativa, 1 com pacote, 1 avulso, 1 inativo) validado pelo Diego.
- [ ] Nenhum número na tela sem selo de procedência. `src/lib/intel/dispatch/` **não existe ainda**.
- [ ] `CONEXA_RATE_LIMIT_PER_MIN=40` ativo no financeiro (confirmado no log) e **zero `429` nos dois serviços por 7 dias corridos**.
- [ ] `npm run typecheck && npm test` verdes; os três greps de invariante (ADR-09) no CI.

---

### **Fase 2 — Reservas de sala e completude** · 4 pts

**Objetivo.** Trazer o endpoint que o financeiro nunca chamou, e provar que o trouxemos inteiro.

**Entregáveis.** `src/lib/conexa/bookings-sync.ts`; modelo `RoomBooking` com `durationHours` e `bookingDate` **materializados**; dimensão `Room` derivada de `place{id,name}`; bloco "Horas e reservas" em `/clientes/[id]`; `/reconciliacao` bloco 2.

**Backfill por janelas DIÁRIAS de `bookingDateTimeFrom/To`**, não por offset contínuo. Motivo: a paginação por offset **escorrega** (medido no financeiro: 66.078 páginas → 65.894 linhas, 184 duplicatas e **189 vendas puladas**; correr de novo escorrega em outros registros, não converge). Uma janela de data no passado é **imutável** — nenhuma reserva nova nasce em 12/03/2025 —, logo paginar dentro de um dia fechado não escorrega. Só o dia corrente escorrega, e ele é re-varrido a cada ciclo. Incremental: janela móvel `hoje − 7d` até `hoje + 90d` (reserva é criada para o futuro).

**Critério de aceite:**
- [ ] Backfill concluído desde `BOOKINGS_BACKFILL_DESDE`; `SyncRun` `SUCCESS`.
- [ ] Para **3 meses fechados sorteados**, a contagem por busca binária no `offset` bate **exatamente** com `count(*)` local.
- [ ] `durationHours` calculado para 100% das reservas com as duas pontas; **`NULL`, nunca 0**, quando falta uma.
- [ ] Teste com fixture: reserva `10:30 → 13:15` ⇒ `2.75`. Conferência cruzada: a `sale` associada tem `quantity: 2.75`.
- [ ] `dim_rooms` populada por descoberta; nenhuma sala classificada por substring de nome.
- [ ] Zero `429` no período do backfill, nos dois serviços.

---

### **Fase 3 — A prova do saldo de horas (fase de MEDIÇÃO, não de UI)** · 3 pts

**Objetivo.** Decidir, com número, se as regras 2 e 9 existem. Esta fase pode **reprovar** — e reprovar é uma entrega válida.

**Entregáveis.** `intel/quota/{entitlement,consumption,balance}.ts` com a precedência do ADR-05; `HourQuotaBalance` populada; `/reconciliacao` bloco 3; `/operacao/lacunas`; e **um ADR intitulado _"Saldo de horas: derivado e reconciliado"_ ou _"Saldo de horas: LACUNA — regras 2 e 9 suspensas"_**, com os números da medição.

**Método.** O cliente exporta a tela de saldo do Conexa para ≥ 20 clientes reais, cobrindo: cota por `spaceId`, cota por `groupId`, cliente com pacote recorrente, cliente com contrato + pacote, cliente que estourou a cota. `reconciliacao/saldo-horas.ts` importa a planilha e compara.

**Critério de aceite (o mais duro do roadmap):**
- [ ] ≥ 95% dos baldes dentro de **± 0,25 h**.
- [ ] **100% de concordância no sinal do gatilho.** Nenhum caso em que o derivado diz "abaixo de 5h" e o Conexa diz "acima". **Um único erro reprova a fase.**
- [ ] Âncora do ciclo confirmada (dia 1 / `dueDay` / dia do `startDate`) e fixada por teste.
- [ ] Carry-over e dedução parcial respondidos pelo cliente e implementados.
- [ ] Cotas por `groupId` marcadas `INDISPONIVEL`, com o `CHECK` do banco garantindo `balanceHours IS NULL`.
- [ ] `/operacao/lacunas` lista as pendências com contagem de clientes impactados.

**Se reprovar:** famílias `SALDO_COTA` ficam em `OFF` permanente; a regra 4 sobrevive (o gatilho >5h não depende de saldo); o roadmap segue.

---

### **Fase 4 — Kernel do motor + 6 famílias, tudo em SOMBRA** · 10 pts

**Objetivo.** As 11 regras existindo como **linhas em banco**, avaliadas diariamente, visíveis na UI, **sem despachar nada**.

**Entregáveis.** `rules/kernel/{types,registry,runner,explain,params}.ts`; as 6 famílias; `calendar.ts`; `prisma/seeds/rules.seed.ts` com as 11 regras; `Segment` + `/admin/segmentos`; `Signal`; telas `/sinais`, `/sinais/[id]`, `/regras`; aba "Por que não disparou?" em `/clientes/[id]`; job `mode=INTELLIGENCE` às 06:00.

**Critério de aceite:**
- [ ] O seed cria **11 `Rule` sobre 6 famílias**, e **nenhuma família tem código específico de uma regra**.
- [ ] Os três greps de invariante passam; em particular, `src/lib/intel/rules/families/` sem Prisma, sem `next/*`, sem `new Date()`.
- [ ] Cada família passa as **seis classes de teste**: T1 positivo mínimo (o caso literal do documento) · T2 negativo adjacente (dia anterior e seguinte **não** disparam) · T3 clamp (`31/01 + 1 mês = 28/02`, e `29/02` em bissexto) · T4 fuso (o mesmo contexto com `hoje` derivado de 23:59 e de 00:01 em Fortaleza produz a **mesma `cycleKey`**) · T5 idempotência · T6 lacuna (dado `INDISPONIVEL` ⇒ `BLOQUEADO_POR_LACUNA`, nunca `SINAL` com número inventado nem silêncio). Cobertura de `families/` ≥ 95%.
- [ ] Rodar o runner **3× no mesmo dia** cria exatamente os mesmos sinais (`signalsCreated = 0` na 2ª e 3ª).
- [ ] Todo `Signal` tem `evidence` renderizável; nenhum vazio.
- [ ] A aba "Por que não disparou?" mostra o predicado reprovado para um cliente escolhido **ao vivo** pelo Diego.
- [ ] Regras 8 e 10 aparecem `OFF` com gap bloqueante em `/operacao/lacunas`, com o desbloqueio necessário escrito.
- [ ] `intel_dispatch_log` continua **vazio, zero linhas** — é a prova de que sombra é sombra.
- [ ] **Portão humano:** o Diego revisa a lista completa de sinais de uma semana e classifica cada um como procedente / falso positivo. **Meta: ≥ 80% de procedência por regra.** Regra acima de 20% de falso positivo volta para especificação.

---

### **Fase 5 — Simulação, UI de parâmetros e precisão** · 6 pts

**Objetivo.** O Diego consegue, sozinho, mudar um threshold, ver o efeito histórico e o histórico de quem mexeu.

**Entregáveis.** `rules/kernel/backtest.ts` + `dataset/as-of.ts`; `RuleSimulation`, `RuleChange`; `/regras/[key]`, `/regras/[key]/simular`, `/regras/nova`; guarda de promoção; painel de precisão.

**Critério de aceite:**
- [ ] `/regras/[key]` renderiza o formulário **gerado do `paramsSchema`** — acrescentar um param numa família faz o campo aparecer sem tocar em JSX.
- [ ] Backtest de 12 meses roda em **< 30 s** e persiste `RuleSimulation`.
- [ ] Comparação A × B funcionando; **relatório de sobreposição** (quantos clientes receberiam 2+ ofertas no mesmo mês).
- [ ] Cada família declara e a UI exibe a **fidelidade** (ALTA/MÉDIA/BAIXA) com o motivo escrito.
- [ ] Tentar salvar `LIVE` sem simulação válida é **recusado**, com a lista do que falta.
- [ ] `RuleChange` grava toda alteração e aparece na tela.
- [ ] Painel de precisão por regra alimentado pelas marcações da fila.

---

### **Fase 6 — Disparo ClickUp: DRY-RUN → LIVE, uma regra por vez** · 6 pts

**Objetivo.** A primeira task real no ClickUp, para **uma** regra, com auditoria completa.

**Entregáveis.** `dispatch/{types,orquestrador,clickup}.ts` (clientes reaproveitados de `agentes-chatwoot`); `DispatchLog` com outbox; `Seller` + `/admin/vendedores`; `/disparos`; `reconciliacao/disparos.ts`.

**Regra de promoção:** começar pela regra de **menor volume e maior confiança** — candidata: `PRIVATIVA_1_MES` (marco determinístico, poucos contratos/mês, oferta clara). Depois de **2 semanas limpas**, promover a segunda. **Nunca duas regras novas no mesmo ciclo.**

**Critério de aceite:**
- [ ] Com `NOTIFICADOR=off`, executar o despacho faz **zero** requisições HTTP a terceiros — provado por teste com `fetch` global mockado que **lança** se chamado.
- [ ] Teste automatizado prova que `previa()` não faz `fetch`.
- [ ] Um ciclo completo em dry-run produz `DispatchLog SIMULADO` para 100% dos sinais elegíveis, com o payload exato, e **zero requisição de escrita** (comprovado por `requestsMade` em `SyncRun`).
- [ ] O Diego aprova por escrito o CSV da prévia de uma semana: título, corpo, vendedor, prioridade.
- [ ] **Teste do pior caso:** matar o container **entre o POST e o commit** ⇒ na execução seguinte **nenhuma segunda task** é criada (a reserva `PENDENTE` barra), e a reconciliação promove a linha para `ENVIADO` com o `externalId` achado pelo `chave_disparo`.
- [ ] **Teste de colisão de prefixo:** a consulta com `==` **não** casa `6521:…` ao procurar `652:…` (com `=` casaria — o teste prova a diferença).
- [ ] `401` forjado **desliga o canal** e abre `IntegrationFailure(AUTH_ERROR)` **sem retry**.
- [ ] Teto: cenário com 10.000 sinais para em `NOTIFICADOR_MAX_POR_EXECUCAO` e marca o run `HALTED`.
- [ ] A task nasce com **todos** os custom fields numa **única** requisição (verificado no log).
- [ ] Vendedor sem `clickupUserId` ⇒ task **sem assignee** em `CLICKUP_LIST_TRIAGEM_ID`. Nunca no chute.

---

### **Fase 7 — Chatwoot (nota privada) + leitura do CRM ClickUp** · 4 pts

**Objetivo.** Contexto da oportunidade onde o vendedor já está, e o Status CRM refletido de volta no dashboard.

**Entregáveis.** `dispatch/chatwoot.ts` com `private: true` obrigatório; `POST /conversations/filter` para achar a conversa; resumo diário na conversa interna; sync de leitura do ClickUp (`ClickUpTask`, `CrmStatus`); fechamento de ciclo (Status CRM = "Ganho" ⇒ `Signal.status = GANHO`).

**Critério de aceite:**
- [ ] Teste de CI prova que **nenhum caminho de código** envia `private: false` com `CHATWOOT_PERMITE_OUTGOING=off`.
- [ ] Cliente sem conversa aberta ⇒ `IGNORADO { motivo: "SEM_CONVERSA" }`, **o sistema não cria conversa**, e a task do ClickUp existe do mesmo jeito.
- [ ] Status CRM decodificado via `type_config.options` para as 3 opções, e **distinguido** de `task.status.status`.
- [ ] `assignee` lido por `meta.assignee.id` **+ `meta.assignee_type`**; teste com fixture onde AgentBot id 4 e agente id 4 coexistem prova que não há confusão.
- [ ] Resumo diário chega em `CHATWOOT_CONVERSA_INTERNA_ID`.

---

### **Fase 8 — Regras destravadas + endurecimento** · 5 pts (condicional)

**Objetivo.** Ligar o que estava bloqueado, quando o bloqueio sair — e deixar a operação sustentável.

**Critério de aceite (por item, condicional):**
- [ ] **R10** sai de `OFF` **só** com o mapa `planId → tier` homologado **por escrito**, versionado como `Segment{tipo:"planTierMap"}` com procedência, **ou** com o extraField de contrato preenchido no Conexa. Classificar por substring do nome do plano é **proibido**.
- [ ] **R8** existe **só** se "Panteão" for cadastrado no Conexa e o `productId` informado, **e** a ambiguidade "no 6º mês vs até o 6º mês" resolvida.
- [ ] **R3** existe **só** com a definição numérica de "irregular" e a escolha compra × consumo.
- [ ] Alertas de falha implementados conforme §7.4; `IntegrationFailure` agrupa por `fingerprint` (endpoint fora do ar por 2h ⇒ **1 linha com `occurrences`**, não 480).
- [ ] Runbook em `docs/context/` responde: "o que fazer quando o dry-run mostra 300 disparos inesperados", "como revogar um disparo já enviado", "como desligar tudo em 30 segundos".
- [ ] **Etapa 2 (FDW)** implementada **se e somente se** o gatilho medido do ADR-01 disparar.

---

### **Testes de aceite finais — o que prova que a arquitetura entregou**

Três, cronometrados. Valem mais que qualquer diagrama:

1. **Regra nova sem deploy.** Criar "Meu Depósito completa 3 meses → ofertar upgrade" pela UI, simular 12 meses, ligar em sombra. **Meta: < 15 min, zero commit.**
2. **Threshold ajustado pelo time comercial.** O Diego muda "5h" para "8h" na regra 9, vê no backtest que os disparos caem de 34/mês para 11/mês, salva. **Meta: < 5 min, sem chamar o dev.**
3. **Explicação de um sinal.** Um vendedor pergunta "por que abriram esta task?" e a resposta completa — predicados, números com procedência, params vigentes no disparo, payload enviado, resposta do ClickUp — está em **uma tela**, sem consultar log.

Se os três passarem, a regra 30 custa o mesmo que a regra 11.

---

## 10. Riscos e mitigações

| # | Risco | Prob. | Impacto | Mitigação (estrutural, não promessa) | Sinal de que aconteceu |
|---|---|---|---|---|---|
| **R1** | **`/room/bookings` bloqueado por permissão (403)** — a coleção documenta *"only available for authorized customers"* e o financeiro nunca chamou o endpoint | Média | 🔴 **Crítico** — derruba as regras 2, 3, 4, 5, 9 e 10 | Teste **nº 1 da Fase 0**. Se 403, chamado na Conexa no dia 1 e roadmap reordenado para as regras de contrato (1, 6, 7, 8), que não dependem de reservas. Plano B parcial: derivar consumo de `/sales` com `status=deductedFromQuota` + `quantity` (fonte cruzada confirmada: 2,75h ↔ `quantity 2.75`), com fidelidade menor e **declarada** | `IntegrationFailure(AUTH_ERROR)` na Fase 0 |
| **R2** | **Estouro do teto de 60 req/min compartilhado degrada o dashboard financeiro** | Média | 🔴 Crítico — quebra o sistema que fecha o mês | ADR-02: token próprio + 40/15 por env + janelas desencontradas + backfill noturno + limiter com margem de 5%. Monitor de `requestsMade` somado em `/operacao`. **Validação: zero 429 em 7 dias** | `429` em qualquer dos dois |
| **R3** | **Saldo derivado diverge do Conexa** (âncora do ciclo, carry-over e dedução parcial todos **NÃO CONFIRMADOS**) | **Alta** | 🔴 Alto | ADR-05: Fase 3 é uma fase de **medição** com critério de reprovação explícito (100% de concordância no sinal). Reprovou ⇒ regras 2 e 9 desligadas e a lacuna documentada com números. `INDISPONIVEL ⇒ NULL` por `CHECK` | Taxa de acerto medida na Fase 3 |
| **R4** | **Receita do comercial diverge do financeiro** | Média | 🔴 **Crítico para credibilidade** | ADR-06: `isRecognizedCharge` copiado literalmente (excluir `negotiated` — ~R$ 132 mil de receita-fantasma medidos); reconciliação diária **bloqueante** com tolerância R$ 0,00; portão da Fase 1 | O próprio número em `/reconciliacao` |
| **R5** | **Regra 5 dispara em massa** (backfill incompleto faz todo cliente antigo parecer "primeira reserva") | **Alta** | 🔴 Alto — 5.505 tasks | Backfill **completo** antes de a regra sair de `SOMBRA` + `dataCorteBackfill` como parâmetro **obrigatório** da família + `cycleKind: CUSTOMER_ONCE` ancorado no `bookingId` (reserva anterior que apareça depois gera correção, não novo disparo) + teto por execução + backtest mostra o volume por mês **antes** de ligar | Milhares de sinais R5 num dia |
| **R6** | **Task duplicada no ClickUp** | Média (sem defesa) → Baixa (com) | 🔴 Alto — lixo no CRM de outra pessoa | 3 constraints de banco + claim outbox **antes** do POST + reconciliação por `chave_disparo` com **`==`, nunca `=`** + teto por execução. Teste de matar o container entre POST e commit (portão da Fase 6) | Duas tasks com a mesma `chave_disparo` |
| **R7** | **Colisão de prefixo no filtro do ClickUp** (`652` casa com `6521`) | Alta se `=` for usado | 🔴 Alto — sistema "acha" que disparou para quem nunca recebeu | Operador `==` obrigatório, chave sempre em `short_text`, **um único filtro** com chave composta, teste dedicado com fixture de colisão | Cliente que nunca recebeu aparece como já disparado |
| **R8** | **Mensagem enviada ao cliente final por engano** (`outgoing` em vez de `private`) | Baixa | 🔴 **Irreversível** | `CHATWOOT_PERMITE_OUTGOING=off` + teste de CI que quebra o build se `outgoing` aparecer fora do guard + Chatwoot é a última fase | Um cliente respondendo a um alerta interno |
| **R9** | **Bug multiplicativo** (fuso, sinal invertido num limiar) atinge a base inteira num ciclo | Média | 🔴 Alto | `NOTIFICADOR_MAX_POR_EXECUCAO` (run `HALTED`, não continua) + `maxPorExecucao` por regra + máquina `OFF→SOMBRA→DRY_RUN→LIVE` + `hoje` injetado (nunca `new Date()`) + backtest obrigatório antes de `LIVE` | Execução `HALTED` em `/operacao` |
| **R10** | **Paginação por offset escorrega** (medido: 184 duplicatas, 189 vendas puladas) e um cliente fica fora de um ciclo de avaliação | **Alta** | 🟠 Médio | `pagination.hasNext` como sinal de fim (o heurístico `items.length < limit` gerou **685 duplicatas** em 21.974 despesas) + reparo diário por `id[]` explícito, com sonda adiante do maior id e parada em **3 lotes vazios = 300 ids** (a Seahub cria ~1.500 vendas todo dia 1º; teto fixo reportaria SUCCESS perdendo ~270) + janelas de data fechadas para reservas | `verificarIntegridade()` acusa contagem menor |
| **R11** | **Registro alterado dentro de janela já sincronizada nunca é re-buscado** — **nenhum** endpoint de lista aceita filtro por `updatedAt` | **Certa** | 🟠 Médio | Reconcile horário do mês corrente + diário do anterior + reparo por id + webhook. Limite **documentado** em `conexa-integration.md` | Divergência na conciliação |
| **R12** | **Config do ClickUp muda em silêncio** (lista recriada ganha id novo; opção renomeada) e o dashboard escreve no vazio | Média | 🟠 Alto | `verificarConfiguracao()` no boot + sync do CRM a cada 6h espelhando `list/{id}/field` + `IntegrationFailure(CONFIG_ERROR)` com severidade alta | Tasks param de aparecer **sem erro visível** |
| **R13** | **Token do ClickUp/Chatwoot morre** com a desativação do funcionário dono | Média | 🟠 Alto | Usuário-**robô** dedicado, nunca token de pessoa; dono documentado; `401` desliga o canal automaticamente e abre incidente — **falha ruidosa** | `IntegrationFailure(AUTH_ERROR)` |
| **R14** | **Agendador silenciado para sempre** por `SyncRun` zumbi | Baixa (com defesa) | 🔴 **Crítico e invisível** | `enterrarZumbis()` no boot (zumbi de 14h já visto em teste) + alerta se o último `SyncRun SUCCESS` tiver > 2h + rodapé "sincronizado há N" | O rodapé da tela |
| **R15** | **Deriva de fuso** faz o marco de aniversário cair um dia antes/depois | Média | 🟠 Médio | Todo corte de dia em `America/Fortaleza`; `hoje` injetado; `addMonthsClamp` testado; `parseCalendarKey()` construindo data **local** (a regressão do financeiro deslizava o período inteiro um dia **com rótulo coerente** — invisível); fuso do robô ClickUp em Fortaleza | Teste T3/T4 |
| **R16** | **Falso positivo alto derruba a confiança** — o vendedor para de olhar a fila | Média | 🔴 **Alto (é o risco de produto)** | Portão de ≥ 80% de procedência na Fase 4, revisado pelo Diego; ação "descartar como falso positivo" alimentando o painel de precisão; regra acima de 20% é desligada | A própria métrica de descarte |
| **R17** | **Fadiga de contato**: privativa recebe 3 ofertas em 6 meses; regras 2 e 9 disparam juntas | Alta | 🟠 Médio | `NOTIFICADOR_MAX_CONTATOS_CLIENTE_MES` + `cooldownDays` por regra + dedupe por `offerProduct` + **relatório de sobreposição no backtest**, que torna isso visível antes de ligar | Reclamação de cliente |
| **R18** | **Segundo container por engano** → dois agendadores, dois disparos | Baixa | 🟠 Alto | `pg_advisory_lock` por tarefa (a segunda réplica não roda) + as 3 constraints de banco como defesa real + réplica única documentada no serviço | Sinais duplicados no log |
| **R19** | **Regra mal configurada pelo time comercial** (limiar invertido) | Média | 🟠 Médio | Guarda de promoção (backtest + teto de volume) + `SOMBRA` como default de regra nova + `RuleChange` audita quem mudou o quê; reverter é restaurar `params` de uma versão anterior | Volume anômalo no backtest |
| **R20** | **Backtest engana** por não ter histórico de estado mutável | Baixa se declarado, 🔴 se escondido | 🟠 Médio | Fidelidade ALTA/MÉDIA/BAIXA por família, **exibida na tela com o motivo**. Melhoria futura: `contract_state_history` alimentada pelo próprio sync (guardar transições de `isActive`) sobe `MARCO_CONTRATO` para ALTA | Divergência entre backtest e produção |
| **R21** | **Webhooks não funcionam** (1 evento em toda a história do banco do financeiro) | **Alta** | 🟢 Baixo | Já tratados como **gatilho, nunca fonte**. O reconcile horário garante atualidade. **Nenhuma regra depende de webhook.** `/operacao` mostra "último webhook há X" para o silêncio ser visível | O próprio painel |
| **R22** | **Migration do comercial toca o banco do financeiro** | Baixa | 🔴 Crítico | Bancos fisicamente separados; role `comercial` sem privilégio algum no database do financeiro. Uma migration destrutiva **não tem permissão para existir** | Erro de permissão no boot |

---

## 11. Lacunas e perguntas para o cliente

> Cada pergunta está marcada com a fase que ela **bloqueia**. Pergunta sem resposta para a fase.

### 🔴 URGÊNCIA MÁXIMA — bloqueiam a Fase 0 (acesso, credenciais, infraestrutura)

**Para a Conexa (`suporte@conexa.app`):**

1. **O limite de 60 req/min é por API key ou por conta?** — **NÃO CONFIRMADO.** Se for por key, um segundo token elimina o problema arquitetural inteiro (ADR-02) e o financeiro volta a 60 req/min.
2. **O token da Seahub tem permissão liberada para `GET /room/bookings`?** A coleção documenta o bloqueio por padrão (403 *"only available for authorized customers"*). **É a pergunta que decide o escopo de 6 das 10 regras.** Se não, como solicitar e qual o prazo?
3. Quando uma reserva **excede** a cota, a Conexa **deduz parcialmente e fatura o excedente**, ou fatura tudo? — **NÃO CONFIRMADO.** Muda o filtro de consumo (hoje `status == 'deductedFromQuota'` pode subestimar).
4. O ciclo de uma cota `validityType: "Monthly"` reseta no **dia 1 do mês**, no **`dueDay` do contrato** ou no **dia do mês do `startDate`**? — **NÃO CONFIRMADO.** Errar move o saldo em até um ciclo inteiro.
5. Horas não usadas **acumulam** para o ciclo seguinte? Por quantos ciclos? — **NÃO CONFIRMADO** e não há campo na API.
6. `recurringSale.packageId` é o **mesmo identificador** de `plan.hourQuotas[].id`? — **NÃO CONFIRMADO** (a doc chama os dois de "ID do Pacote de Horas" e os fixtures coincidem em 78/79/80, mas são fixtures diferentes). Existe algum endpoint para ler um pacote de horas? (Não achamos `/packages` nas 67 rotas.)

**Para o Diego:**

7. Podemos emitir um **`api_key` do Conexa dedicado** ao comercial, separado do financeiro? (Revogável isoladamente, independentemente da resposta da Q1.)
8. Posso **baixar `CONEXA_RATE_LIMIT_PER_MIN` do dashboard financeiro de 60 para 40** e redeployá-lo? (É mudança de variável de ambiente, zero código; o reconcile fica ~1,5× mais lento, invisível num intervalo de 15 min.)
9. Há recursos no Easypanel para um **serviço Postgres novo**, ou uso um database separado no serviço existente? (As duas opções servem; o que não serve é compartilhar schema.)
10. Podemos criar um **usuário-robô no ClickUp** (`bot@seahub…`), com fuso **`America/Fortaleza`**, e usar o token dele? (Token de vendedor cria tasks órfãs e webhooks que morrem em silêncio quando ele sai.)
11. Podemos criar um **usuário de integração no Chatwoot** ("Seahub Integração", admin) — **não** um Agent Bot? (A allowlist de bots proíbe listar/filtrar conversas e ler `/agents`, que é exatamente o que precisamos.)
12. **Em qual plano está o workspace do ClickUp?** — **NÃO CONFIRMADO.** 100 vs 1.000 req/min muda o desenho da camada de saída.
13. Quem são os usuários do dashboard, com e-mail e papel (ADMIN / COMERCIAL / VIEWER)?

---

### 🟠 URGÊNCIA ALTA — bloqueiam a Fase 1 (receita) e a Fase 3 (saldo)

**Receita e identidade:**

14. A **régua de receita** do comercial deve ser a mesma do financeiro — **emissão + `currentAmount`**, excluindo canceladas **e renegociadas**? Confirmam que é assim que vocês pensam "receita do cliente"?
15. **"Alerta se cair X% de um mês para outro" — qual é o X?** E confirmam que a comparação é entre **meses fechados** (o mês corrente, incompleto, não entra)?
16. **Top 5** é por receita do **ano corrente**, dos **últimos 12 meses**, ou do período que o usuário escolher?
17. A segmentação por unidade (Seaway / Sebrae / Ayrton Senna) deve vir de `customer.companyId`? *(O contrato **não** traz `companyId` na resposta, embora `/contracts` aceite o filtro `companyId[]`.)*
18. Quais são os **nomes exatos** das categorias de serviço no Conexa? Atenção: o catálogo real tem **3 grafias para Sebrae** (incluindo uma com dois espaços) e 2 caixas para "Outros Serviços".

**Saldo de horas (portão da Fase 3):**

19. Vocês conseguem **exportar do Conexa a tela de saldo de horas de ~20 clientes reais** para eu reconciliar a derivação antes de ligar as regras? **Sem isso, as regras 2 e 9 não saem de SOMBRA.** Preciso que a amostra inclua: cota por sala, cota por grupo, cliente com pacote recorrente, cliente com contrato **e** pacote, e cliente que estourou a cota.
20. **Quais cotas hoje são por GRUPO de salas (`groupId`) e não por sala específica?** Preciso da lista de **quais salas compõem cada grupo** — **a API não expõe isso** (`/rooms`, `/spaces`, `/spaceGroups` ausentes; 404 medido). Sem a lista, essas cotas ficam permanentemente `INDISPONIVEL`.
21. Em `recurringSale`, o campo `quantity` significa **horas** ou **unidades**? Nos exemplos oficiais ele aparece como `80` (com `amount 1000` — parece 80h por R$1.000) e como `1` (com `amount 0` — parece 1 unidade de cota herdada do plano).
22. Uma reserva marcada e **não comparecida (no-show)** consome cota? (`booking.completed = false`, mas não há campo que distinga no-show de uso real.)

---

### 🟡 URGÊNCIA MÉDIA — bloqueiam a Fase 4 (semântica de cada regra)

**Regra 1 — Fiscal 11 meses:**

23. O relógio dos 11 meses começa em **`startDate`** (início do contrato) ou em **`fidelityDate`** (fim da fidelidade)? Os dois existem e **divergem nos dados reais** (contrato 376: `startDate 2024-03-26`, `fidelityDate 2026-03-25`).
24. Se o cliente já renovou (2º/3º contrato), o gatilho conta do **contrato atual** ou da **primeira contratação** de Endereço Fiscal? *(A API não encadeia contratos — não há campo "contrato anterior".)*
25. A oferta de Bianual vale para **todos os tiers**? No catálogo real existem apenas **2 produtos "Bianual", ambos SEATECH** (3248 "Seatech - EV Litoral (Bianual) Mensal" e 3252 "Seatech - EV Abissal (Bianual) Mensal"). Não há Bianual para Simples/Black/Comércio.
26. Deve disparar para quem **já está em periodicidade Anual/Semestral**, ou apenas para mensalistas?

**Regras 2 e 9 — saldo:**

27. **São a mesma coisa com limiares diferentes?** Se sim, fico só com "< 5h". Se não, qual é o critério da regra 2 (percentual? absoluto? outro)?
28. O saldo de 5h é **por sala** (cota específica) ou o **total somado** do cliente?
29. Se faltam poucos dias para a cota renovar, ainda faz sentido ofertar? A partir de quantos dias restantes a oferta é útil?
30. Cliente que **estourou a cota** (saldo negativo) entra nesta regra ou tem tratamento próprio?

**Regra 3 — padrão irregular:**

31. **"Comprou 20h em junho" significa horas ADQUIRIDAS (pacote comprado) ou horas UTILIZADAS (reservas)?** São dois caminhos totalmente diferentes com respostas diferentes.
32. **Quantos meses formam o padrão e qual a queda mínima** que caracteriza "irregular"?
33. Há **sazonalidade** (dezembro, janeiro, carnaval) em que a queda é normal e **não** deve gerar oferta?
34. Podem me apontar, no Conexa, **3 clientes que hoje vocês considerariam "padrão irregular"**? Uso como caso de teste para calibrar.

**Regra 4 — avulso com uso alto:**

35. **Me passem a tabela de preços dos pacotes de horas** (faixas de horas × valor) e o **preço/hora de sala avulsa**. A API não expõe (`/products` dá 404 para salas com o token da Seahub — 118 de 164+ produtos acessíveis). **Sem isso o sinal dispara, mas a "economia vs avulso" fica em branco.**
36. **"Só compra hora avulsa"** = cliente **sem nenhum contrato**, ou cliente com contrato mas **sem cota** de horas? São populações bem diferentes.
37. As 5h são no **mês-calendário fechado** ou nos **últimos 30 dias corridos**?
38. Se o cliente cruzar 5h todo mês, a oferta se repete mensalmente ou dispara uma vez e volta após N meses?

**Regra 5 — primeira reserva:**

39. O gatilho é no dia em que o cliente **FAZ** a reserva (`createdAt`) ou no dia em que ele **USA** a sala (`startTime`)?
40. **Reserva cancelada** antes de acontecer conta como "primeira reserva"?
41. Vale para **qualquer espaço** (auditório, sala de atendimento, estação de coworking) ou **só sala de reunião**?
42. Se o cliente já tem Endereço Fiscal, ofertamos só o SeaBox, ou a regra não dispara?
43. **Confirmam que posso rodar o backfill completo do histórico de reservas antes de ligar a regra?** (Sem isso, o primeiro dia dispara para toda a base.)

**Regras 6, 7 e 8 — sala privativa:**

44. **Estação de coworking conta como "sala privativa"?** A categoria "Salas Privativas - Seaway Center" inclui, no catálogo real, "Contrato: Estação 01 - Coworking L21 Mensal", "Estação de Coworking - Seahub Seaway" e "Coworking Estação 08".
45. Identifico privativa por **`contract.privateSpaceId`** preenchido ou pela **categoria do plano**? Se um contrato tiver categoria de privativa mas `privateSpaceId` vazio, ele entra?
46. "1 mês do início do contrato" conta de **`startDate`** ou de **`dateSalesGeneration`** (data em que a cobrança começou)? Divergem nos dados (contrato 10506: `2024-03-01` vs `2024-05-02`).
47. Contrato que começa **dia 31**: o aniversário de 1 mês cai no último dia de fevereiro (nossa proposta, com clamp) ou em 3 de março?
48. Confirmam que **2811, 2951 e 3076** são os "Registro de Marca", e que possuir qualquer um deles impede o disparo da regra 6?
49. Confirmam **3156, 3157, 3178, 3179, 3182** como o conjunto "SeaBox"? E qual variante é ofertada na regra 7 — **Básico ou Pro**?
50. **O SeaBox da regra 7 é cortesia (benefício) ou venda?** Se for cortesia, **como vocês registram no Conexa que o cliente já recebeu?** Se não registram, o sistema nunca saberá e pode reofertar.
51. **O que é "Panteão"?** — **NÃO CONFIRMADO / INEXISTENTE.** Busca por "panteao"/"panteão" nos **217 produtos** exportados do Conexa (jan–jul/2026) retorna **zero**. É produto novo ainda não cadastrado, ou tem outro nome no sistema? Se for cadastrado, qual o `productId`?
52. **"Até o 6º mês"** significa disparar **NO** aniversário de 6 meses, ou em algum momento **DENTRO** da janela dos 6 primeiros meses? Se for a janela, **qual evento a aciona?** (Uma janela não é um gatilho — dispararia todo dia por 6 meses.)

**Regra 10 — Endereço Litoral:**

53. **Me passem a lista de `planId` (ou o nome exato do plano no Conexa) de cada tier: Simples, Litoral, Batial, Abissal, Black e Comércio.** — **BLOQUEIO PRINCIPAL.** A API **não distingue os tiers**: todos aparecem como `serviceCategory = "Endereço Fiscal - RN"`. O tier só existe dentro de `plan.name`, e classificar por substring viola a regra de ouro do projeto (29 produtos de Endereço Fiscal com 3 prefixos distintos e 5 periodicidades).
54. **Alternativa melhor e permanente:** vocês conseguem **preencher o campo extra de contrato "Tipo de contrato"** (`extraFields`, `type='contract'`, id 108) no Conexa com o tier? Assim o dashboard lê **dado vivo** em vez de um mapa manual que envelhece. — **NÃO CONFIRMADO** que a Seahub popule esse campo hoje; nenhum exemplo da coleção o traz preenchido.
55. **O plano Batial tem as 2h/mês cadastradas como cota de horas dentro do plano** no Conexa (`plan.hourQuotas` com `quantity: 2`, `validityType: "Monthly"`), ou é um acordo comercial que não está no sistema? — **NÃO CONFIRMADO.** *(Existe um produto real "Horas do Plano Contratado (2h)", id 3014, que corrobora — mas não é prova.)*
56. **Quando ofertar Pacote de Horas e quando ofertar upgrade para Batial?** Existe um volume de horas que separa as duas?
57. Se o cliente Litoral reservar sala todo mês, a oferta se repete mensalmente?

---

### 🟢 URGÊNCIA NORMAL — bloqueiam as Fases 6 e 7 (operação do disparo)

58. **Política de fadiga: qual o máximo de contatos por cliente por mês?** Um cliente de sala privativa receberia 3 ofertas em 6 meses (Registro de Marca, SeaBox, Panteão), mais eventuais ofertas de horas.
59. Se o sistema ficar fora do ar e perder um aniversário, **disparamos atrasado ou deixamos passar?** (Define `toleranciaDias`; a proposta é 7 dias.)
60. Qual `list_id` do ClickUp recebe as oportunidades? E qual **lista de triagem** recebe os sinais sem vendedor mapeado?
61. Quais **`statuses` válidos** a lista tem? (O `status` no create precisa **casar exatamente**, senão a chamada falha.)
62. Podemos **criar 3 custom fields novos** na lista — `chave_disparo` (**`short_text`**, obrigatório para o operador `==`), `conexa_customer_id` e `regra`? São a espinha da idempotência.
63. O campo **"Status CRM"** existe com as opções "Em andamento" / "Ganho" / "Perdido"? — **NÃO CONFIRMADO** (vem do documento do Diego, não de leitura da API).
64. **Mapeamento vendedor → e-mail → `user_id` do ClickUp → `sellerId` do Conexa → `agent_id` do Chatwoot.** *(O Conexa **não tem endpoint `/users` nem `/sellers`** — esse mapa é manual e obrigatório. Conciliar por **e-mail**, nunca por nome.)*
65. **Quem responde por um sinal sem vendedor mapeado?** Rodízio (temos `rodizio.ts` pronto) ou uma pessoa fixa?
66. **Aceitam que a v1 não envie nada ao cliente final** — apenas task interna no ClickUp + nota privada no Chatwoot?
67. Existe um **inbox interno / conversa fixa** no Chatwoot onde o resumo diário pode ser postado sem tocar em conversa de cliente?
68. `account.api_and_webhooks_enabled?` está `true` na instância? Qual a **versão** do Chatwoot em `chatwoot.seahealth.io`? — **NÃO CONFIRMADO.**
69. Qual o **volume diário tolerável** de tasks novas por vendedor? (Vira `NOTIFICADOR_MAX_POR_EXECUCAO` e o teto por regra.)

---

### 📋 Lacunas de API — o que simplesmente NÃO EXISTE (não são perguntas; são fatos a conviver)

| Lacuna | Evidência | Como o sistema lida |
|---|---|---|
| **Saldo de horas** não é campo | Nenhum endpoint devolve "saldo/quota restante". O que existe é a **concessão** (3 lugares) e o **consumo** (derivável) | `HourQuotaBalance` com `balanceSource = DERIVADO`, reconciliado (ADR-05); `INDISPONIVEL ⇒ NULL` |
| **Não existe `/packages`** | `recurringSale.packageId` não resolve para nome, horas ou preço | `HourPackage.hoursIncluded` MANUAL, via `/operacao/lacunas` |
| **Não existem `/rooms`, `/spaces`, `/privateSpaces`, `/spaceGroups`** | Ausentes das 67 rotas; **404 medido** pelo projeto financeiro | `Room` DERIVADA de `booking.place{id,name}`; cotas por `groupId` **BLOQUEADAS** |
| **Não existem `/users` nem `/sellers`** | `sellerId`/`creatorUserId` são inteiros opacos | `Seller` com PK própria e mapeamento MANUAL por e-mail |
| **Não existe `/tags`** | `customer.tagsId` e o filtro `tagId[]` existem; o cadastro não | `CustomerTag.name` MANUAL |
| **Nenhum endpoint aceita filtro por `updatedAt`** | Verificado em `/customers`, `/contracts`, `/sales`, `/charges`, `/recurringSales`, `/room/bookings`, `/plans`, `/products` | Reconcile por janela de negócio + reparo por `id[]` + webhook |
| **`/sales` não aceita `createdAtFrom/To`** na prática | Documentado na coleção, mas devolve **400 "Field validation error"** — MEDIDO em produção | Usar `dateFrom/dateTo` (filtra `referenceDate`) |
| **Não há GET de check-in/check-out** | `/checkin` e `/checkout` são **apenas POST** | Uso de estação de trabalho é **ilegível** pela API; qualquer regra baseada em presença está bloqueada por design |
| **`contract` não traz `companyId`** na resposta | Embora `/contracts` aceite o filtro `companyId[]` | Unidade vem de `customer.companyId` ou `plan.companyId` |
| **Arrays exigem parâmetro REPETIDO** | `id[]=1&id[]=2`. A coleção diz "separados por vírgula", e vírgula devolve silenciosamente o conjunto errado. Verificado buscando 1.913 vendas: repetido traz 1.913/1.913 | Tratado no `client.ts` copiado |