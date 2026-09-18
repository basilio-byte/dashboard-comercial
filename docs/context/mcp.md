# MCP do Dashboard Comercial

Servidor MCP (Model Context Protocol) que expõe o painel a clientes de IA —
Claude Code, Claude Desktop, e qualquer outro que fale o protocolo. Serve para
consultar, operar e **editar** a plataforma de dentro de uma conversa.

> ⚠ **Não confundir com o MCP do Conexa.** Em 2026-09 o Conexa lançou um
> conector próprio (`Configurações > Integrações > MCP`), que autentica por
> **OAuth com o login da pessoa** e dá acesso ao ERP. São coisas diferentes e
> complementares — ver *"O MCP do Conexa"*, no fim deste documento.

---

## Endereço e autenticação

```
POST /api/mcp
Authorization: Bearer <token>
```

**Dois tipos de token, desde 2026-09-18:**

| | Token pessoal (`shc_…`) | Token master (`MCP_TOKEN`) |
|---|---|---|
| Onde nasce | **Minha conta → Tokens do MCP** | variável de ambiente |
| Quem aparece no rastro | `diego@… via MCP (nome do token)` | `mcp:master` |
| Escopo | somente leitura **ou** leitura e escrita | total |
| Revogação | um a um, pelo dono ou por um admin | trocar a variável |
| Para quem | o time | desenvolvimento |

O token pessoal é mostrado **uma vez**. O banco guarda só o SHA-256 — nem ele
sabe qual é o token. Perdeu? Revogue e crie outro.

A pessoa é conferida **a cada chamada**: usuário desativado derruba os tokens
dele na hora, e quem vira VIEWER perde a escrita pelo MCP no mesmo instante,
mesmo com token criado como escrita. Nenhuma ferramenta do MCP cria token: um
token vazado não pode emitir outros.

- **JSON-RPC 2.0 sobre HTTP, sem estado e sem SSE.** Cada requisição carrega
  tudo o que precisa; nenhuma sessão fica presa a uma réplica.
- **Sem master e sem token pessoal ativo ⇒ 503.** A rota nasce fechada. Um
  deploy que esquece a variável não vira endpoint anônimo com escrita no banco
  e consumo do rate limit compartilhado do Conexa.
- **`MCP_SOMENTE_LEITURA=on`** remove toda ferramenta de escrita de
  `tools/list` *e* recusa a chamada direta com um motivo legível.
- `GET /api/mcp` com o token devolve um cartão de visita (lista de ferramentas
  e como registrar). Sem token, 401.

O header opcional `x-mcp-cliente` só rotula DE ONDE veio a chamada ("claude-code",
"claude-desktop") — não autoriza nada. Quem autoriza é o token, e o token
pessoal é que diz quem é a pessoa.

## Registrar

Produção: **`https://seahub-dashboard-comercial.rockwe.easypanel.host/api/mcp`**
(domínio padrão do Easypanel, com certificado Let's Encrypt válido).

> ⚠ O domínio próprio, `comercial.seahubcoworking.com.br`, servia em 2026-09-18
> o certificado padrão do Easypanel (`CN=Easypanel`, autoassinado). O Claude
> Code valida TLS e **recusa conectar** — use o domínio do Easypanel até o
> certificado ser reemitido. Nunca contorne com `NODE_TLS_REJECT_UNAUTHORIZED=0`:
> isso desliga a validação TLS do cliente inteiro e manda o token por conexão
> interceptável.

Cada pessoa registra com o **próprio** token, no escopo `local` — o token fica no
`~/.claude.json` dela, fora do repositório. A tela **Minha conta** mostra o
comando já montado, com o token, no momento da criação:

```bash
claude mcp add --transport http --scope local seahub-comercial \
  https://seahub-dashboard-comercial.rockwe.easypanel.host/api/mcp \
  --header "Authorization: Bearer $MCP_TOKEN" --header "x-mcp-cliente: claude-code"
```

**No Windows, com a extensão do VS Code**, o `claude` costuma não estar no PATH —
o executável vem dentro da extensão. E o token é pedido sem eco, para não ir
para o histórico do terminal:

```powershell
$claude = (Get-ChildItem "$env:USERPROFILE\.vscode\extensions\anthropic.claude-code-*\resources\native-binary\claude.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
$seguro = Read-Host "MCP_TOKEN" -AsSecureString
$token  = (New-Object System.Management.Automation.PSCredential "mcp", $seguro).GetNetworkCredential().Password
& $claude mcp add --transport http --scope local seahub-comercial https://seahub-dashboard-comercial.rockwe.easypanel.host/api/mcp --header "Authorization: Bearer $token" --header "x-mcp-cliente: claude-code"
Remove-Variable seguro, token
& $claude mcp list
```

> ⚠ **Armadilha medida em 2026-09-18 — a letra do drive.** O escopo `local` é
> gravado por caminho da pasta, com a caixa da letra do drive como veio. O
> PowerShell reporta `C:/...`; a extensão abre o workspace como `c:/...`. São
> duas chaves diferentes no `~/.claude.json`: o registro feito no terminal fica
> invisível à extensão. Sintoma: `mcp list` no terminal mostra ✔ Connected e a
> sessão da extensão não enxerga as ferramentas. Correção: a entrada precisa
> existir sob as duas grafias, ou registrar com `--scope user`.

> O repositório **não** traz `.mcp.json`. Ele existiu por dois dias, com
> `${MCP_URL:-http://localhost:7000/api/mcp}`: quem não tinha `MCP_URL` definido
> caía em `localhost`, recebia `ConnectionRefused` e não sabia por quê — e ele
> ainda conflitava com o registro `local` de quem fazia do jeito certo.

**Clientes que só falam stdio** (Claude Desktop e alguns IDEs) usam a ponte:

```bash
MCP_URL=https://seahub-dashboard-comercial.rockwe.easypanel.host/api/mcp MCP_TOKEN=... node scripts/mcp-stdio.mjs
```

A ponte move bytes e nada mais. Toda decisão vive no servidor.

## As ferramentas

32 ao todo; 19 leem, 13 escrevem.

### Consulta
`estado_do_espelho` · `listar_clientes` · `opcoes_de_filtro` · `cliente` ·
`sinais_do_cliente` · `fila_de_sinais` · `receita` · `horas_do_cliente` ·
`catalogo` · `listar_contatos` · `conferir_consistencia`

`conferir_consistencia` compara o Radar com a ficha de cada cliente da fila, e
sorteia clientes fora dela. É a forma de saber que as duas leituras da mesma
regra dizem a mesma coisa — ver ADR-0013.

### Configuração (as três coisas editáveis)
`gatilhos_listar` · `gatilho_atualizar` · `gatilho_criar` · `gatilho_remover` ·
`gatilho_restaurar` · `agentes_listar` · `agente_criar` · `agente_atualizar` ·
`agente_remover` · `categorias_listar` · `categoria_classificar` ·
`categoria_limpar_classificacao` · `mudancas_de_config`

### Operação e desenvolvimento
`sincronizar` · `reconciliar_mes` · `registrar_contato` · `conexa_get` ·
`consulta_sql` · `esquema_do_banco` · `diagnostico` · `anotar`

## Decisões que não convém desfazer

**O protocolo é escrito à mão.** O SDK oficial traz um transporte que quer o
`http.ServerResponse` do Node; o App Router do Next 15 entrega `Request`/
`Response` da Web. Encaixar os dois exige um adaptador — uma dependência a mais
no caminho do build do Docker, que é o que publica este projeto. Um servidor MCP
sem estado é um `switch` sobre seis métodos; o adaptador custaria mais que o
switch. As camadas puras (`protocolo.ts`, `esquema.ts`) têm 22 testes.

**O `inputSchema` é derivado do zod, não escrito ao lado dele.**
`src/lib/mcp/esquema.ts` converte o esquema de validação em JSON Schema. Escrever
os dois à mão é garantia de divergirem na terceira edição — e um esquema errado
num MCP não dá erro de compilação, dá chamada malformada meses depois. O
conversor **lança** no tipo que não cobre, em vez de devolver `{}`: uma
ferramenta que anuncia "aceito qualquer coisa" recebe qualquer coisa.

**Erro de ferramenta volta como resultado com `isError`, não como erro
JSON-RPC.** Erro de protocolo o cliente esconde do modelo, e o modelo repete a
mesma chamada errada para sempre. Como resultado, ele lê o que faltou e corrige.

**`Decimal` vira string na serialização.** `JSON.stringify(new Decimal("1234.56"))`
devolve `{"s":1,"e":3,"d":[...]}`. Dinheiro virando isso é como um número errado
chega a um relatório.

**`consulta_sql` roda numa transação `READ ONLY` do Postgres.** O filtro de
expressão regular (`^select|with`) é conveniência; a garantia é a transação —
verificado: `nextval()` devolve `25006: cannot execute nextval() in a read-only
transaction`. Confiar só em regex contra SQL é a aposta que se perde.

**Toda escrita grava em `mudancas_de_config` com `origem: "MCP"`.** Quando um
agente e uma pessoa mexem na mesma configuração, *"quem desligou a regra 8?"*
precisa ter resposta — e "foi um agente" é uma resposta diferente de "foi o
Diego".

**As instruções do `initialize` carregam as regras de ouro do projeto.** É o
único texto que o cliente lê sem ser perguntado. Um agente que não sabe que o
saldo de horas é uma lacuna conhecida vai tentar calculá-lo de três jeitos
errados e apresentar um número.

## O MCP do Conexa

O conector oficial do Conexa (OAuth, permissão em cascata do usuário logado)
**não substitui e não deve alimentar este painel**:

- **OAuth é por pessoa e interativo.** O agendador roda de madrugada sem
  ninguém logado, e token preso a uma pessoa morre quando a pessoa sai.
- **Não tem selo de completude.** Todo o ADR-0011 se apoia em "nada derivado
  vira fato sem a fonte estar completa"; uma resposta de chat não prova que
  trouxe tudo.
- **Ele escreve — e apaga.** O catálogo dele tem `delete_customer`,
  `settle_charge`, `create_contract` e dezenas de outras. A postura deste
  projeto com o Conexa é somente leitura, em todos os caminhos.
- **Divide o mesmo teto de 60 req/min** — o próprio conector diz isso nas
  descrições —, e o nosso limitador vive no `globalThis` do nosso processo: não
  enxerga o consumo do conector.

### ⚠ Medido em 2026-09-18: ele não alcança o pacote de horas

A hipótese era que a permissão do usuário logado mostraria o que o nosso token
não mostra. Com OAuth de permissão total, `get_recurring_sale` devolve
`Pacote de horas ID: 34` e **nenhuma hora**, e o catálogo do conector **não tem
ferramenta de pacote nem de vendedor**. A pergunta sobre o saldo muda de
destino: não é "liberem `/packages` para o nosso token" (admin), é **"a API
expõe as horas incluídas e o consumo de um pacote?"** (suporte do Conexa).

### Onde ele vale

**Conferir hipótese contra a fonte, com poucas chamadas de leitura.** Foi o que
validou a correção das regras 4 e 10 em 2026-09-18: dos cinco clientes com
reserva abatida da cota, três tinham pacote em venda recorrente e **dois não** —
a cota deles vem de outra via. O status `deductedFromQuota` pega os cinco; uma
sincronização de `recurringSales` pegaria três. Uma chamada ao conector decidiu
qual das duas evidências usar.

Ver `docs/context/auditoria-api-2026-08-27.md` e `decisions.md`.

## Correções de 2026-09-18 (noite)

- **`conexa_get` descartava o `query`** desde que foi criada: todo filtro era
  ignorado e a resposta eram as 20 primeiras linhas da base. Conclusão tirada
  com ela antes desta data, com filtro, não vale.
- **`sincronizar`** aceita `mesesParaTras` no modo incremental: revarre N meses
  e, de quebra, remove do espelho o que foi apagado no Conexa (ADR-0015).
