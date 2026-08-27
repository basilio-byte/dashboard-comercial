# Auditoria da API Conexa v2 — 2026-08-27

Tudo abaixo foi **medido contra a API de produção**, não lido em documentação.
Os scripts que produziram cada número estão em `scripts/prova-*.mjs` e podem ser
rodados de novo (`node --env-file=.env scripts/prova-api-cobertura.mjs --stress`).
As saídas ficam fora do git — carregam id e nome de cliente real.

Todos os três scripts são **somente leitura**: `pedir()` tem o método fixo em
`GET` e não expõe `method` nem `body`, igual ao cliente da aplicação.

---

## 1. O que o nosso token alcança

18 recursos testados. **10 respondem 200, 8 respondem 404.**

| alcançável | 404 (permissão) |
| --- | --- |
| `customers`, `contracts`, `charges`, `sales`, `room/bookings`, `companies`, `serviceCategories`, `plans`, `products`, `recurringSales` | `rooms`, `spaces`, `packages`, `hourPackages`, `customerHours`, `sellers`, `users`, `invoices` |

⚠ **404 aqui não quer dizer "não existe"** — quer dizer "não liberado para este
token". O Conexa responde 404 por permissão, foi assim que já tínhamos descoberto
que salas e espaços somem de `/products`.

Três desses 404 têm consequência direta em regra de negócio — ver a seção 5.

## 2. Ritmo: o teto de 60 req/min é real

Uma rajada curta (40 requisições em 11,9s, **zero 429**) sugeriu que o teto era
muito maior. **Era leitura errada**: 40 requisições não chegam a 60, então o
teste não podia encontrar o limite.

Rajada sustentada de 220 requisições:

- corte na requisição **#58**, com `x-rate-limit-reset: 11`
- 104 respostas 429 no total
- **116 sucessos em 44,9s** ≈ dois ciclos de ~60

Ou seja: **~60 requisições por janela de 60s**, exatamente o que o ADR-0002 já
dizia. A API **não devolve** `x-ratelimit-limit` nem `x-ratelimit-remaining` em
resposta normal — só `x-rate-limit-reset`, e só no 429.

> Consequência: `ultimoRateLimitObservado()` e o freio preventivo
> (`MARGEM_DE_FREIO`) leem cabeçalhos que **nunca chegam**. O freio nunca
> engata. Não é urgente — o limitador de taxa já segura o ritmo — mas é código
> que finge proteger e não protege.

## 3. Duas armadilhas de serialização de query

Ambas **falham alto** (400), o que é uma sorte:

| erro | resposta da API |
| --- | --- |
| `isActive=true` | `400` — `"Is Active must be either 1 or 0"` |
| `planId=1&planId=2` (sem colchete) | `400` — `"planId field must be array"` |
| `createdAtFrom=2023-01-01` (sem hora) | `400` — exige ISO com offset |

O tipo `QueryValue` do nosso cliente **aceitava boolean** e o serializava como
`String(true)` — um convite ao 400 que o retry não cobre (só 429 e 5xx). Corrigido
em `buildUrl`, com teste (`src/lib/conexa/client.test.ts`).

A armadilha do colchete já estava documentada no cliente — e a primeira versão da
minha própria sonda pisou nela mesmo assim, leu o 400 como "0 contratos" e quase
me fez concluir que o defeito estava no espelho.

## 4. O defeito que a auditoria encontrou: deriva de estado

**Este é o achado grave.** A carga recorta por `createdAt` e o incremental
revisitava **apenas a janela corrente** das entidades imutáveis. Mas "imutável"
descrevia só o fato de o registro não *migrar* de janela — nunca o de não *mudar*.

Amostra de 100 registros criados no 1º semestre de 2024, comparando `createdAt`
com `updatedAt`:

| entidade | alterados depois | p50 | p90 | máx | além de 90d |
| --- | --- | --- | --- | --- | --- |
| `sales` | **77%** | 28d | 120d | 356d | **22%** |
| `room/bookings` | 53% | 4d | 15d | 86d | 0% |
| `customers` | — | — | — | — | **não expõe `updatedAt`** |

Exemplos reais de reserva antiga alterada depois: `#90` criada 2024-02-26,
alterada 2024-03-14, `status: cancelled`.

Consequência: uma venda criada em junho e cancelada em agosto **nunca mais era
lida**. O espelho guardava o estado do dia da carga, para sempre, sem erro em
lugar nenhum. Mais de um quinto das vendas cai nesse caso.

E **não dá para perguntar "o que mudou"**: nenhuma das 43 rotas GET aceita
`updatedAtFrom`. Só revarrer.

**Correção aplicada:** `mesesDeRevisita` por entidade (12 para `sales`, 3 para
`bookings`, 6 para `customers`) e uma tarefa diária de **revarredura profunda**,
separada do incremental de 30 min. Custo estimado ~450 requisições (~8 min).
Diária, não semi-horária, porque o fato perseguido tem mediana de 28 dias.

⚠ `customers` é o caso desconfortável: a deriva dele é **não observável** pela
API — nem filtro, nem campo. E é justamente o cadastro que carrega
`isActive`/`isBlocked`, o portão de elegibilidade de toda regra. Os 6 meses são
postura de risco, não medição.

## 5. As horas: hipótese fechada, e um limite intransponível

`abatido > concedido` — o ERP descontou mais horas do que a cota que conhecemos.
`abatido` vem do próprio Conexa (`status: "deductedFromQuota"`), então quem está
errado é a **nossa** concessão.

Três hipóteses morreram contra dado:

1. ~~a cota vem do plano, não do contrato~~ — corrigido, o defeito sobreviveu;
2. ~~`validityType` diferente de `Monthly` é descartado em silêncio~~ — medido:
   os 24 planos com cota usam `Monthly`, os 24;
3. ~~o produto do pacote declara as horas~~ — `/products` não tem campo de
   quantidade nenhum (13 campos, nenhum deles).

A quarta se sustentou. Medindo **no ciclo de aniversário de cada contrato** (a
medição anterior usava 60 dias contra cota mensal e inflava todo mundo):

| | tem pacote recorrente | sem pacote |
| --- | --- | --- |
| **abatido > concedido** | **4** | **0** |
| conta fecha | 117 | 1 |

**Nenhum cliente estoura a cota sem ter pacote recorrente.** A hora desconhecida
vem de `recurringSales.packageId` — 358 das 383 assinaturas ativas são pacote,
só 25 são produto.

**E o conteúdo do pacote é inalcançável:** `/packages`, `/package/:id` e
`/hourPackages` respondem 404. Não existe caminho pela API para saber quantas
horas o pacote 43 concede.

> **Portanto: o saldo de horas não é calculável com o token atual.** Não é
> lacuna de código. O sistema já se comporta certo — `cotaInconsistente`
> suprime o gatilho de estouro nesses clientes em vez de ofertar em cima de
> conta errada. A escala é pequena (4 de 122, resíduos de 1h a 2,5h), mas o
> limite é estrutural.

## 6. Pedidos ao admin do Conexa

Três liberações de token, em ordem de impacto:

1. **`/packages`** — destrava o saldo de horas (regras 2 e 9). Hoje o cálculo é
   suprimido por honestidade.
2. **salas e espaços em `/products`** — 288 produtos aparecem em vendas e não
   estão no catálogo. Toda regra que depende de `productId` falha em silêncio
   nesses.
3. **`/sellers`** — confirma por que o vendedor responsável nunca foi resolvível:
   o recurso existe e não é liberado.

## 7. Campos que a API devolve e nós ainda não lemos

| campo | onde | por que interessa |
| --- | --- | --- |
| `productQuotas` | `plans` **e** `contracts` | cota de produto (ex.: "100 Impressões"); 6 planos usam |
| `serviceCorrespondenceQuotas` | `plans` e `contracts` | cota de correspondência |
| `bookingModels` | `plans` e `contracts` | como a reserva é cobrada |
| `privateSpaceId` | `contracts` | qual sala privativa — as regras 6/7/8 casam por nome de categoria hoje |
| `tagsId` / `tagId[]` | `customers` (campo e filtro) | segmentação já existente no ERP |
| `recurringSaleId` | `sales` | liga venda à assinatura que a gerou |
| `dateSalesGeneration` | `contracts` | alternativa a `startDate` para os marcos — ver `perguntas-abertas.md` |

Nenhum é bloqueio hoje. `tagsId` é o mais promissor: pode ser segmentação que a
Seahub já mantém e que estamos reinventando por casamento de string.

---

## O que mudou no código por causa desta auditoria

- `buildUrl`: boolean → `1`/`0`, com teste
- `DefinicaoEntidade.mesesDeRevisita`: profundidade medida por entidade
- `janelasIncrementais(..., profundidade)`: rasa (30 min) e profunda (diária)
- `sincronizarIncremental({ profundidade })` e o modo `revisita` no `SyncRun`
- tarefa "revarredura profunda" no agendador, 24h, com válvula de 30 min
- `cotasBrutasDoCliente()` em `validar-horas.ts`: diagnóstico da cota crua
