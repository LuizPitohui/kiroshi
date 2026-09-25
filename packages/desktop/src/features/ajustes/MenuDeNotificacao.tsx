import { Bell, BellOff, Check } from 'lucide-react';
import type { NotificationLevel } from '@kiroshi/shared';
import { useStore } from '../../store/index.js';
import { silenciado } from '../../lib/notificar.js';
import { MenuDeContextoItem, MenuDeContextoRotulo, MenuDeContextoSeparador, MenuItem, MenuRotulo, MenuSeparador } from '../../design/primitivos/index.js';
import {
  NOMES_DOS_NIVEIS,
  PRAZOS_DE_SILENCIO,
  ajustarCanal,
  ajustarServidor,
  descreverSilencio,
  silenciarCanal,
  silenciarServidor,
} from './acoesDeNotificacao.js';

const ic = 'size-4';
const vazio = <span aria-hidden className="inline-block size-4" />;

/** O canal (ou a DM) esta silenciado agora — para o icone de sino cortado na lista. */
export function useCanalSilenciado(channelId: string): boolean {
  return useStore((s) => silenciado(s.notificacoesDoCanal.get(channelId), Date.now()));
}

export function useServidorSilenciado(guildId: string): boolean {
  return useStore((s) => silenciado(s.notificacoesDoServidor.get(guildId), Date.now()));
}

/**
 * Os itens de notificacao do clique direito num canal ou numa DM: silenciar
 * por um prazo (ou reativar) e, num canal de servidor, o nivel.
 */
export function ItensDeNotificacaoDoCanal({ channelId, deServidor }: { channelId: string; deServidor: boolean }) {
  const ajuste = useStore((s) => s.notificacoesDoCanal.get(channelId));
  const agora = Date.now();
  const calado = silenciado(ajuste, agora);
  const nivel = ajuste?.notificationLevel ?? null;

  return (
    <>
      <MenuDeContextoRotulo>{calado ? `Silenciado ${descreverSilencio(ajuste?.mutedUntil ?? null, agora)}` : 'Silenciar'}</MenuDeContextoRotulo>
      {calado ? (
        <MenuDeContextoItem icone={<Bell className={ic} strokeWidth={1.5} />} aoEscolher={() => void ajustarCanal(channelId, { muted: false })}>
          Reativar as notificações
        </MenuDeContextoItem>
      ) : (
        PRAZOS_DE_SILENCIO.map((p) => (
          <MenuDeContextoItem key={p.rotulo} icone={<BellOff className={ic} strokeWidth={1.5} />} aoEscolher={() => void silenciarCanal(channelId, p.minutos)}>
            {p.rotulo}
          </MenuDeContextoItem>
        ))
      )}
      {deServidor ? (
        <>
          <MenuDeContextoSeparador />
          <MenuDeContextoRotulo>Notificações do canal</MenuDeContextoRotulo>
          {([null, 'ALL', 'MENTIONS', 'NOTHING'] as (NotificationLevel | null)[]).map((n) => (
            <MenuDeContextoItem
              key={n ?? 'herdar'}
              icone={nivel === n ? <Check className={ic} strokeWidth={1.75} /> : vazio}
              aoEscolher={() => void ajustarCanal(channelId, { notificationLevel: n })}
            >
              {n ? NOMES_DOS_NIVEIS[n] : 'Como o servidor'}
            </MenuDeContextoItem>
          ))}
        </>
      ) : null}
    </>
  );
}

/** Os itens de notificacao no menu do servidor (o cabecalho da navegacao). */
export function ItensDeNotificacaoDoServidor({ guildId }: { guildId: string }) {
  const ajuste = useStore((s) => s.notificacoesDoServidor.get(guildId));
  const agora = Date.now();
  const calado = silenciado(ajuste, agora);
  const nivel = ajuste?.notificationLevel ?? 'ALL';

  return (
    <>
      <MenuSeparador />
      <MenuRotulo>{calado ? `Silenciado ${descreverSilencio(ajuste?.mutedUntil ?? null, agora)}` : 'Silenciar o servidor'}</MenuRotulo>
      {calado ? (
        <MenuItem icone={<Bell className={ic} strokeWidth={1.5} />} aoEscolher={() => void ajustarServidor(guildId, { muted: false })}>
          Reativar as notificações
        </MenuItem>
      ) : (
        PRAZOS_DE_SILENCIO.map((p) => (
          <MenuItem key={p.rotulo} icone={<BellOff className={ic} strokeWidth={1.5} />} aoEscolher={() => void silenciarServidor(guildId, p.minutos)}>
            {p.rotulo}
          </MenuItem>
        ))
      )}
      <MenuSeparador />
      <MenuRotulo>Notificações do servidor</MenuRotulo>
      {(['ALL', 'MENTIONS', 'NOTHING'] as NotificationLevel[]).map((n) => (
        <MenuItem key={n} icone={nivel === n ? <Check className={ic} strokeWidth={1.75} /> : vazio} aoEscolher={() => void ajustarServidor(guildId, { notificationLevel: n })}>
          {NOMES_DOS_NIVEIS[n]}
        </MenuItem>
      ))}
    </>
  );
}
