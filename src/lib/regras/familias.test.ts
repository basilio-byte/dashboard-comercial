import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import {
  ehSegmentoFiscal,
  ehSegmentoPrivativa,
  litoralReservouSala,
  marcoAtingido,
  primeiraReserva,
  quedaMesAMes,
  quedaPercentual,
  podeOfertar,
  posseDoProduto,
  usoAvulsoAlto,
} from "./familias";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const serie = (...pares: Array<[string, number]>) =>
  pares.map(([mesKey, v]) => ({ mesKey, valor: money(v) }));

describe("MARCO_CONTRATO — regras 1, 6, 7, 8", () => {
  it("dispara no dia do aniversário", () => {
    // Regra 1: Fiscal 11 meses, âncora startDate (decidido em 2026-08-27).
    expect(
      marcoAtingido({ inicio: d("2025-09-15"), meses: 11, hoje: d("2026-08-15"), toleranciaDias: 3 }),
    ).toBe(true);
  });

  it("não dispara antes do marco", () => {
    expect(
      marcoAtingido({ inicio: d("2025-09-15"), meses: 11, hoje: d("2026-08-14"), toleranciaDias: 3 }),
    ).toBe(false);
  });

  it("tolera o atraso do job, e só ele", () => {
    // A tolerância existe porque o job roda uma vez por dia: sem ela, um marco
    // que caia num dia de falha da carga é perdido para sempre.
    const base = { inicio: d("2025-09-15"), meses: 11, toleranciaDias: 3 };
    expect(marcoAtingido({ ...base, hoje: d("2026-08-18") })).toBe(true);
    expect(marcoAtingido({ ...base, hoje: d("2026-08-19") })).toBe(false);
  });

  it("⚠ regra 8 é ANIVERSÁRIO, não janela aberta", () => {
    // Decidido pelo dono em 2026-08-27. Se fosse janela, todo dia do 1º ao 6º
    // mês dispararia — cento e oitenta ofertas em vez de uma.
    const base = { inicio: d("2026-01-10"), meses: 6, toleranciaDias: 3 };
    expect(marcoAtingido({ ...base, hoje: d("2026-04-10") })).toBe(false); // 3º mês
    expect(marcoAtingido({ ...base, hoje: d("2026-07-10") })).toBe(true); // 6º mês
  });

  it("encaixa o dia quando o mês de destino é mais curto", () => {
    // 31/jan + 1 mês não existe em fevereiro.
    expect(
      marcoAtingido({ inicio: d("2026-01-31"), meses: 1, hoje: d("2026-02-28"), toleranciaDias: 0 }),
    ).toBe(true);
  });
});

describe("TENDENCIA — regra 3, queda mês a mês", () => {
  it("dispara no exemplo do próprio documento: 20h, 10h, nada", () => {
    const r = quedaMesAMes({ serie: serie(["2026-06", 20], ["2026-07", 10], ["2026-08", 0]) });
    expect(r.disparou).toBe(true);
    expect(r.quedas).toBe(2);
    expect(r.de).toBe("2026-06");
    expect(r.ate).toBe("2026-08");
  });

  it("uma queda só não basta", () => {
    expect(quedaMesAMes({ serie: serie(["2026-07", 20], ["2026-08", 10]) }).disparou).toBe(false);
  });

  it("recuperação no último mês zera o padrão", () => {
    // O que interessa é o que está acontecendo AGORA, não um vale antigo.
    const r = quedaMesAMes({ serie: serie(["2026-05", 30], ["2026-06", 20], ["2026-07", 10], ["2026-08", 25]) });
    expect(r.disparou).toBe(false);
    expect(r.quedas).toBe(0);
  });

  it("estabilidade não é queda", () => {
    expect(
      quedaMesAMes({ serie: serie(["2026-06", 10], ["2026-07", 10], ["2026-08", 10]) }).disparou,
    ).toBe(false);
  });

  it("⚠ série que começa em zero não é queda — é ausência de base", () => {
    expect(
      quedaMesAMes({ serie: serie(["2026-06", 0], ["2026-07", 0], ["2026-08", 0]) }).disparou,
    ).toBe(false);
  });

  it("o número de quedas exigidas é parâmetro", () => {
    const s = serie(["2026-05", 40], ["2026-06", 30], ["2026-07", 20], ["2026-08", 10]);
    expect(quedaMesAMes({ serie: s, quedasSeguidas: 3 }).disparou).toBe(true);
    expect(quedaMesAMes({ serie: s, quedasSeguidas: 4 }).disparou).toBe(false);
  });
});

describe("TENDENCIA — regra 11, queda de X%", () => {
  it("dispara acima do limiar", () => {
    const r = quedaPercentual({ atual: money(60), anterior: money(100), limiarPct: 30 });
    expect(r.disparou).toBe(true);
    expect(r.variacaoPct).toBeCloseTo(-40);
  });

  it("não dispara exatamente abaixo do limiar", () => {
    expect(
      quedaPercentual({ atual: money(75), anterior: money(100), limiarPct: 30 }).disparou,
    ).toBe(false);
  });

  it("⚠ mês anterior zerado NÃO é queda de 100%", () => {
    const r = quedaPercentual({ atual: money(0), anterior: money(0), limiarPct: 30 });
    expect(r.disparou).toBe(false);
    expect(r.variacaoPct).toBeNull();
  });

  it("o limiar é parâmetro — o documento diz X%, não 30%", () => {
    const p = { atual: money(90), anterior: money(100) };
    expect(quedaPercentual({ ...p, limiarPct: 5 }).disparou).toBe(true);
    expect(quedaPercentual({ ...p, limiarPct: 30 }).disparou).toBe(false);
  });
});

describe("USO_SEM_COTA — regra 4", () => {
  it("dispara para quem não tem cota e passou de 5h", () => {
    expect(usoAvulsoAlto({ temContratoComCota: false, horasNoMes: money(6) })).toBe(true);
  });

  it("exatamente 5h não dispara — o documento diz >5h", () => {
    expect(usoAvulsoAlto({ temContratoComCota: false, horasNoMes: money(5) })).toBe(false);
  });

  it("⚠ quem TEM cota nunca entra, mesmo usando muito", () => {
    // Esse caso é do gatilho de excedente, não deste.
    expect(usoAvulsoAlto({ temContratoComCota: true, horasNoMes: money(40) })).toBe(false);
  });

  it("Litoral tem contrato e NÃO tem cota — entra", () => {
    expect(usoAvulsoAlto({ temContratoComCota: false, horasNoMes: money(8) })).toBe(true);
  });
});

describe("PRIMEIRO_EVENTO — regra 5", () => {
  const base = { hoje: d("2026-08-27"), dataDeCorte: d("2026-01-01"), toleranciaDias: 2 };

  it("dispara na estreia recente", () => {
    expect(primeiraReserva({ ...base, primeiraReservaEm: d("2026-08-26") })).toBe(true);
  });

  it("⚠ estreia ANTERIOR ao corte não dispara — é o freio do disparo em massa", () => {
    expect(primeiraReserva({ ...base, primeiraReservaEm: d("2024-03-10") })).toBe(false);
  });

  it("não dispara fora da tolerância", () => {
    expect(primeiraReserva({ ...base, primeiraReservaEm: d("2026-08-20") })).toBe(false);
  });

  it("cliente sem reserva nenhuma não dispara", () => {
    expect(primeiraReserva({ ...base, primeiraReservaEm: null })).toBe(false);
  });
});

describe("EVENTO_EM_SEGMENTO — regra 10", () => {
  it("Litoral (sem cota) que reservou dispara", () => {
    expect(litoralReservouSala({ temPlanoFiscalSemCota: true, reservasNoPeriodo: 1 })).toBe(true);
  });

  it("Litoral sem reserva não dispara", () => {
    expect(litoralReservouSala({ temPlanoFiscalSemCota: true, reservasNoPeriodo: 0 })).toBe(false);
  });

  it("⚠ Batial tem 2h de cota — não é Litoral, não dispara", () => {
    // O tier vem da cota do plano, não do nome. Medido na Fase 0.
    expect(litoralReservouSala({ temPlanoFiscalSemCota: false, reservasNoPeriodo: 5 })).toBe(false);
  });
});

describe("classificação de segmento — regras 1, 6, 7, 8, 10", () => {
  it("⚠ a estação de coworking CONTA como privativa", () => {
    // Decidido pelo dono em 2026-08-27. Era a dúvida que travava as regras
    // 6, 7 e 8: a categoria inclui algo que não é uma sala.
    expect(ehSegmentoPrivativa("Salas Privativas - Seaway Center")).toBe(true);
    expect(ehSegmentoPrivativa("Salas Privativas")).toBe(true);
  });

  it("tolera grafia sem acento e caixa trocada", () => {
    // O catálogo real tem "Endereço Fiscal de Comércio" e "De Comercio".
    expect(ehSegmentoPrivativa("SALA PRIVATIVA")).toBe(true);
    expect(ehSegmentoFiscal("Endereco Fiscal De Comercio")).toBe(true);
    expect(ehSegmentoFiscal("Endereço Fiscal de Comércio")).toBe(true);
  });

  it("não classifica o que não é", () => {
    expect(ehSegmentoPrivativa("Endereço Fiscal Litoral")).toBe(false);
    expect(ehSegmentoPrivativa(null)).toBe(false);
    expect(ehSegmentoFiscal("Salas Privativas - Seaway Center")).toBe(false);
    expect(ehSegmentoFiscal(undefined)).toBe(false);
  });
});

describe("supressão — não ofertar o que o cliente já tem", () => {
  const SEABOX = 4242;

  it("quem comprou não recebe oferta", () => {
    expect(posseDoProduto({ produtoAlvo: SEABOX, comprados: [SEABOX], cortesiasDoPlano: [] })).toBe(
      "POR_COMPRA",
    );
  });

  it("⚠ quem recebeu de CORTESIA no plano também não recebe", () => {
    // Informado pelo dono em 2026-08-27: alguns produtos fornecem o SeaBox
    // embutido na assinatura, sem venda nenhuma para rastrear.
    expect(
      posseDoProduto({ produtoAlvo: SEABOX, comprados: [], cortesiasDoPlano: [SEABOX] }),
    ).toBe("POR_CORTESIA");
  });

  it("⚠ plano NÃO mapeado é DESCONHECIDO, nunca 'não possui'", () => {
    // A cortesia não existe na API — é cadastro. Sem o mapeamento, afirmar
    // "não possui" seria inventar dado, e reofertaria a quem já recebeu.
    expect(
      posseDoProduto({ produtoAlvo: SEABOX, comprados: [], cortesiasDoPlano: null }),
    ).toBe("DESCONHECIDO");
  });

  it("lista vazia é diferente de não mapeado", () => {
    expect(posseDoProduto({ produtoAlvo: SEABOX, comprados: [], cortesiasDoPlano: [] })).toBe(
      "NAO_POSSUI",
    );
  });

  it("só 'não possui' libera a oferta", () => {
    expect(podeOfertar("NAO_POSSUI")).toBe(true);
    expect(podeOfertar("POR_COMPRA")).toBe(false);
    expect(podeOfertar("POR_CORTESIA")).toBe(false);
    expect(podeOfertar("DESCONHECIDO")).toBe(false);
  });
});
