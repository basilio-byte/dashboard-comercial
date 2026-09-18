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
 *
 * ⚠ **A exceção deliberada, de 2026-09-18:** `mesesDeBase`, `quedaMinimaPct` e
 * `mesesDeEvidenciaDeCota` são CORREÇÕES, não preferências. Foram medidas
 * contra a produção — a maioria dos sinais de tendência e das regras 4 e 10 era
 * falsa — e o default deles muda o comportamento de propósito. Ver
 * `docs/context/progress.md` na data.
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
    modo: z.enum(["quedas_seguidas", "queda_percentual", "queda_sustentada"]).default("quedas_seguidas"),
    /** `quedas_seguidas`: quantas quedas consecutivas até disparar. */
    quedasSeguidas: z.number().int().min(1).max(12).default(2),
    /** `queda_percentual`: o "X%" do documento. Sempre positivo — é magnitude. */
    limiarPct: z.number().min(1).max(100).default(30),
    /**
     * `queda_percentual`: quantos meses anteriores formam a BASE (a mediana
     * deles). ⚠ Correção de 2026-09-18 — comparar com o mês anterior só
     * transformava todo pico de cobrança em "queda" no mês seguinte.
     */
    mesesDeBase: z.number().int().min(1).max(12).default(3),
    /**
     * `quedas_seguidas`: queda mínima, em %, para um mês contar como queda.
     * ⚠ Correção de 2026-09-18 — sem ela, −2% contava.
     */
    quedaMinimaPct: z.number().min(0).max(100).default(10),
    /**
     * `queda_sustentada`: quantos meses fechados SEGUIDOS precisam estar abaixo
     * do normal. ⚠ Correção de 2026-09-18 — um mês isolado, no regime de
     * emissão, vem zerado por renegociação ou dobrado por calendário.
     */
    mesesAvaliados: z.number().int().min(1).max(6).default(2),
    /**
     * `queda_sustentada`: abaixo desta base (R$/mês) não se fala em queda.
     * ⚠ Medido em 2026-09-18: um contrato anual com cobranças avulsas
     * esporádicas tinha "base" de R$ 18/mês, e zero depois disso virava
     * "−100%", no topo do Radar.
     */
    baseMinima: z.number().min(0).max(100000).default(50),
  }),

  /** Regra 4 — ">5h no mês sem contrato com cota". */
  USO_SEM_COTA: z.object({
    /** Horas AVULSAS no mês: com venda de valor, fora da cota. Ver `ehHoraAvulsa`. */
    limiarHoras: z.number().min(0).max(500).default(5),
    /**
     * Uma reserva abatida da cota nestes últimos meses prova que o cliente tem
     * cota — e quem tem cota não recebe oferta de pacote. Ver
     * `temEvidenciaDeCota`, correção de 2026-09-18.
     */
    mesesDeEvidenciaDeCota: z.number().int().min(1).max(12).default(3),
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
    /** Mesmo freio da regra 4: quem já tem pacote não recebe oferta de pacote. */
    mesesDeEvidenciaDeCota: z.number().int().min(1).max(12).default(3),
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

  /** Perdeu o contrato, ou passou a pagar menos — é fato, não inferência. */
  MUDANCA_CONTRATO: z.object({
    /**
     * `perdeu` e `reduziu` olham os contratos de PERMANÊNCIA; `concluiu` olha
     * os de categoria PROGRAMA, cujo fim é conclusão, não saída.
     */
    modo: z.enum(["perdeu", "reduziu", "concluiu"]).default("perdeu"),
    /** Quantos dias para trás olhar. */
    janelaDias: z.number().int().min(1).max(365).default(45),
    /** `reduziu`: quanto o valor mensal contratado precisa ter caído. */
    limiarPct: z.number().min(1).max(100).default(20),
  }),

  /**
   * O FREIO: cobrança vencida ou renegociada suspende as ofertas de VENDA.
   * Não aparece no Radar — só impede que outros gatilhos apareçam.
   */
  SAUDE_FINANCEIRA: z.object({
    /** Atraso a partir do qual freia. Abaixo disso é o atraso normal de quem esqueceu. */
    diasDeAtrasoMin: z.number().int().min(0).max(365).default(15),
    /** Dívida mais antiga que isto é outra conversa, e não trava o cliente para sempre. */
    diasDeAtrasoMax: z.number().int().min(1).max(3650).default(105),
    diasDeRenegociacao: z.number().int().min(1).max(365).default(90),
  }),
} as const;

export type Familia = keyof typeof paramsPorFamilia;
export const FAMILIAS = Object.keys(paramsPorFamilia) as Familia[];

/**
 * As famílias cuja oferta é uma VENDA — as que o freio de inadimplência suspende.
 *
 * ⚠ Tendência e mudança de contrato ficam de fora de propósito: elas apontam
 * cliente saindo, e a conversa com quem está saindo acontece mesmo que ele
 * deva. O freio impede o upgrade, não o cuidado.
 */
export const FAMILIAS_DE_VENDA = new Set<Familia>([
  "MARCO_CONTRATO",
  "USO_SEM_COTA",
  "PRIMEIRO_EVENTO",
  "EVENTO_EM_SEGMENTO",
  "EXCEDENTE",
  "SALDO_COTA",
]);

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
// Textos e medidas compartilhados — UMA fonte, para não divergirem
// ---------------------------------------------------------------------------

/**
 * A lacuna do saldo do pacote de horas, com a pergunta certa.
 *
 * ⚠ Estava escrita em nove lugares — tela, ficha, filtro, instruções do MCP —
 * dizendo "depende de o admin do Conexa liberar o endpoint". Em 2026-09-18 o
 * MCP oficial do Conexa, com permissão total, também não mostrou o conteúdo
 * do pacote: a pergunta passou a ser para o SUPORTE. Metade dos textos mudou e
 * metade não. Agora todos leem daqui.
 */
export const LACUNA_SALDO_PACOTE =
  "o saldo do pacote de horas não é calculável: as horas vêm de `recurringSales.packageId`, " +
  "`/packages` responde 404 a este token, e nem o MCP oficial do Conexa — testado com permissão " +
  "total em 2026-09-18 — mostra o conteúdo do pacote. A pergunta é para o SUPORTE do Conexa: " +
  "existe endpoint para as horas incluídas e o consumo de um pacote?";

/**
 * Como um código de gatilho aparece na tela: "regra 4" para os do documento,
 * o próprio código para os outros ("extra", "contrato-perdido").
 *
 * ⚠ Era montado à mão em três telas, cada uma com a exceção só para "extra" e
 * "métrica" — e os gatilhos novos apareciam como "regra contrato-perdido".
 */
export function rotuloDaRegra(codigo: string): string {
  return /^\d+$/.test(codigo) ? `regra ${codigo}` : codigo;
}

/**
 * Peso na fila a partir do DINHEIRO em jogo, em R$/mês.
 *
 * ⚠ Os sinais de saída pesavam pela PORCENTAGEM: −100% sobre R$ 18 pesava o
 * mesmo que sobre R$ 2.000, e um contrato de R$ 24 perdido passava na frente de
 * um cliente de R$ 1.280/mês. +1 a cada R$ 25/mês, com teto de +60 (R$ 1.500/mês)
 * para um único cliente grande não achatar o resto da fila.
 */
export function pesoPorValor(base: number, reaisPorMes: number): number {
  return base + Math.min(60, Math.max(0, reaisPorMes) / 25);
}

// ---------------------------------------------------------------------------
// Os gatilhos nativos
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
    bloqueio: LACUNA_SALDO_PACOTE,
    nota: "depende do Conexa responder se há endpoint para as horas do pacote — não de desenvolvimento",
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
    nota: 'avaliado sobre RECEITA · uma queda só conta a partir de 10% — oscilação de centavos depois de um pico de cobrança não é padrão · falta confirmar se "comprou 20h" é compra ou consumo',
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
    nota: "conta hora com VENDA de valor fora da cota — paga na hora ou na fatura do mês seguinte, que é como a sala é cobrada desde ago/2026 · quem teve reserva abatida da cota nos últimos meses já tem pacote e não entra · a economia vs. avulso NÃO sai: a API não expõe preço por hora",
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
    bloqueio: LACUNA_SALDO_PACOTE,
    nota: "depende do Conexa responder se há endpoint para as horas do pacote — não de desenvolvimento",
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
    nota: "o tier vem da cota do plano, não do nome — Litoral sem cota, Batial 2h, Abissal 8h, medido na Fase 0 · quem já tem pacote (reserva abatida da cota) não entra",
  },
  {
    codigo: "métrica",
    nome: "Queda de receita",
    familia: "TENDENCIA",
    oferta: "olhar antes que o cliente saia",
    condicao: "os 2 últimos meses fechados abaixo de 70% da mediana dos 6 anteriores",
    params: { modo: "queda_sustentada", mesesAvaliados: 2, mesesDeBase: 6, limiarPct: 30, baseMinima: 50 },
    peso: 40,
    ordem: 11,
    bloqueio: null,
    nota: "QUEDA SUSTENTADA: dois meses fechados seguidos abaixo do normal — um mês isolado vem zerado por renegociação ou dobrado por calendário · quem renegociou no período é ambíguo, não queda · o mês em curso só desmente, nunca dispara · ⚠ o limiar de 30% é exemplo do documento, não decisão do cliente",
  },
];

NATIVOS.push(
  {
    codigo: "contrato-perdido",
    nome: "Perdeu o contrato",
    familia: "MUDANCA_CONTRATO",
    oferta: "entender a saída — e tentar reconquistar",
    condicao: "o último contrato terminou nos últimos 45 dias e o cliente ficou sem nenhum",
    params: { modo: "perdeu", janelaDias: 45, limiarPct: 20 },
    peso: 40,
    ordem: 12,
    bloqueio: null,
    nota: "é fato, não inferência — 29 clientes em 45 dias quando foi medido (2026-09-18), e ninguém era avisado · chega depois da saída: o contrato quase nunca avisa antes, porque 1.338 contratos ativos não têm data de fim",
  },
  {
    codigo: "contrato-reduzido",
    nome: "Contrato reduzido",
    familia: "MUDANCA_CONTRATO",
    oferta: "entender a redução antes que vire saída",
    condicao: "o valor mensal contratado caiu 20% ou mais nos últimos 45 dias",
    params: { modo: "reduziu", janelaDias: 45, limiarPct: 20 },
    peso: 45,
    ordem: 13,
    bloqueio: null,
    nota: "o sinal mais limpo medido: das 6 trocas de contrato em 45 dias, 4 eram reduções reais (R$ 2.000 → R$ 119, R$ 1.900 → R$ 99,90) e as 2 renovações pelo mesmo valor não disparam · contrato anual entra pelo valor mensal (÷ 12)",
  },
  {
    codigo: "freio",
    nome: "Freio: cobrança em atraso",
    familia: "SAUDE_FINANCEIRA",
    oferta: "nenhuma oferta de venda — é conversa de cobrança",
    condicao: "cobrança vencida há 15 a 105 dias, ou renegociada nos últimos 90",
    params: { diasDeAtrasoMin: 15, diasDeAtrasoMax: 105, diasDeRenegociacao: 90 },
    peso: 0,
    ordem: 14,
    bloqueio: null,
    nota: "não aparece no Radar: SUSPENDE as ofertas de venda (marcos, pacote, primeira reserva, excedente) de quem está devendo · não suspende os sinais de saída — com quem está saindo a conversa acontece mesmo com dívida · desligar o freio devolve as ofertas",
  },
  {
    codigo: "programa-concluido",
    nome: "Concluiu um programa",
    familia: "MUDANCA_CONTRATO",
    oferta: "oferecer continuidade — coworking, sala ou Endereço Fiscal",
    condicao: "contrato de categoria PROGRAMA terminou nos últimos 45 dias e o cliente não tem contrato de permanência",
    params: { modo: "concluiu", janelaDias: 45, limiarPct: 20 },
    peso: 55,
    ordem: 15,
    bloqueio: null,
    nota: "achado em 2026-09-18: 8 dos 23 \"perdeu o contrato\" eram a turma do Hub Empreendedoras, que terminou junta em 17/08 — não saíram, concluíram. Egressa é público de continuidade, não de reconquista · só funciona com a categoria do programa classificada como PROGRAMA na tela Gatilhos",
  },
);

export const CODIGOS_NATIVOS = new Set(NATIVOS.map((n) => n.codigo));

/** Um código para gatilho criado na tela/MCP. Prefixo separa dos nativos. */
export function novoCodigo(): string {
  return `c_${Math.random().toString(36).slice(2, 8)}`;
}
