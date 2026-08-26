/**
 * Dados SINTÉTICOS para desenvolvimento e demonstração.
 *
 * Existe porque, sem ele, a única forma de ver uma tela com número era apontar
 * a máquina de desenvolvimento para a **API de produção** e consumir ~1.270
 * requisições do rate limit compartilhado. Isso torna "entender o sistema" caro
 * e arriscado, e trava quem não tem o token.
 *
 * ⚠ **Nada aqui é dado real.** Nomes e valores são inventados de propósito, e
 * os ids ficam numa faixa alta (900000+) que não colide com o Conexa — se um
 * banco de demonstração for sincronizado por engano, os registros sintéticos
 * não se misturam aos reais nem os sobrescrevem.
 *
 * O seed marca as janelas de sync como CONCLUIDA para o **selo de completude**
 * ficar verde: sem isso as telas mostrariam "não disponível" e a demonstração
 * não mostraria nada. Ver src/lib/intel/completude.ts.
 *
 *   npm run db:seed
 */
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/** Faixa que não colide com ids reais do Conexa. */
const BASE = 900_000;
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

/** 'yyyy-MM' de N meses atrás, no relógio de parede. */
function mesAtras(n: number): string {
  const d = new Date();
  const alvo = new Date(Date.UTC(d.getFullYear(), d.getMonth() - n, 1));
  return `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, "0")}`;
}
function diaUtc(ano: number, mes: number, dia: number) {
  return new Date(Date.UTC(ano, mes - 1, dia));
}

async function main() {
  console.log("[seed] limpando dados sintéticos anteriores…");
  await prisma.$transaction([
    prisma.customerMonthlyRevenue.deleteMany({ where: { customerConexaId: { gte: BASE } } }),
    prisma.customerProfile.deleteMany({ where: { customerConexaId: { gte: BASE } } }),
    prisma.roomBooking.deleteMany({ where: { conexaId: { gte: BASE } } }),
    prisma.charge.deleteMany({ where: { conexaId: { gte: BASE } } }),
    prisma.sale.deleteMany({ where: { conexaId: { gte: BASE } } }),
    prisma.contract.deleteMany({ where: { conexaId: { gte: BASE } } }),
    prisma.customer.deleteMany({ where: { conexaId: { gte: BASE } } }),
    prisma.plan.deleteMany({ where: { conexaId: { gte: BASE } } }),
    prisma.serviceCategory.deleteMany({ where: { conexaId: { gte: BASE } } }),
    prisma.company.deleteMany({ where: { conexaId: { gte: BASE } } }),
  ]);

  // ---- admin -------------------------------------------------------------
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@seahub.local";
  const senha = process.env.SEED_ADMIN_PASSWORD ?? "seahub-dev-123";
  await prisma.user.upsert({
    where: { email },
    create: { email, name: "Administrador (dev)", passwordHash: await bcrypt.hash(senha, 12), role: "ADMIN" },
    update: {},
  });
  console.log(`[seed] admin: ${email} / ${senha}`);

  // ---- dimensões ---------------------------------------------------------
  await prisma.company.create({ data: { conexaId: BASE + 1, name: "Seaway (demo)", raw: {} } });
  await prisma.serviceCategory.createMany({
    data: [
      { conexaId: BASE + 1, name: "Endereço Fiscal (demo)", raw: {} },
      { conexaId: BASE + 2, name: "Salas Privativas (demo)", raw: {} },
    ],
  });

  // Os tiers reais medidos na Fase 0: Litoral sem cota, Batial 2h, Abissal 8h.
  // A distinção "sem cota é null, não zero" é o que a regra 10 usa.
  const planos = [
    { id: BASE + 1, nome: "EF Litoral (demo)", horas: null, cat: BASE + 1 },
    { id: BASE + 2, nome: "EF Batial (demo)", horas: 2, cat: BASE + 1 },
    { id: BASE + 3, nome: "EF Abissal (demo)", horas: 8, cat: BASE + 1 },
    { id: BASE + 4, nome: "Sala Privativa 04 (demo)", horas: 25, cat: BASE + 2 },
  ];
  for (const p of planos) {
    await prisma.plan.create({
      data: {
        conexaId: p.id,
        companyConexaId: BASE + 1,
        name: p.nome,
        serviceCategoryConexaId: p.cat,
        horasInclusasMes: p.horas === null ? null : dec(p.horas),
        raw: {},
      },
    });
  }

  // ---- clientes, contratos, consumo --------------------------------------
  const hoje = new Date();
  const perfis = [
    // Estoura a cota em 3 ciclos seguidos → deve aparecer no Radar.
    { nome: "Contabilidade Farol (demo)", plano: BASE + 3, cota: 8, usoPorCiclo: 8, excedente: 3.5, receita: 2400 },
    // Usa metade da cota — não é sinal.
    { nome: "Estúdio Maré (demo)", plano: BASE + 3, cota: 8, usoPorCiclo: 4, excedente: 0, receita: 1800 },
    // Litoral: SEM cota. Toda reserva é faturada, e isso NÃO é estouro.
    { nome: "Advocacia Recife (demo)", plano: BASE + 1, cota: null, usoPorCiclo: 0, excedente: 6, receita: 900 },
    // Estoura em 1 ciclo só — não é recorrente, não deve virar sinal.
    { nome: "Clínica Dunas (demo)", plano: BASE + 2, cota: 2, usoPorCiclo: 2, excedente: 0, receita: 1200 },
    { nome: "Sala 04 — Coworking Norte (demo)", plano: BASE + 4, cota: 25, usoPorCiclo: 12, excedente: 0, receita: 5200 },
  ];

  let bookingId = BASE;
  let chargeId = BASE;

  for (let i = 0; i < perfis.length; i++) {
    const p = perfis[i]!;
    const cid = BASE + 10 + i;
    // Contrato começa no dia 8 para o ciclo não coincidir com o mês-calendário —
    // é justamente essa diferença que a aritmética de ciclo trata.
    const inicio = diaUtc(hoje.getUTCFullYear() - 1, 3, 8);

    await prisma.customer.create({
      data: { conexaId: cid, companyConexaId: BASE + 1, name: p.nome, isActive: true, isBlocked: false, raw: {} },
    });
    await prisma.contract.create({
      data: {
        conexaId: BASE + 100 + i,
        customerConexaId: cid,
        planConexaId: p.plano,
        companyConexaId: BASE + 1,
        amount: dec(p.receita),
        startDate: inicio,
        isActive: true,
        raw: {},
      },
    });

    // Reservas dos últimos 4 ciclos.
    for (let c = 0; c < 4; c++) {
      const dia = diaUtc(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1 - c, 15);
      if (p.usoPorCiclo > 0) {
        await prisma.roomBooking.create({
          data: {
            conexaId: ++bookingId,
            customerConexaId: cid,
            status: "deductedFromQuota",
            isActive: true,
            placeName: "Sala de Reunião 01 (demo)",
            startTime: dia,
            finalTime: new Date(dia.getTime() + p.usoPorCiclo * 3_600_000),
            horas: dec(p.usoPorCiclo),
            dataLocal: dia,
            raw: {},
          },
        });
      }
      // Excedente só nos ciclos fechados (c >= 1), para o sinal exigir recorrência.
      if (p.excedente > 0 && c >= 1) {
        await prisma.roomBooking.create({
          data: {
            conexaId: ++bookingId,
            customerConexaId: cid,
            status: "paid",
            isActive: true,
            placeName: "Sala de Reunião 02 (demo)",
            startTime: dia,
            finalTime: new Date(dia.getTime() + p.excedente * 3_600_000),
            horas: dec(p.excedente),
            dataLocal: dia,
            raw: {},
          },
        });
      }
    }

    // Cobranças dos últimos 13 meses, com uma queda no penúltimo para a tela
    // de queda de receita ter o que mostrar.
    for (let m = 0; m <= 13; m++) {
      const mes = mesAtras(m);
      const [ano, mm] = mes.split("-").map(Number);
      const queda = i === 1 && m === 1 ? 0.4 : 1;
      await prisma.charge.create({
        data: {
          conexaId: ++chargeId,
          customerConexaId: cid,
          companyConexaId: BASE + 1,
          status: "paid",
          amount: dec(p.receita * queda),
          currentAmount: dec(p.receita * queda),
          emissionDate: diaUtc(ano!, mm!, 5),
          dueDate: diaUtc(ano!, mm!, 15),
          paymentDate: diaUtc(ano!, mm!, 14),
          raw: {},
        },
      });
    }
  }

  // ---- selo de completude ------------------------------------------------
  // Sem janelas CONCLUIDA e sem "fundo" encontrado, o espelho é considerado
  // incompleto e TODA tela mostra "não disponível" — de propósito. Para a
  // demonstração fazer sentido, o seed declara a carga completa.
  const entidades = ["customers", "contracts", "charges", "sales", "bookings"] as const;
  const fundo = mesAtras(14);
  for (const e of entidades) {
    await prisma.syncState.upsert({
      where: { key: `fundo:${e}` },
      create: { key: `fundo:${e}`, cursor: fundo },
      update: { cursor: fundo },
    });
    for (let m = 0; m <= 14; m++) {
      const janela = mesAtras(m);
      await prisma.syncWindow.upsert({
        where: { entidade_janela: { entidade: e, janela } },
        create: { entidade: e, janela, status: "CONCLUIDA", registros: 1, concluidaEm: new Date() },
        update: { status: "CONCLUIDA", concluidaEm: new Date() },
      });
    }
  }
  await prisma.syncRun.create({
    data: { mode: "dimensions", status: "SUCCESS", finishedAt: new Date(), recordsWrote: perfis.length },
  });

  console.log(`[seed] ${perfis.length} clientes, ${bookingId - BASE} reservas, ${chargeId - BASE} cobranças`);
  console.log("[seed] rode a consolidação em Motor → 'Consolidar inteligência' para as telas de receita");
}

main()
  .catch((e) => {
    console.error("[seed] falhou:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
