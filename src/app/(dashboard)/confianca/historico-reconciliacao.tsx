import { CircleCheck, CircleAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatBRL } from "@/lib/money";
import { dataHoraLocal, rotuloMes } from "@/lib/dates";
import { Nota, Painel, Rolante } from "@/components/Cartao";
import { cn } from "@/lib/ui";

/**
 * Histórico das conferências.
 *
 * ⚠ Existe porque o resultado **não era gravado**: `acaoReconciliar` devolvia
 * direto para a tela e sumia no primeiro F5. Uma conferência que custa minutos
 * e dezenas de requisições da API precisava ser refeita só para alguém lembrar
 * o que deu.
 *
 * O que isto responde e antes não tinha resposta: *quando foi a última vez que
 * alguém conferiu, e deu o quê?* Afirmação sobre correção sem data não vale
 * nada — é o mesmo princípio do §5.4 do documento do Diego, que manda guardar
 * histórico dos disparos.
 */
const VEREDICTO: Record<string, { Icone: LucideIcon; classe: string; rotulo: string }> = {
  BATE: { Icone: CircleCheck, classe: "selo-bom", rotulo: "bate" },
  DIVERGE: { Icone: CircleAlert, classe: "selo-critico", rotulo: "DIVERGE" },
  NADA_A_CONFERIR: { Icone: TriangleAlert, classe: "selo-atencao", rotulo: "nada conferido" },
};

export async function HistoricoReconciliacao() {
  const linhas = await prisma.reconciliacao.findMany({
    orderBy: { executadaEm: "desc" },
    take: 15,
  });

  if (linhas.length === 0) {
    return (
      <Nota>
        Nenhuma conferência registrada ainda. A primeira que rodar fica gravada aqui — com data,
        veredicto e custo em requisições.
      </Nota>
    );
  }

  return (
    <Painel
      titulo="Conferências anteriores"
      rodape={
        <>
          Guardado para a pergunta que a tela não conseguia responder: <strong>quando foi a
          última vez que alguém conferiu, e deu o quê?</strong> Conferir de novo o mesmo mês é
          legítimo — o espelho muda a cada sincronização.
        </>
      }
    >
      <Rolante>
        <table className="tabela">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Mês</th>
              <th>Veredicto</th>
              <th className="text-right">Local</th>
              <th className="text-right">Conexa</th>
              <th className="text-right">Diferença</th>
              <th className="text-right">Diverg.</th>
              <th className="text-right">Req.</th>
              <th>Por</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const v = VEREDICTO[l.veredicto] ?? VEREDICTO.NADA_A_CONFERIR!;
              return (
                <tr key={l.id}>
                  <td className="num whitespace-nowrap text-[var(--tinta-2)]">
                    {dataHoraLocal(l.executadaEm)}
                  </td>
                  <td className="whitespace-nowrap">{rotuloMes(l.mesKey)}</td>
                  <td>
                    <span className={cn("selo", v.classe)}>
                      <v.Icone size={11.5} aria-hidden />
                      {v.rotulo}
                    </span>
                  </td>
                  <td className="num text-right">
                    {formatBRL(l.localTotal.toString())}
                    <span className="ml-1 text-[var(--tinta-3)]">({l.localContagem})</span>
                  </td>
                  <td className="num text-right">
                    {formatBRL(l.remotoTotal.toString())}
                    <span className="ml-1 text-[var(--tinta-3)]">({l.remotoContagem})</span>
                  </td>
                  <td
                    className={cn(
                      "num text-right font-medium",
                      !l.diferenca.equals(0) && "text-[var(--critico-tinta)]",
                    )}
                  >
                    {formatBRL(l.diferenca.toString())}
                  </td>
                  <td
                    className={cn(
                      "num text-right",
                      l.divergencias > 0
                        ? "font-medium text-[var(--critico-tinta)]"
                        : "text-[var(--tinta-3)]",
                    )}
                  >
                    {l.divergencias}
                  </td>
                  <td className="num text-right text-[var(--tinta-3)]">{l.requisicoes}</td>
                  <td className="truncate text-[var(--tinta-3)]" title={l.executadaPor ?? undefined}>
                    {l.executadaPor?.split("@")[0] ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Rolante>
    </Painel>
  );
}
