import { Ban, CircleCheck, CircleDashed, PowerOff, type LucideIcon } from "lucide-react";
import { estadoDoEspelho } from "@/lib/intel/completude";
import { usuarioAtual } from "@/lib/auth/session";
import { carregarGatilhos } from "@/lib/regras/config";
import { FAMILIAS, paramsPorFamilia } from "@/lib/regras/catalogo";
import { paraJsonSchema, type JsonSchema } from "@/lib/mcp/esquema";
import { Cabecalho, Faixa, Nota, Secao } from "@/components/Cartao";
import { cn } from "@/lib/ui";
import { CategoriasClassificadas } from "./categorias";
import { EditorDeGatilhos } from "./editor";

export const dynamic = "force-dynamic";

/**
 * GATILHOS — o que dispara oferta, o que não dispara, e agora o lugar de mexer.
 *
 * Esta tela existe porque **fila vazia precisa ser interpretável**: sem ela,
 * "ninguém tem oportunidade hoje" e "o motor está desligado" têm a mesma
 * aparência, e a segunda é como uma automação morre sem ninguém perceber.
 *
 * ⚠ **A tela não tem mais taxonomia própria.** Ela tinha: uma lista de 12
 * gatilhos escrita em JSX, com estados inventados aqui dentro, que precisava
 * ser mantida em sincronia manual com `docs/context/regras-comerciais.md` e com
 * o motor. Os três divergiram pelo menos uma vez — a tela chegou a declarar
 * "pronto para implementar" três regras que o repositório já tinha analisado
 * como tendo ressalva concreta.
 *
 * Agora o estado vem de `carregarGatilhos()`, que é a mesma fonte que o motor
 * avalia e que o MCP publica. Uma tela que discorda do motor deixou de ser
 * possível, em vez de ser algo que se combina de não fazer.
 *
 * Os quatro estados respondem **de quem é a próxima ação**:
 *  - avaliando — está rodando;
 *  - desligado — alguém desligou aqui, e religa aqui;
 *  - bloqueado — depende do Conexa: o saldo do pacote não sai por endpoint nenhum;
 *  - sem dado — depende da carga terminar.
 */

type Estado = "avaliando" | "desligado" | "bloqueado" | "semDado";

const ESTILO: Record<Estado, { Icone: LucideIcon; selo: string; rotulo: string; deQuem: string }> = {
  avaliando: {
    Icone: CircleCheck,
    selo: "selo-bom",
    rotulo: "avaliando",
    deQuem: "rodando no Radar e na ficha",
  },
  desligado: {
    Icone: PowerOff,
    selo: "selo-atencao",
    rotulo: "desligado",
    deQuem: "alguém desligou — religa aqui",
  },
  bloqueado: {
    Icone: Ban,
    selo: "selo-critico",
    rotulo: "bloqueado por terceiro",
    deQuem: "depende do Conexa, não de código",
  },
  semDado: {
    Icone: CircleDashed,
    selo: "selo-info",
    rotulo: "sem dado completo",
    deQuem: "depende da carga terminar",
  },
};

const ORDEM: Estado[] = ["avaliando", "desligado", "bloqueado", "semDado"];

/** Famílias que só valem com o espelho de reservas/contratos completo. */
const DEPENDE_DE_HORAS = new Set([
  "USO_SEM_COTA",
  "PRIMEIRO_EVENTO",
  "EVENTO_EM_SEGMENTO",
  "EXCEDENTE",
]);

export default async function Gatilhos() {
  const [espelho, gatilhos, usuario] = await Promise.all([
    estadoDoEspelho(),
    carregarGatilhos(),
    usuarioAtual(),
  ]);

  const podeEditar = usuario?.role === "ADMIN" || usuario?.role === "COMERCIAL";

  const estadoDe = (g: (typeof gatilhos.todos)[number]): Estado => {
    if (g.bloqueio) return "bloqueado";
    if (!g.ativo) return "desligado";
    if (DEPENDE_DE_HORAS.has(g.familia) && !espelho.horasConfiavel) return "semDado";
    return "avaliando";
  };

  const contagem = (e: Estado) => gatilhos.todos.filter((g) => estadoDe(g) === e).length;
  const avaliando = contagem("avaliando");

  // O JSON Schema de cada família, para o editor desenhar os campos de limiar
  // sem ter uma lista própria — é o mesmo esquema que valida a gravação.
  const esquemas: Record<string, JsonSchema> = Object.fromEntries(
    FAMILIAS.map((f) => [f, paraJsonSchema(paramsPorFamilia[f])]),
  );

  return (
    <>
      <Cabecalho
        titulo="Gatilhos"
        sub={
          <>
            O que dispara uma oferta — e, principalmente, o que ainda <strong>não</strong> dispara.
            Uma fila vazia só quer dizer alguma coisa quando se sabe o que está ligado. Os
            limiares são editáveis aqui, sem deploy.
          </>
        }
        acao={
          <span className={cn("selo", avaliando > 0 ? "selo-bom" : "selo-atencao")}>
            {avaliando} de {gatilhos.todos.length} avaliando
          </span>
        }
      />

      <div className="space-y-8">
        {/* O placar não conta "quantos faltam" — conta DE QUEM é a próxima ação. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ORDEM.map((e) => {
            const { Icone, rotulo, selo, deQuem } = ESTILO[e];
            const n = contagem(e);
            return (
              <div key={e} className="cartao px-3.5 py-3">
                <div className="flex items-center gap-1.5 text-[13px] text-[var(--tinta-2)]">
                  {/* ⚠ Ícone E rótulo, nunca só a cor: "este gatilho está
                      desligado" é exatamente a informação que, perdida, faz
                      alguém achar que o motor está rodando. */}
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
                <div className="mt-1 text-[12px] text-[var(--tinta-3)]">{deQuem}</div>
              </div>
            );
          })}
        </div>

        <Faixa tom="info">
          <strong>Regra é dado; família é código.</strong> O que se edita aqui são os limiares, a
          oferta e o liga-desliga. A <em>pergunta</em> que cada regra faz vive como função pura
          testada em{" "}
          <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">
            src/lib/regras/familias.ts
          </code>{" "}
          — e uma pergunta nova precisa de código com teste, não de linha de tabela. É essa
          fronteira que permite mexer nos limiares durante o expediente sem medo.
        </Faixa>

        <Secao
          titulo="Os gatilhos"
          sub="Fonte: documento do Diego, mais um pedido do responsável. Cada linha é o que o motor realmente avalia."
        >
          <EditorDeGatilhos
            gatilhos={gatilhos.todos}
            esquemas={esquemas}
            familias={FAMILIAS}
            podeEditar={!!podeEditar}
          />
        </Secao>

        <CategoriasClassificadas podeEditar={!!podeEditar} />

        <Nota>
          Gatilho <strong>bloqueado</strong> não é o mesmo que desligado: as regras 2 e 9 dependem
          do conteúdo do pacote de horas, que{" "}
          <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">/packages</code> nega a
          este token e nem o MCP oficial do Conexa mostra. Ligar não faria efeito — a pergunta é
          para o suporte do Conexa. E nada nesta tela cria task em lugar nenhum: a camada
          de disparo não existe.
        </Nota>
      </div>
    </>
  );
}
