import { useMemo, useState } from 'react';
import type { Channel, PresenceStatus } from '@kiroshi/shared';
import { api } from '../api/client.js';
import { useStore, usePrivateChannels, useRelationships } from '../store/index.js';
import { Avatar } from './Avatar.js';
import { EmptyState } from './ui/EmptyState.js';
import { InlineAlert } from './ui/InlineAlert.js';
import { TextField } from './ui/TextField.js';
import { CreateGuildModal } from './modals/CreateGuildModal.js';
import { Check, Close, Plus, Users } from './Icons.js';

/**
 * A tela de quando nao ha nada aberto.
 *
 * Antes ali estava escrito "Nenhuma conversa aberta — escolha um canal na
 * barra lateral". Nao e falso, e nao serve para nada: e o maior espaco da
 * janela ocupado por uma instrucao que a pessoa ja cumpriu mil vezes, e que
 * nao ajuda em nada quem acabou de criar a conta e nao tem canal nenhum para
 * escolher.
 *
 * O que essa area deve responder e "e agora?". As respostas sao: quem sao
 * seus amigos e quais estao online, quem esta te esperando responder, e como
 * conhecer mais gente — adicionar alguem ou entrar em um servidor.
 *
 * Os pedidos pendentes vem primeiro quando existem, e a aba abre neles.
 * Alguem esperando resposta e a unica coisa aqui com prazo; amigo online
 * continua online daqui a um minuto.
 */

type Aba = 'amigos' | 'pendentes';

export function SocialHome() {
  const selfId = useStore((s) => s.user?.id);
  const presences = useStore((s) => s.presences);
  const relationships = useRelationships();
  const channels = usePrivateChannels();
  const selectChannel = useStore((s) => s.selectChannel);
  const upsertChannel = useStore((s) => s.upsertChannel);

  const pendentes = useMemo(
    () => relationships.filter((r) => r.type === 'PENDING_INCOMING'),
    [relationships],
  );
  const amigos = useMemo(
    () => relationships.filter((r) => r.type === 'FRIEND'),
    [relationships],
  );

  // Abre onde ha algo a fazer. Quem chega com um pedido esperando nao deveria
  // precisar descobrir que existe outra aba.
  const [aba, setAba] = useState<Aba>(() => (pendentes.length > 0 ? 'pendentes' : 'amigos'));

  const [adicionando, setAdicionando] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [usuario, setUsuario] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  const online = amigos.filter((r) => {
    // Sem presenca conhecida a pessoa esta offline: o servidor so manda
    // presenca de quem esta conectado.
    const status = presences.get(r.user.id)?.status ?? 'OFFLINE';
    return status !== 'OFFLINE';
  });

  async function abrirConversa(userId: string): Promise<void> {
    const existente = channels.find((c) => c.type === 'DM' && c.recipientIds.includes(userId));
    if (existente) {
      selectChannel(existente.id);
      return;
    }
    const canal = await api
      .post<Channel>('/users/@me/channels', { recipientIds: [userId] })
      .catch(() => null);
    if (!canal) return;
    upsertChannel(canal);
    selectChannel(canal.id);
  }

  async function enviarPedido(): Promise<void> {
    const nome = usuario.trim().toLowerCase();
    if (!nome) return;
    try {
      await api.post('/relationships', { username: nome });
      setAviso({ tipo: 'sucesso', texto: `Pedido enviado para ${nome}.` });
      setUsuario('');
    } catch (erro) {
      setAviso({
        tipo: 'erro',
        texto: erro instanceof Error ? erro.message : 'Nao consegui enviar o pedido.',
      });
    }
  }

  function responder(id: string, aceitar: boolean): void {
    const chamada = aceitar
      ? api.put(`/relationships/${id}`)
      : api.delete(`/relationships/${id}`);
    void chamada.catch(() => setAviso({ tipo: 'erro', texto: 'Nao consegui responder agora.' }));
  }

  const lista = aba === 'pendentes' ? pendentes : amigos;

  return (
    <div className="inicio">
      <header className="inicio-topo">
        <h1 className="inicio-titulo">Inicio</h1>

        <div className="tabs">
          <button
            className={`tab ${aba === 'amigos' ? 'active' : ''}`}
            onClick={() => setAba('amigos')}
          >
            Amigos
            {online.length > 0 && <span className="tab-conta">{online.length} online</span>}
          </button>
          <button
            className={`tab ${aba === 'pendentes' ? 'active' : ''}`}
            onClick={() => setAba('pendentes')}
          >
            Pendentes
            {/* O numero de pedidos e vermelho porque e o unico com prazo. */}
            {pendentes.length > 0 && <span className="tab-badge">{pendentes.length}</span>}
          </button>
        </div>

        <div className="inicio-acoes">
          <button
            className="btn btn-primary"
            data-inicio="adicionar"
            onClick={() => {
              setAdicionando((v) => !v);
              setAviso(null);
            }}
          >
            <Plus size={14} />
            Adicionar amigo
          </button>
          <button className="btn" onClick={() => setEntrando(true)}>
            <Users size={14} />
            Entrar em um servidor
          </button>
        </div>
      </header>

      {adicionando && (
        <div className="inicio-adicionar">
          <TextField
            rotulo="Nome de usuario"
            valor={usuario}
            aoMudar={(v) => {
              setUsuario(v);
              setAviso(null);
            }}
            dica="Quem voce procura precisa ser exatamente assim: minusculas, numeros, ponto ou _"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void enviarPedido();
            }}
          />
          <button className="btn btn-primary" onClick={() => void enviarPedido()}>
            Enviar pedido
          </button>
        </div>
      )}

      {aviso && (
        <div className="inicio-aviso">
          <InlineAlert
            tipo={aviso.tipo === 'sucesso' ? 'sucesso' : 'erro'}
            aoDispensar={() => setAviso(null)}
          >
            {aviso.texto}
          </InlineAlert>
        </div>
      )}

      <div className="inicio-lista">
        {lista.length === 0 ? (
          aba === 'pendentes' ? (
            <EmptyState
              icone={<Users size={28} />}
              titulo="Nenhum pedido esperando"
              descricao="Quando alguem te adicionar, o pedido aparece aqui."
            />
          ) : (
            <EmptyState
              icone={<Users size={28} />}
              titulo="Sua rede comeca aqui"
              descricao="Adicione alguem pelo nome de usuario, ou entre em um servidor por convite."
              acoes={
                <>
                  <button className="btn btn-primary" onClick={() => setAdicionando(true)}>
                    Adicionar amigo
                  </button>
                  <button className="btn" onClick={() => setEntrando(true)}>
                    Entrar em um servidor
                  </button>
                </>
              }
            />
          )
        ) : (
          lista.map((r) => {
            const status: PresenceStatus = presences.get(r.user.id)?.status ?? 'OFFLINE';
            return (
              <div key={r.id} className="inicio-pessoa">
                <Avatar
                  url={r.user.avatarUrl}
                  name={r.user.displayName}
                  size={36}
                  status={status}
                />
                <span className="inicio-nome">
                  <span className="inicio-exibicao">{r.user.displayName}</span>
                  <span className="inicio-usuario">@{r.user.username}</span>
                </span>

                {aba === 'pendentes' ? (
                  <span className="inicio-botoes">
                    <button
                      className="act bom"
                      onClick={() => responder(r.id, true)}
                      title="Aceitar"
                      aria-label={`Aceitar o pedido de ${r.user.displayName}`}
                    >
                      <Check size={16} />
                    </button>
                    <button
                      className="act ruim"
                      onClick={() => responder(r.id, false)}
                      title="Recusar"
                      aria-label={`Recusar o pedido de ${r.user.displayName}`}
                    >
                      <Close size={16} />
                    </button>
                  </span>
                ) : (
                  <button
                    className="btn"
                    onClick={() => void abrirConversa(r.user.id)}
                    disabled={r.user.id === selfId}
                  >
                    Conversar
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {entrando && <CreateGuildModal onClose={() => setEntrando(false)} />}
    </div>
  );
}

