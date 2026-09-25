import { useMemo } from 'react';
import { CornerUpLeft, PhoneOff } from 'lucide-react';
import { useStore } from '../../store/index.js';
import { navegar, useRota } from '../../app/rotas.js';
import { BotaoIcone } from '../../design/primitivos/index.js';
import { useVoz } from '../casca/useVoz.js';
import { sairDaVoz } from '../casca/acoesDeVoz.js';
import { useFonteDaChamada } from './fonte.js';
import { montarQuadros, quadroEmDestaque } from './quadros.js';
import { useEstadoDoPalco } from './estadoDoPalco.js';
import { Quadro } from './Quadro.js';

const nada = () => undefined;

/**
 * A chamada continua com video enquanto se le outro canal: um palco pequeno
 * no canto, com O MESMO video (o elemento e movido do palco para ca, nunca
 * recriado — sem travada na troca). So aparece quando ha imagem: sem video,
 * o painel da voz na navegacao ja diz que a chamada segue.
 */
export function MiniPalco() {
  const rota = useRota();
  const fonte = useFonteDaChamada();
  const { participantes, assistindoEu } = fonte.usarParticipantes();
  const canalDaChamada = useVoz((v) => (v.connected ? v.channelId : null));
  const guildId = useVoz((v) => v.guildId);
  const escolhido = useEstadoDoPalco((s) => s.destaque);
  const nomeDoCanal = useStore((s) => (canalDaChamada ? (s.channels.get(canalDaChamada)?.name ?? 'chamada') : ''));

  const quadros = useMemo(() => montarQuadros(participantes, assistindoEu), [participantes, assistindoEu]);
  const destaque = quadroEmDestaque(quadros, escolhido);
  // O destaque, se tiver imagem; senao a primeira imagem que houver (a
  // transmissao que se assiste antes da camera de alguem).
  const alvo = quadros.find((q) => q.chave === destaque && q.video) ?? quadros.find((q) => q.video && !q.local) ?? quadros.find((q) => q.video);

  const naPropriaTela = (rota.tela === 'servidor' || rota.tela === 'dm') && rota.canalId === canalDaChamada;
  if (!canalDaChamada || naPropriaTela || !alvo) return null;

  const voltar = () => (guildId ? navegar({ tela: 'servidor', guildId, canalId: canalDaChamada }) : navegar({ tela: 'dm', canalId: canalDaChamada }));

  return (
    <aside aria-label="Chamada em andamento" className="group/mini absolute bottom-[92px] right-4 z-[var(--k-z-palco-flutuante)] w-[320px] shadow-camada">
      <div className="relative aspect-video">
        <Quadro
          quadro={alvo}
          guildId={guildId}
          canalId={canalDaChamada}
          modo="mini"
          emDestaque={false}
          preferencia="auto"
          aoDestacar={voltar}
          aoMudarPreferencia={nada}
        />
      </div>
      <div className="flex h-8 items-center gap-1 border border-t-0 border-borda-2 bg-elevado pl-2.5 pr-1">
        <span className="min-w-0 flex-1 truncate font-mono text-10 uppercase tracking-rotulo text-texto-2">{nomeDoCanal}</span>
        <BotaoIcone rotulo="Voltar para a chamada" tamanho="sm" onClick={voltar} icone={<CornerUpLeft className="size-4" strokeWidth={1.5} />} />
        <BotaoIcone rotulo="Sair da chamada" tamanho="sm" alerta onClick={sairDaVoz} icone={<PhoneOff className="size-4" strokeWidth={1.5} />} />
      </div>
    </aside>
  );
}
