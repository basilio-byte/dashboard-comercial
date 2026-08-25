# docs/context — Memória de desenvolvimento

Esta pasta é a **memória persistente do projeto**: contexto, decisões e progresso que devem
sobreviver entre sessões de desenvolvimento. É versionada junto com o código.

## Arquivos

- **[decisions.md](decisions.md)** — registro de decisões de arquitetura (ADRs). Cada decisão
  relevante vira uma entrada no formato Contexto → Decisão → Consequência.
- **[regras-comerciais.md](regras-comerciais.md)** — as 10 regras de negócio, com os dados de
  entrada, a fórmula, o ciclo de idempotência e o status de viabilidade de cada uma.
- **[conexa-integration.md](conexa-integration.md)** — tudo sobre integrar com o ERP Conexa:
  auth, rate limit, endpoints, campos confirmados e as lacunas conhecidas.
- **[integracoes-saida.md](integracoes-saida.md)** — ClickUp e Chatwoot, e o desenho da camada de
  disparo (dry-run, kill-switch, outbox, idempotência).
- **[roadmap.md](roadmap.md)** — fases, entregáveis e critérios de aceite objetivos.
- **[riscos.md](riscos.md)** — riscos identificados e o que mitiga cada um, com os achados das
  auditorias adversariais.
- **[perguntas-abertas.md](perguntas-abertas.md)** — o que ainda precisa ser respondido, por quem,
  e qual fase cada pergunta bloqueia.
- **[progress.md](progress.md)** — log cronológico do que foi feito e o que vem a seguir.

## Regra permanente

> **Atualizar esta pasta a cada `commit` + `push`.** No mínimo `progress.md`; e `decisions.md` /
> demais docs quando algo mudar.

## Fontes da verdade

| Assunto | Fonte |
|---|---|
| API Conexa v2 | `docs/API v2 Conexa.postman_collection.json` — **consultar, nunca chutar campo** |
| Convenções de stack, Docker e deploy | o projeto irmão, em `c:/Users/User/Desktop/Dashboard Financeira Seahub/seahub_financeiro` |
| Clientes HTTP de ClickUp/Chatwoot | `c:/Users/User/Desktop/Seahub-agentes-chatwoot/agentes-chatwoot/src/server/integrations/` |
| Especificação funcional | documento "Sistema de Inteligência Comercial (Conexa + ClickUp)", de Diego |

## Convenção de confiança

Todo documento desta pasta marca explicitamente o que **não** foi verificado:

| Marca | Significado |
|---|---|
| **CONFIRMADO** | Verificado na coleção Postman ou em código real rodando em produção. Cita o arquivo. |
| **NÃO CONFIRMADO** | Plausível, mas não verificado. Vem sempre acompanhado de **como** confirmar. |
| **LACUNA** | O dado não existe na API. Não se estima; declara-se. |
