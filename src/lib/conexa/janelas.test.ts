import { describe, expect, it } from "vitest";
import {
  ENTIDADES,
  ORDEM_DE_CARGA,
  gerarJanelas,
  janelasIncrementais,
  limitesDaJanela,
} from "./janelas";

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

/**
 * A ordem de carga é uma DECISÃO DE PRODUTO, não estilo.
 *
 * O teto de janelas por execução é global: quem vem primeiro come o orçamento
 * inteiro. Com `sales` na frente — a maior entidade, e a única que não
 * participa de nenhum portão de confiança — a fila do Radar ficava por último.
 * Aconteceu na primeira carga real. Estes testes fazem uma reordenação
 * descuidada falhar em vez de custar horas de carga.
 */
describe("ordem de carga", () => {
  it("cobre todas as entidades, sem repetir nem faltar", () => {
    expect([...ORDEM_DE_CARGA].sort()).toEqual(Object.keys(ENTIDADES).sort());
  });

  it("carrega antes o que destrava a fila do Radar", () => {
    // horasConfiavel = contracts + bookings. É o produto da tela.
    const ultimoDoPortao = Math.max(
      ORDEM_DE_CARGA.indexOf("contracts"),
      ORDEM_DE_CARGA.indexOf("bookings"),
    );
    const outras = ORDEM_DE_CARGA.filter((e) => e !== "contracts" && e !== "bookings");
    expect(ultimoDoPortao).toBeLessThan(Math.min(...outras.map((e) => ORDEM_DE_CARGA.indexOf(e))));
  });

  it("deixa `sales` por último — não participa de portão nenhum", () => {
    expect(ORDEM_DE_CARGA.at(-1)).toBe("sales");
  });
});

/**
 * A janela FUTURA do incremental é a causa do "83/82" que apareceu na tela —
 * e, embaixo dele, de um selo de completude que podia mentir.
 *
 * Entidade mutável ganha uma janela do mês SEGUINTE (um vencimento pode ser
 * empurrado para frente). Ela fecha como CONCLUIDA, mas NÃO pertence ao
 * período histórico. Contá-la deixava uma janela histórica pendente ser
 * compensada pela futura, e a entidade era declarada completa sem estar.
 */
describe("janela futura vs. período histórico", () => {
  const atual = "2026-08";

  it("entidade mutável ganha uma janela além do mês corrente", () => {
    expect(janelasIncrementais("contracts", atual).at(-1)).toBe("2026-09");
    expect(janelasIncrementais("charges", atual).at(-1)).toBe("2026-09");
  });

  it("entidade imutável não ganha janela futura — registro novo nasce na corrente", () => {
    expect(janelasIncrementais("bookings", atual)).toEqual([atual]);
    expect(janelasIncrementais("customers", atual)).toEqual([atual]);
    expect(janelasIncrementais("sales", atual)).toEqual([atual]);
  });

  it("o período histórico PARA no mês corrente — a futura fica de fora", () => {
    const periodo = gerarJanelas("2019-01", atual);
    expect(periodo.at(-1)).toBe(atual);
    expect(periodo).not.toContain("2026-09");
    // É esta diferença que produzia concluídas > totais.
    expect(janelasIncrementais("contracts", atual).some((j) => !periodo.includes(j))).toBe(true);
  });
});

describe("janelasIncrementais — profundidade rasa vs. profunda", () => {
  // ⚠ Estes testes prendem uma MEDIÇÃO, não uma preferência. Os números vêm de
  // 100 registros amostrados da API em 2026-08-27 (ver a nota de
  // `mesesDeRevisita`). Se alguém baixar `sales` para 3 meses "para economizar
  // requisição", 22% das vendas voltam a congelar em silêncio — e o teste é o
  // único lugar onde isso aparece antes de ir para produção.
  it("rasa mantém o comportamento barato: entidade imutável só na janela corrente", () => {
    expect(janelasIncrementais("sales", "2026-08")).toEqual(["2026-08"]);
    expect(janelasIncrementais("bookings", "2026-08")).toEqual(["2026-08"]);
  });

  it("rasa revisita vizinhas nas mutáveis, porque o registro migra de janela", () => {
    const j = janelasIncrementais("charges", "2026-08");
    expect(j).toContain("2026-05");
    expect(j).toContain("2026-09"); // vencimento também é empurrado para frente
  });

  it("profunda alcança a cauda medida de cada entidade", () => {
    // sales: máximo medido de 356 dias entre criação e alteração.
    const vendas = janelasIncrementais("sales", "2026-08", undefined, "profunda");
    expect(vendas).toHaveLength(13); // 12 meses + a corrente
    expect(vendas[0]).toBe("2025-08");

    // bookings: zero alterações além de 90 dias — 3 meses bastam.
    const reservas = janelasIncrementais("bookings", "2026-08", undefined, "profunda");
    expect(reservas).toHaveLength(4);
    expect(reservas[0]).toBe("2026-05");
  });

  it("profunda é mais funda que rasa em toda entidade imutável", () => {
    for (const e of ["customers", "sales", "bookings"] as const) {
      const rasa = janelasIncrementais(e, "2026-08");
      const profunda = janelasIncrementais(e, "2026-08", undefined, "profunda");
      expect(profunda.length, e).toBeGreaterThan(rasa.length);
    }
  });

  it("toda entidade declara profundidade de revisita positiva", () => {
    // Um zero aqui seria "nunca revisita" — o defeito que a medição encontrou,
    // de volta por omissão.
    for (const [nome, def] of Object.entries(ENTIDADES)) {
      expect(def.mesesDeRevisita, nome).toBeGreaterThan(0);
    }
  });
});
