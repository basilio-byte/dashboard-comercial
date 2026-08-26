import { estadoDoEspelho } from "@/lib/intel/completude";
import { Secao } from "@/components/Cartao";

export const dynamic = "force-dynamic";

/**
 * GATILHOS — o que dispara oferta, e o que ainda não dispara.
 *
 * Esta tela existe por um motivo específico: **fila vazia precisa ser
 * interpretável**. Sem ela, "ninguém tem oportunidade hoje" e "o motor está
 * desligado" têm a mesma aparência — e a segunda situação, silenciosa, é como
 * uma automação morre sem ninguém perceber.
 *
 * "Gatilho" é a palavra do documento de especificação do cliente. Usar o
 * vocabulário dele, e não o de um dashboard financeiro, é parte de o sistema
 * ser deste negócio.
 */

type Estado = "ligado" | "aguardando" | "bloqueado" | "pendente";

interface Gatilho {
  n: number | null;
  nome: string;
  condicao: string;
  oferta: string;
  estado: Estado;
  nota: string;
}

function gatilhos(horasConfiavel: boolean): Gatilho[] {
  return [
    {
      n: null,
      nome: "Estoura a cota de horas",
      condicao: "usa mais horas do que o plano oferece, em ciclos seguidos",
      oferta: "upgrade de plano",
      estado: horasConfiavel ? "ligado" : "aguardando",
      nota: horasConfiavel
        ? "ativo — único gatilho rodando hoje"
        : "aguardando a carga de reservas e contratos terminar",
    },
    {
      n: 1,
      nome: "Fiscal completa 11 meses",
      condicao: "contrato de Endereço Fiscal chega a 11 meses",
      oferta: "plano Bianual",
      estado: "pendente",
      nota: "motor de regras não implementado · falta definir se o relógio começa em startDate ou fidelityDate",
    },
    {
      n: 2,
      nome: "Pacote de horas acabando",
      condicao: "saldo do pacote abaixo do limiar",
      oferta: "novo pacote",
      estado: "bloqueado",
      nota: "depende da validação do saldo contra a tela do Conexa — ver Confiança",
    },
    {
      n: 3,
      nome: "Padrão de compra irregular",
      condicao: "compra caindo mês a mês",
      oferta: "novo pacote",
      estado: "bloqueado",
      nota: '"irregular" ainda não tem definição numérica — quantos meses, qual queda?',
    },
    {
      n: 4,
      nome: "Avulso com uso alto",
      condicao: "só compra hora avulsa, mas passou de 5h no mês",
      oferta: "pacote de horas, mostrando a economia",
      estado: "pendente",
      nota: "o gatilho é sólido; a economia depende de uma tabela de preços que é cadastro manual",
    },
    {
      n: 5,
      nome: "Primeira reserva de sala",
      condicao: "primeira reserva do cliente, na data",
      oferta: "Endereço Fiscal + SeaBox",
      estado: "pendente",
      nota: "exige a carga completa de reservas — sem ela, todo cliente antigo parece estreante",
    },
    {
      n: 6,
      nome: "Privativa completa 1 mês",
      condicao: "1 mês do início do contrato de sala privativa",
      oferta: "Registro de Marca",
      estado: "pendente",
      nota: "motor de regras não implementado",
    },
    {
      n: 7,
      nome: "Privativa completa 2 meses",
      condicao: "2 meses do início do contrato",
      oferta: "SeaBox como benefício",
      estado: "pendente",
      nota: 'se o SeaBox é cortesia e não vira venda, o sistema nunca saberá que o cliente já recebeu',
    },
    {
      n: 8,
      nome: "Privativa até 6 meses",
      condicao: "até o 6º mês do contrato",
      oferta: "Panteão",
      estado: "pendente",
      nota: 'produto existe (3380/3381) · falta definir se "até o 6º mês" é aniversário ou janela aberta',
    },
    {
      n: 9,
      nome: "Pacote abaixo de 5h",
      condicao: "saldo do pacote menor que 5h",
      oferta: "novo pacote",
      estado: "bloqueado",
      nota: "mesma dependência do gatilho 2 — é o mesmo cálculo com outro limiar",
    },
    {
      n: 10,
      nome: "Litoral reserva sala",
      condicao: "plano de Endereço Fiscal SEM horas inclusas + fez reserva",
      oferta: "Pacote de Horas ou upgrade para Batial (2h/mês)",
      estado: "pendente",
      nota: "desbloqueado: o tier vem da cota do plano, não do nome — Batial 2h confirmado na API",
    },
  ];
}

const ESTILO: Record<Estado, { cor: string; marca: string; rotulo: string }> = {
  ligado: { cor: "text-[var(--bom-tinta)]", marca: "●", rotulo: "ligado" },
  aguardando: { cor: "text-[var(--atencao-tinta)]", marca: "◐", rotulo: "aguardando dado" },
  bloqueado: { cor: "text-[var(--critico-tinta)]", marca: "✕", rotulo: "bloqueado" },
  pendente: { cor: "text-[var(--tinta-3)]", marca: "○", rotulo: "não implementado" },
};

export default async function Gatilhos() {
  const espelho = await estadoDoEspelho();
  const lista = gatilhos(espelho.horasConfiavel);
  const ligados = lista.filter((g) => g.estado === "ligado").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">Gatilhos</h1>
        <p className="mt-1 text-[14px] text-[var(--tinta-2)]">
          O que dispara uma oferta — e, principalmente, o que ainda <strong>não</strong> dispara.
          Uma fila vazia só quer dizer alguma coisa quando se sabe o que está ligado.
        </p>
      </div>

      <div className="faixa faixa-info">
        <strong>
          {ligados} de {lista.length} gatilhos ativos.
        </strong>{" "}
        Nenhum deles cria task no ClickUp ainda — a camada de disparo não existe. O que roda hoje
        aparece no Radar, para o vendedor decidir o que fazer.
      </div>

      <Secao titulo="Os gatilhos" sub="Fonte: documento de especificação do cliente, mais um derivado da conversa com o responsável.">
        <div className="space-y-2">
          {lista.map((g) => {
            const e = ESTILO[g.estado];
            return (
              <div key={g.nome} className="cartao px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {/* Marca + rótulo: a cor nunca carrega o significado sozinha. */}
                  <span className={e.cor} aria-hidden>
                    {e.marca}
                  </span>
                  <span className="text-[15px] font-medium">{g.nome}</span>
                  {g.n ? (
                    <span className="text-[11px] text-[var(--tinta-3)]">regra {g.n}</span>
                  ) : (
                    <span className="text-[11px] text-[var(--tinta-3)]">
                      pedido do responsável
                    </span>
                  )}
                  <span className={`ml-auto text-[12px] ${e.cor}`}>{e.rotulo}</span>
                </div>

                <div className="mt-1.5 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                  <div className="text-[var(--tinta-2)]">
                    <span className="text-[var(--tinta-3)]">quando: </span>
                    {g.condicao}
                  </div>
                  <div className="text-[var(--tinta-2)]">
                    <span className="text-[var(--tinta-3)]">oferta: </span>
                    {g.oferta}
                  </div>
                </div>

                <p className="mt-1.5 text-[12px] text-[var(--tinta-3)]">{g.nota}</p>
              </div>
            );
          })}
        </div>
      </Secao>
    </div>
  );
}
