import { usuarioAtual } from "@/lib/auth/session";
import { FormularioSenha } from "./formulario";
import { Cabecalho } from "@/components/Cartao";
import { iniciais } from "@/lib/ui";

export const dynamic = "force-dynamic";

export default async function MinhaConta() {
  const usuario = await usuarioAtual();
  if (!usuario) return null;

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
          <span className="selo ml-auto">{usuario.role === "ADMIN" ? "admin" : "leitura"}</span>
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
    </>
  );
}
