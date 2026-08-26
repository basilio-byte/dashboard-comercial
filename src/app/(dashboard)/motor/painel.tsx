"use client";
import { useState, useTransition } from "react";
import { Database, DownloadCloud, Layers, RefreshCw, Loader } from "lucide-react";
import {
  acaoBackfill,
  acaoConsolidar,
  acaoIncremental,
  acaoSincronizarCadastros,
} from "@/lib/operacao/actions";

const ACOES = [
  { rotulo: "Sincronizar cadastros", fn: acaoSincronizarCadastros, Icone: Database, passo: 1 },
  { rotulo: "Carregar dados", fn: acaoBackfill, Icone: DownloadCloud, passo: 2 },
  { rotulo: "Consolidar inteligência", fn: acaoConsolidar, Icone: Layers, passo: 3 },
  { rotulo: "Atualizar (incremental)", fn: acaoIncremental, Icone: RefreshCw, passo: null },
] as const;

export function PainelOperacao() {
  const [pendente, iniciar] = useTransition();
  const [rodando, setRodando] = useState<string | null>(null);
  const [saida, setSaida] = useState<{ rotulo: string; texto: string; erro: boolean } | null>(null);

  const rodar = (fn: () => Promise<unknown>, rotulo: string) => () => {
    setRodando(rotulo);
    setSaida(null);
    iniciar(async () => {
      try {
        const r = await fn();
        setSaida({ rotulo, texto: JSON.stringify(r, null, 2), erro: false });
      } catch (err) {
        setSaida({
          rotulo,
          texto: err instanceof Error ? err.message : String(err),
          erro: true,
        });
      } finally {
        setRodando(null);
      }
    });
  };

  return (
    <section className="cartao overflow-hidden">
      <div className="cartao-topo">
        <div className="text-[14px] font-medium text-[var(--tinta-2)]">Ações</div>
      </div>

      <div className="px-4 py-4">
        <p className="max-w-3xl text-[13.5px] leading-relaxed text-[var(--tinta-3)]">
          <strong className="font-semibold text-[var(--tinta-2)]">
            As quatro rodam sozinhas pelo agendador embutido.
          </strong>{" "}
          Estes botões são para empurrar na frente da fila — não são obrigatórios. A carga é feita{" "}
          <strong className="font-semibold text-[var(--tinta-2)]">por janela mensal</strong>, da mais
          recente para a mais antiga, e prioriza o que destrava a fila do Radar (contratos e
          reservas) antes do resto. Rodar de novo continua de onde parou.
        </p>

        <div className="mt-3.5 flex flex-wrap gap-2">
          {ACOES.map(({ rotulo, fn, Icone, passo }) => {
            const esteRodando = rodando === rotulo;
            return (
              <button
                key={rotulo}
                type="button"
                onClick={rodar(fn, rotulo)}
                disabled={pendente}
                className={passo === null ? "btn btn-primario" : "btn"}
              >
                {esteRodando ? (
                  <Loader size={14} className="animate-spin" aria-hidden />
                ) : (
                  <Icone size={14} aria-hidden />
                )}
                {passo ? (
                  <span className="text-[var(--tinta-3)]">{passo}</span>
                ) : null}
                {rotulo}
              </button>
            );
          })}
        </div>

        {rodando ? (
          <p className="mt-3 text-[13.5px] text-[var(--tinta-3)]">{rodando}: em andamento…</p>
        ) : null}

        {saida ? (
          <div className="mt-3">
            <div
              className={`text-[13px] font-medium ${
                saida.erro ? "text-[var(--critico-tinta)]" : "text-[var(--bom-tinta)]"
              }`}
            >
              {saida.rotulo}: {saida.erro ? "erro" : "concluído"}
            </div>
            <pre className="mt-1.5 max-h-64 overflow-auto rounded-[var(--raio-sm)] border border-[var(--borda)] bg-[var(--superficie-sutil)] p-3 text-[12.5px] leading-relaxed text-[var(--tinta-2)]">
              {saida.texto}
            </pre>
          </div>
        ) : null}
      </div>
    </section>
  );
}
