# Progresso

Log cronológico. Mais recente no topo. **Atualizar a cada commit + push.**

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
2. **Duas regras estão bloqueadas por dado que não existe.** "Panteão" não está em nenhum dos 217
   produtos do Conexa; e o tier do Endereço Fiscal (Litoral, Batial, Abissal…) **não é campo da
   API** — todos caem na mesma categoria de serviço.
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

**Próximo passo — Fase 0 do [roadmap](roadmap.md).** As cinco provas de acesso que decidem o escopo
real do projeto. Nenhuma linha de aplicação antes delas.

**Bloqueios.** As perguntas 🔴 de [perguntas-abertas.md](perguntas-abertas.md), especialmente:
o teto de 60 req/min é por token ou por conta; o token tem acesso a `/room/bookings`; e qual é o
`list_id` da lista alvo no ClickUp.
