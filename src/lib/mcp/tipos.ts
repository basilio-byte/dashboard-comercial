import type { z } from "zod";

/**
 * O contrato de uma ferramenta do MCP.
 *
 * ⚠ `entrada` é um esquema zod e nada mais. O JSON Schema publicado ao cliente
 * é derivado dele (`esquema.ts`), e a validação da chamada usa o mesmo objeto —
 * então é impossível o que o servidor anuncia divergir do que ele aceita. Foi o
 * primeiro desenho que tentei: escrever o JSON Schema à mão ao lado do zod. Os
 * dois divergem na terceira edição, e a divergência não dá erro de compilação.
 */
export interface ContextoMcp {
  /**
   * Quem está chamando. Vai para o rastro de auditoria de toda escrita.
   *
   * ⚠ Não é um usuário do painel: o MCP autentica por token de serviço, e o
   * token não é uma pessoa. O valor aqui identifica a ORIGEM ("mcp:claude-code"
   * ou o que o cliente declarar), e é por isso que `MudancaDeConfig.origem`
   * existe separado de `quem` — para "um agente mudou isso" nunca se confundir
   * com "o Diego mudou isso".
   */
  quem: string;
  /** Sempre "MCP" aqui. Existe para as funções de escrita serem compartilhadas. */
  origem: "MCP";
}

export interface Ferramenta<I extends z.ZodTypeAny = z.ZodTypeAny> {
  /** snake_case, como é convenção em MCP. */
  nome: string;
  /** Rótulo curto para a interface do cliente. */
  titulo: string;
  /**
   * O que faz, QUANDO usar e o que NÃO esperar dela.
   *
   * ⚠ É a única documentação que o modelo lê. Descrição que diz só o que a
   * ferramenta faz produz agente que a chama na hora errada; a parte que evita
   * isso é a que diz quando não usar, e qual é a lacuna conhecida.
   */
  descricao: string;
  entrada: I;
  somenteLeitura: boolean;
  /** Apaga ou sobrescreve algo difícil de recuperar. */
  destrutiva?: boolean;
  idempotente?: boolean;
  /** Fala com sistema de terceiro (a API do Conexa). */
  mundoAberto?: boolean;
  executar(args: z.infer<I>, ctx: ContextoMcp): Promise<unknown>;
}

/** Ajuda o TypeScript a inferir `args` sem `as` em cada ferramenta. */
export function ferramenta<I extends z.ZodTypeAny>(f: Ferramenta<I>): Ferramenta {
  return f as unknown as Ferramenta;
}
