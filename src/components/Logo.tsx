import { cn } from "@/lib/ui";

/**
 * Logotipo da Seahub.
 *
 * ⚠ É o ARQUIVO OFICIAL — `public/seahub-logo.png`, conferido byte a byte
 * (md5 `7fafbd52…`) contra o que o site seahubcoworking.com.br serve. Não
 * redesenhar em SVG: a versão anterior era um desenho meu de "duas ondas" que
 * não tinha relação nenhuma com a marca. O monograma real é um **S com hachura
 * diagonal**, e inventar identidade visual é o mesmo erro que inventar dado.
 *
 * O arquivo é BRANCO sobre transparente, então cai direto em superfície escura
 * — que é o caso da lateral e do painel de login nos dois esquemas de cor. Onde
 * o fundo é claro, `tom="tinta"` inverte para preto.
 *
 * `<img>` cru, e não `next/image`, de propósito: o build é `output: standalone`
 * sem `sharp`, e o otimizador de imagem do Next quebra em runtime nesse arranjo.
 * São 28 KB.
 */
const PROPORCAO = 1280 / 440;

export function Logo({
  altura = 22,
  tom = "marca",
  className,
}: {
  altura?: number;
  /** `marca`: branco fixo (fundo escuro). `tinta`: acompanha o esquema de cor. */
  tom?: "marca" | "tinta";
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/seahub-logo.png"
      alt="Seahub"
      width={Math.round(altura * PROPORCAO)}
      height={altura}
      /* ⚠ `self-start` não é enfeite. Dentro de um flex-column o padrão é
         `align-items: stretch`, que define a LARGURA do item e atropela o
         `width: auto` — o logotipo saía esticado na largura toda da lateral,
         com o monograma achatado. `max-w-none` protege do `max-width: 100%`
         que o preflight do Tailwind põe em toda imagem. */
      className={cn("block max-w-none shrink-0 self-start", tom === "tinta" && "logo-tinta", className)}
      style={{ height: altura, width: "auto" }}
    />
  );
}

/**
 * Assinatura completa: o logotipo mais o nome do sistema.
 *
 * "COMERCIAL" existe porque a Seahub tem mais de um painel — sem ele, este e o
 * financeiro se apresentam igual. Ver a memória de identidade própria.
 */
export function Assinatura({
  altura = 22,
  tom = "marca",
  className,
}: {
  altura?: number;
  tom?: "marca" | "tinta";
  className?: string;
}) {
  return (
    <span className={cn("flex flex-col items-start gap-[5px]", className)}>
      <Logo altura={altura} tom={tom} />
      {/* Recuado para alinhar com o "seahub" do lockup, e não com o monograma:
          o "S" ocupa a primeira faixa da imagem. */}
      <span
        className={cn(
          "pl-[2px] text-[9px] font-semibold uppercase leading-none tracking-[0.2em]",
          tom === "marca" ? "text-[var(--marca-tinta-3)]" : "text-[var(--tinta-3)]",
        )}
      >
        comercial
      </span>
    </span>
  );
}
