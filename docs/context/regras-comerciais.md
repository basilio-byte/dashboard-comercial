# As 10 regras de negócio

Fonte: documento "Sistema de Inteligência Comercial (Conexa + ClickUp)", de Diego.

As regras são **checagens determinísticas de data/threshold**. Não dependem de IA para decidir —
a IA, se usada, entra só para redigir o texto da abordagem.

## Status de viabilidade

| Marca | Significado |
|---|---|
| ✅ **VIÁVEL** | Os dados existem e a regra está definida o bastante para virar código |
| ⚠️ **RESSALVA** | Depende de resposta do cliente ou de uma reconciliação que pode reprovar |
| ⛔ **BLOQUEADA POR DADO** | O dado não existe na API. Não é atraso — é impossibilidade com o que temos hoje |
| ❓ **PRECISA DEFINIÇÃO** | A regra não está definida o bastante para virar código |

## Resumo

| # | Regra | Família | Status |
|---|---|---|---|
| 1 | Fiscal 11 meses → plano Bianual | `MARCO_CONTRATO` | ⚠️ |
| 2 | Pacote de horas acabando | `SALDO_COTA` | ⚠️ |
| 3 | Padrão de compra irregular | `TENDENCIA` | ❓ |
| 4 | Avulso com uso alto (>5h) | `USO_SEM_COTA` | ✅ |
| 5 | Primeira reserva → Endereço Fiscal + SeaBox | `PRIMEIRO_EVENTO` | ⚠️ |
| 6 | Privativa 1 mês → Registro de Marca | `MARCO_CONTRATO` | ⚠️ |
| 7 | Privativa 2 meses → SeaBox | `MARCO_CONTRATO` | ⚠️ |
| 8 | Privativa até 6 meses → Panteão | `MARCO_CONTRATO` | ⛔ |
| 9 | Pacote < 5h → novo pacote | `SALDO_COTA` | ⚠️ |
| 10 | Endereço Litoral + reserva → Pacote ou Batial | `EVENTO_EM_SEGMENTO` | ⛔ |
| 11 | *(bônus)* Queda de receita ≥ X% | `TENDENCIA` | ⚠️ |

**As 10 regras colapsam em 6 famílias.** Manter 10 arquivos significaria 10 lugares para corrigir
o mesmo bug de aritmética de datas. Ver [ADR-0007](decisions.md).

---

## Detalhamento

### 1 — Fiscal 11 meses → oferecer plano Bianual · `MARCO_CONTRATO` · ⚠️

**Entrada.** `/contracts` → `contractId, customerId, planId, startDate, endDate, isActive,
paymentFrequency, fidelityDate, amount` · `/plans` → `serviceCategoryId` · `/serviceCategories` →
`name` · `/customers` → `isActive, isBlocked`

**Fórmula.** Classificação **sem chute por nome**, via `contrato → plano → categoria de serviço`:

```
segmento(c) ∈ Fiscal ∧ elegível(cliente) ∧ c.paymentFrequency ∈ params.periodicidades
∧ aniv = addMonthsClamp(c[params.ancora], 11)
∧ aniv ≤ hoje ≤ aniv + params.toleranciaDias
∧ ¬jáPossui(params.naoOfertarSePossui)
```

**Ciclo.** `contract:{id}:m11` — o marco é do **contrato**, não do cliente: renovação gera
contrato novo e novo marco.

**Ressalvas.**
- O relógio começa em `startDate` ou em `fidelityDate`? Os dois existem e **divergem nos dados
  reais**.
- Cliente que já renovou: conta do contrato atual ou da primeira contratação? A API **não encadeia
  contratos**.
- **Só existem 2 produtos "Bianual" no catálogo, ambos SEATECH.** Não há Bianual para
  Simples/Black/Comércio — a oferta pode não existir para o tier do cliente.
- `paymentFrequency` é periodicidade de **pagamento**, não de vigência: um plano anual pode ser
  cobrado mensalmente.

---

### 2 e 9 — Saldo de pacote de horas · `SALDO_COTA` · ⚠️

São **a mesma mecânica com limiares diferentes** (a regra 9 é caso particular da 2, com limiar
absoluto de 5h). Precisa confirmar com o cliente se são realmente duas regras.

**Entrada.** `/contracts` → `hourPlanQuota[]{quantity, spaceId, groupId}` · `/plans` →
`hourQuotas[]{id, quantity, validityType, spaceId, groupId}` · `/recurringSales` → `packageId,
quantity, frequency` · `/room/bookings` → `startTime, finalTime, status, place.id, isActive,
cancellationReason`

**Fórmula.**

```
concedido = hourPlanQuota ?? plan.hourQuotas ?? cadastro manual     (precedência do ADR-0005)
consumido = Σ (finalTime − startTime) onde status == 'deductedFromQuota'
                                        ∧ mesmo balde ∧ mesmo ciclo
                                        ∧ isActive ∧ ¬cancelada
saldo     = concedido − consumido
dispara se saldo/concedido ≤ params.limiar ∧ diasRestantes ≥ params.minDias
```

**Ciclo.** `quota:{balanceId}:{cycleKey}` — a cota renova por ciclo, e há cotas diárias.

**Ressalvas.** Dependem inteiramente do portão de reconciliação do [ADR-0005](decisions.md). A
âncora do ciclo, o carry-over e a dedução parcial são **NÃO CONFIRMADOS**. Cotas por `groupId` são
**⛔ bloqueadas** — não existe endpoint que liste os membros de um grupo de salas.

---

### 3 — Padrão de compra irregular · `TENDENCIA` · ❓

**Fórmula proposta.** Série dos 3 últimos **meses fechados**; dispara se estritamente decrescente
e a queda passar do limiar.

**Por que está bloqueada por definição:** "irregular" não tem definição numérica. Quantos meses?
Qual queda? E o exemplo do documento ("comprou 20h em jun, 10h em jul, nada em ago") é ambíguo
entre **compra** e **consumo** — são coisas diferentes e vêm de endpoints diferentes.

⚠ Agrava: **não há como identificar com segurança uma venda de pacote de horas em `/sales`.** Os
pacotes reais são `recurringSale.packageId`, e não está documentado qual `productId` o Conexa
grava na venda gerada.

---

### 4 — Avulso com uso alto (>5h) · `USO_SEM_COTA` · ✅

**A mais sólida das dez, e a única que não depende de saldo.**

**Entrada.** `/room/bookings` → duração e status · `/contracts` → `hourPlanQuota` vazio ·
`/recurringSales` → sem `packageId` · `/sales` → `amount, quantity` (preço efetivo)

**Fórmula.**

```
semCota(cliente) ∧ horasAvulsas(mês fechado) > params.minHoras
precoHoraEfetivo = Σ sale.amount / Σ horas      (já vem com desconto aplicado)
economia         = gastoAvulso − precoPacote
```

**Ressalva.** O **gatilho** é sólido. A **economia** depende de uma tabela de preços de pacote que
é cadastro manual. Sem ela, a task sai com a lacuna declarada e **sem número de economia** — nunca
com número estimado.

---

### 5 — Primeira reserva → Endereço Fiscal + SeaBox · `PRIMEIRO_EVENTO` · ⚠️

**Entrada.** `/room/bookings` (**backfill completo obrigatório**) · `/contracts` + `/plans` +
`/serviceCategories`, para não ofertar o que o cliente já tem

**Ciclo.** `customer:{id}:primeira-reserva`, guardando o `bookingId` na evidência — se uma reserva
anterior aparecer depois no espelho, o sistema **registra correção**, não redispara.

**⚠ Risco alto de disparo em massa.** Sem backfill total, **todo cliente antigo parece estreante**
— milhares de tasks de uma vez. A data de corte do backfill é parâmetro **obrigatório** da
família, e o backfill precisa ter selo de completude antes de a regra sair de sombra
(ver [ADR-0011](decisions.md)).

---

### 6, 7 e 8 — Marcos de sala privativa · `MARCO_CONTRATO`

Mesma família, três marcos: **1 mês** → Registro de Marca; **2 meses** → SeaBox; **6 meses** →
Panteão.

**Ressalvas comuns.** Identificar "sala privativa" por `privateSpaceId` ou pela categoria do
plano? **A estação de coworking conta?** (a categoria "Salas Privativas - Seaway Center" inclui
"Estação 01 - Coworking L21"). O relógio começa em `startDate` ou em `dateSalesGeneration`?

**Regra 7 — problema específico.** "Benefício" sugere **cortesia**, não venda. Se o SeaBox é dado
de graça e não vira venda nem contrato no Conexa, **o sistema nunca saberá que o cliente já
recebeu** e vai reofertar. Ou passa a ser registrado, ou o histórico de disparo vira a fonte e a
regra é de disparo único por cliente ([ADR-0010](decisions.md)).

**Regra 8 — ⛔ BLOQUEADA POR DADO.** "Panteão" **não existe** em nenhum dos 217 produtos exportados
do Conexa. Sem o produto cadastrado, não dá para confirmar que a oferta existe, verificar se o
cliente já a tem, nem precificá-la. **Desbloqueio:** cadastrar o produto e informar o `productId`.
Some-se a ambiguidade "**até** o 6º mês" — é o aniversário ou uma janela aberta? Se for janela, não
é gatilho e precisa de um evento âncora.

---

### 10 — Endereço Litoral + reserva → Pacote de Horas ou upgrade Batial · ⛔ BLOQUEADA POR DADO

**O tier do Endereço Fiscal não é campo da API.** Simples, Litoral, Batial, Abissal, Black e
Comércio caem **todos** em `serviceCategory = "Endereço Fiscal - RN"`. O tier só existe dentro de
`plan.name`, e classificar por substring viola a regra de ouro do projeto — são 29 produtos de
Endereço Fiscal, em 3 prefixos e 5 periodicidades; um regex ingênuo produz falso positivo **e**
falso negativo.

**Desbloqueio.** Um mapa `planId → tier` homologado por escrito, versionado com procedência; ou a
Seahub preencher um extraField de contrato com o tipo.
⚠ **NÃO CONFIRMADO que `GET /contracts` devolva `extraFields`** — nos 6 exemplos de resposta da
coleção o campo não aparece. Confirmar antes de propor essa via como solução.

---

### 11 — *(bônus)* Queda de receita ≥ X% · `TENDENCIA` · ⚠️

Não é uma das 10 regras — é a métrica "alerta se cair X% de um mês para outro" do documento,
implementada como regra.

Só sobre **meses fechados**, e só quando o mês anterior é maior que zero. Mês anterior igual a
zero **não é queda de 100%**: é "sem base de comparação". Falta definir o X.

---

## Sobreposições que precisam de política, não de gambiarra

- **2 e 9** são a mesma mecânica → dedupe por oferta + cliente + ciclo.
- **6, 7 e 8** disparam para o mesmo contrato em 1, 2 e 6 meses → um cliente de privativa recebe
  **3 ofertas em 6 meses**. Precisa de teto de contatos por cliente/mês e cooldown por regra, com
  o número decidido pelo cliente, não pelo desenvolvedor.
- **5 e 7** podem ofertar SeaBox ao mesmo cliente no mesmo mês → dedupe por oferta.
- O **relatório de sobreposição** do backtest existe exatamente para tornar isso visível **antes**
  de ligar a regra.

## O que vale para todas

Nenhuma regra dispara sem passar pelo **gate de elegibilidade** (cliente ativo, não bloqueado,
contrato vigente, sem inadimplência dura) e pelas **supressões** ("já possui", "já recusou") —
ver [ADR-0010](decisions.md). E nenhuma roda sobre dado velho ou incompleto —
[ADR-0011](decisions.md).
