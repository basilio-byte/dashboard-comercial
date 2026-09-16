import { z } from "zod";

/**
 * O CATÁLOGO DOS GATILHOS — a regra como dado, e o contrato dos seus limiares.
 *
 * ⚠ Este arquivo é PURO: sem Prisma, sem rede, sem relógio. Ele define o que
 * um gatilho *pode* ser; quem lê o que ele *é* hoje é `config.ts`.
 *
 * A separação importa porque o pedido do Diego — *"campo editável para criar
 * gatilhos"* — colide com o ADR-0007 se for lido como "criar lógica pela tela".
 * Lógica nova é função pura testada. O que a tela cria é uma **instância de uma
 * família existente**, com outros limiares, outro texto de oferta e outro peso.
 *
 * Na prática isso cobre o pedido inteiro: "avisar quando a privativa fizer 3
 * meses" é um MARCO_CONTRATO com `meses: 3`, e sai sem deploy. O que não sai
 * sem deploy é uma pergunta que nenhuma das sete famílias sabe fazer — e essa
 * precisa mesmo de código, porque precisa de teste.
 */

// ---------------------------------------------------------------------------
// Os limiares de cada família
// ---------------------------------------------------------------------------

/**
 * ⚠ Todo campo aqui tem default, e os defaults são EXATAMENTE os valores que
 * viviam como constante em `avaliar.ts`. Isso é o que faz a migração ser
 * silenciosa: um banco sem nenhuma linha de `gatilhos` avalia igual ao de
 * ontem. Configuração que muda o comportamento só por existir seria uma
 * armadilha para quem faz deploy.
 */
export const paramsPorFamilia = {
  /** Regras 1, 6, 7 e 8 — "completou N meses de contrato". */
  MARCO_CONTRATO: z.object({
    meses: z.number().int().min(0).max(120).default(1),
    /**
     * O job roda uma vez por dia; sem folga, um marco que caia num dia de falha
     * da carga é perdido para sempre.
     */
    toleranciaDias: z.number().int().min(0).max(30).default(3),
    /** Em qual segmento o contrato precisa estar para o marco valer. */
    segmento: z.enum(["SALA_PRIVATIVA", "ENDERECO_FISCAL", "SEABOX", "QUALQUER"]).default("QUALQUER"),
  }),

  /** Regra 3 e a métrica do §1 — os dois jeitos de ler queda de receita. */
  TENDENCIA: z.object({
    modo: z.enum(["quedas_seguidas", "queda_percentual"]).default("quedas_seguidas"),
    /** `quedas_seguidas`: quantas quedas consecutivas até disparar. */
    quedasSeguidas: z.number().int().min(1).max(12).default(2),
    /** `queda_percentual`: o "X%" do documento. Sempre positivo — é magnitude. */
    limiarPct: z.number().min(1).max(100).default(30),
  }),

  /** Regra 4 — ">5h no mês sem contrato com cota". */
  USO_SEM_COTA: z.object({
    limiarHoras: z.number().min(0).max(500).default(5),
  }),

  /** Regra 5 — primeira reserva de sala. */
  PRIMEIRO_EVENTO: z.object({
    /**
     * ⚠ Obrigatório e sem escapatória: sem corte, todo cliente antigo parece
     * estreante e saem milhares de ofertas de uma vez.
     */
    desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use aaaa-mm-dd").default("2026-08-01"),
    toleranciaDias: z.number().int().min(0).max(30).default(3),
  }),

  /** Regra 10 — Fiscal sem cota que reservou sala. */
  EVENTO_EM_SEGMENTO: z.object({
    reservasMinimas: z.number().int().min(1).max(100).default(1),
  }),

  /** O "extra" — estoura a cota com recorrência. */
  EXCEDENTE: z.object({
    /** Quantos ciclos fechados olhar para decidir se o estouro é recorrente. */
    ciclosAnalisados: z.number().int().min(1).max(24).default(3),
    /** Quantos deles precisam ter estourado. */
    ciclosComEstouro: z.number().int().min(1).max(24).default(2),
  }),

  /** Regras 2 e 9 — bloqueadas por permissão do token, mas configuráveis. */
  SALDO_COTA: z.object({
    limiarHoras: z.number().min(0).max(500).default(5),
  }),
} as const;

export type Familia = keyof typeof paramsPorFamilia;
export const FAMILIAS = Object.keys(paramsPorFamilia) as Familia[];

export type ParamsDe<F extends Familia> = z.infer<(typeof paramsPorFamilia)[F]>;

/**
 * Valida (e completa com defaults) os params de uma família.
 *
 * ⚠ Devolve os defaults quando o Json do banco está corrompido, em vez de
 * lançar. Um params ilegível é um gatilho a menos; lançar aqui derrubaria a
 * fila inteira por causa de uma linha ruim — e a fila é o produto.
 */
export function lerParams<F extends Familia>(
  familia: F,
  bruto: unknown,
): { params: ParamsDe<F>; problema: string | null } {
  const schema = paramsPorFamilia[familia];
  const r = schema.safeParse(bruto ?? {});
  if (r.success) return { params: r.data as ParamsDe<F>, problema: null };
  return {
    params: schema.parse({}) as ParamsDe<F>,
    problema: r.error.issues.map((i) => `${i.path.join(".") || "params"}: ${i.message}`).join("; "),
  };
}

// ---------------------------------------------------------------------------
// Os gatilhos nativos — os 12 avaliados hoje
// ---------------------------------------------------------------------------

export interface GatilhoNativo {
  codigo: string;
  nome: string;
  familia: Familia;
  oferta: string;
  condicao: string;
  params: Record<string, unknown>;
  peso: number;
  ordem: number;
  /**
   * Por que este gatilho não pode ser avaliado hoje, quando for o caso. `null`
   * = avaliável. É estado do MUNDO, não configuração: desligar/ligar não muda.
   */
  bloqueio: string | null;
  nota: string;
}

/**
 * ⚠ Os códigos são os do documento do Diego e aparecem em `Contato.regra`.
 * Renomear um código órfã o histórico de contatos — por isso gatilho nativo se
 * desliga, nunca se apaga.
 */
export const NATIVOS: GatilhoNativo[] = [
  {
    codigo: "extra",
    nome: "Estoura a cota de horas",
    familia: "EXCEDENTE",
    oferta: "upgrade de plano",
    condicao: "usa mais horas do que o plano oferece, em ciclos seguidos",
    params: { ciclosAnalisados: 3, ciclosComEstouro: 2 },
    peso: 90,
    ordem: 0,
    bloqueio: null,
    nota: "não está no documento do Diego: é pedido do responsável, e foi marcado como o mais importante",
  },
  {
    codigo: "1",
    nome: "Fiscal completa 11 meses",
    familia: "MARCO_CONTRATO",
    oferta: "plano Bianual",
    condicao: "contrato de Endereço Fiscal chega a 11 meses de startDate",
    params: { meses: 11, toleranciaDias: 3, segmento: "ENDERECO_FISCAL" },
    peso: 50,
    ordem: 1,
    bloqueio: null,
    nota: "âncora decidida em 2026-08-27: startDate · só existem 2 produtos Bianual, ambos SEATECH — pode não haver oferta para o tier do cliente",
  },
  {
    codigo: "2",
    nome: "Pacote de horas acabando",
    familia: "SALDO_COTA",
    oferta: "novo pacote de horas",
    condicao: "saldo do pacote comprado está baixo",
    params: { limiarHoras: 10 },
    peso: 70,
    ordem: 2,
    bloqueio:
      "as horas do pacote vêm de `recurringSales.packageId`, e `/packages` responde 404 por permissão deste token — o saldo não é calculável por código",
    nota: "depende de liberação do admin do Conexa, não de desenvolvimento",
  },
  {
    codigo: "3",
    nome: "Padrão de compra irregular",
    familia: "TENDENCIA",
    oferta: "novo pacote",
    condicao: "receita cai em meses consecutivos",
    params: { modo: "quedas_seguidas", quedasSeguidas: 2, limiarPct: 30 },
    peso: 30,
    ordem: 3,
    bloqueio: null,
    nota: 'avaliado sobre RECEITA · falta confirmar se "comprou 20h" é compra ou consumo — vêm de endpoints diferentes',
  },
  {
    codigo: "4",
    nome: "Avulso com uso alto",
    familia: "USO_SEM_COTA",
    oferta: "pacote de horas",
    condicao: "nenhum contrato com cota, mas passou do limiar de horas no mês",
    params: { limiarHoras: 5 },
    peso: 55,
    ordem: 4,
    bloqueio: null,
    nota: "a economia vs. avulso NÃO sai: a API não expõe preço por hora por produto. A task sai com a lacuna declarada, nunca com número estimado",
  },
  {
    codigo: "5",
    nome: "Primeira reserva de sala",
    familia: "PRIMEIRO_EVENTO",
    oferta: "Endereço Fiscal + SeaBox",
    condicao: "primeira reserva do cliente, na data",
    params: { desde: "2026-08-01", toleranciaDias: 3 },
    peso: 60,
    ordem: 5,
    bloqueio: null,
    nota: "a data de corte é obrigatória: sem ela, todo cliente antigo parece estreante e saem milhares de ofertas de uma vez",
  },
  {
    codigo: "6",
    nome: "Privativa completa 1 mês",
    familia: "MARCO_CONTRATO",
    oferta: "Registro de Marca",
    condicao: "1 mês do início do contrato de sala privativa",
    params: { meses: 1, toleranciaDias: 3, segmento: "SALA_PRIVATIVA" },
    peso: 50,
    ordem: 6,
    bloqueio: null,
    nota: "identifica pela CATEGORIA do plano, e a estação de coworking CONTA",
  },
  {
    codigo: "7",
    nome: "Privativa completa 2 meses",
    familia: "MARCO_CONTRATO",
    oferta: "SeaBox como benefício",
    condicao: "2 meses do início do contrato de sala privativa",
    params: { meses: 2, toleranciaDias: 3, segmento: "SALA_PRIVATIVA" },
    peso: 50,
    ordem: 7,
    bloqueio: null,
    nota: "⚠ o SeaBox é cortesia: se não vira venda no Conexa, o sistema nunca saberá que o cliente já recebeu e vai reofertar",
  },
  {
    codigo: "8",
    nome: "Privativa completa 6 meses",
    familia: "MARCO_CONTRATO",
    oferta: "Panteão",
    condicao: "aniversário de 6 meses do contrato de sala privativa",
    params: { meses: 6, toleranciaDias: 3, segmento: "SALA_PRIVATIVA" },
    peso: 50,
    ordem: 8,
    bloqueio: null,
    nota: "decidido em 2026-08-27: ANIVERSÁRIO, não janela aberta — a diferença é entre uma oferta e cento e oitenta",
  },
  {
    codigo: "9",
    nome: "Pacote abaixo de 5h",
    familia: "SALDO_COTA",
    oferta: "novo pacote de horas",
    condicao: "saldo do pacote inferior ao limiar",
    params: { limiarHoras: 5 },
    peso: 75,
    ordem: 9,
    bloqueio:
      "as horas do pacote vêm de `recurringSales.packageId`, e `/packages` responde 404 por permissão deste token — o saldo não é calculável por código",
    nota: "depende de liberação do admin do Conexa, não de desenvolvimento",
  },
  {
    codigo: "10",
    nome: "Litoral reserva sala",
    familia: "EVENTO_EM_SEGMENTO",
    oferta: "Pacote de Horas ou upgrade para Batial",
    condicao: "plano de Endereço Fiscal sem horas inclusas + fez reserva",
    params: { reservasMinimas: 1 },
    peso: 40,
    ordem: 10,
    bloqueio: null,
    nota: "o tier vem da cota do plano, não do nome — Litoral sem cota, Batial 2h, Abissal 8h, medido na Fase 0",
  },
  {
    codigo: "métrica",
    nome: "Queda de receita",
    familia: "TENDENCIA",
    oferta: "olhar antes que o cliente saia",
    condicao: "receita cai mais que o limiar de um mês para o outro",
    params: { modo: "queda_percentual", quedasSeguidas: 2, limiarPct: 30 },
    peso: 35,
    ordem: 11,
    bloqueio: null,
    nota: "⚠ o limiar de 30% é exemplo do documento, não decisão do cliente · mês anterior sem receita não é queda de 100%: é ausência de base",
  },
];

export const CODIGOS_NATIVOS = new Set(NATIVOS.map((n) => n.codigo));

/** Um código para gatilho criado na tela/MCP. Prefixo separa dos nativos. */
export function novoCodigo(): string {
  return `c_${Math.random().toString(36).slice(2, 8)}`;
}
