import { usuarioAtual } from "@/lib/auth/session";
import { listarAgentes } from "@/lib/operacao/agentes";
import { prisma } from "@/lib/db";
import { Cabecalho, Faixa, Nota } from "@/components/Cartao";
import { ListaDeAgentes } from "./lista";

export const dynamic = "force-dynamic";

/**
 * AGENTES — quem usa a ferramenta.
 *
 * Pedido do Diego em 2026-09-16: *"campo para cadastro de agentes (Diego,
 * Guilherme...)"*.
 *
 * ⚠ **Não é o vendedor responsável do Conexa**, e a distinção precisa estar na
 * tela, não só no código. Aquele não é resolvível: `/sellers` responde 404 por
 * permissão, e mesmo liberado o `sellerId` gravado no contrato é o vendedor da
 * ÉPOCA da venda, não o de hoje. Sem esse aviso, alguém vai cadastrar o time
 * aqui e esperar que a carteira se divida sozinha entre eles.
 *
 * O que este cadastro faz hoje: dá uma lista fechada para o campo "quem falou
 * com o cliente" — que era texto livre e por isso acumulava "Diego", "diego" e
 * "DS" como três pessoas diferentes.
 *
 * O que ele prepara: o roster do disparo (vendedor → clickupUserId →
 * chatwootAgentId), que é o que a camada de disparo vai precisar no dia em que
 * existir.
 */
export default async function Agentes() {
  const [agentes, usuario, nomesLivres] = await Promise.all([
    listarAgentes({ incluirInativos: true }),
    usuarioAtual(),
    // ⚠ Os nomes que já foram digitados à mão e não estão no cadastro. É o que
    // transforma esta tela de "formulário vazio" em "eis quem já trabalhou a
    // fila, cadastre-os" — e revela as grafias divergentes da mesma pessoa.
    prisma.contato.groupBy({
      by: ["quem"],
      where: { agenteId: null },
      _count: true,
      _max: { contatoEm: true },
      orderBy: { _count: { quem: "desc" } },
      take: 20,
    }),
  ]);

  const podeEditar = usuario?.role === "ADMIN" || usuario?.role === "COMERCIAL";
  const ativos = agentes.filter((a) => a.ativo).length;

  const jaCadastrados = new Set(
    agentes.flatMap((a) => [a.nome.toLowerCase(), (a.apelido ?? "").toLowerCase()]),
  );
  const pendentes = nomesLivres.filter((n) => !jaCadastrados.has(n.quem.toLowerCase().trim()));

  return (
    <>
      <Cabecalho
        titulo="Agentes"
        sub="Quem usa a ferramenta. É a lista que aparece no campo “quem falou com o cliente”, e o roster do disparo quando ele existir."
        acao={
          <span className="selo">
            {ativos} {ativos === 1 ? "ativo" : "ativos"}
            {agentes.length > ativos ? ` · ${agentes.length - ativos} inativo(s)` : ""}
          </span>
        }
      />

      <div className="space-y-6">
        <Faixa tom="atencao">
          <strong>Isto não é o vendedor responsável do Conexa.</strong> Aquele não é resolvível:{" "}
          <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">/sellers</code>{" "}
          responde <strong>404 por permissão</strong> deste token — e, mesmo liberado, o{" "}
          <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">sellerId</code>{" "}
          gravado no contrato é o vendedor <strong>da época da venda</strong>, não o de hoje.
          Cadastrar gente aqui <strong>não divide a carteira</strong> entre elas.
        </Faixa>

        <ListaDeAgentes agentes={agentes} podeEditar={!!podeEditar} pendentes={pendentes.map((p) => ({
          quem: p.quem,
          contatos: p._count,
          ultimoEm: p._max.contatoEm ? p._max.contatoEm.toISOString().slice(0, 10) : null,
        }))} />

        <Nota>
          Quem já registrou contato <strong>não pode ser removido</strong>, só desativado — apagar
          faria o histórico perder de quem foi o contato, e histórico comercial não se apaga porque
          alguém mudou de emprego. Os ids de ClickUp e Chatwoot podem ficar em branco: a camada de
          disparo não existe, e eles são o preparo para quando existir.
        </Nota>
      </div>
    </>
  );
}
