import { describe, expect, it } from "vitest";
import {
  CODIGOS_NATIVOS,
  FAMILIAS,
  FAMILIAS_DE_VENDA,
  LACUNA_SALDO_PACOTE,
  NATIVOS,
  lerParams,
  novoCodigo,
  paramsPorFamilia,
  pesoPorValor,
  rotuloDaRegra,
} from "./catalogo";

/**
 * ⚠ O teste mais importante deste arquivo é o primeiro: os defaults do catálogo
 * precisam ser **exatamente** os valores que viviam como constante em
 * `avaliar.ts`. É isso que faz a configuração poder ser publicada sem migração
 * de dado — um banco sem nenhuma linha de `gatilhos` avalia igual ao de ontem.
 *
 * Se alguém "arrumar" um default aqui, a fila inteira muda de tamanho no
 * próximo deploy, sem ninguém ter pedido.
 */
describe("catálogo de gatilhos", () => {
  it("os defaults são os limiares que o motor já usava", () => {
    expect(lerParams("MARCO_CONTRATO", {}).params.toleranciaDias).toBe(3);
    expect(lerParams("USO_SEM_COTA", {}).params.limiarHoras).toBe(5);
    expect(lerParams("TENDENCIA", {}).params.quedasSeguidas).toBe(2);
    expect(lerParams("TENDENCIA", {}).params.limiarPct).toBe(30);
    expect(lerParams("PRIMEIRO_EVENTO", {}).params.desde).toBe("2026-08-01");
    expect(lerParams("EXCEDENTE", {}).params.ciclosAnalisados).toBe(3);
    expect(lerParams("EXCEDENTE", {}).params.ciclosComEstouro).toBe(2);
  });

  it("completa o que falta sem apagar o que veio", () => {
    const { params, problema } = lerParams("MARCO_CONTRATO", { meses: 11 });
    expect(problema).toBeNull();
    expect(params).toEqual({ meses: 11, toleranciaDias: 3, segmento: "QUALQUER" });
  });

  it("params corrompidos caem no default e RELATAM o problema, sem lançar", () => {
    // ⚠ Lançar aqui derrubaria a fila inteira por causa de uma linha ruim — e a
    // fila é o produto. Um gatilho a menos é degradação; tela em branco é queda.
    const { params, problema } = lerParams("USO_SEM_COTA", { limiarHoras: "cinco" });
    expect(params.limiarHoras).toBe(5);
    expect(problema).toMatch(/limiarHoras/);
  });

  it("recusa limiar fora da faixa", () => {
    expect(lerParams("TENDENCIA", { limiarPct: 900 }).problema).toMatch(/limiarPct/);
    expect(lerParams("MARCO_CONTRATO", { meses: -1 }).problema).toMatch(/meses/);
  });

  it("a data de corte da primeira reserva precisa ser aaaa-mm-dd", () => {
    // Sem corte válido, todo cliente antigo parece estreante — o risco de
    // disparo em massa que a regra 5 carrega.
    expect(lerParams("PRIMEIRO_EVENTO", { desde: "01/08/2026" }).problema).toMatch(/desde/);
  });

  it("todo nativo tem família conhecida e params que validam nela", () => {
    for (const n of NATIVOS) {
      expect(FAMILIAS).toContain(n.familia);
      const r = paramsPorFamilia[n.familia].safeParse(n.params);
      expect(r.success, `params inválidos no nativo ${n.codigo}`).toBe(true);
    }
  });

  it("os códigos nativos são únicos — eles são chave em Contato.regra", () => {
    // ⚠ Código duplicado órfã o histórico de contatos: dois gatilhos diferentes
    // gravariam o mesmo "motivo do contato".
    expect(CODIGOS_NATIVOS.size).toBe(NATIVOS.length);
  });

  it("as 12 regras do documento estão todas presentes", () => {
    for (const c of ["extra", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "métrica"]) {
      expect(CODIGOS_NATIVOS.has(c), `falta o gatilho ${c}`).toBe(true);
    }
  });

  it("as regras 2 e 9 continuam bloqueadas por permissão, não por configuração", () => {
    // Se alguém "destravar" isto sem o Conexa expor o conteúdo do pacote, a
    // regra passa a existir na tela e nunca dispara — pior que estar bloqueada.
    for (const c of ["2", "9"]) {
      const n = NATIVOS.find((x) => x.codigo === c)!;
      expect(n.bloqueio).toBe(LACUNA_SALDO_PACOTE);
      expect(n.bloqueio).toMatch(/suporte/i);
    }
  });

  it("código gerado não colide com nativo", () => {
    for (let i = 0; i < 50; i++) expect(CODIGOS_NATIVOS.has(novoCodigo())).toBe(false);
  });

  it("⚠ o freio suspende VENDA, nunca sinal de saída", () => {
    // Com quem está saindo, a conversa acontece mesmo com dívida.
    expect(FAMILIAS_DE_VENDA.has("TENDENCIA")).toBe(false);
    expect(FAMILIAS_DE_VENDA.has("MUDANCA_CONTRATO")).toBe(false);
    expect(FAMILIAS_DE_VENDA.has("SAUDE_FINANCEIRA")).toBe(false);
    expect(FAMILIAS_DE_VENDA.has("MARCO_CONTRATO")).toBe(true);
    expect(FAMILIAS_DE_VENDA.has("EXCEDENTE")).toBe(true);
  });

  it("os sinais de saída e o freio existem como nativos", () => {
    for (const c of ["contrato-perdido", "contrato-reduzido", "freio"]) {
      expect(CODIGOS_NATIVOS.has(c), `falta ${c}`).toBe(true);
    }
    // A métrica virou queda sustentada — a versão de mês isolado não volta.
    const metrica = NATIVOS.find((n) => n.codigo === "métrica")!;
    expect(metrica.params.modo).toBe("queda_sustentada");
  });

  it("rótulo de regra: número vira 'regra N', o resto fica como está", () => {
    expect(rotuloDaRegra("4")).toBe("regra 4");
    expect(rotuloDaRegra("10")).toBe("regra 10");
    expect(rotuloDaRegra("contrato-perdido")).toBe("contrato-perdido");
    expect(rotuloDaRegra("métrica")).toBe("métrica");
  });

  it("peso pelo dinheiro: R$ 24 não passa na frente de R$ 1.280, e há teto", () => {
    expect(pesoPorValor(40, 24)).toBeLessThan(pesoPorValor(40, 1280));
    expect(pesoPorValor(40, 1_000_000)).toBe(100);
    expect(pesoPorValor(40, -50)).toBe(40);
  });

  it("o programa concluído existe como nativo, e a métrica exige base mínima", () => {
    expect(CODIGOS_NATIVOS.has("programa-concluido")).toBe(true);
    const metrica = NATIVOS.find((n) => n.codigo === "métrica")!;
    expect(metrica.params.baseMinima).toBe(50);
  });
});
