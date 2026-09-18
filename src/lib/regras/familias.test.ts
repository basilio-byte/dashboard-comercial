import { describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import {
  ehSegmentoFiscal,
  ehSegmentoPrivativa,
  litoralReservouSala,
  marcoAtingido,
  primeiraReserva,
  mediana,
  quedaContraBase,
  quedaMesAMes,
  quedaPercentual,
  ehHoraAvulsa,
  temEvidenciaDeCota,
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

/**
 * ⚠ Os casos abaixo são SÉRIES REAIS da produção, medidas em 2026-09-18 — sem
 * nome de cliente, só os valores. Cada uma era um sinal falso no Radar. Se um
 * destes testes voltar a falhar, o sinal falso volta para a fila do vendedor.
 */
describe("TENDENCIA — casos reais de falso positivo (2026-09-18)", () => {
  it("regra 3: oscilação de centavos depois de um pico NÃO é padrão irregular", () => {
    // 86,85 · 170,16 (duas cobranças) · 86,01 · 84,14 — dava "2 quedas seguidas".
    const s = serie(["2026-05", 86.85], ["2026-06", 170.16], ["2026-07", 86.01], ["2026-08", 84.14]);
    expect(quedaMesAMes({ serie: s, quedasSeguidas: 2, quedaMinimaPct: 10 }).disparou).toBe(false);
    // Sem a queda mínima, o defeito aparece — é o que o default 0 preserva.
    expect(quedaMesAMes({ serie: s, quedasSeguidas: 2 }).disparou).toBe(true);
  });

  it("regra 3: o exemplo do documento continua disparando com queda mínima", () => {
    const s = serie(["2026-06", 20], ["2026-07", 10], ["2026-08", 0]);
    expect(quedaMesAMes({ serie: s, quedasSeguidas: 2, quedaMinimaPct: 10 }).disparou).toBe(true);
  });

  it("métrica: mês com DUAS cobranças não vira base — a volta ao normal não é queda", () => {
    // 148,57 · 148,57 · 297,14 (2 cobranças) · 148,57 — dava "−50%".
    const s = serie(["2026-05", 148.57], ["2026-06", 148.57], ["2026-07", 297.14], ["2026-08", 148.57]);
    const r = quedaContraBase({ serie: s, mesesDeBase: 3, limiarPct: 30 });
    expect(r.disparou).toBe(false);
    expect(r.variacaoPct).toBe(0);
    // O defeito, reproduzido: contra o mês anterior, é −50%.
    expect(
      quedaPercentual({ atual: money(148.57), anterior: money(297.14), limiarPct: 30 }).disparou,
    ).toBe(true);
  });

  it("métrica: cobrança ANUAL não é queda de 100% no mês seguinte", () => {
    // 0 · 0 · 900,55 · 0 — contrato Yearly, dava "−100%".
    const s = serie(["2026-05", 0], ["2026-06", 0], ["2026-07", 900.55], ["2026-08", 0]);
    const r = quedaContraBase({ serie: s, mesesDeBase: 3, limiarPct: 30 });
    expect(r.disparou).toBe(false);
    expect(r.semBase).toBe("BASE_ZERO");
  });

  it("métrica: cobrança avulsa isolada não é queda", () => {
    // 163,84 · 163,84 · 570,09 · 163,84 — dava "−71%".
    const s = serie(["2026-05", 163.84], ["2026-06", 163.84], ["2026-07", 570.09], ["2026-08", 163.84]);
    expect(quedaContraBase({ serie: s, mesesDeBase: 3, limiarPct: 30 }).disparou).toBe(false);
  });

  it("métrica: queda DE VERDADE continua disparando", () => {
    const s = serie(["2026-05", 1000], ["2026-06", 1000], ["2026-07", 1000], ["2026-08", 500]);
    const r = quedaContraBase({ serie: s, mesesDeBase: 3, limiarPct: 30 });
    expect(r.disparou).toBe(true);
    expect(r.variacaoPct).toBe(-50);
  });

  it("métrica: cliente que zerou depois de meses estáveis dispara — é o churn", () => {
    const s = serie(["2026-05", 400], ["2026-06", 410], ["2026-07", 395], ["2026-08", 0]);
    expect(quedaContraBase({ serie: s, mesesDeBase: 3, limiarPct: 30 }).disparou).toBe(true);
  });

  it("série curta demais não compara — e diz por quê", () => {
    const s = serie(["2026-07", 100], ["2026-08", 10]);
    expect(quedaContraBase({ serie: s, mesesDeBase: 3, limiarPct: 30 }).semBase).toBe("SERIE_CURTA");
  });

  it("mediana: par tira a média dos dois do meio; vazia é null, nunca zero", () => {
    expect(mediana([money(1), money(3), money(2), money(10)])!.toNumber()).toBe(2.5);
    expect(mediana([])).toBeNull();
  });
});

describe("USO_SEM_COTA e EVENTO_EM_SEGMENTO — evidência de cota (2026-09-18)", () => {
  const desde = d("2026-07-01");

  it("reserva abatida da cota prova que o cliente TEM cota, mesmo sem plano com cota", () => {
    // O caso real: pacote via recurringSales, invisível ao espelho, mas o
    // Conexa abate as reservas dele.
    expect(
      temEvidenciaDeCota({ reservas: [{ status: "deductedFromQuota", dataLocal: d("2026-09-03") }], desde }),
    ).toBe(true);
  });

  it("abatimento ANTIGO não prova cota de hoje — o pacote pode ter acabado", () => {
    expect(
      temEvidenciaDeCota({ reservas: [{ status: "deductedFromQuota", dataLocal: d("2025-11-03") }], desde }),
    ).toBe(false);
  });

  it("reserva paga ou não faturada não é evidência de cota", () => {
    expect(
      temEvidenciaDeCota({
        reservas: [
          { status: "paid", dataLocal: d("2026-09-03") },
          { status: "notBilled", dataLocal: d("2026-09-04") },
        ],
        desde,
      }),
    ).toBe(false);
  });

  it("reserva cancelada não conta", () => {
    expect(
      temEvidenciaDeCota({
        reservas: [{ status: "deductedFromQuota", dataLocal: d("2026-09-03"), cancellationReason: "cliente desistiu" }],
        desde,
      }),
    ).toBe(false);
  });
});

describe("USO_SEM_COTA — o que é hora avulsa (corrigido em 2026-09-18)", () => {
  it("⚠ notBilled COM venda de valor é avulsa — a sala é cobrada na fatura do mês seguinte", () => {
    // O caso real que a primeira versão errou: 16h em setembro, R$ 1.100 em
    // vendas, todas `notBilled` porque a cobrança só sai em outubro.
    expect(ehHoraAvulsa({ status: "notBilled", valorDaVenda: 275 })).toBe(true);
  });

  it("paga na hora continua sendo avulsa", () => {
    expect(ehHoraAvulsa({ status: "paid", valorDaVenda: 90 })).toBe(true);
    expect(ehHoraAvulsa({ status: "partiallyPaid", valorDaVenda: 90 })).toBe(true);
  });

  it("venda de valor ZERO é cortesia, não compra avulsa", () => {
    expect(ehHoraAvulsa({ status: "notBilled", valorDaVenda: 0 })).toBe(false);
  });

  it("abatida da cota nunca é avulsa, mesmo com venda", () => {
    expect(ehHoraAvulsa({ status: "deductedFromQuota", valorDaVenda: 90 })).toBe(false);
  });

  it("reserva sem venda ligada não é avulsa — não há preço para afirmar", () => {
    expect(ehHoraAvulsa({ status: "notBilled", valorDaVenda: null })).toBe(false);
  });

  it("cobrança cancelada não conta", () => {
    expect(ehHoraAvulsa({ status: "billedCancelled", valorDaVenda: 90 })).toBe(false);
  });
});
