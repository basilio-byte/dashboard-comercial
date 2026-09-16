import Link from "next/link";
import { Secao } from "@/components/Cartao";

/**
 * COMO O MOTOR FUNCIONA.
 *
 * Pergunta do Diego em 2026-09-16, literal: *"Motor funciona como?"*.
 *
 * ⚠ A pergunta veio de quem vê os botões e os contadores desta tela e não
 * consegue montar a cadeia. E ela é a pergunta certa: um sistema que aponta
 * clientes sem explicar por que os apontou não é usado — é obedecido ou
 * ignorado, e os dois são ruins.
 *
 * ⚠ **Só afirmações que a tela consegue sustentar.** Nada aqui promete disparo,
 * IA, nem prioridade calculada por modelo. O motor é uma cadeia de quatro elos,
 * três deles existem, e o quarto é uma pessoa.
 */
export function ComoFunciona() {
  const elos = [
    {
      n: "1",
      titulo: "Espelhar",
      oQue: "O Conexa é copiado para um banco nosso, mês a mês.",
      porQue:
        "A API não é ordenada — offset 0 não é o registro mais antigo — e tem teto de 60 requisições por minuto. Perguntar a ela a cada tela seria lento e daria respostas diferentes a cada recarga.",
      detalhe:
        "A carga é por JANELA MENSAL, e cada janela termina marcada como concluída. Completude vira \"todas as janelas do período estão concluídas\", que é verificável — em vez de \"o cursor chegou ao fim\", que não é.",
    },
    {
      n: "2",
      titulo: "Consolidar",
      oQue: "Receita por mês e perfil de cada cliente são calculados e gravados.",
      porQue:
        "A ficha de um cliente precisa de 12 meses e a lista precisa do ano inteiro de milhares de clientes. Calcular a cada abertura de tela não caberia no tempo de um request.",
      detalhe:
        "A receita usa a mesma régua do dashboard financeiro: regime de EMISSÃO, valor com juros e multa, sem canceladas nem renegociadas. É o que faz os dois sistemas baterem ao centavo.",
    },
    {
      n: "3",
      titulo: "Avaliar",
      oQue: "Cada gatilho ligado é testado contra os dados de cada cliente elegível.",
      porQue:
        "São checagens determinísticas de data e limiar — não precisam de IA para decidir. Cada uma é uma função pura com teste, e o limiar é configuração, não constante.",
      detalhe:
        "Roda em LOTE sobre a base inteira, sem corte. Avaliar cliente a cliente daria milhares de consultas e obrigaria a limitar a fila — que foi o defeito que fez uma versão anterior enxergar 200 dos 5.244 clientes.",
    },
    {
      n: "4",
      titulo: "Agir",
      oQue: "Uma pessoa lê o Radar, liga para o cliente e registra o que aconteceu.",
      porQue:
        "O sistema nunca fala com o cliente. Ele aponta quem procurar e por quê; como abordar é decisão de quem vende.",
      detalhe:
        "O registro do contato fecha o ciclo: sem ele a fila repete o mesmo nome todo dia, e o vendedor aprende a ignorá-la. É assim que uma ferramenta de recomendação morre — não errando, repetindo.",
    },
  ];

  return (
    <Secao
      titulo="Como o motor funciona"
      sub="A cadeia inteira, do ERP até o telefone. Quatro elos — e o último é uma pessoa."
    >
      <ol className="grid gap-3 lg:grid-cols-2">
        {elos.map((e) => (
          <li key={e.n} className="cartao px-4 py-3.5">
            <div className="flex items-baseline gap-2.5">
              <span
                aria-hidden
                className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--acento-wash)] text-[12px] font-semibold text-[var(--acento-tinta)]"
              >
                {e.n}
              </span>
              <h3 className="text-[15px] font-semibold">{e.titulo}</h3>
            </div>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--tinta)]">{e.oQue}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--tinta-2)]">
              <strong className="font-semibold">Por quê assim:</strong> {e.porQue}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--tinta-3)]">{e.detalhe}</p>
          </li>
        ))}
      </ol>

      <div className="cartao px-4 py-3.5">
        <h3 className="text-[14px] font-semibold">O que o motor NÃO faz</h3>
        <ul className="mt-2 space-y-1.5 text-[13.5px] leading-relaxed text-[var(--tinta-2)]">
          <li>
            <strong>Não dispara nada.</strong> Não cria task no ClickUp nem mensagem no Chatwoot — a
            camada de disparo não existe no código, e essa ausência é estrutural, não um toggle
            desligado.
          </li>
          <li>
            <strong>Não usa IA para decidir.</strong> Nenhum gatilho consulta modelo. Se um dia
            houver IA, será para redigir o texto de uma abordagem que uma pessoa aprovou.
          </li>
          <li>
            <strong>Não inventa número.</strong> Quando a fonte está incompleta ou a API não expõe
            o dado, a tela mostra lacuna declarada — nunca zero. É por isso que &quot;saldo do
            pacote de horas&quot; aparece como indisponível em vez de aparecer como 0h.
          </li>
          <li>
            <strong>Não escreve no Conexa.</strong> A integração é somente leitura, em todos os
            caminhos, inclusive o do MCP.
          </li>
        </ul>
      </div>

      <div className="cartao px-4 py-3.5">
        <h3 className="text-[14px] font-semibold">Onde mexer em cada coisa</h3>
        <ul className="mt-2 space-y-1.5 text-[13.5px] leading-relaxed text-[var(--tinta-2)]">
          <li>
            Limiar de gatilho, ligar/desligar, criar gatilho novo →{" "}
            <Link href="/gatilhos" className="font-medium text-[var(--acento-tinta)] underline underline-offset-2">
              Gatilhos
            </Link>
          </li>
          <li>
            Como uma categoria de serviço é lida (e a unidade dela) →{" "}
            <Link href="/gatilhos" className="font-medium text-[var(--acento-tinta)] underline underline-offset-2">
              Gatilhos → Como as categorias são lidas
            </Link>
          </li>
          <li>
            Quem usa a ferramenta →{" "}
            <Link href="/agentes" className="font-medium text-[var(--acento-tinta)] underline underline-offset-2">
              Agentes
            </Link>
          </li>
          <li>
            Conferir o espelho contra o Conexa →{" "}
            <Link href="/confianca" className="font-medium text-[var(--acento-tinta)] underline underline-offset-2">
              Confiança
            </Link>
          </li>
          <li>Empurrar uma carga na frente da fila → os botões desta página, abaixo.</li>
        </ul>
      </div>
    </Secao>
  );
}
