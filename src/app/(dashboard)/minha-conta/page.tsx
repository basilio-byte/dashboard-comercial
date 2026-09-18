import { headers } from "next/headers";
import { usuarioAtual } from "@/lib/auth/session";
import { listarTokensMcp } from "@/lib/mcp/tokens";
import { FormularioSenha } from "./formulario";
import { TokensMcp } from "./tokens-mcp";
import { Cabecalho } from "@/components/Cartao";
import { iniciais } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function MinhaConta() {
  const usuario = await usuarioAtual();
  if (!usuario) return null;

  const ehAdmin = usuario.role === "ADMIN";
  // Admin vê e revoga os tokens de todos: é quem responde por um vazamento.
  const tokens = await listarTokensMcp(ehAdmin ? {} : { userId: usuario.id });

  // ⚠ O endereço do comando é o que a pessoa está usando AGORA no navegador.
  // Montar a partir de APP_URL mandaria para o domínio próprio, que em
  // 2026-09-18 servia certificado autoassinado — e o Claude Code recusa.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:7000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const urlMcp = `${proto}://${host}/api/mcp`;

  return (
    <>
      <Cabecalho titulo="Minha conta" />

      <div className="max-w-lg space-y-4">
        <div className="cartao flex items-center gap-3.5 px-4 py-4">
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--acento-wash)] text-[15px] font-semibold text-[var(--acento-tinta)]"
          >
            {iniciais(usuario.name)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold">{usuario.name}</div>
            <div className="truncate text-[14px] text-[var(--tinta-2)]">{usuario.email}</div>
          </div>
          <span className="selo ml-auto">
            {usuario.role === "ADMIN" ? "admin" : usuario.role === "COMERCIAL" ? "comercial" : "leitura"}
          </span>
        </div>

        <div className="cartao px-5 py-4">
          <h2 className="text-[15.5px] font-semibold">Trocar senha</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--tinta-2)]">
            Trocar a senha encerra as <strong className="font-semibold text-[var(--tinta)]">outras</strong>{" "}
            sessões deste usuário — a atual continua. Se a senha vazou, é isso que resolve.
          </p>
          <div className="mt-4">
            <FormularioSenha />
          </div>
        </div>
      </div>

      <div className="mt-4 max-w-3xl">
        <div className="cartao px-5 py-4">
          <h2 className="text-[15.5px] font-semibold">Tokens do MCP</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--tinta-2)]">
            Para conectar um assistente de IA (Claude Code, Claude Desktop) ao painel. Cada token é
            seu: o que for feito com ele aparece no histórico de mudanças com o{" "}
            <strong className="font-semibold text-[var(--tinta)]">seu</strong> e-mail. Prefira{" "}
            <strong className="font-semibold text-[var(--tinta)]">somente leitura</strong> — escrita
            só para quem vai ajustar gatilhos, agentes ou categorias pelo assistente.
            {ehAdmin ? " Como administrador, você vê e pode revogar os tokens de todos." : ""}
          </p>
          <div className="mt-4">
            <TokensMcp
              tokens={tokens}
              urlMcp={urlMcp}
              ehAdmin={ehAdmin}
              ehLeitura={usuario.role === "VIEWER"}
              meuId={usuario.id}
            />
          </div>
        </div>
      </div>
    </>
  );
}
