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
  quedaSustentada,
  mediaAparada,
  ehHoraAvulsa,
  mudancaDeContrato,
  situacaoFinanceira,
  renegociouNoPeriodo,
  foraDaBaseElegivel,
  temEvidenciaDeCota,
  valorContratadoEm,
  valorMensalDoContrato,
  type ContratoParaValor,
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

/**
 * ⚠ Séries e contratos REAIS da produção (2026-09-18), sem nome de cliente.
 * Cada caso foi um sinal certo ou errado conferido linha a linha.
 */
describe("TENDENCIA — queda SUSTENTADA (a métrica desde 2026-09-18)", () => {
  const base6 = (v: number) =>
    serie(["2026-01", v], ["2026-02", v], ["2026-03", v], ["2026-04", v], ["2026-05", v], ["2026-06", v]);

  it("dois meses seguidos abaixo do normal disparam — o caso real de R$ 2.000 que foi a zero", () => {
    const s = [...base6(2000), ...serie(["2026-07", 0], ["2026-08", 0])];
    const r = quedaSustentada({ serie: s, mesesAvaliados: 2, mesesDeBase: 6, limiarPct: 30 });
    expect(r.disparou).toBe(true);
    expect(r.avaliados).toEqual(["2026-07", "2026-08"]);
  });

  it("⚠ um mês isolado baixo NÃO dispara — era o defeito das duas versões anteriores", () => {
    // 1900 estável, julho ainda 1900, agosto 219: queda real, mas de um mês só.
    // Espera o próximo mês fechar — e o "contrato reduzido" pega esse caso já.
    const s = [...base6(1900), ...serie(["2026-07", 1900], ["2026-08", 219])];
    expect(quedaSustentada({ serie: s, mesesAvaliados: 2, mesesDeBase: 6, limiarPct: 30 }).disparou).toBe(false);
  });

  it("⚠ o mês em curso DESMENTE: quem pagou tudo de uma vez em setembro não caiu", () => {
    // O caso real da renegociação: 113 por mês, zero em jul e ago, 337 em setembro.
    const s = [...base6(113), ...serie(["2026-07", 0], ["2026-08", 0])];
    const r = quedaSustentada({
      serie: s, mesesAvaliados: 2, mesesDeBase: 6, limiarPct: 30, mesEmCurso: money(337),
    });
    expect(r.disparou).toBe(false);
    expect(r.desmentidoPeloMesEmCurso).toBe(true);
  });

  it("⚠ o mês em curso nunca CRIA queda: pela metade ele sempre parece baixo", () => {
    const s = [...base6(100), ...serie(["2026-07", 100], ["2026-08", 100])];
    const r = quedaSustentada({
      serie: s, mesesAvaliados: 2, mesesDeBase: 6, limiarPct: 30, mesEmCurso: money(0),
    });
    expect(r.disparou).toBe(false);
  });

  it("base com dois meses atípicos não vira normal — a mediana de 6 aguenta", () => {
    // O caso da base de 3 que falhava: 1273 (avulso) e 205 (duas cobranças) no
    // meio de ~103. Com 6 meses de base, a mediana volta a ser ~103.
    const s = serie(
      ["2026-01", 100], ["2026-02", 104], ["2026-03", 101], ["2026-04", 102],
      ["2026-05", 1273], ["2026-06", 205], ["2026-07", 103], ["2026-08", 107],
    );
    expect(quedaSustentada({ serie: s, mesesAvaliados: 2, mesesDeBase: 6, limiarPct: 30 }).disparou).toBe(false);
  });

  it("contrato anual (zero quase todo mês) não tem base, e não é queda", () => {
    const s = serie(
      ["2026-01", 0], ["2026-02", 0], ["2026-03", 0], ["2026-04", 0],
      ["2026-05", 0], ["2026-06", 0], ["2026-07", 900], ["2026-08", 0],
    );
    const r = quedaSustentada({ serie: s, mesesAvaliados: 2, mesesDeBase: 6, limiarPct: 30 });
    expect(r.disparou).toBe(false);
  });

  it("série curta demais declara que não tem base", () => {
    const s = serie(["2026-06", 100], ["2026-07", 0], ["2026-08", 0]);
    expect(quedaSustentada({ serie: s, mesesAvaliados: 2, mesesDeBase: 6, limiarPct: 30 }).semBase).toBe("SERIE_CURTA");
  });
});

describe("MUDANCA_CONTRATO — contratos reais de 2026-09-18", () => {
  const hoje = d("2026-09-18");
  const k = (
    conexaId: number, valor: number, inicio: string, fim: string | null, ativo: boolean, freq = "Monthly",
  ): ContratoParaValor => ({
    conexaId, amount: money(valor), paymentFrequency: freq,
    startDate: d(inicio), endDate: fim ? d(fim) : null, isActive: ativo,
  });

  it("anual vale pelo valor MENSAL — trocar anual por mensal não é queda de 92%", () => {
    expect(valorMensalDoContrato({ amount: money(1200), paymentFrequency: "Yearly" }).toNumber()).toBe(100);
  });

  it("trocou R$ 330 por R$ 90: reduziu", () => {
    const r = mudancaDeContrato({
      contratos: [k(10434, 330, "2025-10-01", "2026-09-05", false), k(12552, 90, "2026-09-11", null, true)],
      hoje, janelaDias: 45, limiarPct: 20,
    });
    expect(r.reduziu).toBe(true);
    expect(r.perdeu).toBe(false);
    expect(Math.round(r.variacaoPct!)).toBe(-73);
  });

  it("⚠ renovou pelo MESMO valor: não é redução — eram 2 das 6 trocas medidas", () => {
    const r = mudancaDeContrato({
      contratos: [k(12126, 99.9, "2025-08-24", "2026-08-24", false), k(12488, 99.9, "2026-08-24", null, true)],
      hoje, janelaDias: 45, limiarPct: 20,
    });
    expect(r.reduziu).toBe(false);
    expect(r.perdeu).toBe(false);
  });

  it("tinha dois, ficou com o menor: reduziu (69,80 → 19,90)", () => {
    const r = mudancaDeContrato({
      contratos: [k(11245, 49.9, "2025-06-01", "2026-09-01", false), k(12403, 19.9, "2026-03-03", null, true)],
      hoje, janelaDias: 45, limiarPct: 20,
    });
    expect(r.reduziu).toBe(true);
  });

  it("o último contrato terminou e não há outro: perdeu", () => {
    const r = mudancaDeContrato({
      contratos: [k(10100, 150, "2025-03-01", "2026-09-10", false)],
      hoje, janelaDias: 45, limiarPct: 20,
    });
    expect(r.perdeu).toBe(true);
    expect(r.encerrado!.conexaId).toBe(10100);
  });

  it("terminou FORA da janela: não é notícia", () => {
    const r = mudancaDeContrato({
      contratos: [k(10100, 150, "2025-03-01", "2026-06-10", false)],
      hoje, janelaDias: 45, limiarPct: 20,
    });
    expect(r.perdeu).toBe(false);
  });

  it("cliente novo (não tinha nada 45 dias atrás) não é redução nem perda", () => {
    const r = mudancaDeContrato({
      contratos: [k(12700, 99.9, "2026-09-01", null, true)],
      hoje, janelaDias: 45, limiarPct: 20,
    });
    expect(r.reduziu).toBe(false);
    expect(r.perdeu).toBe(false);
  });

  it("contrato inativo sem data de fim não conta como vigente", () => {
    expect(valorContratadoEm([k(1, 100, "2025-01-01", null, false)], hoje)).toBeNull();
  });
});

describe("SAUDE_FINANCEIRA — o freio", () => {
  const hoje = d("2026-09-18");
  const c = (status: string, vence: string, valor = 100) => ({
    status, dueDate: d(vence), emissionDate: d(vence), valor: money(valor),
  });
  const params = { hoje, diasDeAtrasoMin: 15, diasDeAtrasoMax: 105, diasDeRenegociacao: 90 };

  it("cobrança vencida há 40 dias freia", () => {
    const r = situacaoFinanceira({ cobrancas: [c("unpaid", "2026-08-09", 350)], ...params });
    expect(r.freiar).toBe(true);
    expect(r.maiorAtrasoDias).toBe(40);
    expect(r.valorVencido!.toNumber()).toBe(350);
  });

  it("atraso de 5 dias NÃO freia — é quem esqueceu, não quem deve", () => {
    expect(situacaoFinanceira({ cobrancas: [c("unpaid", "2026-09-13")], ...params }).freiar).toBe(false);
  });

  it("⚠ dívida de dois anos não trava o cliente para sempre", () => {
    expect(situacaoFinanceira({ cobrancas: [c("unpaid", "2024-09-01")], ...params }).freiar).toBe(false);
  });

  it("⚠ `denied` é cobrança vencida e não paga — freia como `unpaid`", () => {
    // Tereza, 2026-09-18: 1ª do Radar, oferta de upgrade, com uma `denied` de
    // R$ 464 vencida havia 21 dias. O freio só olhava `unpaid`.
    const r = situacaoFinanceira({ cobrancas: [c("denied", "2026-08-28", 464)], ...params });
    expect(r.freiar).toBe(true);
    expect(r.vencidas).toBe(1);
    expect(situacaoFinanceira({ cobrancas: [c("protested", "2026-08-01")], ...params }).freiar).toBe(true);
    expect(situacaoFinanceira({ cobrancas: [c("juridical", "2026-08-01")], ...params }).freiar).toBe(true);
    // paga ou cancelada continua sem freio
    expect(situacaoFinanceira({ cobrancas: [c("paid", "2026-08-01")], ...params }).freiar).toBe(false);
  });

  it("renegociou há 50 dias: freia", () => {
    const r = situacaoFinanceira({ cobrancas: [c("negotiated", "2026-07-29")], ...params });
    expect(r.freiar).toBe(true);
    expect(r.renegociou).toBe(true);
  });

  it("cobrança paga não freia, mesmo antiga", () => {
    expect(situacaoFinanceira({ cobrancas: [c("paid", "2026-08-01")], ...params }).freiar).toBe(false);
  });
});

describe("queda sustentada — a base robusta (2026-09-18, depois do deploy)", () => {
  it("⚠ troca de ritmo de cobrança não é queda: bimestral de 180 virou mensal de 90", () => {
    // O caso real (Plenitus): paga os mesmos R$ 90/mês; a mediana sozinha dava −33%.
    const s = serie(
      ["2026-01", 180], ["2026-02", 0], ["2026-03", 180], ["2026-04", 0],
      ["2026-05", 180], ["2026-06", 90], ["2026-07", 90], ["2026-08", 90],
    );
    expect(quedaSustentada({ serie: s, mesesAvaliados: 2, mesesDeBase: 6, limiarPct: 30 }).disparou).toBe(false);
  });

  it("⚠ base pequena demais não vira −100% no topo do Radar", () => {
    // O caso real (Simplifica): anual, com avulsos esporádicos — base de R$ 18/mês.
    const s = serie(
      ["2026-01", 98], ["2026-02", 0], ["2026-03", 36], ["2026-04", 0],
      ["2026-05", 2066], ["2026-06", 0], ["2026-07", 0], ["2026-08", 0],
    );
    const r = quedaSustentada({ serie: s, mesesAvaliados: 2, mesesDeBase: 6, limiarPct: 30, baseMinima: 50 });
    expect(r.disparou).toBe(false);
    expect(r.semBase).toBe("BASE_PEQUENA");
  });

  it("dois picos na base não inflam o normal — a mediana segura", () => {
    const s = serie(
      ["2026-01", 100], ["2026-02", 100], ["2026-03", 300], ["2026-04", 100],
      ["2026-05", 300], ["2026-06", 100], ["2026-07", 100], ["2026-08", 100],
    );
    expect(quedaSustentada({ serie: s, mesesAvaliados: 2, mesesDeBase: 6, limiarPct: 30 }).disparou).toBe(false);
  });

  it("queda real de contrato grande continua disparando, e informa a perda por mês", () => {
    // O caso real (Climb): R$ 3.000/mês para R$ 119.
    const s = serie(
      ["2026-01", 3000], ["2026-02", 3000], ["2026-03", 3064], ["2026-04", 3035],
      ["2026-05", 3063], ["2026-06", 119], ["2026-07", 123], ["2026-08", 119],
    );
    const r = quedaSustentada({ serie: s, mesesAvaliados: 2, mesesDeBase: 6, limiarPct: 30, baseMinima: 50 });
    expect(r.disparou).toBe(true);
    expect(r.perdaPorMes!.toNumber()).toBeGreaterThan(2800);
  });

  it("média aparada tira o menor e o maior", () => {
    expect(mediaAparada([money(0), money(100), money(100), money(1000)])!.toNumber()).toBe(100);
  });
});

describe("MUDANCA_CONTRATO — programa não é permanência (2026-09-18)", () => {
  const hoje = d("2026-09-18");
  const k = (
    conexaId: number, valor: number, inicio: string, fim: string | null, ativo: boolean,
    freq = "Monthly", foraDaPermanencia = false,
  ): ContratoParaValor => ({
    conexaId, amount: money(valor), paymentFrequency: freq,
    startDate: d(inicio), endDate: fim ? d(fim) : null, isActive: ativo, foraDaPermanencia,
  });

  it("⚠ egressa do Hub CONCLUIU — não perdeu o contrato", () => {
    // O caso real: 8 dos 23 "perdeu o contrato" eram a turma que terminou em 17/08.
    const r = mudancaDeContrato({
      contratos: [k(11646, 279.9, "2026-04-28", "2026-08-17", false, "Yearly", true)],
      hoje, janelaDias: 45, limiarPct: 20,
    });
    expect(r.perdeu).toBe(false);
    expect(r.concluiu).toBe(true);
    expect(r.programaEncerrado!.conexaId).toBe(11646);
  });

  it("concluiu o programa mas já tem permanência: não é sinal de continuidade", () => {
    const r = mudancaDeContrato({
      contratos: [
        k(1, 279.9, "2026-04-28", "2026-08-17", false, "Yearly", true),
        k(2, 119, "2026-06-01", null, true),
      ],
      hoje, janelaDias: 45, limiarPct: 20,
    });
    expect(r.concluiu).toBe(false);
    expect(r.perdeu).toBe(false);
  });

  it("programa terminando não conta como redução de quem tem outro contrato", () => {
    const r = mudancaDeContrato({
      contratos: [
        k(1, 1200, "2026-01-01", "2026-09-01", false, "Monthly", true),
        k(2, 119, "2025-01-01", null, true),
      ],
      hoje, janelaDias: 45, limiarPct: 20,
    });
    expect(r.reduziu).toBe(false);
  });
});

describe("renegociouNoPeriodo", () => {
  const c = (status: string, venc: string | null, emissao: string | null = null) => ({
    status, dueDate: venc ? d(venc) : null, emissionDate: emissao ? d(emissao) : null, valor: money(100),
  });

  it("renegociada dentro do período conta; fora, não", () => {
    expect(renegociouNoPeriodo({ cobrancas: [c("negotiated", "2026-08-10")], desde: d("2026-07-01") })).toBe(true);
    expect(renegociouNoPeriodo({ cobrancas: [c("negotiated", "2026-05-10")], desde: d("2026-07-01") })).toBe(false);
  });

  it("vencida sem renegociação não é renegociação", () => {
    expect(renegociouNoPeriodo({ cobrancas: [c("unpaid", "2026-08-10")], desde: d("2026-07-01") })).toBe(false);
  });

  it("sem vencimento, usa a emissão", () => {
    expect(renegociouNoPeriodo({ cobrancas: [c("negotiated", null, "2026-08-01")], desde: d("2026-07-01") })).toBe(true);
  });
});

describe("foraDaBaseElegivel — o gate do Radar, na ficha", () => {
  const base = { ativoNoConexa: true, bloqueadoNoConexa: false, temContratoVigente: true };

  it("cliente elegível: nenhuma família fica de fora", () => {
    for (const familia of ["TENDENCIA", "MARCO_CONTRATO", "MUDANCA_CONTRATO", "EXCEDENTE"]) {
      expect(foraDaBaseElegivel({ ...base, familia })).toBeNull();
    }
  });

  it("⚠ ex-cliente: a queda de receita é consequência da saída, não sinal a mais", () => {
    // Skydocs, 2026-09-18: contrato encerrado em 18/08 e "receita caiu 92%" na
    // ficha, enquanto o Radar mostrava só "perdeu o contrato".
    const ex = { ...base, temContratoVigente: false };
    expect(foraDaBaseElegivel({ ...ex, familia: "TENDENCIA" })).toBe("SEM_CONTRATO_VIGENTE");
    expect(foraDaBaseElegivel({ ...ex, familia: "USO_SEM_COTA" })).toBe("SEM_CONTRATO_VIGENTE");
    // ...mas a mudança de contrato é exatamente a pergunta sobre quem saiu.
    expect(foraDaBaseElegivel({ ...ex, familia: "MUDANCA_CONTRATO" })).toBeNull();
  });

  it("inativo ou bloqueado no Conexa: fora de tudo, inclusive mudança de contrato", () => {
    expect(foraDaBaseElegivel({ ...base, ativoNoConexa: false, familia: "MUDANCA_CONTRATO" })).toBe("INATIVO_NO_CONEXA");
    expect(foraDaBaseElegivel({ ...base, bloqueadoNoConexa: true, familia: "TENDENCIA" })).toBe("BLOQUEADO_NO_CONEXA");
  });

  it("o freio passa sempre — não é sinal, e a dívida do ex-cliente segue sendo informação", () => {
    expect(
      foraDaBaseElegivel({ ativoNoConexa: false, bloqueadoNoConexa: true, temContratoVigente: false, familia: "SAUDE_FINANCEIRA" }),
    ).toBeNull();
  });
});
