import { ultimosMesesFechados } from "@/lib/dates";
import { usuarioAtual } from "@/lib/auth/session";
import { PainelReconciliacao } from "./painel-reconciliacao";
import { Faixa, Nota } from "@/components/Cartao";
import { HistoricoReconciliacao } from "./historico-reconciliacao";

export async function SecaoReconciliacao() {
  const usuario = await usuarioAtual();
  const meses = ultimosMesesFechados(6).reverse();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight">Reconciliação das cobranças</h2>
        <p className="mt-1 max-w-3xl text-[14.5px] leading-relaxed text-[var(--tinta-2)]">
          Confere o espelho local contra o Conexa, cobrança por cobrança, num mês fechado.
        </p>
      </div>

      <div className="cartao space-y-2.5 px-4 py-3.5 text-[13.5px] leading-relaxed text-[var(--tinta-2)]">
        <p>
          <strong className="font-semibold text-[var(--tinta)]">Critério:</strong> diferença de{" "}
          <strong className="font-semibold text-[var(--tinta)]">R$ 0,00</strong> e contagem
          idêntica. Só o total batendo não serve — duas divergências podem se cancelar e esconder as
          duas.
        </p>
        <p>
          <strong className="font-semibold text-[var(--tinta)]">A janela é por VENCIMENTO.</strong>{" "}
          Medido contra a API:{" "}
          <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">/charges</code> só
          aceita filtro por vencimento, competência e pagamento —{" "}
          <strong className="font-semibold text-[var(--tinta)]">
            não existe filtro por data de criação
          </strong>
          , e a API devolve zero em vez de ignorar o parâmetro. Então esta tela prova que o espelho
          tem os mesmos registros e valores, não o total de um mês de emissão.
        </p>
        <p>
          Conjunto remoto vazio nunca é &quot;bate&quot;: aparece como{" "}
          <strong className="font-semibold text-[var(--tinta)]">nada conferido</strong>. Um atestado
          de correção sobre uma conferência que não aconteceu é pior que não ter conferência.
        </p>
      </div>

      <Faixa tom="atencao">
        <strong>Custa requisições:</strong> varre o mês inteiro na API. Rode sob demanda, não em
        laço. Os 60 req/min <strong>são inteiros do comercial</strong> — o financeiro em produção
        usa login web, não a API v2 —, mas a carga automática disputa o mesmo teto, e a folga
        existe para a futura rajada dos agentes do Chatwoot.
      </Faixa>

      {usuario?.role === "ADMIN" ? (
        <PainelReconciliacao meses={meses} />
      ) : (
        <Nota>Reconciliação é restrita a administradores.</Nota>
      )}

      <HistoricoReconciliacao />
    </div>
  );
}
