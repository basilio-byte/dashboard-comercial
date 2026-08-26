import { Lock } from "lucide-react";
import { usuarioAtual } from "@/lib/auth/session";
import { SecaoValidacao } from "./secao-validacao";
import { SecaoReconciliacao } from "./secao-reconciliacao";
import { Cabecalho, Vazio } from "@/components/Cartao";

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
    <>
      <Cabecalho
        titulo="Confiança"
        sub="Os números batem com a fonte? Nenhum gatilho deveria disparar sobre número que ninguém conferiu."
      />

      {!admin ? (
        <Vazio Icone={Lock}>As conferências são restritas a administradores.</Vazio>
      ) : (
        <div className="space-y-10">
          <SecaoValidacao />
          <hr className="divisor" />
          <SecaoReconciliacao />
        </div>
      )}
    </>
  );
}
