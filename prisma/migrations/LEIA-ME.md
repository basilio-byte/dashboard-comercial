# Política de migrations

## ⚠ A partir do primeiro deploy, migration é APENAS ADITIVA

Durante o desenvolvimento inicial, antes de existir qualquer banco real, esta
pasta foi **regerada do zero cinco vezes** — sempre com uma migration só,
renomeada a cada mudança de schema:

```
20260825000000_esqueleto_inicial
20260826000000_esqueleto_e_espelho
20260826010000_inicial
20260826020000_inicial
20260826030000_inicial   ← a que está aplicada em produção
```

Era conveniente e inofensivo enquanto nenhum banco tinha estado. **Deixou de
ser** no momento em que o sistema subiu no Easypanel.

**Por quê.** O `docker-entrypoint.sh` roda `prisma migrate deploy` no boot, com
`set -e`. O Postgres guarda em `_prisma_migrations` o nome do que já aplicou. Se
esta pasta for regerada com outro nome, o Prisma vê uma migration desconhecida
sobre um banco que já tem as tabelas, falha com
`type "UserRole" already exists`, e **o container não sobe**. Aconteceu no banco
de teste em 2026-08-26.

## O fluxo correto, daqui em diante

```bash
# 1. altere prisma/schema.prisma
# 2. gere uma migration NOVA, aditiva:
npx prisma migrate dev --name descreve_a_mudanca
# 3. confira o SQL gerado antes de commitar
```

Nunca apagar nem renomear uma migration já publicada na `main`.

## Se o banco ficar dessincronizado mesmo assim

O sintoma é o container em loop de reinício com erro de migration no log. O
conserto, **só quando o estado do banco realmente corresponde ao schema**:

```bash
# de dentro do container ou de um com acesso ao banco
node ./prisma-cli/node_modules/prisma/build/index.js \
  migrate resolve --applied <nome_da_migration>
```

Isso marca a migration como aplicada sem executá-la. Só use sabendo que as
tabelas já estão como o schema espera — senão o banco fica mentindo sobre si.
