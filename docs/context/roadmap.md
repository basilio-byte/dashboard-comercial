# Roadmap

> ⚠ **Atualizado em 2026-08-26.** Este roadmap foi escrito antes da Fase 0 e o
> plano mudou com o que ela mediu. O estado real, sempre atual, está em
> [progress.md](progress.md) — leia-o antes deste arquivo.
>
> **Já feito:** Fase 0 (veredito GO) · Fase 1 (espelho, métricas, telas) · parte
> da Fase 2 (reservas carregadas) · parte da Fase 3 (ciclo de horas e sinal de
> excedente, com o saldo ainda **não validado**).
>
> **O que mudou de rota:**
> - a carga é por **janela mensal**, não por offset — a API não é ordenada;
> - as regras 8 e 10 **não estão bloqueadas** (a Fase 0 desbloqueou as duas);
> - surgiu um gatilho novo, pedido pelo responsável: **excedente recorrente de
>   horas**, hoje o único ativo;
> - surgiu um bloqueio novo: **o vendedor responsável não é resolvível pela
>   API**, o que trava o roteamento e, com ele, a fase de disparo.

Princípio de faseamento: **cada fase pode parar e ainda ter entregue valor**, e nenhuma fase
escreve num sistema de terceiro antes de o dado que a sustenta ter sido provado.

Ordem de canal decidida com o dono do projeto: **ClickUp primeiro e sozinho**. O Chatwoot vem
depois, e a abordagem (inbox exclusiva para sinais vs. notas internas na conversa do cliente)
ainda **será desenhada**.

---

## Fase 0 — Provas de acesso · GO / NO-GO

**Objetivo.** Descobrir, antes de escrever qualquer regra, o que a API realmente entrega. Esta
fase pode **redefinir o escopo do projeto inteiro**.

Cinco medições, todas com token real:

1. **`GET /room/bookings` responde 200?** A coleção documenta que o endpoint é *"only available
   for authorized customers"*. Se der 403, **6 das 10 regras caem** e o roadmap se reordena para
   as regras de contrato (1, 6, 7, 8), que não dependem de reservas.
2. **O rate limit de 60 req/min é por token ou por conta?** Se for por token, o problema
   arquitetural do [ADR-0002](decisions.md) desaparece com um segundo `api_key`.
3. **`GET /contracts` devolve `extraFields`?** É o que decide se a regra 10 tem caminho de
   desbloqueio ([ADR-0001](decisions.md) e [regras](regras-comerciais.md)).
4. **`sale.quantity` de uma venda originada de reserva carrega horas fracionárias?** A coleção
   tipa o campo como `integer` e como "quantidade de **itens**". O plano B da regra 4 depende
   disso. Medir cruzando por `booking.saleId`.
5. **O `hourPlanQuota` vem preenchido nos contratos reais da Seahub?** Nos fixtures vem; em
   produção é outra história.

**Critério de aceite.** Um documento em `docs/context/` com as 5 respostas medidas, e o roadmap
reordenado conforme elas. **Nenhuma linha de aplicação escrita antes disso.**

---

## Fase 1 — Esqueleto, espelho e as métricas do documento

**Objetivo.** As métricas que o documento pede, corretas e conferíveis: receita do cliente no ano,
receita mês a mês com variação, Top 5.

**Entregáveis.** Projeto Next.js + Prisma + Docker + entrypoint (com as **três correções** do
[ADR-0008](decisions.md): cursor de backfill retomável, handler de SIGTERM, agendador por relógio
de parede). Autenticação e usuários. Espelho de clientes, contratos, planos, categorias, produtos,
vendas e cobranças. Telas `/`, `/clientes`, `/clientes/[id]`, `/receita`, `/reconciliacao`,
`/operacao`. Deploy no Easypanel funcionando.

**Critério de aceite.**
- `GET /api/health` → `200`; raiz redireciona para login; `POST /api/sync` sem segredo → `401`.
- **Receita de um mês fechado bate ao centavo com o dashboard financeiro.** Δ = R$ 0,00, e a
  contagem de cobranças bate 1:1.
- Top 5 do ano conferido manualmente contra o Conexa pelo cliente.
- A variação é `NULL` quando o mês anterior é zero; teste prova que no dia 3 do mês **nenhum**
  cliente é marcado em queda por causa do mês corrente.
- Nenhum número na tela sem selo de procedência.
- A camada de disparo **não existe ainda** — nem o diretório.
- Zero `429` nos dois serviços por 7 dias corridos.

---

## Fase 2 — Reservas de sala

**Objetivo.** Trazer o endpoint que o financeiro nunca chamou, e **provar** que o trouxemos
inteiro.

⚠ **A auditoria derrubou a premissa original desta fase.** Não se pode assumir que uma janela de
data passada é imutável: existe `PATCH /room/booking/:id` que altera `date`, `startTime` e
`finalTime` — uma reserva pode ser **movida** de um dia para outro depois de sincronizada. E o
`status` muda depois do dia da reserva (é justamente a transição para `deductedFromQuota` que a
Fase 3 usa para derivar consumo).

**Estratégia corrigida.** Usar **também** `createdAtFrom/To` (que o endpoint aceita) para capturar
reserva criada hoje para qualquer data; replicar o reparo determinístico por `id[]` que o projeto
irmão já provou; e re-varrer periodicamente os últimos meses fechados para capturar mudança de
status, cancelamento e movimentação.

**Critério de aceite.** Trocar "a contagem bate" por **"o hash do conjunto
`(bookingId, startTime, finalTime, status)` bate"** — contagem não detecta reserva movida nem
status desatualizado. Duração calculada para 100% das reservas com as duas pontas; **`NULL`,
nunca `0`**, quando falta uma. Matar o container no meio do backfill e reiniciar **retoma do
ponto**.

---

## Fase 3 — A prova do saldo de horas · fase de MEDIÇÃO

**Objetivo.** Decidir, **com número**, se as regras 2 e 9 existem. Esta fase pode **reprovar** — e
reprovar é uma entrega válida.

**Método.** O cliente exporta a tela de saldo do Conexa para ≥ 20 clientes reais, cobrindo cota
por sala, cota por grupo, pacote recorrente, contrato + pacote, e cliente que estourou a cota. O
sistema importa e compara contra a derivação.

**Critério de aceite — o mais duro do roadmap.**
- ≥ 95% dos baldes dentro de ± 0,25 h.
- **100% de concordância no sinal do gatilho.** Nenhum caso em que o derivado diz "abaixo de 5h" e
  o Conexa diz "acima". **Um único erro reprova a fase.**
- Âncora do ciclo confirmada e fixada por teste; carry-over e dedução parcial respondidos.
- Cotas por grupo marcadas indisponíveis, com o `CHECK` do banco garantindo saldo `NULL`.

**Se reprovar.** As regras 2 e 9 ficam `OFF` permanente; a regra 4 sobrevive; o roadmap segue. Um
ADR registra a razão **com os números da medição**.

---

## Fase 4 — Motor de regras, tudo em SOMBRA

**Objetivo.** As regras existindo como **linhas em banco**, avaliadas diariamente, visíveis na UI,
**sem despachar nada**.

**Entregáveis.** Kernel + as 6 famílias + gate de elegibilidade + supressões + selo de completude.
Telas `/sinais`, `/sinais/[id]`, `/regras`. Aba "Por que não disparou?" na tela do cliente.

**Critério de aceite.**
- O seed cria as regras sobre 6 famílias, e **nenhuma família tem código específico de uma regra**.
- Os greps de invariante passam: nenhuma família importa Prisma, `next/*` ou usa `new Date()`.
- Cada família passa as **oito classes de teste**: positivo mínimo (o caso literal do documento) ·
  negativo adjacente (véspera e dia seguinte **não** disparam) · clamp de data (`31/01 + 1 mês`,
  ano bissexto) · fuso (o mesmo contexto às 23:59 e às 00:01 em Fortaleza produz a **mesma** chave
  de ciclo) · idempotência · lacuna (dado indisponível ⇒ bloqueado, nunca sinal com número
  inventado) · **elegibilidade** (inativo / bloqueado / contrato encerrado / inadimplente ⇒ nunca
  sinal) · **supressão** (já possui / já recusou ⇒ nunca sinal).
- Rodar o runner **3× no mesmo dia** cria exatamente os mesmos sinais.
- Com o sync de reservas marcado como falho, o ciclo produz **zero** sinais das famílias que
  dependem de reservas — provado por teste.
- O histórico de disparo continua **vazio, zero linhas** — é a prova de que sombra é sombra.
- **Portão humano:** o cliente revisa a lista de sinais de uma semana e classifica cada um como
  procedente ou falso positivo. **Meta: ≥ 80% de procedência por regra.** Regra acima de 20% de
  falso positivo volta para especificação.

---

## Fase 5 — Configurações, simulação e parâmetros

**Objetivo.** O time comercial consegue, sozinho, ligar/desligar um canal, mudar um threshold e
**ver o efeito histórico** antes de salvar.

**Entregáveis.** Tela `/configuracoes` com os toggles por canal ([ADR-0009](decisions.md)).
Backtest persistido. `/regras/[key]`, `/regras/[key]/simular`, `/regras/nova`. Guarda de promoção.
Auditoria de quem mudou o quê.

**Critério de aceite.**
- O formulário de parâmetros é **gerado do schema** — acrescentar um parâmetro numa família faz o
  campo aparecer sem tocar em JSX.
- Backtest de 12 meses roda em menos de 30 s.
- **Relatório de sobreposição:** quantos clientes receberiam 2+ ofertas no mesmo mês.
- Cada família declara e a UI exibe a **fidelidade** do backtest (alta/média/baixa) com o motivo.
- Tentar promover para LIVE sem simulação válida é **recusado**, com a lista do que falta.
- Mudar um threshold **não redispara o histórico** — provado por teste.

---

## Fase 6 — Disparo no ClickUp: DRY-RUN → LIVE, uma regra por vez

**Objetivo.** A primeira task real no ClickUp, para **uma** regra, com auditoria completa.

**Regra de promoção.** Começar pela regra de **menor volume e maior confiança** — candidata:
"privativa 1 mês" (marco determinístico, poucos contratos/mês, oferta clara). Depois de **2
semanas limpas**, promover a segunda. **Nunca duas regras novas no mesmo ciclo.**

**Critério de aceite.**
- Com o notificador desligado, executar o despacho faz **zero** requisições HTTP a terceiros —
  provado por teste com `fetch` global que **lança** se chamado.
- Teste prova que a prévia não faz `fetch`.
- Um ciclo em dry-run produz o payload exato para 100% dos sinais elegíveis, e **zero requisição
  de escrita**.
- O cliente aprova **por escrito** a prévia de uma semana: título, corpo, vendedor, prioridade.
- **Teste do pior caso:** matar o container **entre o POST e o commit** ⇒ na execução seguinte
  **nenhuma segunda task** é criada, e a reconciliação promove o registro com o id encontrado.
- `401` forjado **desliga o canal** e abre incidente, **sem retry**.
- Cenário com 10.000 sinais **para no teto** e marca a execução como interrompida.
- Vendedor sem mapeamento ⇒ task **sem responsável** numa lista de triagem. Nunca no chute.

---

## Fase 7 — Chatwoot *(desenho pendente)*

**Objetivo.** Levar o sinal até onde o vendedor já está.

⚠ **A abordagem ainda não está decidida** — inbox exclusiva para sinais ou nota interna na
conversa do cliente. Decidir com o time comercial antes de implementar.

**Inegociável, qualquer que seja a abordagem:** a mensagem é **interna, para o vendedor**. O
sistema nunca fala com o cliente final, e a garantia é **estrutural**, não um grep
([ADR-0012](decisions.md)).

---

## Fase 8 — Destravamento e endurecimento *(condicional)*

Liga o que estava bloqueado, **quando** o bloqueio sair:

- **Regra 10** sai de `OFF` só com o mapa `planId → tier` homologado **por escrito**, ou com o
  extraField de contrato preenchido — e só se a Fase 0 tiver confirmado que a API o devolve.
  Classificar por substring do nome do plano é **proibido**.
- **Regra 8** existe só se "Panteão" for cadastrado no Conexa e o `productId` informado, **e** a
  ambiguidade "no 6º mês vs até o 6º mês" resolvida.
- **Regra 3** existe só com a definição numérica de "irregular" e a escolha compra × consumo.

Mais: alertas de falha agrupados por assinatura (endpoint fora do ar por 2h ⇒ **1 incidente com
contador**, não 480 linhas); runbook respondendo "o que fazer quando o dry-run mostra 300 disparos
inesperados", "como revogar um disparo já enviado" e "como desligar tudo em 30 segundos".

---

## Testes de aceite finais

Três, cronometrados. Valem mais que qualquer diagrama:

1. **Regra nova sem deploy.** Criar uma regra pela UI, simular 12 meses, ligar em sombra.
   Meta: **< 15 min, zero commit**.
2. **Threshold ajustado pelo time comercial.** Mudar um limiar, ver no backtest o efeito no
   volume, salvar. Meta: **< 5 min, sem chamar o dev**.
3. **Explicação de um sinal.** Um vendedor pergunta "por que abriram esta task?" e a resposta
   completa — predicados, números com procedência, parâmetros vigentes no disparo, payload
   enviado, resposta do ClickUp — está em **uma tela**, sem consultar log.

Se os três passarem, a regra 30 custa o mesmo que a regra 11.
