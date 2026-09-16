"use server";
import { revalidatePath } from "next/cache";
import { usuarioAtual } from "@/lib/auth/session";
import {
  criarGatilho,
  removerGatilho,
  restaurarGatilho,
  salvarGatilho,
  type EdicaoDeGatilho,
} from "@/lib/regras/config";
import { FAMILIAS, type Familia } from "@/lib/regras/catalogo";
import { classificarCategoria, limparClassificacao, SEGMENTOS } from "@/lib/regras/segmentos";
import {
  atualizarAgente,
  criarAgente,
  removerAgente,
  type DadosDeAgente,
} from "@/lib/operacao/agentes";
import type { SegmentoCategoria } from "@prisma/client";

/**
 * Ações das telas de configuração.
 *
 * ⚠ **COMERCIAL pode, VIEWER não.** Ajustar limiar e desligar um gatilho ruim é
 * trabalho do time comercial no meio do expediente — exigir ADMIN aqui
 * transformaria "desligar em segundos" em "abrir chamado". O que continua
 * restrito a ADMIN é o que gasta o rate limit do Conexa ou mexe no espelho
 * (`actions.ts`).
 */
async function exigirOperador() {
  const u = await usuarioAtual();
  if (!u) throw new Error("Sessão expirada.");
  if (u.role === "VIEWER") throw new Error("Seu perfil é somente leitura.");
  return u;
}

const ctxDe = (email: string) => ({ quem: email, origem: "UI" as const });

function revalidarTudoQueDependeDeGatilho() {
  // Um limiar mudado altera a fila, a ficha do cliente e a própria tela de
  // gatilhos. Revalidar só a tela editada deixaria o Radar mostrando o
  // resultado antigo — e a pessoa concluiria que a edição não pegou.
  revalidatePath("/");
  revalidatePath("/gatilhos");
  revalidatePath("/carteira", "layout");
}

// ---------------------------------------------------------------------------
// Gatilhos
// ---------------------------------------------------------------------------

export async function acaoSalvarGatilho(codigo: string, edicao: EdicaoDeGatilho) {
  const u = await exigirOperador();
  const g = await salvarGatilho(codigo, edicao, ctxDe(u.email));
  revalidarTudoQueDependeDeGatilho();
  return g;
}

export async function acaoAlternarGatilho(codigo: string, ativo: boolean) {
  return acaoSalvarGatilho(codigo, { ativo });
}

export async function acaoCriarGatilho(dados: {
  nome: string;
  familia: string;
  oferta: string;
  condicao?: string;
  params?: Record<string, unknown>;
  peso?: number;
  nota?: string;
}) {
  const u = await exigirOperador();
  if (!FAMILIAS.includes(dados.familia as Familia)) {
    throw new Error(`Família desconhecida: ${dados.familia}`);
  }
  const g = await criarGatilho({ ...dados, familia: dados.familia as Familia }, ctxDe(u.email));
  revalidarTudoQueDependeDeGatilho();
  return g;
}

export async function acaoRemoverGatilho(codigo: string) {
  const u = await exigirOperador();
  await removerGatilho(codigo, ctxDe(u.email));
  revalidarTudoQueDependeDeGatilho();
}

export async function acaoRestaurarGatilho(codigo: string) {
  const u = await exigirOperador();
  const g = await restaurarGatilho(codigo, ctxDe(u.email));
  revalidarTudoQueDependeDeGatilho();
  return g;
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

export async function acaoClassificarCategoria(
  serviceCategoryConexaId: number,
  dados: { segmento: string; rotulo?: string | null; unidade?: string | null; nota?: string | null },
) {
  const u = await exigirOperador();
  if (!SEGMENTOS.includes(dados.segmento as SegmentoCategoria)) {
    throw new Error(`Segmento desconhecido: ${dados.segmento}`);
  }
  const r = await classificarCategoria(
    serviceCategoryConexaId,
    { ...dados, segmento: dados.segmento as SegmentoCategoria },
    ctxDe(u.email),
  );
  revalidarTudoQueDependeDeGatilho();
  return r;
}

export async function acaoLimparClassificacao(serviceCategoryConexaId: number) {
  const u = await exigirOperador();
  const r = await limparClassificacao(serviceCategoryConexaId, ctxDe(u.email));
  revalidarTudoQueDependeDeGatilho();
  return r;
}

// ---------------------------------------------------------------------------
// Agentes
// ---------------------------------------------------------------------------

export async function acaoCriarAgente(dados: DadosDeAgente) {
  const u = await exigirOperador();
  const a = await criarAgente(dados, ctxDe(u.email));
  revalidatePath("/agentes");
  return a;
}

export async function acaoAtualizarAgente(id: string, dados: Partial<DadosDeAgente>) {
  const u = await exigirOperador();
  const a = await atualizarAgente(id, dados, ctxDe(u.email));
  revalidatePath("/agentes");
  return a;
}

export async function acaoRemoverAgente(id: string) {
  const u = await exigirOperador();
  await removerAgente(id, ctxDe(u.email));
  revalidatePath("/agentes");
}
