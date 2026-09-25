import { useEffect, useState } from 'react';
import type { InvitePreview } from '@kiroshi/shared';
import { ApiRequestError } from '../../api/client.js';
import { navegar, ROTA_INICIAL } from '../../app/rotas.js';
import { useStore } from '../../store/index.js';
import { Avatar, Botao, Carregando, EstadoVazio } from '../../design/primitivos/index.js';
import { iniciaisDe } from '../casca/organizar.js';
import { aceitarConvite, verConvite } from './acoes.js';
import { quandoExpira } from './regrasDoConvite.js';

/**
 * A tela do convite (`#/convite/<codigo>`): chega pelo link `kiroshi://`, pela
 * notificacao ou colando o convite no `+` do trilho. Mostra o servidor antes
 * de entrar, como a pagina do navegador.
 */
export function EntrarPorConvite({ codigo }: { codigo: string }) {
  const [convite, setConvite] = useState<InvitePreview | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const jaMembro = useStore((s) => (convite ? s.guilds.has(convite.guild.id) : false));

  useEffect(() => {
    let vivo = true;
    setConvite(null);
    setErro(null);
    verConvite(codigo)
      .then((c) => vivo && setConvite(c))
      .catch((e: unknown) => {
        if (!vivo) return;
        setErro(e instanceof ApiRequestError && e.status !== 0 ? 'Este convite não vale mais: pode ter expirado, acabado os usos ou sido revogado.' : 'Não consegui falar com o servidor. Confira a conexão.');
      });
    return () => {
      vivo = false;
    };
  }, [codigo]);

  async function entrar() {
    setEntrando(true);
    setErro(null);
    try {
      await aceitarConvite(codigo);
    } catch (e) {
      setErro(e instanceof ApiRequestError ? e.message : 'Não deu para entrar. Tente de novo.');
      setEntrando(false);
    }
  }

  if (erro && !convite) {
    return (
      <EstadoVazio rotulo="convite" titulo="Convite inválido" acao={<Botao onClick={() => navegar(ROTA_INICIAL)}>Voltar ao início</Botao>}>
        {erro}
      </EstadoVazio>
    );
  }
  if (!convite) {
    return (
      <div className="grid h-full place-items-center">
        <Carregando texto="Abrindo o convite" />
      </div>
    );
  }

  const { guild, inviter } = convite;
  return (
    <div className="k-grade flex h-full items-center justify-center px-6">
      <div className="k-colchetes relative w-[420px] max-w-full border border-borda-2 bg-deck px-8 py-8 text-center shadow-camada">
        <span className="k-colchetes-extra" aria-hidden />
        <p className="k-rotulo">convite</p>
        <p className="mt-3 flex items-center justify-center gap-2 text-13 text-texto-3">
          <Avatar nome={inviter.displayName} id={inviter.id} url={inviter.avatarUrl} tamanho={20} />
          {inviter.displayName} te chamou para
        </p>
        <span className="k-chanfro mx-auto mt-4 grid size-20 place-items-center overflow-hidden border border-borda bg-terminal font-display text-24 font-bold text-texto-2">
          {guild.iconUrl ? <img src={guild.iconUrl} alt="" className="size-full object-cover" /> : iniciaisDe(guild.name)}
        </span>
        <h1 className="mt-4 font-display text-28 font-bold uppercase tracking-display text-texto">{guild.name}</h1>
        <p className="mt-1 font-mono text-11 uppercase tracking-rotulo text-texto-3">
          <span className="text-ok">●</span> {convite.onlineCount} online · {convite.memberCount} {convite.memberCount === 1 ? 'membro' : 'membros'}
        </p>
        {guild.description ? <p className="mt-3 text-14 text-texto-2">{guild.description}</p> : null}
        {erro ? (
          <p role="alert" className="mt-4 text-13 text-perigo">
            <span className="font-mono">[!] </span>
            {erro}
          </p>
        ) : null}
        <div className="mt-6 flex justify-center gap-2">
          <Botao variante="fantasma" onClick={() => navegar(ROTA_INICIAL)} disabled={entrando}>
            Agora não
          </Botao>
          {jaMembro ? (
            <Botao variante="primario" onClick={() => navegar({ tela: 'servidor', guildId: guild.id, canalId: null })}>
              Abrir o servidor
            </Botao>
          ) : (
            <Botao variante="primario" carregando={entrando} onClick={() => void entrar()}>
              Entrar no servidor
            </Botao>
          )}
        </div>
        <p className="mt-4 text-12 text-texto-3">{jaMembro ? 'Você já está neste servidor.' : `O convite ${quandoExpira(convite.expiresAt, Date.now())}.`}</p>
      </div>
    </div>
  );
}
