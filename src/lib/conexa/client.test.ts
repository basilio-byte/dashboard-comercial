import { describe, expect, it, vi } from "vitest";

// `buildUrl` lê a base do ambiente. O teste é sobre SERIALIZAÇÃO de query, não
// sobre configuração — então a base é fixada aqui.
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ CONEXA_BASE_URL: "https://exemplo.test/api/v2" }),
}));
vi.mock("server-only", () => ({}));

const { buildUrl } = await import("./client");

const q = (url: string) => new URL(url).searchParams;

describe("buildUrl — as regras da API do Conexa, presas por teste", () => {
  it("repete o parâmetro para arrays com colchetes", () => {
    // Juntar com vírgula devolve SILENCIOSAMENTE o conjunto errado — o pior
    // tipo de defeito de integração, porque responde 200.
    const p = q(buildUrl("customers", { "id[]": [1, 2, 3] }));
    expect(p.getAll("id[]")).toEqual(["1", "2", "3"]);
  });

  it("converte booleano para 1/0", () => {
    // Medido em 2026-08-27: `isActive=true` → 400 "Is Active must be either
    // 1 or 0". O tipo `QueryValue` aceita boolean, então sem esta conversão o
    // erro só apareceria contra a API real.
    expect(q(buildUrl("plans", { isActive: true })).get("isActive")).toBe("1");
    expect(q(buildUrl("plans", { isActive: false })).get("isActive")).toBe("0");
  });

  it("ignora undefined e null em vez de mandar a string", () => {
    const p = q(buildUrl("plans", { a: undefined, b: null, c: 1 }));
    expect(p.has("a")).toBe(false);
    expect(p.has("b")).toBe(false);
    expect(p.get("c")).toBe("1");
  });

  it("não duplica a barra entre base e caminho", () => {
    expect(buildUrl("/room/bookings")).toBe("https://exemplo.test/api/v2/room/bookings");
  });

  it("preserva o zero, que é valor e não ausência", () => {
    expect(q(buildUrl("plans", { offset: 0 })).get("offset")).toBe("0");
  });
});
