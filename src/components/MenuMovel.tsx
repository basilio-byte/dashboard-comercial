"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Lateral } from "./Lateral";

/**
 * Gaveta de navegação no celular.
 *
 * A versão anterior empilhava a lateral inteira como faixa fixa no topo do
 * celular — cinco itens em duas linhas cada, empurrando o conteúdo para baixo
 * da dobra antes de qualquer número aparecer.
 *
 * ⚠ A gaveta vai para um PORTAL no `body`, e não fica onde o botão está. O
 * botão mora dentro da barra superior, que usa `backdrop-blur` — e
 * `backdrop-filter` cria bloco de contenção para descendentes `position:
 * fixed`. Sem o portal, `fixed inset-0` não mede a janela: mede os 56px da
 * barra, e a gaveta sai recortada em uma tira no topo, com o conteúdo da
 * página aparecendo por baixo. Foi exatamente o que aconteceu.
 */
export function MenuMovel({ nome, email }: { nome: string; email?: string }) {
  const [aberto, setAberto] = useState(false);
  const [montado, setMontado] = useState(false);
  const caminho = usePathname();

  // O portal só existe no cliente; no servidor não há `document`.
  useEffect(() => setMontado(true), []);

  // Fecha na navegação. Sem isto, a gaveta fica por cima da tela nova.
  useEffect(() => setAberto(false), [caminho]);

  // Trava o rolamento do fundo enquanto a gaveta está aberta.
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => {
      document.body.style.overflow = anterior;
      window.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  const gaveta = (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Fechar navegação"
        onClick={() => setAberto(false)}
        className="absolute inset-0 bg-black/55"
      />
      <div className="absolute inset-y-0 left-0 w-[268px] shadow-3">
        <button
          type="button"
          onClick={() => setAberto(false)}
          aria-label="Fechar navegação"
          className="absolute right-2 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--marca-tinta-3)] transition-colors hover:bg-[var(--marca-hover)] hover:text-[var(--marca-tinta)]"
        >
          <X size={16} />
        </button>
        <Lateral nome={nome} email={email} aoNavegar={() => setAberto(false)} />
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Abrir navegação"
        aria-expanded={aberto}
        className="btn btn-fantasma -ml-1.5 h-9 w-9 p-0 md:hidden"
      >
        <Menu size={18} />
      </button>

      {aberto && montado ? createPortal(gaveta, document.body) : null}
    </>
  );
}
