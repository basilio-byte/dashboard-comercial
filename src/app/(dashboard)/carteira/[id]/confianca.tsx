import Link from "next/link";
import { prisma } from "@/lib/db";
import { dataHoraLocal, ultimoMesFechado } from "@/lib/dates";
import { estadoDoEspelho } from "@/lib/intel/completude";
import type { HorasDoCliente } from "@/lib/intel/horas";
import { Procedencia } from "@/components/Procedencia";
import { Painel, Secao } from "@/components/Cartao";
import { cn } from "@/lib/ui";

/**
 * CONFIANÇA — dentro do cliente.
 *
 * Pergunta do Diego em 2026-09-16: *"Confiança, pode ser um campo dentro do
 * cliente?"*.
 *
 * ⚠ Pode, e é onde ela vale mais. A tela Confiança responde *"o espelho inteiro
 * está certo?"* — uma pergunta de auditoria, que se faz uma vez por mês. O
 * vendedor prestes a ligar para ESTE cliente faz outra: *"posso confiar nestes
 * números aqui?"*. São perguntas diferentes, e a segunda é a que decide se ele
 * repete o número ao telefone.
 *
 * ⚠ Não virou um "score de confiança" — de propósito. Um número único (87% de
 * confiança) seria inventado: não existe fórmula que combine "o espelho de
 * reservas está completo" com "a última reconciliação bateu" e produza uma
 * porcentagem que signifique alguma coisa. O que existe é uma lista de
 * afirmações verificáveis, cada uma com procedência. É menos bonito e é o que
 * se pode defender.
 */
export async function ConfiancaDoCliente({
  customerConexaId,
  horas,
  calculadoEm,
}: {
  customerConexaId: number;
  horas: HorasDoCliente;
  calculadoEm: Date | null | undefined;
}) {
  const mes = ultimoMesFechado();
  const [espelho, cliente, ultimaReconciliacao, ultimaCarga] = await Promise.all([
    estadoDoEspelho(),
    prisma.customer.findUnique({
      where: { conexaId: customerConexaId },
      select: { syncedAt: true },
    }),
    prisma.reconciliacao.findFirst({
      where: { mesKey: mes },
      orderBy: { executadaEm: "desc" },
      select: { veredicto: true, executadaEm: true, diferenca: true, mesKey: true },
    }),
    prisma.syncRun.findFirst({
      where: { status: "SUCCESS" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true, mode: true },
    }),
  ]);

  const linhas: Array<{
    o_que: string;
    veredicto: "confiavel" | "ressalva" | "lacuna";
    detalhe: React.ReactNode;
  }> = [];

  // ── Receita ─────────────────────────────────────────────────────────────
  linhas.push({
    o_que: "Receita deste cliente",
    veredicto: espelho.receitaConfiavel ? "confiavel" : "lacuna",
    detalhe: espelho.receitaConfiavel ? (
      <>
        <Procedencia tipo="DERIVADO" /> soma de cobranças no regime de emissão, com{" "}
        <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">currentAmount</code> —
        a mesma régua do dashboard financeiro. Canceladas e renegociadas ficam de fora.
      </>
    ) : (
      <>
        Espelho incompleto em <strong>{espelho.barramReceita.join(", ")}</strong>. Os valores
        exibidos são parciais e <strong>não valem como fato</strong> — zero aqui pode ser
        &quot;ainda não carreguei&quot;.
      </>
    ),
  });

  // ── Conferência contra o Conexa ─────────────────────────────────────────
  linhas.push({
    o_que: `Conferência de ${mes} contra o Conexa`,
    veredicto: !ultimaReconciliacao
      ? "lacuna"
      : ultimaReconciliacao.veredicto === "BATE"
        ? "confiavel"
        : "ressalva",
    detalhe: !ultimaReconciliacao ? (
      <>
        Nunca conferido para este mês.{" "}
        <Link href="/confianca" className="font-medium text-[var(--acento-tinta)] underline underline-offset-2">
          Conferir agora
        </Link>{" "}
        — é uma conferência da base inteira, não deste cliente isolado.
      </>
    ) : (
      <>
        {/* ⚠ A conferência é da BASE, não deste cliente. Dizer "este cliente
            confere" seria mentira: a reconciliação compara totais do mês. */}
        <strong>{ultimaReconciliacao.veredicto}</strong> em{" "}
        {dataHoraLocal(ultimaReconciliacao.executadaEm)}
        {ultimaReconciliacao.veredicto !== "BATE" ? (
          <> · diferença de {ultimaReconciliacao.diferenca.toString()}</>
        ) : null}
        . Vale para o total da base no mês, não para este cliente isolado.
      </>
    ),
  });

  // ── Horas ───────────────────────────────────────────────────────────────
  linhas.push({
    o_que: "Consumo de horas",
    veredicto: !espelho.horasConfiavel ? "lacuna" : horas.atribuicaoAmbigua ? "ressalva" : "confiavel",
    detalhe: !espelho.horasConfiavel ? (
      <>
        Espelho incompleto em <strong>{espelho.barramHoras.join(", ")}</strong> — o consumo por
        ciclo não pode ser apresentado como fato.
      </>
    ) : horas.atribuicaoAmbigua ? (
      <>
        <strong>Atribuição ambígua:</strong> este cliente tem mais de um contrato com cota, e a
        reserva não diz de qual balde a hora saiu. Os números por contrato{" "}
        <strong>não são conclusivos</strong>, e ele fica de fora da fila de excedente.
      </>
    ) : (
      <>
        <Procedencia tipo="DERIVADO" /> reservas abatidas da cota, por ciclo de aniversário do
        contrato. O ciclo é mensal e <strong>não acumula</strong>.
      </>
    ),
  });

  // ── A lacuna que não fecha por código ───────────────────────────────────
  linhas.push({
    o_que: "Saldo do pacote de horas",
    veredicto: "lacuna",
    detalhe: (
      <>
        <Procedencia tipo="INDISPONIVEL" /> as horas do pacote vêm de{" "}
        <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">
          recurringSales.packageId
        </code>
        , e{" "}
        <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">/packages</code>{" "}
        responde <strong>404 por permissão</strong> deste token. Não é conferência pendente: é
        liberação do admin do Conexa. É o que mantém as regras 2 e 9 bloqueadas.
      </>
    ),
  });

  // ── Vendedor responsável ────────────────────────────────────────────────
  linhas.push({
    o_que: "Vendedor responsável",
    veredicto: "lacuna",
    detalhe: (
      <>
        <Procedencia tipo="INDISPONIVEL" />{" "}
        <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">/sellers</code> também
        responde 404 — e, mesmo liberado, o{" "}
        <code className="rounded-sm bg-[var(--superficie-sutil)] px-1 py-px">sellerId</code> do
        contrato é o vendedor <strong>da época da venda</strong>. Quem falou com este cliente é o
        que está em <strong>Contatos</strong>, acima, e é digitado por gente.
      </>
    ),
  });

  const problemas = linhas.filter((l) => l.veredicto !== "confiavel").length;

  return (
    <Secao
      titulo="Confiança"
      sub="O que dá para afirmar sobre este cliente, e o que não dá. Antes de repetir um número ao telefone."
      acao={
        <span className={cn("selo", problemas === 0 ? "selo-bom" : "selo-atencao")}>
          {problemas === 0
            ? "tudo verificável"
            : `${problemas} ${problemas === 1 ? "ressalva" : "ressalvas"}`}
        </span>
      }
    >
      <Painel
        rodape={
          <>
            Perfil consolidado {calculadoEm ? `em ${dataHoraLocal(calculadoEm)}` : "— nunca"} ·
            cadastro do cliente lido do Conexa{" "}
            {cliente?.syncedAt ? `em ${dataHoraLocal(cliente.syncedAt)}` : "— nunca"}
            {ultimaCarga?.finishedAt ? (
              <> · última carga bem-sucedida em {dataHoraLocal(ultimaCarga.finishedAt)}</>
            ) : null}
            .{" "}
            <Link
              href="/confianca"
              className="font-medium text-[var(--acento-tinta)] underline underline-offset-2"
            >
              Conferência da base inteira
            </Link>
          </>
        }
      >
        <ul className="divide-y divide-[var(--linha)]">
          {linhas.map((l) => (
            <li key={l.o_que} className="flex gap-3 px-4 py-3">
              <span
                aria-hidden
                className={cn(
                  "mt-1 block h-2 w-2 shrink-0 rounded-full",
                  l.veredicto === "confiavel" && "bg-[var(--bom)]",
                  l.veredicto === "ressalva" && "bg-[var(--atencao)]",
                  l.veredicto === "lacuna" && "bg-[var(--critico)]",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium">{l.o_que}</span>
                  <span
                    className={cn(
                      "selo",
                      l.veredicto === "confiavel" && "selo-bom",
                      l.veredicto === "ressalva" && "selo-atencao",
                      l.veredicto === "lacuna" && "selo-critico",
                    )}
                  >
                    {l.veredicto === "confiavel"
                      ? "pode afirmar"
                      : l.veredicto === "ressalva"
                        ? "com ressalva"
                        : "lacuna declarada"}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--tinta-2)]">
                  {l.detalhe}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Painel>
    </Secao>
  );
}
