/**
 * REGRAS DE USUÁRIO — módulo PURO, sem Prisma e sem rede.
 *
 * Aqui vive a parte que, errada, tranca todo mundo fora do painel: quem pode
 * desativar quem, e quem pode deixar de ser administrador. Isso não pode
 * depender de `if` espalhado na tela.
 *
 * ⚠ O painel viveu de 2026-08-26 a 2026-09-30 **sem nenhuma forma de criar
 * usuário**: o único era o administrador que o `bootstrap-admin.mjs` cria a
 * partir das ENV no boot. O Diego tentou entrar duas vezes em 30/09 com dois
 * e-mails e as duas tentativas registraram "e-mail inexistente" — ele nunca
 * teve conta, e não havia tela para criar uma.
 */

export const SENHA_MINIMA = 8;

export type Papel = "ADMIN" | "COMERCIAL" | "VIEWER";

export const PAPEIS: { papel: Papel; rotulo: string; descricao: string }[] = [
  { papel: "ADMIN", rotulo: "Administrador", descricao: "configura gatilhos, categorias, usuários e integrações" },
  { papel: "COMERCIAL", rotulo: "Comercial", descricao: "trabalha a fila, registra contato e ajusta gatilhos" },
  { papel: "VIEWER", rotulo: "Consulta", descricao: "só visualiza; o token de MCP dele é de leitura" },
];

/** Minúsculas e sem espaço nas pontas — é a forma como o login busca. */
export function normalizarEmail(v: string): string {
  return v.trim().toLowerCase();
}

/**
 * Validação de e-mail deliberadamente frouxa: um caractere, arroba, domínio
 * com ponto. Regex ambiciosa de e-mail rejeita endereço válido, e o custo do
 * erro aqui é baixo (o administrador vê a linha na lista e corrige).
 */
export function emailParece(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function validarNovoUsuario(d: {
  nome: string;
  email: string;
  senha: string;
  papel: string;
}): string | null {
  if (!d.nome.trim()) return "Informe o nome.";
  const email = normalizarEmail(d.email);
  if (!email) return "Informe o e-mail.";
  if (!emailParece(email)) return `"${d.email}" não parece um e-mail.`;
  if (d.senha.length < SENHA_MINIMA) {
    return `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`;
  }
  if (!PAPEIS.some((p) => p.papel === d.papel)) return "Perfil inválido.";
  return null;
}

export interface AlvoDaMudanca {
  id: string;
  papel: Papel;
  ativo: boolean;
}

/**
 * Por que esta mudança NÃO pode acontecer — ou `null` quando pode.
 *
 * Duas travas, as duas por experiência de sistema interno:
 *
 * 1. **Ninguém se desativa nem se rebaixa.** O caminho de recuperação é outra
 *    pessoa; quem se tranca sozinho não tem para quem pedir.
 * 2. **O último administrador ATIVO não pode sair de administrador nem ser
 *    desativado.** Sem isso o painel fica sem ninguém que possa criar usuário,
 *    e a única saída é mexer no banco à mão.
 */
export function impedimento(p: {
  alvo: AlvoDaMudanca;
  mudanca: { papel?: Papel; ativo?: boolean };
  euId: string;
  /** Quantos ADMIN ativos existem HOJE, incluindo o alvo se ele for um. */
  adminsAtivos: number;
}): string | null {
  const viraNaoAdmin = p.mudanca.papel !== undefined && p.mudanca.papel !== "ADMIN";
  const viraInativo = p.mudanca.ativo === false;
  const eraAdminAtivo = p.alvo.papel === "ADMIN" && p.alvo.ativo;

  if (p.alvo.id === p.euId) {
    if (viraInativo) return "Você não pode desativar a sua própria conta — peça a outro administrador.";
    if (viraNaoAdmin) return "Você não pode rebaixar a sua própria conta — peça a outro administrador.";
  }

  if (eraAdminAtivo && (viraNaoAdmin || viraInativo) && p.adminsAtivos <= 1) {
    return "Este é o único administrador ativo. Promova outra pessoa a administrador antes.";
  }

  return null;
}

/**
 * Senha temporária legível: 4 grupos de 4 caracteres sem `0/O/1/l`, que é
 * onde erra quem digita o que recebeu por mensagem.
 *
 * ⚠ Recebe o sorteio de fora para continuar pura e testável — quem chama passa
 * `crypto.getRandomValues`.
 */
export function senhaTemporaria(sortear: (n: number) => number[]): string {
  const alfabeto = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const n = 16;
  const letras = sortear(n).map((x) => alfabeto[x % alfabeto.length]);
  return [0, 4, 8, 12].map((i) => letras.slice(i, i + 4).join("")).join("-");
}
