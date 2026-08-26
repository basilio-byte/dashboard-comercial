import { ultimosMesesFechados } from "@/lib/dates";
import { usuarioAtual } from "@/lib/auth/session";
import { PainelReconciliacao } from "./painel-reconciliacao";

export async function SecaoReconciliacao() {
  const usuario = await usuarioAtual();
  const meses = ultimosMesesFechados(6).reverse();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight">Reconciliação das cobranças</h2>
        <p className="mt-1 text-sm text-[var(--tinta-2)]">
          Confere o espelho local contra o Conexa, cobrança por cobrança, num mês fechado.
        </p>
      </div>

      <div className="cartao px-4 py-3 text-sm text-[var(--tinta-2)]">
        <p>
          <strong>Critério:</strong> diferença de <strong>R$ 0,00</strong> e contagem idêntica. Só o total
          batendo não serve — duas divergências podem se cancelar e esconder as duas.
        </p>
        <p className="mt-2">
          <strong>A janela é por VENCIMENTO.</strong> Medido contra a API: <code>/charges</code> só
          aceita filtro por vencimento, competência e pagamento — <strong>não existe filtro por data
          de criação</strong>, e a API devolve zero em vez de ignorar o parâmetro. Então esta tela
          prova que o espelho tem os mesmos registros e valores, não o total de um mês de emissão.
        </p>
        <p className="mt-2">
          Conjunto remoto vazio nunca é &quot;bate&quot;: aparece como{" "}
          <strong>nada conferido</strong>. Um atestado de correção sobre uma conferência que não
          aconteceu é pior que não ter conferência.
        </p>
        <p className="mt-2 text-xs text-[var(--tinta-3)]">
          ⚠ Custa requisições: varre o mês inteiro na API. Rode sob demanda, não em laço — o teto de 60
          req/min é dividido com o Dashboard Financeiro.
        </p>
      </div>

      {usuario?.role === "ADMIN" ? (
        <PainelReconciliacao meses={meses} />
      ) : (
        <p className="text-sm text-[var(--tinta-3)]">Reconciliação é restrita a administradores.</p>
      )}
    </div>
  );
}
