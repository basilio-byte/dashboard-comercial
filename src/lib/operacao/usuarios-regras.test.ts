import { describe, expect, it } from "vitest";
import {
  emailParece,
  impedimento,
  normalizarEmail,
  senhaTemporaria,
  validarNovoUsuario,
  type AlvoDaMudanca,
} from "./usuarios-regras";

describe("normalização e validação", () => {
  it("o e-mail é normalizado como o login busca", () => {
    expect(normalizarEmail("  Diego@Seahubcoworking.com.BR ")).toBe("diego@seahubcoworking.com.br");
  });

  it("recusa o que claramente não é e-mail e aceita o que é", () => {
    expect(emailParece("diego@seahubcoworking.com.br")).toBe(true);
    expect(emailParece("diego")).toBe(false);
    expect(emailParece("diego@seahub")).toBe(false);
    expect(emailParece("di ego@seahub.com")).toBe(false);
  });

  it("senha curta é recusada com o número na mensagem", () => {
    const erro = validarNovoUsuario({ nome: "Diego", email: "d@s.com", senha: "1234567", papel: "COMERCIAL" });
    expect(erro).toMatch(/8 caracteres/);
  });

  it("usuário válido passa", () => {
    expect(
      validarNovoUsuario({ nome: "Diego", email: "d@s.com", senha: "12345678", papel: "COMERCIAL" }),
    ).toBeNull();
  });

  it("perfil inventado é recusado", () => {
    expect(
      validarNovoUsuario({ nome: "Diego", email: "d@s.com", senha: "12345678", papel: "DONO" }),
    ).toBe("Perfil inválido.");
  });
});

describe("impedimento — as travas que evitam trancar todo mundo fora", () => {
  const admin = (id: string, ativo = true): AlvoDaMudanca => ({ id, papel: "ADMIN", ativo });
  const comercial = (id: string, ativo = true): AlvoDaMudanca => ({ id, papel: "COMERCIAL", ativo });

  it("⚠ o último administrador ativo não pode se rebaixar nem ser desativado", () => {
    expect(
      impedimento({ alvo: admin("a"), mudanca: { papel: "COMERCIAL" }, euId: "outro", adminsAtivos: 1 }),
    ).toMatch(/único administrador/);
    expect(
      impedimento({ alvo: admin("a"), mudanca: { ativo: false }, euId: "outro", adminsAtivos: 1 }),
    ).toMatch(/único administrador/);
  });

  it("com dois administradores ativos, um pode sair", () => {
    expect(
      impedimento({ alvo: admin("a"), mudanca: { papel: "COMERCIAL" }, euId: "outro", adminsAtivos: 2 }),
    ).toBeNull();
  });

  it("⚠ ninguém desativa nem rebaixa a própria conta", () => {
    expect(impedimento({ alvo: admin("eu"), mudanca: { ativo: false }, euId: "eu", adminsAtivos: 3 })).toMatch(
      /própria conta/,
    );
    expect(
      impedimento({ alvo: admin("eu"), mudanca: { papel: "VIEWER" }, euId: "eu", adminsAtivos: 3 }),
    ).toMatch(/própria conta/);
  });

  it("promover, renomear e reativar nunca são impedidos", () => {
    expect(impedimento({ alvo: comercial("b"), mudanca: { papel: "ADMIN" }, euId: "eu", adminsAtivos: 1 })).toBeNull();
    expect(impedimento({ alvo: comercial("b"), mudanca: {}, euId: "eu", adminsAtivos: 1 })).toBeNull();
    expect(
      impedimento({ alvo: comercial("b", false), mudanca: { ativo: true }, euId: "eu", adminsAtivos: 1 }),
    ).toBeNull();
  });

  it("administrador JÁ inativo não conta como o último — reativar ou mexer nele é livre", () => {
    expect(
      impedimento({ alvo: admin("a", false), mudanca: { papel: "VIEWER" }, euId: "eu", adminsAtivos: 1 }),
    ).toBeNull();
  });
});

describe("senhaTemporaria", () => {
  it("são 4 grupos de 4, sem os caracteres que se confundem ao digitar", () => {
    const s = senhaTemporaria((n) => Array.from({ length: n }, (_, i) => i * 7));
    expect(s).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    expect(s).not.toMatch(/[0O1lI]/);
    expect(s.replace(/-/g, "")).toHaveLength(16);
  });
});
