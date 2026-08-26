import { describe, expect, it } from "vitest";
import {
  contaComoReceita,
  estaCancelada,
  estaEmQueda,
  participacao,
  serieMensal,
  somarReceita,
  topClientes,
  valorFaturado,
  type CobrancaParaReceita,
} from "./receita";
import { money } from "@/lib/money";
import { ultimosMesesFechados, ultimoMesFechado } from "@/lib/dates";

const cobranca = (over: Partial<CobrancaParaReceita> = {}): CobrancaParaReceita => ({
  status: "paid",
  amount: 100,
  currentAmount: 100,
  ...over,
});

describe("régua de receita", () => {
  it("usa currentAmount, não amount — é o que a tela do Conexa soma", () => {
    // Cobrança vencida com juros: amount 100, currentAmount 107,35.
    expect(valorFaturado(cobranca({ amount: 100, currentAmount: 107.35 })).toFixed(2)).toBe("107.35");
  });

  it("cai para amount quando currentAmount não vem", () => {
    expect(valorFaturado(cobranca({ amount: 250.5, currentAmount: null })).toFixed(2)).toBe("250.50");
    expect(valorFaturado(cobranca({ amount: 250.5, currentAmount: undefined })).toFixed(2)).toBe("250.50");
  });

  it("trata cancelada por status E por cancelDate", () => {
    expect(estaCancelada(cobranca({ status: "cancelled" }))).toBe(true);
    expect(estaCancelada(cobranca({ status: "canceled" }))).toBe(true);
    expect(estaCancelada(cobranca({ status: "billedCancelled" }))).toBe(true);
    // status benigno mas com data de cancelamento: ainda é cancelada
    expect(estaCancelada(cobranca({ status: "paid", cancelDate: "2026-03-10" }))).toBe(true);
    expect(estaCancelada(cobranca({ status: "unpaid" }))).toBe(false);
  });

  it("exclui negotiated — somar a original e a nova é dupla contagem", () => {
    expect(contaComoReceita(cobranca({ status: "negotiated" }))).toBe(false);
    expect(contaComoReceita(cobranca({ status: "unpaid" }))).toBe(true);
  });

  it("soma só as reconhecidas e devolve a contagem", () => {
    const r = somarReceita([
      cobranca({ amount: 100, currentAmount: 100 }),
      cobranca({ amount: 50, currentAmount: 50 }),
      cobranca({ status: "cancelled", amount: 999, currentAmount: 999 }),
      cobranca({ status: "negotiated", amount: 888, currentAmount: 888 }),
    ]);
    expect(r.total.toFixed(2)).toBe("150.00");
    expect(r.contagem).toBe(2);
  });

  it("não perde centavos somando muitos valores (sem float binário)", () => {
    // 0.1 + 0.2 !== 0.3 em float; aqui tem de dar exato.
    const r = somarReceita([
      cobranca({ amount: 0.1, currentAmount: 0.1 }),
      cobranca({ amount: 0.2, currentAmount: 0.2 }),
    ]);
    expect(r.total.toFixed(2)).toBe("0.30");

    const mil = Array.from({ length: 1000 }, () => cobranca({ amount: 0.07, currentAmount: 0.07 }));
    expect(somarReceita(mil).total.toFixed(2)).toBe("70.00");
  });
});

describe("série mensal e variação", () => {
  it("preenche mês sem cobrança com zero, em vez de sumir com ele", () => {
    const porMes = new Map<string, CobrancaParaReceita[]>([
      ["2026-01", [cobranca({ amount: 100, currentAmount: 100 })]],
      ["2026-03", [cobranca({ amount: 300, currentAmount: 300 })]],
    ]);
    const s = serieMensal(porMes, ["2026-01", "2026-02", "2026-03"]);
    expect(s.map((p) => p.mesKey)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(s[1]!.receita.toFixed(2)).toBe("0.00");
    expect(s[1]!.cobrancas).toBe(0);
  });

  it("calcula a variação contra o mês imediatamente anterior", () => {
    const porMes = new Map<string, CobrancaParaReceita[]>([
      ["2026-01", [cobranca({ amount: 1000, currentAmount: 1000 })]],
      ["2026-02", [cobranca({ amount: 800, currentAmount: 800 })]],
    ]);
    const s = serieMensal(porMes, ["2026-01", "2026-02"]);
    expect(s[0]!.variacaoPct).toBeNull(); // não há anterior
    expect(s[1]!.variacaoPct).toBe(-20);
  });

  it("variação é NULL quando o mês anterior é zero — não é queda de 100%", () => {
    const porMes = new Map<string, CobrancaParaReceita[]>([
      ["2026-01", []],
      ["2026-02", [cobranca({ amount: 500, currentAmount: 500 })]],
      ["2026-03", []],
    ]);
    const s = serieMensal(porMes, ["2026-01", "2026-02", "2026-03"]);
    expect(s[1]!.variacaoPct).toBeNull(); // estreou: 0 -> 500 não é "+∞%"
    expect(s[2]!.variacaoPct).toBe(-100); // 500 -> 0 é queda real de 100%
  });

  it("cliente sem base NÃO é marcado em queda", () => {
    const semBase = { mesKey: "2026-02", receita: money(0), cobrancas: 0, variacaoPct: null };
    expect(estaEmQueda(semBase, 30)).toBe(false);
  });

  it("marca em queda a partir do limiar, inclusive", () => {
    const p = (v: number) => ({ mesKey: "2026-02", receita: money(1), cobrancas: 1, variacaoPct: v });
    expect(estaEmQueda(p(-29.99), 30)).toBe(false);
    expect(estaEmQueda(p(-30), 30)).toBe(true);
    expect(estaEmQueda(p(-55), 30)).toBe(true);
    expect(estaEmQueda(p(+40), 30)).toBe(false);
    // limiar informado como positivo ou negativo dá no mesmo
    expect(estaEmQueda(p(-30), -30)).toBe(true);
  });
});

describe("meses fechados", () => {
  it("nunca inclui o mês corrente — no dia 3, comparar 3 dias com 31 é falso positivo", () => {
    const dia3 = new Date(2026, 2, 3); // 3 de março de 2026
    const meses = ultimosMesesFechados(3, dia3);
    expect(meses).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(meses).not.toContain("2026-03");
  });

  it("vale também no último dia do mês", () => {
    const dia31 = new Date(2026, 0, 31); // 31 de janeiro
    expect(ultimoMesFechado(dia31)).toBe("2025-12");
  });

  it("atravessa a virada de ano corretamente", () => {
    const jan1 = new Date(2026, 0, 1);
    expect(ultimosMesesFechados(2, jan1)).toEqual(["2025-11", "2025-12"]);
  });
});

describe("top clientes", () => {
  const c = (id: number, nome: string, v: number) => ({
    customerConexaId: id,
    nome,
    receita: money(v),
  });

  it("ordena por receita decrescente e corta em N", () => {
    const top = topClientes([c(1, "A", 100), c(2, "B", 500), c(3, "C", 300)], 2);
    expect(top.map((x) => x.nome)).toEqual(["B", "C"]);
  });

  it("desempata por id para a ordem ser determinística entre execuções", () => {
    const top = topClientes([c(9, "Z", 100), c(2, "B", 100), c(5, "M", 100)], 3);
    expect(top.map((x) => x.customerConexaId)).toEqual([2, 5, 9]);
  });

  it("descarta receita zero — não é 'melhor cliente'", () => {
    expect(topClientes([c(1, "A", 0), c(2, "B", 10)], 5).map((x) => x.nome)).toEqual(["B"]);
  });

  it("participação é null quando o total é zero", () => {
    expect(participacao(money(0), money(0))).toBeNull();
    expect(participacao(money(25), money(200))).toBe(12.5);
  });
});
