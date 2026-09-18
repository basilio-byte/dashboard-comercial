# Progresso

Log cronológico. Mais recente no topo. **Atualizar a cada commit + push.**

---

## 2026-09-18 — A primeira leitura da produção pelo MCP achou a fila cheia de sinais falsos

O MCP foi ligado à produção e a primeira pergunta foi o tamanho do Radar novo.
Eu tinha alertado para "milhares" de linhas; a medição deu **37 clientes e 47
sinais sobre 1.011 elegíveis** — a amostra de agosto (6 de 10 com sinal) não
representava a base elegível.

O tamanho estava bom. O conteúdo não. Conferindo linha a linha contra o espelho,
três defeitos de regra, nenhum de limiar:

**1. Tendência: os 10 sinais (métrica + regra 3) eram artefato de cobrança.**
O regime é de emissão, e mês em que o Conexa emite duas cobranças vira pico — a
volta ao normal lia como queda. Quatro clientes com receita estável caíram
"−50%" no mesmo agosto. Um contrato anual (900,55 em julho, zero no resto) dava
"−100%". E a regra 3 contava qualquer queda: R$ 86,01 → R$ 84,14 (−2%) era
"padrão irregular". Subir o limiar não resolve — a base de comparação é que
estava errada. Agora a métrica compara com a **mediana dos 3 meses anteriores**
(`quedaContraBase`) e a regra 3 exige **queda mínima de 10% por passo**. Isso
dispensou excluir os 328 contratos anuais, que era a outra saída e escondia um
terço da base: 0, 0, 900, 0 tem mediana zero, que é "sem base", não queda.

**2. O Radar contava reservas de meses futuros como "horas no mês".** A consulta
de `fila.ts` tinha `dataLocal >= início do mês` e nenhum limite superior. Os "64h
no mês" de um cliente eram 16h × setembro, outubro, novembro e dezembro —
reservas recorrentes já agendadas. O defeito é anterior a 2026-09-16; só
apareceu quando a fila foi ligada ao Radar. A ficha filtrava certo, então os dois
discordavam sobre o mesmo cliente.

**3. As regras 4 e 10 ofertavam pacote de horas a quem já tinha.** As reservas
de cinco dos seis clientes conferidos vinham com `deductedFromQuota` — o Conexa
abatendo de uma cota que o espelho não enxerga. Conferido na fonte pelo MCP do
Conexa: três têm pacote em venda recorrente, **dois não** (a cota vem de outra
via). O status pega os cinco; sincronizar `recurringSales` pegaria três. Então a
evidência de posse é o status (`temEvidenciaDeCota`), com janela de 3 meses. E a
regra 4 passa a contar só hora **faturada** como avulso: nenhum dos seis tinha
hora `billed`/`paid` em jul–set, e oferecer "pacote sai mais barato que avulso" a
quem não paga por hora é a oferta errada.

As duas camadas — ficha (`avaliar.ts`) e Radar (`fila.ts`) — passam a chamar as
**mesmas** funções puras. Foi a lógica duplicada que as deixou discordar.

De passagem: `partiallyPaid` não estava em balde nenhum, caía em "status
desconhecido" e tornava o ciclo inconclusivo — um cliente que estourou a cota e
pagou parte deixava de confirmar o excedente, em silêncio. Agora é faturado. E
desligar um gatilho nativo congelava a nota do catálogo no banco; a nota só é
gravada quando editada.

**O que ficou em produção antes do deploy:** métrica, 3 e 4 desligadas pelo
MCP. A 10 não — o classificador de permissões do modo automático barrou a
escrita, e ela precisa ser desligada na tela ou religada depois do deploy
conforme a medição.

**Achado de negócio, em aberto:** reservas `notBilled` saltaram de 1h em junho
para 406h em agosto e 369h em setembro. Pode ser cortesia deliberada, pode ser
cobrança parada — é pergunta para o comercial, não conclusão.

O `.mcp.json` saiu do repositório: com `MCP_URL` vazio caía em `localhost`, e
conflitava com o registro de quem fazia certo. A documentação do MCP ganhou o
domínio de produção, o comando para Windows e a armadilha da letra do drive.

168 testes (eram 152). Os casos novos são as séries reais que davam sinal falso,
sem nome de cliente.

---

## 2026-09-16 — MCP, configuração editável e o Radar mostrando o que já existia

**O Radar mostrava um gatilho de doze.** `fila.ts` avaliava as 12 regras em lote
e **nenhuma tela a importava**; o Radar consumia só a fila de excedente de horas.
As outras onze eram avaliadas apenas abrindo cliente por cliente — e com milhares
de clientes, um sinal que exige abrir a ficha é o mesmo que não existir.

O pedido do Diego, *"Radar — aumentar o número de oportunidades levando em
consideração os gatilhos existentes"*, é exatamente isso: **não faltava gatilho,
faltava a tela mostrar os que já existiam**. `filaDeSinais()` agora inclui o
excedente (reaproveitando `clientesComExcedente`, e não reescrevendo a
consolidação por ciclo), agrupa por cliente e devolve `bloqueadas` e
`desligadas` separados — porque "fila vazia" só é interpretável quando se sabe o
que não foi avaliado, e de quem é a próxima ação.

**Regra virou dado; família continua código.** Os limiares viviam em `PARAMS`,
constante em `avaliar.ts`. Agora vivem na tabela `gatilhos`, editáveis na tela,
com rastro de quem mudou. `avaliar.ts` varre `carregarGatilhos()` e despacha por
família, em vez de percorrer arrays escritos nele — então um gatilho novo aparece
na ficha do cliente e no Radar **sem tocar em código**.

⚠ Os defaults do catálogo são **exatamente** os valores antigos: um banco sem
linha nenhuma avalia igual ao de ontem. Não há migração de dado nem tela que
precise ser aberta antes de o motor voltar a funcionar. E **não há escrita no
caminho de leitura** — semear as 12 linhas na primeira consulta faria uma página
de consulta escrever em produção.

O que NÃO é editável, de propósito: a **família** de um gatilho nativo (trocá-la
mudaria o significado de um código já gravado em `Contato.regra`) e o **bloqueio**
por permissão da API (ligar a regra 2 não faz `/packages` responder).

**Classificar categoria conserta uma falha silenciosa.** O casamento por trecho
de nome — "privativ", "fiscal", "seabox" — para de encontrar contrato quando a
Seahub renomeia uma categoria: a fila encolhe e não há erro em lugar nenhum. A
classificação manual é **por id**, e id não muda quando o nome muda. A tela
mostra as duas colunas lado a lado, porque é só assim que a renomeação aparece.
Atende ao pedido do Diego ("Meu Depósito", "Serviços de Espaço - Sebrae") e traz
a **unidade**, que virou filtro na Carteira.

**Cadastro de agentes.** `Contato.quem` era texto livre e acumulava "Diego",
"diego" e "DS" como três pessoas. A tela começa pelos nomes já digitados que não
estão no cadastro — um formulário vazio convida a inventar. ⚠ A tela diz, em
faixa de atenção, que **isto não é o vendedor responsável do Conexa**, que
continua irresolvível.

**Carteira com filtros combináveis**, como o Diego pediu, inclusive o exemplo
literal dele (plano X + receita decrescente). ⚠ **"Horas disponíveis" não está
lá, e a tela diz por quê**: o saldo do pacote vive atrás de um 404 de permissão.
Aparece como lacuna declarada, com o motivo — é o que faz alguém pedir a
liberação em vez de esperar para sempre.

**Confiança dentro do cliente** (pergunta do Diego). A tela Confiança responde
"o espelho está certo?"; o vendedor prestes a ligar pergunta "posso confiar
nestes números aqui?". Não virou score: um número único seria inventado. É uma
lista de afirmações verificáveis, cada uma com procedência.

**"Motor funciona como?"** virou seção na tela Motor: os quatro elos, o porquê de
cada um, e uma lista do que o motor **não** faz.

**Servidor MCP** em `POST /api/mcp` — 31 ferramentas, 18 de leitura e 13 de
escrita. Documentado em [mcp.md](mcp.md), com as decisões: protocolo à mão (o SDK
quer `http.ServerResponse`, o App Router entrega `Request` da Web), `inputSchema`
derivado do zod (escrever os dois à mão faz divergirem), erro de ferramenta como
`result` com `isError` (erro de protocolo o cliente esconde do modelo), e
`consulta_sql` em transação **READ ONLY** do Postgres — verificado: `nextval()`
devolve `25006`.

Sem `MCP_TOKEN` a rota responde **503**, não 200.

⚠ **O Conexa lançou um MCP próprio**, com OAuth e permissão em cascata do
usuário logado. Ele **não substitui o espelho** — OAuth é por pessoa, não tem
selo de completude, escreve no ERP, e divide o mesmo rate limit sem que o nosso
limitador o enxergue. Mas serve para uma coisa valiosa: **provar** se `/packages`
é restrição do nosso token ou lacuna do produto. Ver [mcp.md](mcp.md).

**Migration aditiva**, uma só: `agentes`, `gatilhos`, `categoria_classificacoes`,
`mudancas_de_config`, e `contatos.agenteId` anulável. 152 testes (eram 120).

---

## 2026-08-26 — No ar, com identidade própria; e o bloqueio do vendedor

**Deploy feito.** O sistema está rodando no Easypanel, porta 7000, com agendador
embutido continuando a carga sozinho. Guia completo em
[deploy-easypanel.md](deploy-easypanel.md).

⚠ **O CI falhou 11 vezes antes disso**, em `COPY --from=builder /app/public`. Causa:
**o git não versiona diretório vazio** — `public/` existia na máquina local (então o
build local passava, o tempo todo) e não existia no checkout limpo. Resolvido com
`public/robots.txt`, e a correção foi provada clonando o repositório limpo e
buildando dali, em vez de confiar no build local.

**Identidade própria.** O dono apontou que os nomes do menu lembravam o dashboard
financeiro — e estava certo: "Panorama", "Receita" e "Reconciliação" são
literalmente os nomes das telas de lá. Eu havia copiado a arquitetura de
informação junto com a stack.

Refeito a partir da pergunta que este sistema responde — *quem eu devo procurar
hoje, e por quê?*: **Radar · Carteira · Gatilhos · Confiança · Motor**. A tela de
Receita deixou de existir como destino; virou seção da Carteira, porque receita
aqui é atributo do cliente, não relatório. "Gatilhos" é a palavra do próprio
documento de especificação.

A tela **Gatilhos** existe por um motivo: fila vazia precisa ser interpretável.
Sem ela, "ninguém tem oportunidade" e "o motor está desligado" têm a mesma
aparência — e a segunda, silenciosa, é como uma automação morre sem ninguém
perceber.

**Visual.** Parte do "está feio" era bug: a página não declarava `color-scheme`,
então o Chrome aplicava auto dark mode e arruinava os contrastes. Sistema de
cores refeito sobre a paleta validada, com papéis semânticos e zero cor crua.
Verificado por captura nos dois esquemas, depois de login real.

**Troca de senha**, que não existia, foi adicionada em `/minha-conta`.

⚠ **BLOQUEIO NOVO: o vendedor responsável não é resolvível.** Ver
[perguntas-abertas.md](perguntas-abertas.md). `sellerId` existe no dado mas a API
não o resolve para um nome, e a tentativa via `/persons` foi **falso positivo** —
devolveu contatos de clientes. Isso bloqueia a fase de roteamento.

---

## 2026-08-26 — Sincronização por janela, e a descoberta de que a API não é ordenada

**Os dois achados estruturais da auditoria, atacados.** A paginação por offset
global tinha um buraco silencioso, e a consolidação de horas usava um ciclo só
para clientes com vários contratos.

**Sync por janela mensal.** Cada entidade é varrida um mês por vez, com progresso
em `SyncWindow`. Completude virou afirmação **verificável** ("todas as janelas
concluídas até o fundo") em vez de "o cursor chegou ao fim" — que é verdadeiro
mesmo tendo pulado registros. O incremental saiu de graça, e `POST /api/sync` sem
parâmetro finalmente faz algo (antes devolvia 400).

**Antes de construir, medi cada filtro de data.** A coleção Postman está errada
em quatro de oito casos: `/charges` com `createdAtFrom` devolve zero
silenciosamente; `/sales`, `/customers` e `/room/bookings` devolvem 400 com data
pura e funcionam com ISO+offset. A própria API informa o formato na mensagem de
erro: `Y-m-d\TH:i:sP`.

**⚠ O achado maior veio da própria correção: a API NÃO devolve os registros em
ordem.** Medido em `/room/bookings`: offset 0 traz um registro de 2024-12, offset
5.000 traz um de **2024-03**, offset 21.000 volta atrás em relação ao 20.000.

Eu havia descoberto o início do histórico lendo `offset: 0` e assumindo que era o
mais antigo. Não é — e a carga **pulou nove meses em silêncio**: 15.647 reservas
contra ~21.400 existentes.

Foi o desenho por janelas que tornou o buraco **visível**, ao permitir comparar o
carregado com o total sondado. O cursor global teria escondido isso para sempre.

Corrigido: a carga anda do mês corrente **para trás** até seis janelas vazias
consecutivas, sem assumir ordem nenhuma. Enquanto o fundo não é alcançado, o
total é reportado como **desconhecido** — e desconhecido nunca é completo.

**Consolidação por contrato.** Cada contrato com cota virou um bloco independente,
com o seu ciclo. Quando há mais de um, a atribuição é declarada **ambígua** (a
reserva não diz de qual balde a hora saiu) e o cliente fica fora da fila
automática, contado à parte.

**Correção verificada contra a produção.** Com a varredura para trás, o mesmo
banco saiu de **15.647** para **21.345** reservas — e esse número **bate com a
estimativa independente** obtida por busca binária de offset (~21.250–21.562).
Dois métodos diferentes concordando é o que faltava para confiar no espelho.

O fundo foi encontrado em 2023-08, após seis janelas vazias consecutivas; o dado
real começa em 2024-02.

A distribuição de status na base completa também confirma o achado da auditoria:
`partiallyPaid` **existe** (9 registros, 31,5h) e o código antigo o descartava em
silêncio.

62 testes.

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
