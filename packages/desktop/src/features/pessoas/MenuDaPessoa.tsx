import type { ReactNode } from 'react';
import { Permission, has } from '@kiroshi/shared';
import { Crown, Gavel, MessageSquare, PenLine, Shield, UserMinus, UserRound } from 'lucide-react';
import { useRolesOfGuild, useStore } from '../../store/index.js';
import {
  MenuDeContextoItem,
  MenuDeContextoMarcavel,
  MenuDeContextoSeparador,
  MenuDeContextoSub,
  MenuDeContextoSubConteudo,
  MenuDeContextoSubGatilho,
  MenuItem,
  MenuSeparador,
} from '../../design/primitivos/index.js';
import { abrirConversa } from '../inicio/acoes.js';
import { cargosEmOrdem, podeAgirSobre, podeDarCargo, podeTirarCargo } from '../servidor/hierarquia.js';
import { useContextoDe, usePoder } from '../servidor/poder.js';
import { darCargo, tirarCargo } from '../servidor/acoes.js';
import { abrirJanela } from './janelas.js';

const ic = 'size-4';

interface Acao {
  id: string;
  rotulo: string;
  icone: ReactNode;
  perigo?: boolean;
  aoEscolher: () => void;
}

/**
 * O que eu posso fazer com uma pessoa neste servidor, na ordem do menu.
 * So entra o que o servidor aceitaria (a mesma conta da hierarquia).
 */
function useAcoesDaPessoa(guildId: string, userId: string, aoVerPerfil?: () => void): { comuns: Acao[]; moderacao: Acao[] } {
  const poder = usePoder(guildId);
  const alvo = useContextoDe(guildId, userId);
  const eu = useStore((s) => s.user?.id);
  const donoId = useStore((s) => s.guilds.get(guildId)?.ownerId);

  const comuns: Acao[] = [];
  const moderacao: Acao[] = [];
  if (!poder || !alvo) return { comuns, moderacao };

  const souEu = userId === eu;
  const ehDono = userId === donoId;
  const abaixo = podeAgirSobre(poder, alvo);
  const tem = (bit: bigint) => has(poder.permissoes, bit);

  if (aoVerPerfil) comuns.push({ id: 'perfil', rotulo: 'Ver perfil', icone: <UserRound className={ic} strokeWidth={1.5} />, aoEscolher: aoVerPerfil });
  if (!souEu) {
    comuns.push({ id: 'mensagem', rotulo: 'Mandar mensagem', icone: <MessageSquare className={ic} strokeWidth={1.5} />, aoEscolher: () => void abrirConversa(userId) });
  }
  if ((souEu && tem(Permission.CHANGE_NICKNAME)) || (!souEu && abaixo && tem(Permission.MANAGE_NICKNAMES))) {
    comuns.push({
      id: 'apelido',
      rotulo: souEu ? 'Mudar meu apelido' : 'Mudar o apelido',
      icone: <PenLine className={ic} strokeWidth={1.5} />,
      aoEscolher: () => abrirJanela('apelido', guildId, userId),
    });
  }

  if (!souEu && !ehDono && abaixo) {
    if (tem(Permission.KICK_MEMBERS)) {
      moderacao.push({ id: 'expulsar', rotulo: 'Expulsar', icone: <UserMinus className={ic} strokeWidth={1.5} />, perigo: true, aoEscolher: () => abrirJanela('expulsar', guildId, userId) });
    }
    if (tem(Permission.BAN_MEMBERS)) {
      moderacao.push({ id: 'banir', rotulo: 'Banir', icone: <Gavel className={ic} strokeWidth={1.5} />, perigo: true, aoEscolher: () => abrirJanela('banir', guildId, userId) });
    }
  }
  if (poder.dono && !souEu) {
    moderacao.push({ id: 'posse', rotulo: 'Passar a posse', icone: <Crown className={ic} strokeWidth={1.5} />, perigo: true, aoEscolher: () => abrirJanela('posse', guildId, userId) });
  }
  return { comuns, moderacao };
}

/** A lista de cargos com caixas de marcar, dentro do clique direito. */
function SubmenuDeCargos({ guildId, userId }: { guildId: string; userId: string }) {
  const todos = useRolesOfGuild(guildId);
  const roleIds = useStore((s) => s.members.get(`${guildId}:${userId}`)?.roleIds);
  const poder = usePoder(guildId);
  const alvo = useContextoDe(guildId, userId);
  if (!poder || !alvo || !roleIds || !has(poder.permissoes, Permission.MANAGE_ROLES) || !podeAgirSobre(poder, alvo)) return null;

  const cargos = cargosEmOrdem(todos, guildId);
  if (cargos.length === 0) return null;

  return (
    <MenuDeContextoSub>
      <MenuDeContextoSubGatilho icone={<Shield className={ic} strokeWidth={1.5} />}>Cargos</MenuDeContextoSubGatilho>
      <MenuDeContextoSubConteudo>
        {cargos.map((c) => {
          const tem = roleIds.includes(c.id);
          const pode = tem ? podeTirarCargo(poder, c) : podeDarCargo(poder, c);
          return (
            <MenuDeContextoMarcavel
              key={c.id}
              marcado={tem}
              cor={c.color}
              desativado={!pode}
              aoMudar={(marcar) => void (marcar ? darCargo(guildId, userId, c.id) : tirarCargo(guildId, userId, c.id))}
            >
              {c.name}
            </MenuDeContextoMarcavel>
          );
        })}
      </MenuDeContextoSubConteudo>
    </MenuDeContextoSub>
  );
}

/** Os itens do clique direito numa pessoa do servidor. */
export function ItensDaPessoa({ guildId, userId, aoVerPerfil }: { guildId: string; userId: string; aoVerPerfil?: () => void }) {
  const { comuns, moderacao } = useAcoesDaPessoa(guildId, userId, aoVerPerfil);
  return (
    <>
      {comuns.map((a) => (
        <MenuDeContextoItem key={a.id} icone={a.icone} aoEscolher={a.aoEscolher}>
          {a.rotulo}
        </MenuDeContextoItem>
      ))}
      <SubmenuDeCargos guildId={guildId} userId={userId} />
      {moderacao.length ? <MenuDeContextoSeparador /> : null}
      {moderacao.map((a) => (
        <MenuDeContextoItem key={a.id} icone={a.icone} perigo={a.perigo} aoEscolher={a.aoEscolher}>
          {a.rotulo}
        </MenuDeContextoItem>
      ))}
    </>
  );
}

/** Os mesmos itens num menu suspenso (o "..." da pagina de Membros), sem a lista de cargos. */
export function ItensDaPessoaNoMenu({ guildId, userId }: { guildId: string; userId: string }) {
  const { comuns, moderacao } = useAcoesDaPessoa(guildId, userId);
  if (comuns.length === 0 && moderacao.length === 0) return <MenuItem desativado>Nada a fazer aqui</MenuItem>;
  return (
    <>
      {comuns.map((a) => (
        <MenuItem key={a.id} icone={a.icone} aoEscolher={a.aoEscolher}>
          {a.rotulo}
        </MenuItem>
      ))}
      {comuns.length && moderacao.length ? <MenuSeparador /> : null}
      {moderacao.map((a) => (
        <MenuItem key={a.id} icone={a.icone} perigo={a.perigo} aoEscolher={a.aoEscolher}>
          {a.rotulo}
        </MenuItem>
      ))}
    </>
  );
}
