import { useEffect, useState } from 'react';
import { LIMITS } from '@kiroshi/shared';
import { selectors, useStore } from '../../store/index.js';
import { AreaDeTexto, Botao, Campo, Confirmacao, Dialogo } from '../../design/primitivos/index.js';
import { banir, expulsar, mudarApelido, passarPosse } from '../servidor/acoes.js';
import { useJanelasDaPessoa } from './janelas.js';

function JanelaDeApelido({ guildId, userId, aoFechar }: { guildId: string; userId: string; aoFechar: () => void }) {
  const atual = useStore((s) => s.members.get(`${guildId}:${userId}`)?.nickname ?? '');
  const nomeDeConta = useStore((s) => s.users.get(userId)?.displayName ?? '');
  const eu = useStore((s) => s.user?.id === userId);
  const [apelido, setApelido] = useState(atual);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(valor: string) {
    setSalvando(true);
    setErro(null);
    try {
      await mudarApelido(guildId, userId, valor);
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu certo.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && aoFechar()}
      rotulo="apelido"
      titulo={eu ? 'Seu apelido aqui' : `Apelido de ${nomeDeConta}`}
      descricao="O nome que aparece neste servidor. Em branco, volta o nome de exibição."
      largura="sm"
      acoes={
        <>
          {atual ? (
            <Botao variante="fantasma" disabled={salvando} onClick={() => void salvar('')}>
              Tirar o apelido
            </Botao>
          ) : null}
          <Botao variante="primario" carregando={salvando} onClick={() => void salvar(apelido)}>
            Salvar
          </Botao>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void salvar(apelido);
        }}
      >
        <Campo
          rotulo="Apelido"
          value={apelido}
          maxLength={LIMITS.nickname.max}
          contador
          autoFocus
          placeholder={nomeDeConta}
          erro={erro}
          onChange={(e) => setApelido(e.target.value)}
        />
      </form>
    </Dialogo>
  );
}

function JanelaDeBanimento({ guildId, userId, nome, aoFechar }: { guildId: string; userId: string; nome: string; aoFechar: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function confirmar() {
    setOcupado(true);
    setErro(null);
    try {
      await banir(guildId, userId, motivo);
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu certo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && !ocupado && aoFechar()}
      rotulo="moderação"
      titulo={`Banir ${nome}?`}
      descricao="A pessoa sai do servidor agora e não volta nem com convite, até alguém tirar o banimento."
      largura="sm"
      acoes={
        <>
          <Botao variante="fantasma" disabled={ocupado} onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="perigo" carregando={ocupado} onClick={() => void confirmar()}>
            Banir
          </Botao>
        </>
      }
    >
      <AreaDeTexto
        rotulo="Motivo (opcional)"
        value={motivo}
        maxLength={512}
        rows={3}
        dica="Fica no registro de auditoria e na lista de banimentos."
        erro={erro}
        onChange={(e) => setMotivo(e.target.value)}
      />
    </Dialogo>
  );
}

/** As janelas de moderacao de uma pessoa, montadas uma vez na casca. */
export function JanelasDaPessoa(): React.JSX.Element | null {
  const aberta = useJanelasDaPessoa((s) => s.aberta);
  const fechar = useJanelasDaPessoa((s) => s.fechar);
  const nome = useStore((s) => (aberta ? selectors.displayNameOf(s, aberta.userId, aberta.guildId) : ''));
  const servidor = useStore((s) => (aberta ? (s.guilds.get(aberta.guildId)?.name ?? '') : ''));
  const aindaExiste = useStore((s) => (aberta ? s.guilds.has(aberta.guildId) : false));

  // Saiu do servidor enquanto a janela estava aberta: nada a moderar.
  useEffect(() => {
    if (aberta && !aindaExiste) fechar();
  }, [aberta, aindaExiste, fechar]);

  if (!aberta) return null;
  const { tipo, guildId, userId } = aberta;

  switch (tipo) {
    case 'apelido':
      return <JanelaDeApelido guildId={guildId} userId={userId} aoFechar={fechar} />;
    case 'banir':
      return <JanelaDeBanimento guildId={guildId} userId={userId} nome={nome} aoFechar={fechar} />;
    case 'expulsar':
      return (
        <Confirmacao
          aberto
          aoMudar={(v) => !v && fechar()}
          titulo={`Expulsar ${nome}?`}
          descricao="A pessoa sai do servidor agora, e da chamada se estiver numa. Pode voltar com um convite."
          confirmar="Expulsar"
          perigo
          aoConfirmar={() => expulsar(guildId, userId)}
        />
      );
    case 'posse':
      return (
        <Confirmacao
          aberto
          aoMudar={(v) => !v && fechar()}
          titulo={`Passar ${servidor} para ${nome}?`}
          descricao={`${nome} vira dono e pode tudo, inclusive apagar o servidor e tirar os seus cargos. Não dá para desfazer daqui: para voltar a ser dono, só se ${nome} devolver.`}
          confirmar="Passar a posse"
          perigo
          aoConfirmar={() => passarPosse(guildId, userId)}
        />
      );
  }
}
