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

describe("sinal de excedente recorrente", () => {
  const c = (faturado: number, concedido: number | null, abatido = concedido ?? 0) => ({
    ciclo: { inicio: d("2026-01-01"), fimExclusivo: d("2026-02-01"), rotulo: "x" },
    concedido: concedido === null ? null : money(concedido),
    abatido: money(abatido),
    faturado: money(faturado),
    naoFaturado: money(0),
    consumido: money(abatido + faturado),
    saldo: concedido === null ? null : money(concedido - abatido),
    estourou: concedido !== null && faturado > 0,
    reservas: 1,
  });

  it("dispara com estouro em 2 dos 3 ciclos", () => {
    const s = avaliarExcedente([c(0, 5, 3), c(2, 5), c(1.5, 5)]);
    expect(s.ciclosComEstouro).toBe(2);
    expect(s.horasExcedentes.toFixed(2)).toBe("3.50");
    expect(s.recorrente).toBe(true);
  });

  it("um estouro isolado NÃO é recorrente — pode ter sido um evento", () => {
    const s = avaliarExcedente([c(0, 5, 2), c(4, 5), c(0, 5, 1)]);
    expect(s.ciclosComEstouro).toBe(1);
    expect(s.recorrente).toBe(false);
  });

  it("limiar de ciclos é configurável", () => {
    expect(avaliarExcedente([c(1, 5)], { minCiclosComEstouro: 1 }).recorrente).toBe(true);
    expect(avaliarExcedente([c(1, 5)], { minCiclosComEstouro: 3 }).recorrente).toBe(false);
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
