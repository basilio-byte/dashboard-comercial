import { describe, expect, it } from "vitest";
import { dataHoraLocal, horaLocal } from "./dates";

/**
 * Regressão do fuso na exibição de instantes.
 *
 * O bug chegou em PRODUÇÃO: a barra superior dizia "sincronizado 20:30" às
 * 17:48 do relógio de quem olhava. `Intl.DateTimeFormat` sem `timeZone` usa o
 * fuso do processo, e o container roda em UTC — três horas à frente de
 * America/Fortaleza, que não tem horário de verão.
 *
 * Estes testes fixam o instante em UTC e exigem o relógio de parede da empresa.
 * Passam independentemente do fuso da máquina que roda a suíte, que é o ponto:
 * na máquina de desenvolvimento (UTC-3) o bug era invisível.
 */
describe("exibição de instantes no fuso da empresa", () => {
  it("mostra a hora local, não a do processo", () => {
    // 2026-08-26T20:30:00Z é 17:30 em Natal/RN.
    expect(horaLocal(new Date("2026-08-26T20:30:00.000Z"))).toBe("17:30");
  });

  it("mostra data e hora locais juntas", () => {
    expect(dataHoraLocal(new Date("2026-08-26T20:30:00.000Z"))).toBe("26/08/2026, 17:30");
  });

  it("recua o dia quando o instante UTC cai na madrugada", () => {
    // 01:00Z do dia 27 ainda é 22:00 do dia 26 no relógio da empresa. Uma carga
    // da noite não pode aparecer datada do dia seguinte.
    expect(dataHoraLocal(new Date("2026-08-27T01:00:00.000Z"))).toBe("26/08/2026, 22:00");
  });

  it("não desloca nada quando o instante já é meia-noite local", () => {
    expect(dataHoraLocal(new Date("2026-08-27T03:00:00.000Z"))).toBe("27/08/2026, 00:00");
  });
});
