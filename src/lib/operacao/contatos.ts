"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { usuarioAtual } from "@/lib/auth/session";
import { keyToUtcDate, todayKey } from "@/lib/dates";

/**
 * Registro manual de contato com o cliente.
 *
 * Sugestão do Diego em 2026-08-27: *"um campo para informar o último contato e
 * quem fez"*.
 *
 * ⚠ Fecha o ciclo que faltava. O sistema aponta quem procurar e **nunca fica
 * sabendo que alguém procurou** — então a fila repete o mesmo cliente
 * indefinidamente e o vendedor aprende a ignorá-la. É assim que uma ferramenta
 * de recomendação morre: não errando, mas repetindo.
 *
 * É o §5.4 do documento na versão manual, que é a que faz sentido enquanto a
 * camada de disparo não existe.
 */

export interface EstadoContato {
  erro?: string;
  ok?: string;
}

const RESULTADOS = ["FALOU", "SEM_RESPOSTA", "INTERESSADO", "RECUSOU", "FECHOU"] as const;
type Resultado = (typeof RESULTADOS)[number];

export async function registrarContato(
  _anterior: EstadoContato,
  form: FormData,
): Promise<EstadoContato> {
  const u = await usuarioAtual();
  if (!u) return { erro: "Sessão expirada." };

  const customerConexaId = Number(form.get("customerConexaId"));
  const quem = String(form.get("quem") ?? "").trim();
  const resultado = String(form.get("resultado") ?? "") as Resultado;
  const dia = String(form.get("contatoEm") ?? "").trim();
  const regra = String(form.get("regra") ?? "").trim() || null;
  const nota = String(form.get("nota") ?? "").trim() || null;

  if (!Number.isInteger(customerConexaId)) return { erro: "Cliente inválido." };
  if (!quem) return { erro: "Informe quem fez o contato." };
  if (!RESULTADOS.includes(resultado)) return { erro: "Escolha o resultado." };

  // ⚠ Data no FUTURO é erro de digitação, não registro. Um contato que "vai
  // acontecer" não é contato, e entraria na fila como se o cliente já tivesse
  // sido procurado.
  const hoje = keyToUtcDate(todayKey());
  const contatoEm = dia ? keyToUtcDate(dia) : hoje;
  if (Number.isNaN(contatoEm.getTime())) return { erro: "Data inválida." };
  if (contatoEm > hoje) return { erro: "A data do contato não pode ser no futuro." };

  try {
    await prisma.contato.create({
      data: {
        customerConexaId,
        contatoEm,
        quem,
        resultado,
        regra,
        nota,
        registradoPor: u.email,
      },
    });
  } catch (err) {
    // Cliente que não existe no espelho viola a chave estrangeira.
    return {
      erro:
        err instanceof Error && err.message.includes("Foreign key")
          ? "Cliente não encontrado no espelho."
          : "Não foi possível registrar o contato.",
    };
  }

  revalidatePath(`/carteira/${customerConexaId}`);
  revalidatePath("/");
  return { ok: "Contato registrado." };
}
