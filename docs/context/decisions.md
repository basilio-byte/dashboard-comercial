# Decisões de Arquitetura (ADRs)

Formato: cada entrada = Contexto → Decisão → Consequência. Mais recente no topo.

---

## ADR-0001 — Banco de dados fisicamente separado do dashboard financeiro

**Contexto.** O dashboard financeiro já espelha 8 das 9 entidades que o comercial precisa
(Customer, Plan, Contract, Sale, Charge, Product, ServiceCategory, RecurringSale) num Postgres em
produção, validado ao centavo contra o Conexa. Três caminhos: (A) usar o mesmo banco, (B) banco
separado com sync próprio, (C) o financeiro vira hub de ingestão e o comercial lê por
`postgres_fdw`.

A opção A é inaceitável por um motivo operacional concreto: o `docker-entrypoint.sh` roda
`prisma migrate deploy` **no boot do container**. Duas tabelas `_prisma_migrations` no mesmo
schema, dois `schema.prisma` que não se conhecem — um `migrate dev` de qualquer um dos dois "vê"
as tabelas do outro e propõe `DROP`. É um acidente com data marcada, num banco de dinheiro.

A opção C é arquitetonicamente superior, mas exige alterar um sistema em produção antes de a
primeira tela do comercial existir — e num momento em que ainda não se sabe se metade dos dados
do comercial sequer está acessível.

**Decisão.**
- **Banco físico separado** (`seahub_comercial`), na mesma instância Postgres do Easypanel, com
  role `comercial` **sem privilégio algum** no database do financeiro.
- Sync próprio das entidades que o comercial usa. O comercial **não** sincroniza `bills`,
  `suppliers`, `methods`.
- `/room/bookings` é do comercial, sempre — o financeiro nunca chamou esse endpoint.
- **Proibido:** o comercial rodar migration contra o banco do financeiro; ter `INSERT/UPDATE/DELETE`
  em qualquer objeto dele; a UI consultar dado do financeiro dentro de um request.
- **FDW é promoção condicional com gatilho medido**, não decisão de dia 1. Promove-se quando
  qualquer um de: ≥ 3 respostas `429` em 24h em qualquer dos dois serviços; o sync de cadastros do
  comercial passar de 20 min; a reconciliação de receita acusar divergência recorrente.

**Consequência.** Duplicação de ingestão custa uma carga inicial e algumas dezenas de requisições
por hora em regime — ruído, não argumento. O risco real que sobra é **divergência de receita**, e
ele é neutralizado pelo ADR-0006, não por esperança. Blast radius de qualquer incidente do
comercial = só o comercial.

---

## ADR-0002 — Rate limit do Conexa é compartilhado e precisa de coordenação real

**Contexto.** O limitador do cliente HTTP do financeiro é **por processo Node** — comentário
literal do repositório: *"Vale por processo Node (o container do Easypanel roda um único
processo)"*. Se dois containers usarem o mesmo token, **cada um acredita ter os 60 req/min
inteiros**, e o consumo combinado é ~120/min contra um teto de 60.

⚠ **Auditoria derrubou a mitigação ingênua.** "Rodar em janelas desencontradas" é
**inimplementável** com o agendador que se pretendia copiar: ele ancora a fase de cada tarefa no
**boot do container** (`setTimeout(atrasoInicial) → setInterval(intervalo)`), e todo redeploy
re-randomiza. E a única guarda de concorrência que o financeiro tem — `backfillEmAndamento()` —
consulta o **próprio** banco, então com bancos separados nenhum dos dois enxerga o backfill do
outro.

**Decisão.**
1. **Perguntar à Conexa se o teto é por token ou por conta** e solicitar um `api_key` dedicado ao
   comercial. Se for por key, o problema desaparece. É a pergunta nº 1 do projeto e **bloqueia a
   Fase 1**.
2. Enquanto não houver resposta, orçamento repartido por env (`CONEXA_RATE_LIMIT_PER_MIN`:
   financeiro 40, comercial 15), **mais** coordenação real — uma das três:
   (a) token-bucket compartilhado em tabela/Redis que os dois serviços consomem;
   (b) um único serviço coletor que espelha para os dois bancos;
   (c) janela horária explícita por **relógio de parede** (`SYNC_JANELA_HORARIA`, ex. comercial
   só sincroniza 01:00–05:00) + endpoint `/api/operacao/ocupado` que cada serviço consulta no
   outro por HTTP antes de iniciar carga pesada (leitura HTTP não viola o isolamento de banco).
3. Monitoramento obrigatório: `/operacao` mostra o consumo somado das últimas 24h; qualquer `429`
   vira incidente registrado.

**Consequência.** Baixar o teto do financeiro é mudança de variável de ambiente, zero código,
reversível num redeploy. Critério de validação: **zero `429` nos dois serviços por 7 dias
corridos**.

---

## ADR-0003 — Agendador embutido, com um único regime de exclusão mútua

**Contexto.** Cron externo é um passo que se esquece, e esquecer é silencioso — o dashboard
simplesmente para de atualizar. Já aconteceu no projeto irmão, que rodou em produção sem nenhum
cron configurado. O container já é um processo Node de longa duração; ele mesmo se agenda.

⚠ **Auditoria encontrou um conflito lógico** ao copiar as defesas do irmão: `enterrarZumbis()`
marca, no boot, **todo** `SyncRun` em `RUNNING` como falho, sem filtrar por processo — premissa
"um container só". Isso é incompatível com suportar duas réplicas: o boot da réplica B mataria o
backfill vivo da réplica A **e** liberaria a guarda, fazendo as duas atacarem a API ao mesmo
tempo. Além disso, `pg_advisory_lock` de **sessão** sobre conexão do pool do Prisma não é
confiável — a conexão volta ao pool e o unlock de outra conexão falha em silêncio.

**Decisão.**
- Agendador **embutido**, ligado por `src/instrumentation.ts`, **só no runtime `nodejs`**.
- **Um regime, escolhido e escrito: réplica única.** `SYNC_SCHEDULER=off` obrigatório em qualquer
  réplica extra, documentado no serviço do Easypanel. Com isso `enterrarZumbis()` continua válido.
  Se um dia houver multi-réplica, trocar `enterrarZumbis()` por **heartbeat** (`SyncRun.ownerId` +
  `heartbeatAt` a cada 30s, enterrando só runs com heartbeat velho) — nunca os dois juntos.
- Se um lock for usado, `pg_try_advisory_xact_lock` dentro de `$transaction`, nunca lock de sessão.
- **Três chaves independentes**: `SYNC_SCHEDULER` (leitura, default `on`), `INTEL_SCHEDULER`
  (consolidação + regras, default `on`), `NOTIFICADOR` (disparo, default **`off`**).
- O caminho HTTP continua existindo (`POST /api/sync`, `POST /api/rules/run` com `x-cron-secret`),
  como porta para cron externo e para disparar backfill à mão.

**Consequência.** O sistema não depende de "lembrar de manter uma réplica só" para estar correto,
porque a defesa contra disparo duplicado é constraint de banco (ADR-0004), não o agendador.

---

## ADR-0004 — Camada de disparo: dry-run é infraestrutura e todo default fecha

**Contexto.** O financeiro é somente-leitura por construção. O comercial escreve em ferramenta de
terceiro, e essa escrita tem quatro propriedades que a leitura não tem:

1. **Não existe rollback.** Task criada por engano se apaga na mão, uma a uma.
2. **O erro é multiplicativo.** 11 regras × ~5.500 clientes num job diário. Um bug de fuso na
   regra "11 meses" não gera *um* disparo errado — gera um por cliente de Endereço Fiscal, de uma
   vez. Um sinal invertido num limiar (`< 5h` vs `> 5h`) inverte a base inteira.
3. **O dano cai sobre terceiros.** Quem vê o estrago é o vendedor com 300 tasks às 6h.
4. **Estourar o limite quebra vizinhos.** O rate limit do ClickUp é por token.

E o backoff de 7 tentativas do cliente Conexa é seguro para `GET` e **perigoso para `POST`**: um
`500` pode ter criado a task antes de falhar.

**Decisão.**
- **A prévia é um caminho de código SEPARADO, não uma flag.** A interface tem `previa()` (pura,
  sem rede) e `disparar()`. Com uma flag interna, um `if (!dryRun)` esquecido em qualquer branch
  escreveria em produção. Separando, **uma prévia é estruturalmente incapaz de escrever**.
- **Nenhum notificador conhece kill-switch, idempotência ou dry-run** — tudo vive no orquestrador;
  se cada implementação checasse, bastaria uma esquecer. Ordem das guardas:

  ```
  1. kill-switch global NOTIFICADOR=off     → antes do banco, para parar tudo sem tocar em dados
  2. gate de elegibilidade do cliente       → ADR-0010
  3. selo de frescor/completude do sync     → ADR-0011
  4. modo da regra (OFF/SOMBRA)             → SOMBRA nunca chega ao canal
  5. reconciliação vermelha                 → divergência de dado BLOQUEIA escrita
  6. lacuna bloqueante no sinal             → não sai oferta com número que não existe
  7. supressão (já possui / já recusou)     → ADR-0010
  8. claim outbox (INSERT com @@unique)     → concorrência resolvida pelo BANCO
  9. teto por execução                      → disjuntor contra bug multiplicativo; run vira HALTED
  10. toggle por canal (ClickUp / Chatwoot) → configurável na UI, ver ADR-0009
  11. dry-run → previa()   |   live → disparar()
  ```

  **Idempotência vem ANTES do dry-run** de propósito: assim a prévia mostra exatamente o conjunto
  que a execução real produziria. Um dry-run que ignorasse o histórico exibiria disparos que nunca
  aconteceriam, e a revisão humana estaria conferindo ficção.
- **Padrão outbox.** Registro gravado como `PENDENTE` **antes** da chamada HTTP, cobrindo o pior
  caso — *a escrita deu certo e a resposta se perdeu*. Um `PENDENTE` antigo é **suspeito, não
  falho**: a reconciliação consulta o ClickUp pela chave de disparo e decide. Reconciliar é mais
  barato que duplicar.
- **Retry classificado por erro**, nunca o backoff de GET: `429` → aguarda o reset (máx. 3);
  `5xx`/rede → backoff com jitter (máx. 3); `401`/`403` → **nunca** retry, abre incidente e
  **desliga o canal**; `400`/`404`/`422` → nunca retry, é bug de payload e retry o mascara.
- **Rate limiter próprio por destino.** Jamais reutilizar a instância calibrada para o Conexa.
- **Todos os defaults fecham.** `NOTIFICADOR=off`, modo `dry-run`, canais desligados, regra nova
  nasce em `SOMBRA`. Um deploy que esqueça de configurar não dispara nada.
- **Promoção regra a regra**, nunca duas regras novas no mesmo ciclo.

**Consequência.** A primeira execução real do sistema nunca é a primeira vez que alguém vê o que
ele decidiu. O custo é uma fase inteira do roadmap gasta em dry-run antes da primeira task real.

---

## ADR-0005 — Saldo de horas é derivado, e só existe depois de reconciliação que pode reprovar

**Contexto.** O documento de especificação afirma que *"a API não expõe quota/saldo de horas por
pacote"*. Isso é **parcialmente falso**, e a diferença muda 5 regras.

**CONFIRMADO na coleção Postman** — a **concessão** é exposta em três lugares:
`plan.hourQuotas[] {id, name, spaceId, groupId, quantity, validityType: Daily|Weekly|Monthly}`;
`contract.hourPlanQuota[] {quantity, spaceId, groupId}` (e vem na **lista** `/contracts`, não só
no detalhe — um varrimento paginado traz a cota de todos os contratos); e
`recurringSale.packageId + quantity + frequency`.

**O consumo também é derivável:** `booking.startTime`/`finalTime` dão a duração, e
`booking.status` inclui **`deductedFromQuota`** — o próprio Conexa marca quais reservas foram
abatidas da cota.

**O que NÃO é exposto é o SALDO.** E derivá-lo depende de três coisas que a documentação não diz:
a **âncora do ciclo** (uma cota `Monthly` reseta no dia 1? no `dueDay`? no dia do mês do
`startDate`?), o **carry-over** de horas não usadas, e o comportamento de **dedução parcial**.
Errar a âncora move o saldo em **até um ciclo inteiro**.

**Decisão.**
- O saldo guarda **três parcelas com procedência separada**: `entitled` (API ou MANUAL ou
  INDISPONIVEL), `consumed` (sempre DERIVADO), `balance` (DERIVADO, e **só existe se `entitled`
  for conhecido**).
- **`INDISPONIVEL ⇒ NULL`, garantido por `CHECK` no Postgres.** Nunca `0`. "0h de saldo" é uma
  afirmação forte (o cliente esgotou a cota); "saldo desconhecido" é outra coisa, e confundir as
  duas dispara a regra errada.
- **Cotas por `groupId` são BLOQUEADAS.** Não existe `/rooms`, `/spaces` nem `/spaceGroups` na API
  (404 medido pelo projeto irmão). Sem saber quais salas compõem cada grupo, não há como saber
  quais reservas consomem a cota. Marcadas `INDISPONIVEL`, nunca estimadas.
- **Portão de reprovação explícito.** O cliente exporta a tela de saldo do Conexa para ≥ 20
  clientes reais, cobrindo cota por sala, cota por grupo, pacote recorrente, contrato + pacote, e
  cliente que estourou a cota. Critérios: ≥ 95% dos baldes dentro de ± 0,25 h **e 100% de
  concordância no sinal do gatilho** — nenhum caso em que o derivado diz "abaixo de 5h" e o
  Conexa diz "acima". **Um único erro reprova.**
- **Se reprovar**, as regras 2 e 9 ficam `OFF` permanente, a lacuna vai para a tela de lacunas, e
  um ADR registra a razão **com os números da medição**. A regra 4 sobrevive, porque ">5h de uso
  avulso" não depende de saldo.

**Consequência.** As regras 2 e 9 são as últimas a subir, e podem não subir. Isso é preferível a
ofertar pacote para quem tem 20h de saldo.

---

## ADR-0006 — Receita usa a mesma régua do financeiro, com reconciliação bloqueante

**Contexto.** Dois sistemas somando cobranças com réguas ligeiramente diferentes mostram números
diferentes para o mesmo cliente. Na primeira reunião, "receita do cliente X" no comercial ≠ no
financeiro, e o dashboard novo perde a credibilidade para sempre. É o maior risco **de produto**.

**Decisão.**
- **Fonte é `/charges`, não `/sales`.** A cobrança tem `customerId` + as três datas + os valores;
  a venda só tem `referenceDate` e pode ser faturada em outro mês.
- **Regime padrão: EMISSÃO** (`createdAt` convertido para `America/Fortaleza`, somando
  `currentAmount`, **com** juros/multa). É o regime que o financeiro da Seahub usa e o único
  validado ao centavo contra a tela do Conexa. Competência e caixa ficam disponíveis, com o
  regime **declarado na tela**, nunca implícito.
- **O predicado de reconhecimento é copiado literalmente** do financeiro: exclui `cancelled`/
  `cancelDate` **e também `negotiated`** — a cobrança original que uma renegociação substituiu.
  Somar as duas gerou ~R$ 132 mil de receita-fantasma medidos no projeto irmão.
- **Comparação mês a mês usa apenas meses FECHADOS.** O mês corrente é sempre incompleto;
  comparar corrente contra anterior faz **todo cliente parecer em queda no dia 3**.
- **Divisão por zero não vira 0%.** A variação é `NULL` quando o mês anterior é zero; a UI mostra
  "sem base de comparação", nunca `−100%`.
- **Reconciliação diária com tolerância R$ 0,00.** Divergência abre incidente e **trava a promoção
  de qualquer regra para LIVE**.

**Consequência.** Divergência vira número vermelho na tela no dia seguinte, não descoberta em
reunião. E o sistema se recusa a escrever no CRM de alguém enquanto os próprios números não fecham.

---

## ADR-0007 — Motor de regras: regra é DADO, família é CÓDIGO PURO

**Contexto.** Hoje são 10 gatilhos; o documento do cliente é claramente o começo de uma lista. Se
cada regra for um arquivo `.ts` + entrada em `enum` + migration + deploy, a regra 15 vira
negociação de sprint e a regra 30 nunca acontece. Quem vai querer mexer em "5h", "30%",
"11 meses" é o time comercial, não o dev.

**Decisão.**
- **6 famílias cobrem as 10 regras:** `MARCO_CONTRATO` (1, 6, 7, 8), `SALDO_COTA` (2, 9),
  `USO_SEM_COTA` (4), `TENDENCIA` (3 + queda de receita), `PRIMEIRO_EVENTO` (5),
  `EVENTO_EM_SEGMENTO` (10).
- **A avaliação de uma família é PURA:** sem `fetch`, sem Prisma, sem `next/*`, sem `process.env`,
  **sem `new Date()`**. O relógio é **injetado**. Verificado por grep no CI.
- É a pureza que entrega, de graça e ao mesmo tempo: teste unitário com fixture, **backtest** (é
  só trocar a data), **explicabilidade negativa** ("por que o cliente 652 NÃO disparou?") e
  **shadow mode**. Sem pureza, cada uma dessas vira um sistema separado.
- **O motor nunca chama a API do Conexa** — lê o espelho local. Isso permite rodar as regras
  centenas de vezes num backtest sem tocar no rate limit compartilhado.
- **Regra é linha em banco**, com os parâmetros validados por schema **em toda escrita**, e o
  baseline versionado num seed que continua sendo código revisado em PR.
- **O schema de parâmetros gera o formulário do admin** — acrescentar um parâmetro numa família
  faz o campo aparecer na tela sem tocar em JSX.
- **Máquina de estados por regra:** `OFF → SOMBRA → DRY_RUN → LIVE`. Nenhuma pula etapa. `LIVE` é
  recusado sem backtest recente com os parâmetros exatos, ou com volume acima do teto, ou com
  lacuna bloqueante, ou com a reconciliação vermelha.
- **Toda alteração é auditada** (autor, campo, de → para, motivo).

**Consequência.** A regra 11 é um `INSERT`: zero código, zero deploy.

**Contrapartida honesta do backtest:** o espelho guarda o **estado atual** de campos mutáveis
(`isActive`, `status`), não o histórico deles. Logo o backtest é aproximação. Em vez de esconder,
o sistema classifica e **exibe a fidelidade** por família (ALTA / MÉDIA / BAIXA) com o motivo
escrito na tela.

---

## ADR-0008 — Stack e deploy: cópia disciplinada do dashboard financeiro

**Contexto.** Existe um sistema irmão em produção no mesmo servidor, com o mesmo ERP, mantido pela
mesma pessoa. Divergir de stack cria dois padrões de operação para uma pessoa só manter.

**Decisão.** Copiar: Next.js 15 App Router + TypeScript + Postgres + Prisma + Tailwind + Recharts
+ Vitest; `output: "standalone"`; Dockerfile multi-stage com o stage isolado do CLI do Prisma;
entrypoint que roda `migrate deploy` no boot; validação de env com zod que falha rápido; sessão
server-side com bcrypt; convenções de schema (`conexaId` como PK, `raw Json`, `syncedAt`,
`Decimal(14,2)`, timezone `America/Fortaleza`); publicação no GHCR com tag `latest` **e** a tag do
short-sha; healthcheck em `/api/health`.

**Não copiar:** modelos de despesa/fornecedor/meio de recebimento, DRE, export XLSX (o comercial
não vive de exportar — CSV basta), e a lógica de data de crédito.

**Corrigir ao copiar** — defeitos encontrados pela auditoria no que parecia pronto:

1. o backfill **não é retomável** (sempre parte do offset 0, sem cursor persistido) — resolvido
   pelo model `SyncState`, que guarda o cursor por entidade/janela;
2. o agendador ancora a fase no **boot**, não no relógio de parede — logo "rodar em janelas
   desencontradas do financeiro" não é implementável sem horário explícito (ver ADR-0002);
3. **não há drenagem no encerramento**: nada para o agendador, grava o cursor em voo ou termina um
   despacho já postado antes do processo sair.

⚠ **Correção de um erro meu, medido nesta imagem.** Eu havia escrito que o container "não trata
SIGTERM" e que todo redeploy terminaria em SIGKILL. **Está errado.** O servidor standalone do Next
instala o handler por conta própria (`next/dist/server/lib/start-server.js` →
`process.on('SIGTERM', cleanup)`), e o `exec` do entrypoint faz o Node receber o sinal como PID 1.
Medição: `docker stop` sai com **código 0 em ~500 ms, com e sem `tini`**. O `tini` foi mantido pelo
que ele de fato entrega — encaminhar sinais e colher zumbis — não pela razão que eu havia dado.

O problema **real** é o item 3: o Next fecha o servidor HTTP, mas não sabe nada do nosso agendador
nem do backfill em voo. Drenar é código de aplicação.

**Consequência.** Quem mantém um mantém o outro. E as correções entram **antes** do primeiro
backfill longo, não depois de perdê-lo.

---

## ADR-0009 — Configuração é dado, com toggle por canal na UI e kill-switch em env

**Contexto.** Pedido explícito do dono do projeto: cada canal de disparo tem um toggle de
ligar/desligar, e existe uma página de Configurações onde se ajusta o que for preciso sem depender
de deploy. Quem vai querer desligar um gatilho ruim é o time comercial, no meio do expediente.

**Decisão.** **Dois níveis, e os dois existem de propósito:**

- **UI (`/configuracoes`)** — o controle do dia a dia: liga/desliga por canal (ClickUp e Chatwoot,
  independentes), modo dry-run global, destino do ClickUp, roster do time comercial, liga/desliga
  e thresholds por regra, ciclo de repetição. Persistido em banco, com **quem mudou e quando**
  registrado.
- **Variável de ambiente** — o kill-switch de emergência, que precisa funcionar **mesmo com a UI
  quebrada**. `NOTIFICADOR=off` desliga tudo sem depender de tela nenhuma.

**Destino é allowlist fechada, não parâmetro livre:** a lista do ClickUp vem de configuração e a
função de criar task **não aceita `list_id` como argumento** — não existe caminho de código que
escreva em outra lista. Os destinatários saem de um roster do time comercial persistido; enviar
para alguém fora do roster é erro, não fallback.

**Consequência.** Mudança de threshold não redispara o histórico — a chave de ciclo é **imune aos
parâmetros** (cliente + regra + âncora do ciclo). Reavaliar o ciclo corrente com parâmetros novos
é uma ação **separada, explícita e auditada**, com prévia de volume antes de confirmar; nunca
efeito colateral de salvar um formulário.

---

## ADR-0010 — Gate de elegibilidade e supressão são obrigatórios e centralizados

**Contexto.** Achado de auditoria adversarial: a especificação das 10 regras diz **quando ofertar
e nunca quando não ofertar**. Sem condição de exclusão, acontece: contrato encerrado no dia 25
dispara o marco de 1 mês no dia 30 e o vendedor liga oferecendo Registro de Marca para um
**ex-cliente**; cliente com cobrança `denied`/`protested`/`juridical` recebe oferta de upgrade;
cliente `isBlocked` recebe oferta de pacote.

**Decisão.**
- **Gate de elegibilidade** aplicado pelo runner **antes** de qualquer família ser chamada — não
  dentro de cada família, para não depender de disciplina: `customer.isActive` ∧
  `¬customer.isBlocked` ∧ (para marcos) contrato ativo com `endDate` nulo ou futuro ∧ sem cobrança
  em inadimplência dura (parâmetro configurável).
- ⚠ `isActive` e `isBlocked` **precisam virar coluna** — no espelho do financeiro eles ficam
  enterrados no `raw`.
- **Supressão por "já possui":** cada regra declara os `productIds` que representam a oferta; o
  kernel suprime quando o cliente já tem venda ou contrato ativo com qualquer um deles. Caso
  especial: oferta dada como **cortesia** não vira venda no Conexa — então ou passa a ser
  registrada, ou o histórico de disparo vira a fonte e a regra é de disparo único por cliente.
- **Supressão por "já recusou":** o "Perdido" do Status CRM suprime a mesma dupla
  (cliente, oferta) por um prazo configurável. Sem isso, o cliente diz "não quero", o vendedor
  marca perdido, e no ciclo seguinte outro vendedor liga oferecendo a mesma coisa.

**Consequência.** Duas classes de teste novas e obrigatórias: cliente inelegível e oferta já
possuída/recusada ⇒ **nunca** geram sinal.

---

## ADR-0011 — Nenhuma regra roda sobre dado velho ou incompleto

**Contexto.** Achado de auditoria: o job diário não tinha pré-condição alguma. E o próprio plano
admite que os dados podem estar incompletos (paginação por offset escorrega; registro alterado
dentro de janela já sincronizada nunca é re-buscado). Todas as mitigações eram **alerta, não
bloqueio** — e às 6h da manhã não há ninguém olhando o rodapé.

O estrago concreto: se o backfill de reservas falhar ou o token perder acesso a `/room/bookings`,
a tabela local fica vazia e a regra "primeira reserva" passa a ver **todo cliente antigo como
estreante** — milhares de tasks — enquanto as regras de saldo veem cota cheia para a base inteira.

**Decisão.**
- Cada família **declara de quais entidades depende**. O runner recebe o último sync de cada uma;
  sem sucesso dentro do SLA, a família inteira retorna `BLOQUEADO_POR_DADO_DESATUALIZADO` — sinal
  nenhum, disparo nenhum.
- **Checagem de sanidade de volume:** a contagem local de cada entidade não pode ter caído em
  relação ao dia anterior. Queda ⇒ parada, porque só truncamento produz isso.
- O orquestrador recusa despachar sinal avaliado num ciclo sem selo de completude.

**Consequência.** O sistema prefere não dizer nada a dizer algo errado — que é a mesma escolha do
ADR-0005 e do `INDISPONIVEL ⇒ NULL`, aplicada ao tempo em vez de ao valor.

---

## ADR-0012 — A escrita externa é isolada e estruturalmente incapaz de falar com o cliente

**Contexto.** O sistema **nunca** fala com o cliente final — decisão do dono do projeto. Toda
saída é interna, para o vendedor.

⚠ **Auditoria mostrou que a defesa proposta era fraca.** O cliente Chatwoot que se pretendia
reaproveitar tem `enviarMensagem(conversationId, conteudo, opcoes: { privado?: boolean } = {})`
montando `private: opcoes.privado ?? false`. **Omitir o parâmetro manda a mensagem para o
cliente.** Um grep de CI não pega isso: o código errado não contém a string `outgoing` — ele
apenas *esquece* `{ privado: true }`.

**Decisão.** Repetir o padrão do cliente Conexa somente-leitura, que é **estrutural e não
convencional**: uma função `enviarNotaPrivada(conversationId, texto)` como **único** ponto de
contato com o Chatwoot, com `private: true` fixo e **sem parâmetro capaz de expressar o
contrário** — o tipo torna a mensagem pública inexpressável. Import direto do cliente cru é
proibido por grep de invariante no CI. Toda a escrita externa vive em **dois arquivos**, também
verificados por grep.

**Consequência.** Para eliminar a única falha irreversível do sistema, a proteção é o tipo, não a
disciplina. Segunda camada (`CHATWOOT_PERMITE_OUTGOING=off`) fica como reforço, não como defesa
principal.
