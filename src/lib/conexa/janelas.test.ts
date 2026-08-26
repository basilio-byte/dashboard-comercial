import { describe, expect, it } from "vitest";
import { ENTIDADES, gerarJanelas, janelasIncrementais, limitesDaJanela } from "./janelas";

describe("limites da janela", () => {
  it("filtro de DATA aceita data pura", () => {
    expect(limitesDaJanela("2026-06", "data")).toEqual({ de: "2026-06-01", ate: "2026-06-30" });
  });

  it("filtro de DATETIME exige ISO com offset — data pura devolve 400", () => {
    // Formato medido contra a API: "The format of createdAtFrom should be Y-m-d\TH:i:sP"
    expect(limitesDaJanela("2026-06", "datetime")).toEqual({
      de: "2026-06-01T00:00:00-03:00",
      ate: "2026-06-30T23:59:59-03:00",
    });
  });

  it("acerta o último dia de meses de 31, 30 e fevereiro", () => {
    expect(limitesDaJanela("2026-01", "data").ate).toBe("2026-01-31");
    expect(limitesDaJanela("2026-04", "data").ate).toBe("2026-04-30");
    expect(limitesDaJanela("2026-02", "data").ate).toBe("2026-02-28");
    expect(limitesDaJanela("2024-02", "data").ate).toBe("2024-02-29"); // bissexto
  });
});

describe("geração de janelas", () => {
  it("cobre o intervalo inteiro, inclusive nas duas pontas", () => {
    expect(gerarJanelas("2026-01", "2026-04")).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  it("atravessa a virada de ano", () => {
    expect(gerarJanelas("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("intervalo de um mês só devolve uma janela", () => {
    expect(gerarJanelas("2026-03", "2026-03")).toEqual(["2026-03"]);
  });

  it("não entra em laço quando o fim é anterior ao início", () => {
    const r = gerarJanelas("2026-05", "2026-01");
    expect(r.length).toBeLessThan(1200);
    expect(r[0]).toBe("2026-05");
  });

  it("o histórico da Seahub cabe num número tratável de janelas", () => {
    // ~9 anos de dados = ~110 janelas por entidade.
    expect(gerarJanelas("2017-01", "2026-08").length).toBe(116);
  });
});

describe("janelas incrementais", () => {
  it("entidade IMUTÁVEL revisita só a janela corrente", () => {
    // createdAt nunca muda: registro novo nasce na janela corrente.
    expect(ENTIDADES.sales.imutavel).toBe(true);
    expect(janelasIncrementais("sales", "2026-08")).toEqual(["2026-08"]);
  });

  it("entidade MUTÁVEL revisita as vizinhas — o registro migra de janela", () => {
    // dueDate é editável: a cobrança sai de uma janela e entra em outra, e a
    // janela de DESTINO precisa ser revisitada, inclusive à frente.
    expect(ENTIDADES.charges.imutavel).toBe(false);
    expect(janelasIncrementais("charges", "2026-08", 2)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  it("atravessa a virada de ano para trás", () => {
    expect(janelasIncrementais("charges", "2026-01", 2)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

describe("definições das entidades", () => {
  it("cobranças NÃO usam createdAt — a API não expõe esse filtro", () => {
    // Medido: /charges com createdAtFrom devolve ZERO, silenciosamente.
    expect(ENTIDADES.charges.filtro).toBe("dueDate");
    expect(ENTIDADES.charges.formato).toBe("data");
  });

  it("as entidades recortadas por createdAt estão marcadas como imutáveis", () => {
    for (const [nome, def] of Object.entries(ENTIDADES)) {
      if (def.filtro === "createdAt") {
        expect(def.imutavel, `${nome} recorta por createdAt e deveria ser imutável`).toBe(true);
        expect(def.formato, `${nome} usa datetime`).toBe("datetime");
      }
    }
  });
});
