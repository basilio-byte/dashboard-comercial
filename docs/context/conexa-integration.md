# Integração com o ERP Conexa

Fonte da verdade: [`docs/API v2 Conexa.postman_collection.json`](../API%20v2%20Conexa.postman_collection.json).
**Consultar, nunca chutar campo.**

## Instância e base URL

- Instância Seahub: `https://seahubcoworking.conexa.app`
- Base da API v2: `https://seahubcoworking.conexa.app/index.php/api/v2`

## Somente leitura — garantia estrutural

O dashboard **nunca escreve no Conexa**. O API Token é de admin e tem privilégios altos; uma
escrita acidental alteraria dados reais da empresa. A garantia não é convenção, é estrutural:

- a função de fetch tem o método **fixo em `GET`** e **não expõe parâmetro `method` nem `body`** —
  não há como expressar uma escrita pelo cliente;
- todos os métodos são `get*` / `list*`;
- verificável por grep de invariante no CI.

Habilitar escrita exigiria editar deliberadamente o cliente — algo visível em revisão de código.

## Autenticação

**API Token permanente**, gerado por um admin dentro da plataforma. Enviado como
`Authorization: Bearer <token>`. Sem fluxo de login, sem expiração. Guardado como secret
(`CONEXA_API_TOKEN`), nunca no repositório.

## Limites e paginação

- **Rate limit: 60 req/min.** Headers `X-Rate-Limit-Limit/Remaining/Reset`; `429` devolve
  `{"message":"Rate limit exceeded!"}`.
  ⚠ **O teto é compartilhado com o dashboard financeiro** — ver [ADR-0002](decisions.md).
- **Paginação obrigatória:** sempre enviar `limit` (1–100) e paginar por `offset`.
- **Fim da listagem:** `pagination.hasNext === false`. O heurístico `items.length < limit` **erra**
  — gerou 685 duplicatas em 21.974 registros no projeto irmão.
- ⚠ **Paginação por offset escorrega.** Medido no irmão: 66.078 páginas → 65.894 linhas, com 184
  duplicatas e **189 registros pulados**; correr de novo escorrega em outros, não converge. A
  defesa é o **reparo determinístico por `id[]` explícito**.
- **Arrays exigem colchetes E repetição:** `customerId[]=652&customerId[]=653`. Juntar com vírgula
  devolve silenciosamente o conjunto errado.

## Endpoints usados pelo comercial

| Entidade | Lista | Item |
|---|---|---|
| Cliente | `GET /customers` | `GET /customer/:id` |
| Contrato | `GET /contracts` | `GET /contract/:id` |
| Venda | `GET /sales` | `GET /sale/:id` |
| Cobrança | `GET /charges` | `GET /charge/:id` |
| Venda recorrente | `GET /recurringSales` | `GET /recurringSale/:id` |
| **Reserva de sala** | `GET /room/bookings` | `GET /room/booking/:id` |

Dimensões (mudam pouco, cacheadas): `/plans`, `/products`, `/serviceCategories`, `/companies`,
`/persons`, `/costCenters`, `/paymentMethods`, `/receivingMethods`, `/extraFields`.

⚠ `/serviceCategories` é **plural** — no singular a API devolve 404.

## Campos confirmados

**Contrato** — `contractId`, `customerId`, `planId`, `startDate`, `endDate`, `isActive`, `amount`,
`paymentFrequency`, `dueDay`, `fidelityDate`, `contractSummary`, `costCenterId`, `salesQuantity`,
`dateSalesGeneration`, `privateSpaceId`, **`hourPlanQuota[]{quantity, spaceId, groupId}`**,
`productQuotas`, `createdAt`, `updatedAt`.
⚠ **Não** traz `companyId` na resposta, embora `/contracts` aceite o filtro.

**Plano** — `planId`, `name`, `companyId`, `serviceCategoryId`, `costCenterId`, `fidelityMonths`,
`membershipFee`, `paymentPeriodicities`, **`hourQuotas[]{id, name, spaceId, groupId, quantity,
validityType: Daily|Weekly|Monthly}`**, `productQuotas`, `privateSpaceIds`, `discountOnRooms`,
`isActive`.

**Reserva de sala** — `bookingId`, `saleId`, `customerId`, `personId`, `place{id, name}`,
**`startTime`**, **`finalTime`** (⚠ **não** `startAt`), `status`, `isActive`, `isBilled`,
`completed`, `cancellationReason`, `idRecurringBooking`, `createdAt`, `updatedAt`, `visitors`,
`settings`.
Valores de `status` incluem **`deductedFromQuota`** — o Conexa marca quais reservas foram abatidas
da cota.

**Venda** — `saleId`, `customerId`, `productId`, `product{id, name, description, companyId}`,
`contractId`, `recurringSaleId`, `quantity`, `amount`, `originalAmount`, `discountValue`,
`sellerId`, `requesterId`, `referenceDate`, `status`.
⚠ `quantity` é tipado como `integer` e documentado como "quantidade de **itens** do produto" —
**NÃO CONFIRMADO** que carregue horas fracionárias numa venda de reserva. Medir na Fase 0.

**Cliente** — `customerId`, `name`, `tradeName`, `companyId`, **`isActive`**, **`isBlocked`**,
`createdAt`, `extraFields[{id, name, value}]`, `phones`, `cellNumber`, `emailsMessage`,
`emailsFinancialMessages`, `isJuridicalPerson`, `naturalPerson{...}`, `address{...}`,
`fieldOfActivity`, `notes`.
⚠ `isActive` e `isBlocked` são o insumo do gate de elegibilidade ([ADR-0010](decisions.md)) e
**precisam virar coluna** — no espelho do irmão ficam enterrados no `raw`.

## Lacunas conhecidas

| Lacuna | Consequência |
|---|---|
| Não existe endpoint de **saldo** de horas | O saldo é derivado; ver [ADR-0005](decisions.md) |
| Não existe `/rooms`, `/spaces`, `/spaceGroups` (404 medido) | Cotas por **grupo de salas** são irrecuperáveis |
| Não existe `/packages` | Não há como ler um pacote de horas diretamente |
| **Nenhum endpoint de lista aceita filtro por `updatedAt`** | Registro alterado em janela já sincronizada nunca é re-buscado sozinho — daí o reparo por id e a re-varredura periódica |
| A API não encadeia contratos | "Primeira contratação do cliente" precisa ser derivada |
| `/products` não cobre salas/espaços | O irmão resolveu via `venda → contrato → plano → categoria` |

## Mutabilidade — cuidado com a premissa de "janela fechada"

⚠ **Uma reserva no passado NÃO é imutável.** Existe `PATCH /room/booking/:id` com `date`,
`startTime`, `finalTime` e `roomId` no corpo — a reserva pode ser **movida** de um dia para outro
depois de sincronizada (saindo de uma janela fechada e virando fantasma no banco local, ou entrando
numa janela já varrida e nunca sendo descoberta). Existe também
`PATCH /room/booking/:id/cancel`, e `status`/`isBilled`/`completed` mudam depois do dia da reserva
— inclusive a transição para `deductedFromQuota`, que é justamente o insumo do cálculo de consumo.

Consequência prática: **verificar contagem não basta**. A contagem pode bater enquanto o conteúdo
está errado. O critério de completude é o **hash do conjunto
`(bookingId, startTime, finalTime, status)`**.

## Filtros úteis

- `/room/bookings` aceita `bookingDateTimeFrom/To` **e** `createdAtFrom/To` (formato W3C) — o
  segundo captura reserva criada hoje para qualquer data.
- `/sales` aceita `dateFrom/dateTo` sobre `referenceDate`. ⚠ `createdAtFrom/To` devolve **400**
  (medido no irmão).
- `/customers` aceita `isActive` (1 ativos / 0 inativos).
