# syntax=docker/dockerfile:1

# ---- Base ----
FROM node:22-alpine AS base
# libc compat p/ Prisma engines no Alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---- Dependências ----
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ---- Builder ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Gera o Prisma Client e o build standalone do Next.
RUN npx prisma generate && npm run build

# ---- CLI do Prisma (isolado) ----
# O entrypoint roda `migrate deploy` no boot, então o CLI é dependência de
# RUNTIME. O bundle standalone do Next NÃO traz `node_modules/.bin` nem as deps
# transitivas do CLI — copiar só a pasta `prisma` resultava em
# "sh: prisma: not found" e, depois, "Cannot find module 'effect'".
# Instalamos o CLI num diretório PRÓPRIO (com seu node_modules), para que a
# resolução de módulos dele funcione sem colidir com o bundle da aplicação.
# A versão vem do package-lock — nunca "a mais recente" — para não divergir do
# @prisma/client gerado no builder.
FROM base AS prisma-cli
WORKDIR /cli
COPY package-lock.json ./lock.json
RUN PV=$(node -p "require('/cli/lock.json').packages['node_modules/prisma'].version") \
  && echo '{"name":"prisma-cli","private":true}' > package.json \
  && npm install --no-save --no-audit --no-fund "prisma@$PV" \
  && rm -f lock.json

# ---- Runner (produção) ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# tini como PID 1 — reaping de zumbis e encaminhamento de sinais.
#
# ⚠ Ele NÃO é o que faz o SIGTERM funcionar. Medido nesta imagem: com `exec` no
# entrypoint o Node vira PID 1, e o servidor standalone do Next JÁ instala o
# handler (`next/dist/server/lib/start-server.js`, `process.on('SIGTERM',
# cleanup)`) — `docker stop` sai com código 0 em ~500ms COM e SEM tini.
#
# O que o tini garante é o resto: encaminhar sinais para a árvore de processos e
# colher zumbis se algum dia houver processo filho. É barato e correto — mas não
# resolve sozinho o problema real, que é a aplicação DRENAR o que está em voo
# (parar o agendador, gravar o cursor do backfill, terminar um despacho já
# postado). Isso é código de aplicação, entra na Fase 1. Ver ADR-0008.
RUN apk add --no-cache tini

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Artefatos do build standalone
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma: schema + migrations (para o migrate deploy) e o client gerado (engines)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# CLI do Prisma isolado, com as próprias deps (ver stage prisma-cli).
COPY --from=prisma-cli /cli/node_modules ./prisma-cli/node_modules

# Scripts de bootstrap + bcryptjs, que o Next embute no bundle do servidor e
# portanto NÃO fica disponível em node_modules para scripts avulsos.
# bcryptjs 2.x não tem dependências, então copiar a pasta basta.
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs

COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Fuso do PROCESSO fixado em UTC. A aritmética de ciclo converte explicitamente
# para America/Fortaleza; deixar o processo num fuso deslocado fazia a conta sair
# errada entre 21h e meia-noite. O Alpine cai em UTC por padrão — isto torna a
# premissa explícita em vez de sorte.
ENV TZ=UTC

STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "server.js"]
