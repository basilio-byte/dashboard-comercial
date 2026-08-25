import "server-only";
import { z } from "zod";

/**
 * Validação centralizada das variáveis de ambiente do servidor.
 * Falha rápido no boot se algo essencial estiver faltando.
 *
 * Em produção elas vêm das ENV do serviço no Easypanel. Localmente, do `.env`
 * (coberto pelo .gitignore). Nunca há valor de credencial no repositório.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Fuso de referência. Todo corte de dia acontece no relógio de parede da empresa. */
  APP_TIMEZONE: z.string().default("America/Fortaleza"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatório"),

  /** Gere um segredo forte: openssl rand -base64 48 */
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET deve ter ao menos 16 caracteres"),

  // -------------------------------------------------------------------------
  // Conexa — SOMENTE LEITURA
  // -------------------------------------------------------------------------
  CONEXA_BASE_URL: z
    .string()
    .url()
    .default("https://seahubcoworking.conexa.app/index.php/api/v2"),
  CONEXA_API_TOKEN: z.string().default(""),

  /**
   * ⚠ CONSERVADOR DE PROPÓSITO. O teto de 60 req/min do Conexa é da CONTA, e o
   * dashboard financeiro já consome parte dele em produção no mesmo servidor.
   * Dois processos com o limitador cheio consomem ~120/min contra um teto de
   * 60, e a degradação é lenta — portanto descoberta tarde. Ver ADR-0002.
   */
  CONEXA_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(15),

  /** Segredo do header `x-cron-secret` das rotas de sync/regras. */
  CRON_SECRET: z.string().default(""),

  // -------------------------------------------------------------------------
  // Agendadores — três chaves independentes (ADR-0003)
  // -------------------------------------------------------------------------
  /** Leitura do Conexa (espelho local). */
  SYNC_SCHEDULER: z.enum(["on", "off"]).default("on"),
  /** Consolidação do perfil + motor de regras. */
  INTEL_SCHEDULER: z.enum(["on", "off"]).default("on"),

  // -------------------------------------------------------------------------
  // Disparo — TODOS OS DEFAULTS FECHAM (ADR-0004)
  //
  // Um deploy que esqueça de configurar não dispara nada. Esta é a última linha
  // de defesa, e ela funciona mesmo com a UI de configurações quebrada.
  // -------------------------------------------------------------------------
  /** Kill-switch global de emergência. */
  NOTIFICADOR: z.enum(["on", "off"]).default("off"),
  NOTIFICADOR_MODO: z.enum(["dry-run", "live"]).default("dry-run"),
  /** Disjuntor contra bug multiplicativo: a execução vira HALTED, não continua. */
  NOTIFICADOR_MAX_POR_EXECUCAO: z.coerce.number().int().positive().default(50),

  // ClickUp — único canal da fase 1
  CLICKUP_ENABLED: z.enum(["on", "off"]).default("off"),
  CLICKUP_TOKEN: z.string().default(""),
  /**
   * Lista ALVO. O destino é allowlist fechada: a função que cria task não
   * aceita `list_id` como argumento, então não existe caminho de código que
   * escreva em outra lista. Ver ADR-0009.
   */
  CLICKUP_LIST_ID: z.string().default(""),
  /** Lista de triagem: task de vendedor não mapeado cai aqui, sem responsável. */
  CLICKUP_LIST_TRIAGEM_ID: z.string().default(""),

  // Chatwoot — fase 2, abordagem ainda a desenhar
  CHATWOOT_ENABLED: z.enum(["on", "off"]).default("off"),
  CHATWOOT_BASE_URL: z.string().default(""),
  CHATWOOT_TOKEN: z.string().default(""),
  CHATWOOT_ACCOUNT_ID: z.string().default(""),
});

type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** true quando dá para consultar o Conexa de verdade. */
export function conexaConfigurado(): boolean {
  return getEnv().CONEXA_API_TOKEN.length > 0;
}
