import { useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import type { NotificationLevel } from '@kiroshi/shared';
import { useStore } from '../../store/index.js';
import { useShallow } from 'zustand/react/shallow';
import { silenciado } from '../../lib/notificar.js';
import {
  gravarPreferenciasDeNotificacao,
  lerPreferenciasDeNotificacao,
  type PreferenciasDeNotificacao,
} from '../../lib/preferenciasDeNotificacao.js';
import { Botao, LinhaDeInterruptor, Menu, MenuConteudo, MenuGatilho, MenuItem, Selecao } from '../../design/primitivos/index.js';
import { NOMES_DOS_NIVEIS, PRAZOS_DE_SILENCIO, ajustarServidor, descreverSilencio, silenciarServidor } from './acoesDeNotificacao.js';
import { Bloco } from './partes.js';

function LinhaDoServidor({ guildId }: { guildId: string }) {
  const nome = useStore((s) => s.guilds.get(guildId)?.name ?? 'Servidor');
  const ajuste = useStore((s) => s.notificacoesDoServidor.get(guildId));
  const calado = silenciado(ajuste, Date.now());

  return (
    <li className="flex flex-wrap items-center gap-3 border-t border-borda py-3 first:border-t-0">
      <span className="min-w-0 flex-1 truncate text-14 font-medium">{nome}</span>
      <Selecao
        rotulo={`Notificações de ${nome}`}
        valor={ajuste?.notificationLevel ?? 'ALL'}
        opcoes={(['ALL', 'MENTIONS', 'NOTHING'] as NotificationLevel[]).map((n) => ({ valor: n, rotulo: NOMES_DOS_NIVEIS[n] }))}
        aoMudar={(v) => void ajustarServidor(guildId, { notificationLevel: v as NotificationLevel })}
        className="w-[200px]"
      />
      {calado ? (
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-12 text-texto-3">
            <BellOff aria-hidden className="size-3.5" strokeWidth={1.5} />
            Silenciado {descreverSilencio(ajuste?.mutedUntil ?? null)}
          </span>
          <Botao tamanho="sm" icone={<Bell className="size-4" strokeWidth={1.5} />} onClick={() => void ajustarServidor(guildId, { muted: false })}>
            Reativar
          </Botao>
        </span>
      ) : (
        <Menu>
          <MenuGatilho asChild>
            <Botao tamanho="sm" icone={<BellOff className="size-4" strokeWidth={1.5} />}>
              Silenciar
            </Botao>
          </MenuGatilho>
          <MenuConteudo alinhar="end">
            {PRAZOS_DE_SILENCIO.map((p) => (
              <MenuItem key={p.rotulo} aoEscolher={() => void silenciarServidor(guildId, p.minutos)}>
                {p.rotulo}
              </MenuItem>
            ))}
          </MenuConteudo>
        </Menu>
      )}
    </li>
  );
}

/**
 * Notificacoes (F7): o que vale neste computador e o nivel de cada servidor.
 * Canais e conversas diretas tem o seu no clique direito.
 */
export function PaginaNotificacoes() {
  const [preferencias, setPreferencias] = useState<PreferenciasDeNotificacao>(lerPreferenciasDeNotificacao);
  const servidores = useStore(useShallow((s) => [...s.guilds.keys()]));
  const mudar = (patch: Partial<PreferenciasDeNotificacao>) => setPreferencias(gravarPreferenciasDeNotificacao(patch));

  return (
    <div className="space-y-8">
      <Bloco titulo="Neste computador" descricao="Em Não perturbe (no seu status) nenhuma notificação aparece, e a conversa que você está lendo nunca avisa.">
        <LinhaDeInterruptor
          titulo="Notificações do Windows"
          descricao="Mensagem nova com o Kiroshi fora da frente. Clicar abre a conversa."
          ligado={preferencias.windows}
          aoMudar={(windows) => mudar({ windows })}
        />
        <LinhaDeInterruptor
          titulo="Piscar na barra de tarefas"
          descricao="O ícone pisca quando chega algo que notifica."
          ligado={preferencias.piscar}
          aoMudar={(piscar) => mudar({ piscar })}
        />
        <LinhaDeInterruptor
          titulo="Contador de menções no ícone"
          descricao="O selo na barra de tarefas enquanto houver menção sem ler. Conversa silenciada não conta."
          ligado={preferencias.contador}
          aoMudar={(contador) => mudar({ contador })}
        />
      </Bloco>
      <Bloco titulo="Por servidor" descricao="Vale em todos os seus aparelhos. Cada canal e cada conversa direta também tem o seu: clique com o botão direito neles.">
        {servidores.length === 0 ? (
          <p className="text-13 text-texto-3">Você ainda não está em nenhum servidor.</p>
        ) : (
          <ul>
            {servidores.map((id) => (
              <LinhaDoServidor key={id} guildId={id} />
            ))}
          </ul>
        )}
      </Bloco>
    </div>
  );
}
