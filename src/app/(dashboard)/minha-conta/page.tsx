import { usuarioAtual } from "@/lib/auth/session";
import { FormularioSenha } from "./formulario";

export const dynamic = "force-dynamic";

export default async function MinhaConta() {
  const usuario = await usuarioAtual();
  if (!usuario) return null;

  return (
    <div className="max-w-md space-y-8">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">Minha conta</h1>
        <p className="mt-1 text-[14px] text-[var(--tinta-2)]">
          {usuario.name} · {usuario.email}
        </p>
      </div>

      <div className="cartao px-5 py-4">
        <h2 className="text-[15px] font-medium">Trocar senha</h2>
        <p className="mt-1 text-[13px] text-[var(--tinta-2)]">
          Trocar a senha encerra as <strong>outras</strong> sessões deste usuário — a atual
          continua. Se a senha vazou, é isso que resolve.
        </p>
        <div className="mt-4">
          <FormularioSenha />
        </div>
      </div>
    </div>
  );
}
