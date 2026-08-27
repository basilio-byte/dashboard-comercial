import { CircleCheck, CircleDashed, CircleQuestionMark, TriangleAlert, type LucideIcon } from "lucide-react";
import { sinaisDoCliente, type EstadoSinal } from "@/lib/regras/avaliar";
import { Nota, Painel, Rolante, Secao } from "@/components/Cartao";
import { cn } from "@/lib/ui";

/**
 * SINAIS AUTOMÁTICOS — a aba do §4.6 do documento do Diego, virada tela.
 *
 * *"Cada regra de negócio da seção 1, avaliada com os dados reais do cliente
 * (marcar como: gatilho ativo / não aplicável / dado indisponível / ambíguo)"*.
 *
 * ⚠ Os quatro estados são os DELE. Não inventei taxonomia — já fiz isso uma vez
 * nesta sessão, na tela Gatilhos, e estava errado em três regras.
 *
 * A tela Gatilhos responde *"o que o sistema consegue disparar?"*. Esta responde
 * *"o que este cliente aqui aciona hoje?"*. São perguntas diferentes e por isso
 * duas telas — a primeira é sobre o motor, a segunda é sobre a pessoa que o
 * vendedor vai ligar.
 */
const ESTILO: Record<
  EstadoSinal,
  { Icone: LucideIcon; selo: string; aresta: string; rotulo: string }
> = {
  ATIVO: {
    Icone: CircleCheck,
    selo: "selo-bom",
    aresta: "bg-[var(--bom)]",
    rotulo: "gatilho ativo",
  },
  AMBIGUO: {
    Icone: TriangleAlert,
    selo: "selo-atencao",
    aresta: "bg-[var(--atencao)]",
    rotulo: "ambíguo",
  },
  DADO_INDISPONIVEL: {
    Icone: CircleQuestionMark,
    selo: "selo-critico",
    aresta: "bg-[var(--critico)]",
    rotulo: "dado indisponível",
  },
  NAO_APLICAVEL: {
    Icone: CircleDashed,
    selo: "",
    aresta: "bg-[var(--linha)]",
    rotulo: "não aplicável",
  },
};

const ORDEM: EstadoSinal[] = ["ATIVO", "AMBIGUO", "DADO_INDISPONIVEL", "NAO_APLICAVEL"];

export async function SinaisAutomaticos({ customerConexaId }: { customerConexaId: number }) {
  const sinais = await sinaisDoCliente(customerConexaId);
  const conta = (e: EstadoSinal) => sinais.filter((s) => s.estado === e).length;
  const ativos = conta("ATIVO");

  // Ativo e ambíguo primeiro: é o que o vendedor precisa ler. O resto é
  // contexto — e existe para "nenhum sinal" ser interpretável em vez de vazio.
  const ordenados = [...sinais].sort(
    (a, b) => ORDEM.indexOf(a.estado) - ORDEM.indexOf(b.estado),
  );

  return (
    <Secao
      titulo="Sinais automáticos"
      sub={`As ${sinais.length} regras avaliadas contra os dados deste cliente, agora.`}
      acao={
        <span className={cn("selo", ativos > 0 ? "selo-bom" : "")}>
          {ativos} {ativos === 1 ? "gatilho ativo" : "gatilhos ativos"}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ORDEM.map((e) => {
          const { Icone, selo, rotulo } = ESTILO[e];
          const n = conta(e);
          return (
            <div key={e} className="cartao px-3.5 py-3">
              <div className="flex items-center gap-1.5 text-[13px] text-[var(--tinta-2)]">
                <span className={cn("selo h-5 w-5 justify-center p-0", selo)}>
                  <Icone size={12} />
                </span>
                {rotulo}
              </div>
              <div
                className={cn(
                  "num mt-1.5 text-[22px] font-semibold leading-none",
                  n === 0 && "text-[var(--tinta-3)]",
                )}
              >
                {n}
              </div>
            </div>
          );
        })}
      </div>

      <Painel
        rodape={
          <>
            ⚠ Nenhum destes cria task no ClickUp — <strong>a camada de disparo não existe</strong>.
            Esta tela é para o vendedor ler e decidir; o sistema não fala com o cliente, e a
            abordagem é sempre de uma pessoa.
          </>
        }
      >
        <Rolante>
          <table className="tabela">
            <thead>
              <tr>
                <th className="w-8" />
                <th>Regra</th>
                <th>Oferta</th>
                <th>Estado</th>
                <th>Por quê</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((s) => {
                const e = ESTILO[s.estado];
                return (
                  <tr key={s.regra}>
                    <td className="pl-0 pr-0">
                      <span aria-hidden className={cn("block h-6 w-[3px] rounded-r", e.aresta)} />
                    </td>
                    <td>
                      <span className="font-medium">{s.nome}</span>
                      <span className="selo ml-2">
                        {s.regra === "extra" || s.regra === "métrica" ? s.regra : `regra ${s.regra}`}
                      </span>
                      {s.evidencia ? (
                        <div className="mt-0.5 text-[12.5px] font-medium text-[var(--critico-tinta)]">
                          {s.evidencia}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-[var(--tinta-2)]">{s.oferta}</td>
                    <td>
                      <span className={cn("selo whitespace-nowrap", e.selo)}>
                        <e.Icone size={11.5} aria-hidden />
                        {e.rotulo}
                      </span>
                    </td>
                    <td className="max-w-md text-[13px] leading-relaxed text-[var(--tinta-3)]">
                      {s.motivo}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Rolante>
      </Painel>

      <Nota>
        Os quatro estados são os do documento do Diego (§4.6). <strong>Ambíguo</strong> não é
        &quot;talvez&quot;: é o sistema recusando afirmar — mais de um contrato com cota, ou uma
        oferta que o cliente pode já ter recebido de cortesia sem que exista mapeamento para
        confirmar. <strong>Dado indisponível</strong> é lacuna declarada, e nenhuma regra dispara
        sobre ela.
      </Nota>
    </Secao>
  );
}
