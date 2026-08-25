# Integrações de saída — ClickUp e Chatwoot

> **O sistema nunca fala com o cliente final.** Toda saída é interna, para o **vendedor**, que
> decide se e como aborda. Ver [ADR-0012](decisions.md).

Ordem decidida: **ClickUp primeiro e sozinho**. O Chatwoot vem depois, com a abordagem ainda a
desenhar.

---

## Código reaproveitável

Existem clientes prontos, testados, em português, em
`c:/Users/User/Desktop/Seahub-agentes-chatwoot/agentes-chatwoot/src/server/integrations/`:

| Copiar | Escrever do zero |
|---|---|
| `clickup/{client,campos,tipos,formatacao,config,catalogo}.ts` + testes | A camada de disparo (orquestrador, kill-switch, dry-run, outbox, teto) |
| `chatwoot/{client,atendentes,config,rodizio,historico,eventos}.ts` + testes | O filtro de conversas por vendedor |
| `conexa/{client,config,formatacao}.ts` | O histórico de idempotência |

Busca por `dryRun` / `DRY_RUN` / `simulacao` nesses repositórios: **zero ocorrências**. A camada de
disparo é código novo.

### Armadilhas de autenticação que esse código já resolve

Causa nº 1 de `401` nas duas APIs:

```ts
// ClickUp — token CRU no Authorization. SEM "Bearer".
headers: { Authorization: token, "Content-Type": "application/json" }

// Chatwoot — header próprio. Também SEM "Bearer".
headers: { api_access_token: token }

// Conexa — este sim é Bearer.
headers: { Authorization: `Bearer ${token}` }
```

---

## ClickUp

**Base URL:** `https://api.clickup.com/api/v2`. Token de **usuário-robô** dedicado, nunca token de
pessoa — quando o funcionário sai, o token morre e as tasks ficam órfãs. Fuso do robô em
`America/Fortaleza`.

### Status CRM

O funil vive num **campo customizado "Status CRM"** (tipo `drop_down`), decodificado via
`type_config.options`. Valores típicos: "Em andamento", "Ganho", "Perdido".

⚠ **Não confundir** com o status **nativo** (`task['status']['status']`), que tem valores como
"aguardando pagamento" e "sem contato". Para status como "Sem contato", usar o nativo.

O **"Perdido"** não é decorativo: alimenta a supressão por "já recusou"
([ADR-0010](decisions.md)). Sem mapeá-lo, o cliente diz "não quero", o vendedor marca perdido, e no
ciclo seguinte outro vendedor liga oferecendo a mesma coisa.

### Destino é allowlist fechada

A task é criada numa **lista definida**, nunca em qualquer lugar do workspace. A garantia é
estrutural: o `list_id` vem de configuração e **a função de criar task não o aceita como
argumento** — não existe caminho de código que escreva em outra lista.

Vendedor sem mapeamento ⇒ task **sem responsável, numa lista de triagem**. Nunca no chute.

### Idempotência

Chave de disparo (`cliente + regra + ciclo`) gravada num campo customizado de texto, com:

- **três constraints de banco** impedindo o mesmo disparo duas vezes;
- **claim no outbox antes do POST** — cobre o pior caso, *a escrita deu certo e a resposta se
  perdeu*;
- reconciliação que consulta a chave e decide entre enviado e falhou. **Reconciliar é mais barato
  que duplicar.**

⚠ **Usar o operador de igualdade exata na busca pela chave.** Com igualdade "contém",
`652` casaria com `6521` — e o sistema acharia que já disparou para quem nunca recebeu.

### A mapear antes de rodar

`list_id` da lista alvo · ids dos campos customizados · `user_id` de cada vendedor · plano do
workspace (define o rate limit).

---

## Chatwoot — *desenho pendente*

**Base URL:** `https://chatwoot.seahealth.io/api/v1`, header `api_access_token`.

⚠ **A abordagem ainda não está decidida** — inbox exclusiva para sinais, ou nota interna na
conversa do cliente. Decidir com o time comercial antes de implementar.

### O perigo estrutural

`POST /accounts/{id}/conversations/{conv_id}/messages` com `message_type: "outgoing"` envia a
mensagem **para o contato da conversa — ou seja, para o cliente**. Para notificar o vendedor, o
correto é **nota privada** (`private: true`).

⚠⚠ **O cliente reaproveitado é perigoso como está.** Em `chatwoot/client.ts:229-245`:

```ts
enviarMensagem(conversationId, conteudo, opcoes: { privado?: boolean } = {})
// corpo: { message_type: "outgoing", private: opcoes.privado ?? false }
```

**Omitir o parâmetro manda a mensagem para o cliente.** Um grep de CI não pega isso: o código
errado não contém a string `outgoing` — ele apenas *esquece* `{ privado: true }`.

**A defesa é o tipo, não a disciplina.** Criar `enviarNotaPrivada(conversationId, texto)` como
**único** ponto de contato, com `private: true` fixo e **sem parâmetro capaz de expressar o
contrário**. Import direto do cliente cru proibido por grep de invariante.

### Filtro de conversas por vendedor

⚠ O parâmetro `agent_id` em `GET /conversations` **costuma ser ignorado**. Usar
`POST /conversations/filter?status=open` com payload de `attribute_key: assignee_id`,
`filter_operator: equal_to`, `values: [agent_id]`.

⚠ Ler o responsável por `meta.assignee.id` **junto com `meta.assignee_type`** — um AgentBot e um
agente podem ter o mesmo id numérico.

### Quando não há conversa aberta

O sistema **não cria conversa** — registra "sem conversa" e segue. A task do ClickUp existe do
mesmo jeito. Criar conversa é **NÃO CONFIRMADO** como endpoint, e fora da janela de 24h do
WhatsApp a Meta exige template aprovado: a conversa criada seria um registro que ninguém recebe.

---

## Contrato da camada de disparo

Interface única, com implementações por canal. Nenhuma implementação conhece kill-switch,
idempotência ou dry-run — **tudo vive no orquestrador**; se cada uma checasse, bastaria uma
esquecer.

```
Notificador {
  previa(sinal)    → PURA: sem rede, sem escrita. Estruturalmente incapaz de disparar.
  disparar(sinal)  → o caminho real
}
```

A ordem das guardas e o tratamento de erro estão no [ADR-0004](decisions.md). O essencial:

- **prévia é caminho de código separado**, não flag — com flag, um `if` esquecido escreve em
  produção;
- **idempotência vem antes do dry-run**, para a prévia mostrar o conjunto real e a revisão humana
  não conferir ficção;
- `401`/`403` **nunca** dão retry: abrem incidente e **desligam o canal**;
- `400`/`404`/`422` nunca dão retry — retry mascara bug de payload;
- **rate limiter próprio por destino**, jamais o do Conexa;
- **todos os defaults fecham**.

## Configuração

Toggle por canal, thresholds e roster vivem na tela `/configuracoes`, em banco, com auditoria de
quem mudou. A variável de ambiente é o **kill-switch de emergência**, que funciona mesmo com a UI
quebrada. Ver [ADR-0009](decisions.md).

## Falhas de integração

Trilha **separada** dos sinais: endpoint fora do ar, token expirado, configuração que mudou em
silêncio (lista recriada ganha id novo; opção de campo renomeada). Agrupadas por assinatura —
endpoint caído por 2h vira **1 incidente com contador**, não 480 linhas.

⚠ O modo de falha mais traiçoeiro: **tasks param de aparecer sem erro visível**, porque o
`list_id` mudou. Daí a verificação de configuração no boot.
