# Riscos e mitigações

Levantados no planejamento e refinados por **três auditorias adversariais** (veracidade técnica
contra a coleção Postman · operação e deploy · risco de negócio) mais um crítico de completude.
46 achados, 10 críticos.

---

## Os que decidem o escopo

| # | Risco | Impacto | Mitigação | Sinal de que aconteceu |
|---|---|---|---|---|
| **R1** | **`/room/bookings` bloqueado por permissão (403)** — a coleção documenta *"only available for authorized customers"*, e o financeiro nunca chamou o endpoint | 🔴 Crítico — derruba as regras 2, 3, 4, 5, 9 e 10 | **Teste nº 1 da Fase 0.** Se der 403, chamado na Conexa no dia 1 e roadmap reordenado para as regras de contrato (1, 6, 7, 8) | Falha de autorização na Fase 0 |
| **R2** | **Teto de 60 req/min compartilhado degrada o dashboard financeiro**, que já está em produção | 🔴 Crítico — quebra o sistema que fecha o mês | [ADR-0002](decisions.md): token próprio + orçamento repartido + **coordenação real** (token-bucket compartilhado, coletor único, ou janela horária + endpoint de ocupação). ⚠ "Janelas desencontradas" sozinho **não funciona** — o agendador ancora no boot | `429` em qualquer dos dois |
| **R3** | **Saldo derivado diverge do Conexa** — âncora do ciclo, carry-over e dedução parcial todos NÃO CONFIRMADOS | 🔴 Alto | [ADR-0005](decisions.md): a Fase 3 é **medição com critério de reprovação explícito**. Reprovou ⇒ regras 2 e 9 desligadas e lacuna documentada com números | A taxa de acerto medida na Fase 3 |
| **R4** | **Receita do comercial diverge do financeiro** | 🔴 Crítico para credibilidade | [ADR-0006](decisions.md): régua copiada literalmente, reconciliação diária **bloqueante** com tolerância R$ 0,00 | O próprio número na tela de reconciliação |

---

## Os achados críticos das auditorias

| # | Achado | Por que é grave | Correção |
|---|---|---|---|
| **A1** | **Não existia gate de elegibilidade.** Nenhuma regra verificava se o cliente está ativo, não bloqueado, não inadimplente e com contrato vigente | Contrato encerrado no dia 25 dispara o marco de 1 mês no dia 30 → vendedor liga oferecendo produto a um **ex-cliente**. Cliente em negativação recebe oferta de upgrade | [ADR-0010](decisions.md) — gate obrigatório e centralizado no runner, mais `isActive`/`isBlocked` como coluna |
| **A2** | **O motor avaliava sem selo de frescor do sync.** As defesas eram alerta, não bloqueio | Se o backfill de reservas falhar, a regra "primeira reserva" vê **todo cliente antigo como estreante** — milhares de tasks — e as regras de saldo veem cota cheia para a base inteira. Às 6h não há ninguém olhando o rodapé | [ADR-0011](decisions.md) — família declara suas dependências; sem sync recente, retorna bloqueado. Mais checagem de sanidade de volume |
| **A3** | **Não havia supressão por "já possui" nem por "já recusou"** | O cliente diz "não quero SeaBox", o vendedor marca Perdido, e no ciclo seguinte outro vendedor liga oferecendo a mesma coisa. É o modo de falha mais caro em imagem | [ADR-0010](decisions.md) — regra declara os produtos da oferta; "Perdido" suprime por prazo configurável |
| **A4** | **A defesa contra a falha irreversível era um grep**, sobre um cliente cujo default manda a mensagem ao cliente final | O código errado **não contém** a string procurada — ele apenas *esquece* `{ privado: true }` | [ADR-0012](decisions.md) — o tipo torna a mensagem pública inexpressável |
| **A5** | **A premissa da Fase 2 era falsa.** "Janela de data passada é imutável" | Existe `PATCH /room/booking/:id` alterando `date`/`startTime`/`finalTime`: a reserva **se move** entre janelas. E o critério "a contagem bate" passa enquanto o conteúdo está errado | Usar `createdAtFrom/To` **também**, reparo por id, re-varredura periódica, e trocar o critério para **hash do conjunto** |
| **A6** | **`enterrarZumbis()` e multi-réplica são incompatíveis**, e o plano adotava os dois | O boot da réplica B mata o backfill vivo da réplica A **e** libera a guarda — as duas passam a atacar a API juntas. E `pg_advisory_lock` de sessão sobre conexão pooled não é confiável | [ADR-0003](decisions.md) — **um regime só**: réplica única declarada, ou heartbeat por processo. Nunca os dois |
| **A7** | **O backfill não é retomável e não há drenagem no encerramento** | O sync sempre parte do offset 0 e nada persiste onde parou. Um redeploy no meio de um backfill de horas **joga a carga inteira fora**. ⚠ **Parte deste achado estava errada** — ver abaixo | [ADR-0008](decisions.md) — cursor em `SyncState`, drenagem no encerramento, `stop_grace_period` no serviço |
| **A8** | **"Fonte cruzada confirmada" não estava confirmada.** O plano B da regra 4 dependia de `sale.quantity` carregar horas fracionárias | A coleção tipa o campo como `integer` e como "quantidade de **itens**". O único `2.75` da coleção está numa venda que **não** é de reserva. É indício, não confirmação | Rebaixado para NÃO CONFIRMADO; virou medição da Fase 0 |
| **A9** | **O caminho de desbloqueio da regra 10 pode não existir.** `extraFields` não aparece em nenhum exemplo de resposta de `/contracts` | Se a API não devolve o campo, preenchê-lo no Conexa **não destrava nada**, e a regra 10 fica sem saída | Virou teste de leitura da Fase 0, e pergunta à Conexa em vez de proposta ao cliente |
| **A10** | **Mudar um threshold podia redisparar o histórico inteiro** — nunca foi definido | Se a chave de ciclo incluísse os parâmetros, qualquer ajuste abriria "ciclo novo" e as constraints **deixariam passar**. Se não incluísse, quem ficou de fora por limiar errado nunca mais entraria | [ADR-0009](decisions.md) — chave **imune aos parâmetros**; reavaliar é ação separada, explícita e auditada, com prévia de volume |

---

## Operação e produto

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| **R5** | **Regra 5 dispara em massa** — sem backfill completo, todo cliente antigo parece "primeira reserva" | 🔴 Alto — milhares de tasks | Backfill completo **antes** de sair de sombra + data de corte como parâmetro obrigatório + teto por execução + backtest mostra o volume **antes** de ligar |
| **R6** | **Task duplicada no ClickUp** | 🔴 Alto — lixo no CRM de outra pessoa | 3 constraints + claim outbox antes do POST + reconciliação pela chave |
| **R7** | **Colisão de prefixo na busca da chave** (`652` casando com `6521`) | 🔴 Alto — o sistema "acha" que disparou para quem nunca recebeu | Operador de igualdade **exata**, chave composta, teste dedicado com fixture de colisão |
| **R8** | **Bug multiplicativo** (fuso, sinal invertido num limiar) atinge a base inteira num ciclo | 🔴 Alto | Teto por execução (a execução **para**, não continua) + máquina de estados por regra + relógio **injetado** + backtest obrigatório antes de LIVE |
| **R9** | **Fadiga de contato** — privativa recebe 3 ofertas em 6 meses; regras 2 e 9 disparam juntas | 🟠 Médio | Teto de contatos por cliente/mês + cooldown por regra + dedupe por oferta + **relatório de sobreposição** no backtest, que torna isso visível antes de ligar |
| **R10** | **Falso positivo alto derruba a confiança** — o vendedor para de olhar a fila | 🔴 Alto — **é o risco de produto** | Portão de ≥ 80% de procedência na Fase 4, revisado pelo cliente; ação "descartar como falso positivo" alimentando o painel de precisão; regra acima de 20% é desligada |
| **R11** | **Config do ClickUp muda em silêncio** (lista recriada ganha id novo) | 🟠 Alto | Verificação de configuração no boot + sync periódico dos campos + incidente de severidade alta |
| **R12** | **Token morre** com a desativação do funcionário dono | 🟠 Alto | Usuário-**robô** dedicado; `401` desliga o canal e abre incidente — **falha ruidosa** |
| **R13** | **Agendador silenciado para sempre** por registro de sync zumbi | 🔴 Crítico **e invisível** | Enterro de zumbis no boot + alerta se o último sync bem-sucedido tiver mais de 2h + rodapé "sincronizado há N" |
| **R14** | **Migration do comercial toca o banco do financeiro** | 🔴 Crítico | Bancos fisicamente separados; role sem privilégio algum no database do financeiro. Uma migration destrutiva **não tem permissão para existir** |

---

## Achados que a verificação derrubou

Auditoria também erra. Registrado aqui para ninguém corrigir o que não está quebrado:

**A7, parte do SIGTERM — FALSO.** A auditoria afirmou que o container não trata SIGTERM (sem
handler no código, sem `tini`, Node como PID 1) e que por isso todo redeploy terminaria em
SIGKILL. **Medido na imagem real e refutado:** o servidor standalone do Next instala o handler por
conta própria (`next/dist/server/lib/start-server.js` → `process.on('SIGTERM', cleanup)`), e o
`exec` do entrypoint faz o Node recebê-lo como PID 1. `docker stop` sai com **código 0 em ~500 ms,
com e sem `tini`** — testado nas duas variantes da mesma imagem.

O que **sobra de verdadeiro** no achado: não há **drenagem de aplicação**. O Next fecha o servidor
HTTP, mas não conhece o nosso agendador nem o backfill em voo. Somado ao backfill não-retomável
(esse sim confirmado), um redeploy no meio de uma carga longa continua custando caro — só que a
correção é cursor persistido + drenagem, não `tini`.

---

## Lacunas de completude ainda em aberto

Levantadas pelo crítico de completude, **sem fase atribuída ainda** — precisam entrar no roadmap:

1. **Não há modo mock nem seed sintético.** O irmão tem; o comercial não previu. Sem isso não se
   desenvolve nem se demonstra sem token de produção.
2. **Não há ambiente de ensaio** para ClickUp/Chatwoot. Hoje a primeira chamada real aconteceria na
   lista de produção, com vendedores olhando. Pedir lista de staging e inbox de teste.
3. **O sinal não expira.** Uma oferta de "11 meses" é acionável no mês 11 e sem sentido no mês 14 —
   mas a task continua aberta. E "sinais abertos sem contato há N dias" é justamente o indicador de
   que a fila morreu; sem estado de expiração, um sistema ignorado tem a **mesma aparência** de um
   sistema funcionando.
4. **Versionamento de família.** Quando um deploy altera a família, regras vivas em banco podem
   ficar com parâmetros que não validam mais — falhando em silêncio no job das 6h.
5. **Volumetria e custo nunca foram calculados.** ~60 mil avaliações/dia. Se a explicação de "por
   que não disparou" for **persistida** para todos, são ~22 milhões de linhas/ano. Decidir e
   escrever: é **recomputada sob demanda**, persistindo só os sinais positivos.
6. **Não há métrica de sucesso do produto nem critério para matar o projeto.** Sem "quanto entrou
   por causa disto", o projeto perde o argumento de continuidade — e regra ruim sobrevive por
   inércia, porque ninguém desliga o que ninguém mede.
7. **O passado externo é invisível.** As ofertas já feitas fora do sistema (tasks manuais,
   conversas, o combinado informal) não estão em campo nenhum. No primeiro ciclo, o sistema vai
   ofertar o que um vendedor ofereceu há três semanas.
8. **Documentação de usuário e handover não são entregáveis.** Dois dos três testes de aceite
   finais são o cliente operando sozinho — sem um único documento que o ensine. E um teste
   cronometrado feito com o autor ao lado não prova autonomia: prova que ele acompanhou.
9. **Calendário de operação.** Fim de semana, feriado, férias do vendedor, e vendedor que sai da
   empresa deixando fila órfã.
