# Seahub Comercial

Dashboard de **inteligência comercial** da [Seahub Coworking](https://seahubcoworking.com.br)
(Natal/RN). Consolida o perfil de cada cliente a partir do ERP **Conexa** e aponta, por **regras
determinísticas**, onde existe potencial de venda adicional — abrindo uma task no **ClickUp** para
o vendedor responsável.

> Sistema single-tenant. Roda como container único no **Easypanel** da empresa, ao lado do
> [Dashboard Financeiro](../../Dashboard%20Financeira%20Seahub/seahub_financeiro).

## O que ele é

1. **Espelho local e auditável** dos dados comerciais do Conexa — clientes, contratos, planos,
   vendas, cobranças e **reservas de sala** (inédito no ecossistema Seahub).
2. **Perfil consolidado por cliente** — receita no ano, receita mês a mês com variação, Top 5,
   uso de horas, saldo de cota, segmentos, vendedor. Cada número com **procedência declarada**.
3. **Motor de regras determinístico e parametrizável** — regra é *dado* (linha em banco, editável
   pelo time comercial); família de regra é *código puro*, testado e backtestável. As 10 regras
   do documento de especificação colapsam em **6 famílias**.
4. **Camada de disparo isolada e desligada por padrão** — cria task no ClickUp, com idempotência
   garantida por constraint de banco.

## O que ele NÃO é

| Não é | Por quê |
|---|---|
| Um sistema de IA | As regras são checagens de data/threshold. Não há modelo, score aprendido nem "provavelmente". |
| Um segundo dashboard financeiro | Sem DRE, despesa, fornecedor ou conciliação bancária. Receita existe só como atributo do cliente, com a **mesma régua** do financeiro. |
| Um sistema que escreve no Conexa | O cliente HTTP tem método fixo em `GET`, sem parâmetro de `method` nem `body`. Garantia **estrutural**. |
| **Um robô que fala com o cliente final** | **Nenhuma mensagem sai para o cliente, nunca.** Toda saída é interna, para o vendedor, que decide como abordar. |
| Um sistema que inventa número | `INDISPONIVEL ⇒ NULL`, garantido por `CHECK` no Postgres. Lacuna vira tarefa de cadastro, nunca zero nem estimativa silenciosa. |
| Um sistema com 10 regras no dia 1 | Duas estão bloqueadas por dado que não existe; duas dependem de uma reconciliação que pode reprovar. Ver [regras-comerciais.md](docs/context/regras-comerciais.md). |

## Stack

Next.js 15 (App Router) · TypeScript · PostgreSQL · Prisma · Tailwind · Recharts · Vitest.
Mesma do projeto irmão, de propósito — ver [ADR-08](docs/context/decisions.md).

## Documentação

Toda a memória de desenvolvimento vive em [`docs/context/`](docs/context/) e é **versionada junto
com o código**:

| Documento | Conteúdo |
|---|---|
| [decisions.md](docs/context/decisions.md) | Decisões de arquitetura (ADRs) |
| [regras-comerciais.md](docs/context/regras-comerciais.md) | As 10 regras, viabilidade e fórmula de cada uma |
| [conexa-integration.md](docs/context/conexa-integration.md) | API Conexa v2: auth, limites, endpoints, campos confirmados |
| [integracoes-saida.md](docs/context/integracoes-saida.md) | ClickUp e Chatwoot, e as salvaguardas da camada de disparo |
| [roadmap.md](docs/context/roadmap.md) | Fases, entregáveis e critérios de aceite |
| [riscos.md](docs/context/riscos.md) | Riscos e o que os mitiga |
| [perguntas-abertas.md](docs/context/perguntas-abertas.md) | O que precisa ser respondido, por quem e o que bloqueia |
| [progress.md](docs/context/progress.md) | Log cronológico — atualizar a cada commit |

## Estado atual

**Fase de planejamento.** Nenhum código escrito ainda. O próximo passo é a **Fase 0** do
[roadmap](docs/context/roadmap.md) — as provas de acesso que decidem o escopo real do projeto.

## Regra permanente

> **Atualizar `docs/context/` a cada `commit` + `push`.** No mínimo `progress.md`; e os demais
> quando algo mudar. (Mesma disciplina do projeto irmão.)
