import { describe, expect, it } from "vitest";
import {
  abatidaDaCota,
  addMesesClamp,
  avaliarExcedente,
  ciclosFechados,
  cicloVigente,
  consolidarCiclo,
  faturada,
  type ReservaParaConsumo,
} from "./horas";
import { money } from "@/lib/money";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("aniversário do ciclo", () => {
  it("reproduz o exemplo dado pelo responsável (contratou 26/08)", () => {
    // "contratou 26/08, o pacote vai até 25/09; 26/09 sobe um novo pacote"
    const c = cicloVigente(d("2026-08-26"), d("2026-09-10"))!;
    expect(c.inicio).toEqual(d("2026-08-26"));
    expect(c.fimExclusivo).toEqual(d("2026-09-26")); // exclusivo: cobre até 25/09
    expect(c.rotulo).toBe("26/08–25/09");
  });

  it("vira para o ciclo seguinte exatamente no aniversário", () => {
    const inicio = d("2026-08-26");
    expect(cicloVigente(inicio, d("2026-09-25"))!.inicio).toEqual(d("2026-08-26"));
    expect(cicloVigente(inicio, d("2026-09-26"))!.inicio).toEqual(d("2026-09-26"));
  });

  it("não existe ciclo antes do contrato começar", () => {
    expect(cicloVigente(d("2026-08-26"), d("2026-08-25"))).toBeNull();
  });

  it("o primeiro dia do contrato já está no primeiro ciclo", () => {
    const c = cicloVigente(d("2026-08-26"), d("2026-08-26"))!;
    expect(c.inicio).toEqual(d("2026-08-26"));
  });

  it("faz clamp em mês curto — contrato no dia 31 não escorrega para março", () => {
    expect(addMesesClamp(d("2026-01-31"), 1)).toEqual(d("2026-02-28"));
    const c = cicloVigente(d("2026-01-31"), d("2026-02-15"))!;
    expect(c.inicio).toEqual(d("2026-01-31"));
    expect(c.fimExclusivo).toEqual(d("2026-02-28"));
  });

  it("volta ao dia original depois do mês curto", () => {
    // Fevereiro trunca para 28, mas março tem de voltar ao 31.
    expect(addMesesClamp(d("2026-01-31"), 2)).toEqual(d("2026-03-31"));
    const c = cicloVigente(d("2026-01-31"), d("2026-03-05"))!;
    expect(c.inicio).toEqual(d("2026-02-28"));
    expect(c.fimExclusivo).toEqual(d("2026-03-31"));
  });

  it("atravessa a virada de ano", () => {
    const c = cicloVigente(d("2025-12-15"), d("2026-01-20"))!;
    expect(c.inicio).toEqual(d("2026-01-15"));
    expect(c.fimExclusivo).toEqual(d("2026-02-15"));
  });

  it("acerta o ciclo anos depois do início, sem derivar", () => {
    // O ponto do aniversário mensal: mesmo 3 anos depois, o dia é o mesmo.
    const c = cicloVigente(d("2023-03-07"), d("2026-08-20"))!;
    expect(c.inicio).toEqual(d("2026-08-07"));
    expect(c.fimExclusivo).toEqual(d("2026-09-07"));
  });

  it("ciclos fechados vêm do mais antigo para o mais novo e excluem o vigente", () => {
    const cs = ciclosFechados(d("2026-01-10"), d("2026-05-15"), 3);
    expect(cs.map((c) => c.inicio)).toEqual([d("2026-02-10"), d("2026-03-10"), d("2026-04-10")]);
    // o vigente (10/05) não entra
    expect(cs.some((c) => c.inicio.getTime() === d("2026-05-10").getTime())).toBe(false);
  });

  it("não inventa ciclo anterior ao contrato", () => {
    const cs = ciclosFechados(d("2026-04-10"), d("2026-05-15"), 6);
    expect(cs).toHaveLength(1);
    expect(cs[0]!.inicio).toEqual(d("2026-04-10"));
  });
});

describe("classificação da reserva", () => {
  const r = (o: Partial<ReservaParaConsumo>): ReservaParaConsumo => ({
    status: "deductedFromQuota",
    isActive: true,
    horas: 2,
    dataLocal: d("2026-08-30"),
    ...o,
  });

  it("abatida da cota é o que o Conexa marcou como tal", () => {
    expect(abatidaDaCota(r({}))).toBe(true);
    expect(abatidaDaCota(r({ status: "billed" }))).toBe(false);
  });

  it("notBilled é balde próprio — nem abatido, nem faturado", () => {
    // Status real, medido em produção. Ambíguo entre cortesia e cobrança
    // pendente, então não entra no consumo.
    const c = consolidarCiclo(
      { inicio: d("2026-08-26"), fimExclusivo: d("2026-09-26"), rotulo: "x" },
      [{ status: "notBilled", isActive: true, horas: 3, dataLocal: d("2026-09-01") }],
      money(5),
    );
    expect(c.abatido.toFixed(2)).toBe("0.00");
    expect(c.faturado.toFixed(2)).toBe("0.00");
    expect(c.naoFaturado.toFixed(2)).toBe("3.00");
    expect(c.consumido.toFixed(2)).toBe("0.00");
    expect(c.estourou).toBe(false);
  });

  it("cancelada não conta, mesmo marcada como abatida", () => {
    expect(abatidaDaCota(r({ cancellationReason: "cliente desistiu" }))).toBe(false);
    expect(abatidaDaCota(r({ isActive: false }))).toBe(false);
    expect(faturada(r({ status: "billed", cancellationReason: "x" }))).toBe(false);
  });
});

describe("consolidação do ciclo", () => {
  const ciclo = { inicio: d("2026-08-26"), fimExclusivo: d("2026-09-26"), rotulo: "26/08–25/09" };
  const res = (o: Partial<ReservaParaConsumo>): ReservaParaConsumo => ({
    status: "deductedFromQuota",
    isActive: true,
    horas: 1,
    dataLocal: d("2026-09-01"),
    ...o,
  });

  it("ignora reserva fora da janela do ciclo", () => {
    const c = consolidarCiclo(
      ciclo,
      [res({ dataLocal: d("2026-08-25") }), res({ dataLocal: d("2026-09-26") }), res({})],
      money(5),
    );
    expect(c.reservas).toBe(1);
    expect(c.abatido.toFixed(2)).toBe("1.00");
  });

  it("saldo é a cota menos o abatido", () => {
    const c = consolidarCiclo(ciclo, [res({ horas: 2 }), res({ horas: 1.5 })], money(6));
    expect(c.abatido.toFixed(2)).toBe("3.50");
    expect(c.saldo!.toFixed(2)).toBe("2.50");
    expect(c.estourou).toBe(false);
  });

  it("excedente é o que o Conexa FATUROU, não o nosso cálculo", () => {
    // Cota 5h: o ERP abateu 5h e faturou 2h. Somamos o que ele decidiu.
    const c = consolidarCiclo(
      ciclo,
      [res({ horas: 5 }), res({ status: "billed", horas: 2 })],
      money(5),
    );
    expect(c.abatido.toFixed(2)).toBe("5.00");
    expect(c.faturado.toFixed(2)).toBe("2.00");
    expect(c.consumido.toFixed(2)).toBe("7.00");
    expect(c.saldo!.toFixed(2)).toBe("0.00");
    expect(c.estourou).toBe(true);
  });

  it("plano SEM cota: saldo é null, e reserva faturada não é 'estouro'", () => {
    // É o Endereço Fiscal Litoral — toda reserva é faturada por desenho.
    const c = consolidarCiclo(ciclo, [res({ status: "billed", horas: 3 })], null);
    expect(c.concedido).toBeNull();
    expect(c.saldo).toBeNull();
    expect(c.faturado.toFixed(2)).toBe("3.00");
    expect(c.estourou).toBe(false);
  });

  it("sem carry-over: a cota do ciclo é sempre cheia, não sobra do anterior", () => {
    const anterior = consolidarCiclo(ciclo, [], money(6));
    expect(anterior.saldo!.toFixed(2)).toBe("6.00"); // não usou nada
    const seguinte = consolidarCiclo(
      { inicio: d("2026-09-26"), fimExclusivo: d("2026-10-26"), rotulo: "26/09–25/10" },
      [res({ dataLocal: d("2026-10-01"), horas: 2 })],
      money(6), // cota cheia de novo — as 6h não usadas expiraram
    );
    expect(seguinte.saldo!.toFixed(2)).toBe("4.00");
  });
});

describe("bugs que a auditoria adversarial encontrou", () => {
  const ciclo = { inicio: d("2026-08-26"), fimExclusivo: d("2026-09-26"), rotulo: "x" };
  const r = (o: Partial<ReservaParaConsumo>): ReservaParaConsumo => ({
    status: "deductedFromQuota",
    isActive: true,
    horas: 1,
    dataLocal: d("2026-09-01"),
    ...o,
  });

  it("reserva paga com a cota INTACTA não é estouro", () => {
    // O bug: cliente Abissal (8h) usa 2h da cota e 1h de auditório pago (sala
    // fora do grupo da cota). A versão antiga marcava "estoura a cota" com 6h
    // de saldo na linha ao lado — 25% de uso.
    const c = consolidarCiclo(ciclo, [r({ horas: 2 }), r({ status: "paid", horas: 1 })], money(8));
    expect(c.abatido.toFixed(2)).toBe("2.00");
    expect(c.faturado.toFixed(2)).toBe("1.00");
    expect(c.saldo!.toFixed(2)).toBe("6.00");
    expect(c.estourou).toBe(false);
  });

  it("estouro exige a cota ESGOTADA", () => {
    const c = consolidarCiclo(ciclo, [r({ horas: 5 }), r({ status: "paid", horas: 2 })], money(5));
    expect(c.estourou).toBe(true);
  });

  it("duração ausente vira LACUNA, não zero — e o ciclo fica não-conclusivo", () => {
    // Reserva de 6h com finalTime nulo aparecia como "0h, saldo cheio".
    const c = consolidarCiclo(ciclo, [r({ horas: null })], money(5));
    expect(c.abatido.toFixed(2)).toBe("0.00");
    expect(c.conclusivo).toBe(false);
    expect(c.reservas).toBe(1);
  });

  it("status desconhecido (partiallyPaid) não evapora", () => {
    // Está no enum documentado da API e sumia de todos os baldes.
    const c = consolidarCiclo(ciclo, [r({ status: "partiallyPaid", horas: 3 })], money(5));
    expect(c.horasDesconhecidas.toFixed(2)).toBe("3.00");
    expect(c.conclusivo).toBe(false);
  });

  it("cancelada é descarte legítimo — o ciclo continua conclusivo", () => {
    const c = consolidarCiclo(ciclo, [r({ status: "cancelled", horas: 3 }), r({ horas: 1 })], money(5));
    expect(c.reservasDescartadas).toBe(1);
    expect(c.conclusivo).toBe(true);
    expect(c.abatido.toFixed(2)).toBe("1.00");
  });

  it("ciclo não-conclusivo NÃO vota no sinal de excedente", () => {
    const bom = consolidarCiclo(ciclo, [r({ horas: 5 }), r({ status: "paid", horas: 2 })], money(5));
    const furado = consolidarCiclo(ciclo, [r({ status: "partiallyPaid", horas: 9 })], money(5));
    const s = avaliarExcedente([bom, furado, furado], { minCiclosComEstouro: 2 });
    expect(s.ciclosConclusivos).toBe(1);
    expect(s.ciclosComEstouro).toBe(1);
    expect(s.recorrente).toBe(false); // 1 estouro conclusivo não faz recorrência
  });

  it("cota ZERO não é cota — não gera estouro", () => {
    // quantity nulo virava Decimal(0), passava no `!= null` e marcava a base
    // inteira do plano como estourando.
    const c = consolidarCiclo(ciclo, [r({ status: "paid", horas: 2 })], money(0));
    expect(c.estourou).toBe(false);
  });
});

describe("sinal de excedente recorrente", () => {
  const c = (faturado: number, concedido: number | null, abatido = concedido ?? 0) => ({
    ciclo: { inicio: d("2026-01-01"), fimExclusivo: d("2026-02-01"), rotulo: "x" },
    concedido: concedido === null ? null : money(concedido),
    abatido: money(abatido),
    faturado: money(faturado),
    naoFaturado: money(0),
    horasDesconhecidas: money(0),
    reservasDescartadas: 0,
    consumido: money(abatido + faturado),
    saldo: concedido === null ? null : money(concedido - abatido),
    // cota esgotada E faturado por cima — a regra corrigida
    estourou: concedido !== null && concedido > 0 && abatido >= concedido && faturado > 0,
    conclusivo: true,
    cotaInconsistente: false,
    reservas: 1,
  });

  it("dispara com estouro em 2 dos 3 ciclos", () => {
    // c(faturado, concedido, abatido): estouro exige abatido >= concedido
    const s = avaliarExcedente([c(0, 5, 3), c(2, 5, 5), c(1.5, 5, 5)]);
    expect(s.ciclosComEstouro).toBe(2);
    expect(s.horasExcedentes.toFixed(2)).toBe("3.50");
    expect(s.recorrente).toBe(true);
  });

  it("um estouro isolado NÃO é recorrente — pode ter sido um evento", () => {
    const s = avaliarExcedente([c(0, 5, 2), c(4, 5, 5), c(0, 5, 1)]);
    expect(s.ciclosComEstouro).toBe(1);
    expect(s.recorrente).toBe(false);
  });

  it("limiar de ciclos é configurável", () => {
    expect(avaliarExcedente([c(1, 5, 5)], { minCiclosComEstouro: 1 }).recorrente).toBe(true);
    expect(avaliarExcedente([c(1, 5, 5)], { minCiclosComEstouro: 3 }).recorrente).toBe(false);
  });

  it("uso médio ignora ciclos sem cota, em vez de dividir por zero", () => {
    // 100% (5 de 5) e 60% (3 de 5) → média 80%. O ciclo sem cota fica de fora.
    const s = avaliarExcedente([c(0, 5, 5), c(0, 5, 3), c(0, null, 4)]);
    expect(s.usoMedioPct).toBe(80);
  });

  it("uso médio é null quando nenhum ciclo tem cota", () => {
    expect(avaliarExcedente([c(0, null, 4)]).usoMedioPct).toBeNull();
  });

  it("uso acima de 100% aparece como tal — é o sinal de venda", () => {
    const s = avaliarExcedente([c(3, 5, 5)]); // consumiu 8 de cota 5
    expect(s.usoMedioPct).toBe(160);
  });
});

/**
 * A cota que conhecemos pode estar MENOR que a real — e quando está, o sistema
 * não pode transformar o próprio erro em sinal de venda.
 *
 * Observado em produção em 2026-08-27: 4 de 20 linhas da amostra com saldo
 * derivado negativo, porque a concessão saía de `plan.hourQuotas` ignorando
 * `contract.hourPlanQuota`.
 */
describe("cota inconsistente — abatido acima do concedido", () => {
  const janela = { inicio: d("2026-08-01"), fimExclusivo: d("2026-09-01"), rotulo: "ago" };

  it("marca a inconsistência quando o Conexa abateu mais que a cota", () => {
    // Caso real: #1172 HOMEOFORMULA — cota 2h, abatido 4h.
    const c = consolidarCiclo(
      janela,
      [{ status: "deductedFromQuota", horas: 4, dataLocal: d("2026-08-10") }],
      money(2),
    );
    expect(c.cotaInconsistente).toBe(true);
    // O saldo negativo continua calculado, para a tela poder DECLARÁ-LO.
    expect(Number(c.saldo)).toBe(-2);
  });

  it("⚠ ciclo com cota inconsistente NÃO confirma estouro", () => {
    // Sem esta trava, a cota subestimada torna `abatido >= concedido`
    // trivialmente verdadeiro e `estourou` vira só "existe hora faturada" —
    // exatamente o bug que a regra atual foi escrita para não ter.
    const c = consolidarCiclo(
      janela,
      [
        { status: "deductedFromQuota", horas: 4, dataLocal: d("2026-08-10") },
        { status: "paid", horas: 3, dataLocal: d("2026-08-12") },
      ],
      money(2),
    );
    expect(c.cotaInconsistente).toBe(true);
    expect(c.estourou).toBe(false);
  });

  it("cota exatamente esgotada NÃO é inconsistente — é o estouro legítimo", () => {
    const c = consolidarCiclo(
      janela,
      [
        { status: "deductedFromQuota", horas: 6, dataLocal: d("2026-08-10") },
        { status: "paid", horas: 15, dataLocal: d("2026-08-12") },
      ],
      money(6),
    );
    expect(c.cotaInconsistente).toBe(false);
    expect(c.estourou).toBe(true);
  });

  it("plano sem cota nunca é inconsistente — não há balde para estourar", () => {
    const c = consolidarCiclo(
      janela,
      [{ status: "paid", horas: 9, dataLocal: d("2026-08-10") }],
      null,
    );
    expect(c.cotaInconsistente).toBe(false);
    expect(c.estourou).toBe(false);
  });
});
