import { usuarioAtual } from "@/lib/auth/session";
import { batendoNaPorta, listarUsuarios } from "@/lib/operacao/usuarios";
import { Cabecalho, Faixa, Nota } from "@/components/Cartao";
import { cn } from "@/lib/ui";
import { ListaDeUsuarios } from "./lista";

export const dynamic = "force-dynamic";

/**
 * USUÁRIOS — quem consegue ENTRAR no painel.
 *
 * ⚠ Esta tela não existia até 2026-09-30, e a falta dela não era visível: o
 * administrador é criado no boot a partir das ENV (`bootstrap-admin.mjs`), então
 * quem publicou o sistema entrava normalmente e **não havia caminho nenhum para
 * dar acesso a outra pessoa**. O Diego tentou entrar em 30/09 com dois e-mails
 * diferentes; as quatro tentativas registraram "e-mail inexistente".
 *
 * ⚠ **Usuário ≠ Agente.** Agente é o nome que aparece em "quem falou com o
 * cliente" e precisa sobreviver à saída da pessoa; usuário é login, e precisa
 * ser revogável no mesmo minuto. A tela diz isso porque a pergunta "cadastrei o
 * Diego em Agentes, por que ele não entra?" é a próxima pergunta natural.
 */
export default async function Usuarios() {
  const usuario = await usuarioAtual();
  const ehAdmin = usuario?.role === "ADMIN";

  if (!ehAdmin) {
    return (
      <>
        <Cabecalho titulo="Usuários" sub="Quem consegue entrar no painel." />
        <Faixa tom="atencao">
          <strong>Só administradores.</strong> Esta tela lista e-mails e perfis de acesso, então
          ela não abre para outros perfis. Para trocar a sua própria senha, use{" "}
          <strong>Minha conta</strong>.
        </Faixa>
      </>
    );
  }

  const [usuarios, porta] = await Promise.all([listarUsuarios(), batendoNaPorta()]);
  const ativos = usuarios.filter((u) => u.ativo).length;
  const admins = usuarios.filter((u) => u.ativo && u.papel === "ADMIN").length;

  return (
    <>
      <Cabecalho
        titulo="Usuários"
        sub="Quem consegue entrar no painel, com qual perfil. Criar, trocar perfil, desativar e redefinir senha."
        acao={
          <span className={cn("selo", ativos > 1 ? "selo-bom" : "selo-atencao")}>
            {ativos} {ativos === 1 ? "ativo" : "ativos"} · {admins}{" "}
            {admins === 1 ? "administrador" : "administradores"}
          </span>
        }
      />

      <div className="space-y-8">
        {ativos === 1 ? (
          <Faixa tom="atencao">
            <strong>Só você entra no painel.</strong> Enquanto o time comercial não tem conta, o
            Radar produz sinal que ninguém lê — e o registro de contato, que é o que mede se o
            sinal presta, não tem como acontecer.
          </Faixa>
        ) : null}

        <ListaDeUsuarios usuarios={usuarios} euId={usuario!.id} batendo={porta} />

        <Nota>
          <strong>Nenhuma ferramenta do MCP cria, promove ou reativa usuário</strong> — a mesma
          regra dos tokens pessoais. Um agente de IA com token de escrita poderia, de outra forma,
          criar um administrador para si. Acesso se dá aqui, por gente.
          <br />
          O painel <strong>não manda e-mail</strong>: não existe "esqueci a senha" automático. O
          caminho é um administrador redefinir a senha aqui e passar a nova pela mão. Quem entra
          troca em <strong>Minha conta</strong>.
        </Nota>
      </div>
    </>
  );
}

export const metadata = { title: "Usuários" };
