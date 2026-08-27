# Perguntas abertas

> 🔴 **BLOQUEIO NOVO (2026-08-26): quem é o vendedor responsável?**
>
> "O vendedor certo" está na definição do produto — é para ele que a task vai — e
> é a peça **sem solução** hoje.
>
> **O que existe:** `contract.sellerId` e `sale.sellerId`, preenchidos em 814 de
> 909 contratos, com 7 valores distintos (1, 30, 34, 35, 2745, 2758, 2930).
>
> **O que não existe:** endpoint que resolva esse id para um nome. Não há
> `/sellers`, `/users` nem `/employees` na API v2.
>
> ⚠ **Falso positivo registrado:** consultar `/persons?id[]=...` com esses ids
> devolve sete nomes e **parece** confirmação. Não é — os registros têm
> `customerId` preenchido e `isIndividualCustomer: true`, ou seja, são **contatos
> de clientes**, não funcionários. O id casou por coincidência de faixa. Quem
> pegou o erro foi o dono do projeto, ao não reconhecer os nomes.
>
> **Duas perguntas, nesta ordem:**
>
> 1. **De onde vem o responsável ATUAL?** O documento de especificação diz que o
>    ClickUp guarda "vendedor responsável" no CRM — essa é a fonte mais provável.
>    ⚠ Mesmo resolvendo os nomes, `sellerId` é o vendedor **da época do
>    contrato**: rotear por ele manda o sinal para quem fechou a venda há três
>    anos, não para quem atende o cliente hoje.
> 2. **Quem são os vendedores atuais**, nome a nome, e qual o `user_id` de cada
>    um no ClickUp?
>
> Enquanto isso não estiver resolvido, a fila é **lida na tela**, sem roteamento
> automático. Rotear errado é pior que não rotear: cria trabalho para quem não é
> dono da conta e queima a confiança do time na estreia.


Cada pergunta está marcada com a fase que ela **bloqueia**. Pergunta sem resposta trava a fase.

> ✅ **Respondido em 2026-08-26 pelo responsável da Seahub** — as três incógnitas do ciclo da cota,
> que bloqueavam a Fase 3 (perguntas 4, 5 e as correlatas):
>
> - **Ciclo:** 30 dias ancorados na **data de contratação**, não no mês-calendário. Exemplo dado:
>   contratou 26/08 → vale até 25/09 → novo pacote em 26/09.
>   ⚠ Esse exemplo descreve um **aniversário mensal** (dia 26 de cada mês), não 30 dias exatos; as
>   duas coisas divergem ao longo do ano. Adotado o aniversário do dia do mês, com clamp para meses
>   curtos (dia 31 → último dia de fevereiro).
> - **Carry-over:** **não existe**. As horas expiram ao fim do ciclo, usadas ou não.
> - **Excedente:** dedução parcial **e** cobrança. 5h de cota com 7h de uso = 5h abatidas + 2h
>   faturadas.
>
> **Mudança de ênfase, e ela reordena o trabalho:** o que mais importa é medir que o cliente **tem**
> as horas e se ele **usa mais do que o plano oferece**. O sinal forte é o **excedente recorrente**,
> não o saldo instantâneo — e o excedente é observável mesmo sem acertar o saldo ao minuto, porque a
> dedução parcial deixa rastro na cobrança do excedente.
>
> **Escopo novo:** acompanhar também quem **compra pacote de horas fora do EV** — compra avulsa, sem
> plano de Endereço Fiscal atrelado.

---

## 🔴 Bloqueiam a Fase 0 — acesso, credenciais, infraestrutura

### Para a Conexa (suporte)

1. **O limite de 60 req/min é por API key ou por conta?** Se for por key, um segundo token elimina
   o problema arquitetural inteiro ([ADR-0002](decisions.md)) e o dashboard financeiro volta ao
   teto cheio.
2. **O token da Seahub tem permissão liberada para `GET /room/bookings`?** A coleção documenta o
   bloqueio por padrão (*"only available for authorized customers"*). **É a pergunta que decide o
   escopo de 6 das 10 regras.** Se não tem, como solicitar e qual o prazo?
3. **`GET /contract/:id` e `GET /contracts` retornam os `extraFields` do tipo `contract`?** Nos 6
   exemplos de resposta da coleção o campo não aparece. É o que decide se a regra 10 tem caminho
   de desbloqueio.
4. Quando uma reserva **excede** a cota, o sistema **deduz parcialmente e fatura o excedente**, ou
   fatura tudo?
5. O ciclo de uma cota mensal reseta no **dia 1**, no **`dueDay` do contrato** ou no **dia do mês
   do `startDate`**? Errar move o saldo em até um ciclo inteiro.
6. Horas não usadas **acumulam** para o ciclo seguinte? Por quantos ciclos?
7. O campo `quantity` de uma venda originada de reserva carrega a **duração em horas
   fracionárias**, apesar de documentado como `integer` e como "quantidade de itens"?
8. `recurringSale.packageId` é o **mesmo identificador** de `plan.hourQuotas[].id`? Existe algum
   endpoint para ler um pacote de horas? (Não há `/packages` nas rotas da coleção.)

### Para o Diego

9. Podemos emitir um **`api_key` do Conexa dedicado** ao comercial, separado do financeiro?
   (Revogável isoladamente, independentemente da resposta da Q1.)
10. Posso **baixar o teto do dashboard financeiro de 60 para 40** e redeployá-lo? É mudança de
    variável de ambiente, zero código.
11. Há recursos no Easypanel para um **serviço Postgres novo**, ou uso um database separado na
    instância existente? As duas opções servem; o que **não** serve é compartilhar schema.
12. Podemos criar um **usuário-robô no ClickUp**, com fuso `America/Fortaleza`, e usar o token
    dele? Token de vendedor cria tasks órfãs quando a pessoa sai.
13. **Em qual plano está o workspace do ClickUp?** O rate limit muda com o plano e isso muda o
    desenho da camada de saída.
14. Quem são os usuários do dashboard, com e-mail e papel?
15. **Qual é o `list_id` da lista do ClickUp** onde as tasks devem ser criadas, e quais campos
    customizados dessa lista precisam ser preenchidos?
16. **Quem é o time comercial**, nominalmente, com o `user_id` do ClickUp de cada um?

---

## 🟠 Bloqueiam a Fase 1 (receita) e a Fase 3 (saldo)

### Receita e identidade

17. A **régua de receita** do comercial deve ser a mesma do financeiro — emissão + valor atual,
    excluindo canceladas **e renegociadas**? É assim que vocês pensam "receita do cliente"?
18. **"Alerta se cair X% de um mês para outro" — qual é o X?** E confirmam que a comparação é
    entre **meses fechados** (o mês corrente, incompleto, não entra)?
19. **Top 5** é por receita do **ano corrente**, dos **últimos 12 meses**, ou do período que o
    usuário escolher?
20. A segmentação por unidade deve vir de `customer.companyId`? *(O contrato **não** traz
    `companyId` na resposta, embora `/contracts` aceite o filtro.)*
21. Quais são os **nomes exatos** das categorias de serviço no Conexa? O catálogo real tem
    **3 grafias para Sebrae** (uma delas com dois espaços) e 2 caixas para "Outros Serviços".

### Saldo de horas — portão da Fase 3

22. Vocês conseguem **exportar do Conexa a tela de saldo de ~20 clientes reais** para eu
    reconciliar a derivação antes de ligar as regras? **Sem isso, as regras 2 e 9 não saem de
    sombra.** A amostra precisa incluir: cota por sala, cota por grupo, pacote recorrente,
    contrato **e** pacote, e cliente que estourou a cota.
23. **Quais cotas hoje são por GRUPO de salas e não por sala específica?** Preciso da lista de
    **quais salas compõem cada grupo** — **a API não expõe isso**. Sem a lista, essas cotas ficam
    permanentemente indisponíveis.
24. Uma reserva marcada e **não comparecida (no-show)** consome cota?

---

## 🟡 Bloqueiam a Fase 4 — semântica de cada regra

### Regra 1 — Fiscal 11 meses

25. ~~O relógio começa em `startDate` ou em `fidelityDate`?~~ ✅ **RESPONDIDO em 2026-08-27 pelo
    dono: `startDate`.** `fidelityDate` é ignorado, mesmo divergindo nos dados reais.
    Implementado em `src/lib/regras/familias.ts` → `marcoAtingido`.
26. Se o cliente já renovou, o gatilho conta do **contrato atual** ou da **primeira contratação**?
27. A oferta de Bianual vale para **todos os tiers**? **Só existem 2 produtos "Bianual" no
    catálogo, ambos SEATECH** — não há Bianual para Simples/Black/Comércio.
28. Deve disparar para quem **já está em periodicidade anual/semestral**, ou só para mensalistas?

### Regras 2 e 9 — saldo

29. **São a mesma coisa com limiares diferentes?** Se sim, fico só com "< 5h".
30. O saldo de 5h é **por sala** ou o **total somado** do cliente?
31. Se faltam poucos dias para a cota renovar, ainda faz sentido ofertar?
32. Cliente que **estourou a cota** (saldo negativo) entra nesta regra ou tem tratamento próprio?

### Regra 3 — padrão irregular

33. ~~Qual é a definição numérica de "irregular"?~~ ✅ **RESPONDIDO em 2026-08-27 pelo dono:
    "mês a mês"** — queda em meses CONSECUTIVOS. Implementado como `quedaMesAMes`, com
    `quedasSeguidas` default **2** (o exemplo do próprio documento — 20h, 10h, nada — são três
    meses e duas quedas seguidas). ⚠ O NÚMERO de quedas continua confirmável: é parâmetro.
34. "Comprou 20h" é **compra** ou **consumo**? São coisas diferentes e vêm de endpoints diferentes.

### Regra 4 — avulso com uso alto

35. **"Só compra hora avulsa"** significa sem nenhum contrato, ou sem cota de horas?
36. Qual é o **preço do pacote** para calcular a economia? (A API não expõe preço por hora a nível
    de produto — é cadastro manual.)

### Regra 5 — primeira reserva

37. O marco é a **criação** da reserva ou o **uso** dela?
38. Reserva **cancelada** conta como primeira reserva?
39. **Qualquer espaço** ou só sala de reunião?

### Regras 6, 7, 8 — sala privativa

40. Identificar "sala privativa" por `privateSpaceId` ou pela categoria do plano? **A estação de
    coworking conta?** (a categoria "Salas Privativas - Seaway Center" inclui "Estação 01 -
    Coworking L21")
41. O relógio começa em `startDate` ou em `dateSalesGeneration`?
42. **O SeaBox da regra 7 é cortesia ou venda?** Se é cortesia e não é registrada no Conexa, o
    sistema **nunca saberá que o cliente já recebeu** e vai reofertar.
43. ~~"Até o 6º mês" é aniversário ou janela aberta?~~ ✅ **RESPONDIDO em 2026-08-27 pelo dono:
    ANIVERSÁRIO.** Dispara no marco dos 6 meses, com tolerância para o atraso do job — e não
    todo dia do 1º ao 6º mês. A diferença é entre uma oferta e cento e oitenta.
44. Quando "Panteão" será cadastrado no Conexa? Sem `productId`, a regra 8 não existe.

### Regra 10 — Endereço Litoral

45. Vocês conseguem **homologar por escrito o mapa `planId → tier`**, ou preferem preencher um
    extraField de contrato no Conexa? (A segunda é melhor, porque não envelhece — mas depende da
    resposta da Q3.)

---

## 🟢 Bloqueiam as Fases 5 e 6 — operação do disparo

46. **Quantos contatos por cliente por mês, no máximo?** As regras 6, 7 e 8 disparam para o mesmo
    contrato em 1, 2 e 6 meses — um cliente de privativa recebe **3 ofertas em 6 meses**.
47. Por quanto tempo uma **recusa** ("Perdido" no CRM) suprime a mesma oferta para o mesmo cliente?
48. **O que conta como inadimplente** para efeito de bloquear oferta? Qualquer cobrança vencida, ou
    só as em negativação/protesto/jurídico?
49. Qual o **SLA de primeiro contato** depois que um sinal abre? E por quanto tempo um sinal
    continua válido antes de expirar? (Uma oferta de "11 meses" é acionável no mês 11 e sem
    sentido no mês 14 — mas a task continua aberta.)
50. Existe uma **lista de staging** no ClickUp e uma conversa de teste no Chatwoot que eu possa
    usar? Custo zero, e é o que permite ensaiar contra a API real sem tocar a lista de produção.
51. **Quais ofertas o time já fez nos últimos 90 dias, e para quem?** Mesmo uma planilha grosseira
    evita o vexame da primeira semana — o sistema nasce sem saber o que já foi ofertado fora dele.
52. **Qual é a meta de sucesso do sistema, em número?** (ex.: "≥ N oportunidades ganhas/mês
    atribuídas a sinais, em 6 meses".) Sem isso não há como decidir, em D+90, se expande, mantém
    ou descontinua — e regra ruim sobrevive por inércia.

---

## Lacunas de API — fatos a conviver, não perguntas

- **Não existe endpoint de saldo de horas.** A concessão e o consumo existem; o saldo é derivado.
- **Não existe `/rooms`, `/spaces` nem `/spaceGroups`** — cotas por grupo de salas são
  irrecuperáveis pela API.
- **Não existe `/packages`** — não há como ler um pacote de horas diretamente.
- **Nenhum endpoint de lista aceita filtro por `updatedAt`.** Registro alterado dentro de uma
  janela já sincronizada nunca é re-buscado por conta própria — daí a necessidade do reparo por id
  e da re-varredura periódica.
- **A API não encadeia contratos** — não há campo "contrato anterior", então "primeira contratação
  do cliente" precisa ser derivada.
