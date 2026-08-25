# Fase 0 — Conclusões

Executada em 2026-08-25 contra a API de produção, com token de admin, **somente leitura**
(~30 requisições, a 15 req/min). O relatório bruto fica em `fase-0-resultado.md`, que o git
ignora por poder conter dado de cliente.

**Veredito: GO.** Nenhum bloqueio de acesso. E duas regras que estavam marcadas como
"bloqueadas por dado" na verdade **não estão**.

---

## As seis provas

| # | Prova | Resultado |
|---|---|---|
| 1 | `GET /room/bookings` responde? | ✅ **200** — e o status `deductedFromQuota` aparece em dado real |
| 2 | Rate limit por token ou por conta? | ⚠️ Indício apenas: `Limit 60`, consumo observado = 1 por chamada nossa. Sem resposta definitiva — segue como pergunta à Conexa |
| 3 | `/contracts` devolve `extraFields`? | ✅ **Sim, 20/20** — mas **nenhum contrato tem o campo preenchido** |
| 4 | `sale.quantity` carrega horas? | ✅ **20/20 pares (reserva, venda) concordam** — 100% |
| 5 | `hourPlanQuota` vem preenchido? | ⚠️ 17/100 contratos ativos têm cota — **e 100% dos baldes são por grupo** |
| + | O produto "Panteão" existe? | ✅ **Existe** — ids 3380 e 3381 |

---

## O que mudou no escopo

### 🟢 Regra 8 (Panteão) — DESBLOQUEADA

O produto existe: **`productId` 3380 e 3381**, mesmo nome, R$ 15.000, `serviceCategoryId` 29,
em duas unidades (`companyId` 3 e 4). São o mesmo produto cadastrado por empresa — a escolha é
pelo `companyId` do cliente.

A afirmação anterior ("Panteão não existe em nenhum dos 217 produtos") vinha de um **export**
manual de produtos, não da API. O export estava incompleto ou desatualizado.

Resta só a ambiguidade de negócio: *"até o 6º mês"* é o aniversário ou uma janela aberta?

### 🟢 Regra 10 (Endereço Litoral) — DESBLOQUEADA, e de forma melhor do que se esperava

O bloqueio era: "o tier não é campo da API, e classificar por substring do nome viola a regra de
ouro". **A saída não é classificar por nome — é olhar a cota.**

Os planos de Endereço Fiscal declaram a cota mensal de horas em `plan.hourQuotas`:

| Tier | Horas/mês | Planos ativos |
|---|---|---|
| **Litoral** | **sem cota** (`hourQuotas: null`) | 151, 169, 200, 229 |
| Batial | 2h | 152, 168, 230 |
| Abissal | 8h | 153, 167, 231 |
| Comércio | 6h | 127, 172 |
| Black | 6h | (132, inativo) |
| Simples | 4h | (131, inativo) |

O predicado real da regra 10 é, portanto, **dado, não texto**:

> cliente com plano de Endereço Fiscal **sem cota de horas** (`hourQuotas` nulo) que **faz uma
> reserva de sala** → a reserva é faturada, porque ele não tem horas inclusas → ofertar Pacote de
> Horas ou upgrade para Batial.

E o "**Batial (2h mensais inclusas)**" do documento do cliente está **confirmado pela API**
(`quantity: 2`, `validityType: "Monthly"`). A oferta é verificável, não uma promessa de folheto.

⚠ Confirma-se também a inconsistência de catálogo já suspeitada: existem
`"Endereço Fiscal de Comércio"` e `"Endereço Fiscal De Comercio"` — mesma coisa, grafias
diferentes. Mais uma razão para **não** classificar por nome.

### 🟡 Regras 2 e 9 (saldo de horas) — o bloqueio de "grupo" era menor do que parecia

**100% das cotas são por grupo** (`groupId: 2`), nenhuma por sala específica. E os endpoints de
grupo/sala continuam não existindo — confirmado medindo: `/rooms`, `/spaces`, `/spaceGroups`,
`/roomGroups`, `/room/groups`, `/privateSpaces`, `/packages` → **todos 404**.

Só que **existe um único grupo** (`id: 2`), usado por **todos** os 24 planos com cota. E, o que
resolve de verdade: **não é preciso saber quem está no grupo**, porque o próprio Conexa marca as
reservas abatidas com `status: "deductedFromQuota"`. A pergunta "esta reserva consome a cota?" já
vem respondida no dado.

Derivando empiricamente quais salas aparecem em reservas deduzidas (300 reservas varridas): **11
salas**, todas de reunião/atendimento/auditório das unidades SEAWAY e SEBRAE. Ou seja, o grupo 2 é
"as salas reserváveis".

**Consequência:** o ADR-0005 precisa ser corrigido. Cotas por grupo **não** são irrecuperáveis
neste cenário. As três incógnitas que sobram são as de sempre — **âncora do ciclo, carry-over e
dedução parcial** — e essas continuam exigindo a reconciliação da Fase 3.

Teste da derivação num cliente real (mês corrente): concedido 6h, 0 reservas deduzidas,
**saldo derivado 6h**. O mecanismo roda; falta conferir contra a tela do Conexa.

### 🟡 Regra 4 — plano B confirmado

`sale.quantity` **carrega a duração em horas**: 20/20 pares (reserva, venda) concordam. A coleção
Postman tipa o campo como `integer` e como "quantidade de itens" — a documentação está errada, o
dado real está certo. Rebaixamento anterior revertido.

### 🔴 `extraFields` de contrato — caminho existe, mas está vazio

A API **devolve** o campo em `/contracts` (20/20). Mas **nenhum contrato tem valor preenchido**.
O caminho de desbloqueio existe tecnicamente; depende de a Seahub passar a preencher.

Como a regra 10 se resolveu pela cota, isto deixou de ser bloqueante — vira melhoria futura.

---

## O que continua em aberto

1. **O teto de 60 req/min é por token ou por conta?** A prova 2 só dá indício. Continua sendo a
   pergunta nº 1 à Conexa, e continua ditando o ADR-0002.
2. **Âncora do ciclo da cota** — dia 1, `dueDay` ou dia do mês do `startDate`?
3. **Carry-over** — horas não usadas acumulam?
4. **Dedução parcial** — reserva que excede a cota é abatida em parte e o excedente faturado?
5. **Validação do saldo derivado** contra a tela do Conexa, para ~20 clientes (portão da Fase 3).

As três primeiras não têm resposta na API — são perguntas de comportamento do produto.

---

## Efeito no roadmap

- **Fase 1 pode começar.** Não há bloqueio de acesso.
- **Fase 2 (reservas) confirmada** — o endpoint responde e traz o que precisamos.
- **Fase 3 (saldo) segue existindo**, mas com escopo menor: o que falta medir é o **ciclo**, não a
  atribuição de consumo.
- **Fase 8 encolhe**: as regras 8 e 10 saem de lá e podem entrar no fluxo normal.
