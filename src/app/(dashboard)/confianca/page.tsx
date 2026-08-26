import { usuarioAtual } from "@/lib/auth/session";
import { SecaoValidacao } from "./secao-validacao";
import { SecaoReconciliacao } from "./secao-reconciliacao";

export const dynamic = "force-dynamic";

/**
 * CONFIANÇA — os números batem?
 *
 * Junta as duas conferências numa tela só porque respondem a mesma pergunta:
 * **dá para confiar no que a tela mostra?** Separá-las em "Reconciliação" e
 * "Validação" era vocabulário de contabilidade; aqui o que importa é se o
 * vendedor pode agir sobre o número.
 *
 * Ordem deliberada: o saldo de horas vem primeiro porque é o que ainda NÃO foi
 * validado e o que bloqueia dois gatilhos.
 */
export default async function Confianca() {
  const usuario = await usuarioAtual();
  const admin = usuario?.role === "ADMIN";

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">Confiança</h1>
        <p className="mt-1 text-[14px] text-[var(--tinta-2)]">
          Os números batem com a fonte? Nenhum gatilho deveria disparar sobre número que ninguém
          conferiu.
        </p>
      </div>

      {!admin ? (
        <p className="text-sm text-[var(--tinta-3)]">
          As conferências são restritas a administradores.
        </p>
      ) : (
        <>
          <SecaoValidacao />
          <div className="border-t border-[var(--linha)]" />
          <SecaoReconciliacao />
        </>
      )}
    </div>
  );
}
