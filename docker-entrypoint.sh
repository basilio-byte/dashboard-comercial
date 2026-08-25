#!/bin/sh
set -e

# Aplica migrations pendentes antes de subir a aplicação. Idempotente.
#
# O CLI do Prisma é invocado DIRETO pelo Node, a partir do diretório isolado
# `prisma-cli/` (ver Dockerfile, stage `prisma-cli`): a imagem standalone do
# Next não traz `node_modules/.bin`, então `npx prisma` falha no boot com
# "prisma: not found"; e copiar só a pasta `prisma` não basta, porque o CLI tem
# dependências transitivas próprias. Os dois erros foram vividos no projeto
# irmão antes de a imagem ir para produção.
PRISMA_CLI="./prisma-cli/node_modules/prisma/build/index.js"

if [ ! -f "$PRISMA_CLI" ]; then
  echo "[entrypoint] ERRO: CLI do Prisma não encontrado em $PRISMA_CLI" >&2
  exit 1
fi

echo "[entrypoint] Aplicando migrations do banco (prisma migrate deploy)..."
node "$PRISMA_CLI" migrate deploy

# Primeiro administrador. Idempotente — nunca sobrescreve senha existente.
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  echo "[entrypoint] Verificando usuário administrador..."
  node ./scripts/bootstrap-admin.mjs
fi

echo "[entrypoint] Iniciando aplicação: $*"
# `exec` para o processo do Node herdar o PID do shell e receber os sinais que
# o tini encaminha — ver o stage runner do Dockerfile.
exec "$@"
