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
Authorization: Bearer $MCP_TOKEN
```

- **JSON-RPC 2.0 sobre HTTP, sem estado e sem SSE.** Cada requisição carrega
  tudo o que precisa; nenhuma sessão fica presa a uma réplica.
- **`MCP_TOKEN` vazio ⇒ 503.** A rota nasce fechada. Um deploy que esquece a
  variável não vira endpoint anônimo com escrita no banco e consumo do rate
  limit compartilhado do Conexa. É a mesma postura de `CRON_SECRET`.
- **`MCP_SOMENTE_LEITURA=on`** remove toda ferramenta de escrita de
  `tools/list` *e* recusa a chamada direta com um motivo legível.
- `GET /api/mcp` com o token devolve um cartão de visita (lista de ferramentas
  e como registrar). Sem token, 401.

O token **não é uma pessoa**. O header opcional `x-mcp-cliente` só rotula quem
chamou, para o rastro de auditoria — não autoriza nada.

## Registrar

**Claude Code (recomendado — HTTP direto):**

```bash
claude mcp add --transport http seahub-comercial \
  https://SEU-DOMINIO/api/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```

O repositório já traz `.mcp.json` com `${MCP_URL}` e `${MCP_TOKEN}` — exporte as
duas variáveis e o servidor aparece sozinho. **Nunca** escreva o token nesse
arquivo: ele é versionado.

**Clientes que só falam stdio** (Claude Desktop e alguns IDEs) usam a ponte:

```bash
MCP_URL=https://SEU-DOMINIO/api/mcp MCP_TOKEN=... node scripts/mcp-stdio.mjs
```

A ponte move bytes e nada mais. Toda decisão vive no servidor.

## As ferramentas

31 ao todo; 18 leem, 13 escrevem.

### Consulta
`estado_do_espelho` · `listar_clientes` · `opcoes_de_filtro` · `cliente` ·
`sinais_do_cliente` · `fila_de_sinais` · `receita` · `horas_do_cliente` ·
`catalogo` · `listar_contatos`

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
- **Ele escreve.** A postura deste projeto com o Conexa é somente leitura, em
  todos os caminhos.
- **Divide o mesmo rate limit** de 60 req/min, e o nosso limitador vive no
  `globalThis` do nosso processo — ele não enxerga o consumo do conector. Uma
  sessão exploratória pode matar de fome a revarredura diária.

**Onde ele vale:** diagnóstico. Como a permissão dele é a do usuário logado,
perguntar a um admin *"qual o saldo do pacote de horas do cliente X?"* decide se
`/packages` é restrição do **nosso token** (e então o pedido ao admin do Conexa
passa a ter prova) ou lacuna do produto. É o que destrava as regras 2 e 9 e o
filtro "horas disponíveis" da Carteira.

Ver `docs/context/auditoria-api-2026-08-27.md` e `decisions.md`.
