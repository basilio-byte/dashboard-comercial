import { describe, expect, it } from "vitest";
import { CODIGOS_NATIVOS, FAMILIAS, NATIVOS, lerParams, novoCodigo, paramsPorFamilia } from "./catalogo";

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
    // Se alguém "destravar" isto sem o admin do Conexa liberar `/packages`, a
    // regra passa a existir na tela e nunca dispara — pior que estar bloqueada.
    for (const c of ["2", "9"]) {
      const n = NATIVOS.find((x) => x.codigo === c)!;
      expect(n.bloqueio).toMatch(/404/);
    }
  });

  it("código gerado não colide com nativo", () => {
    for (let i = 0; i < 50; i++) expect(CODIGOS_NATIVOS.has(novoCodigo())).toBe(false);
  });
});
