import { useState } from 'react';
import { useStore } from '../../store/index.js';
import { Botao, Campo, Dialogo } from '../../design/primitivos/index.js';
import { apagarServidor } from './acoes.js';

/**
 * Excluir o servidor: so o dono, digitando o nome — o mesmo cuidado de
 * excluir a conta. Quem esta numa chamada dele sai dela antes (o servidor
 * cuida disso).
 */
export function JanelaDeExcluirServidor({ guildId, aoFechar }: { guildId: string; aoFechar: () => void }) {
  const nome = useStore((s) => s.guilds.get(guildId)?.name ?? '');
  const [digitado, setDigitado] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const confere = digitado.trim() === nome.trim() && nome.trim().length > 0;

  async function excluir() {
    setOcupado(true);
    setErro(null);
    try {
      await apagarServidor(guildId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu certo.');
      setOcupado(false);
    }
  }

  return (
    <Dialogo
      aberto
      aoMudar={(v) => !v && !ocupado && aoFechar()}
      rotulo="servidor"
      titulo={`Excluir ${nome}?`}
      descricao="Canais, mensagens, cargos, emojis e sons somem para todo mundo. Não dá para desfazer."
      largura="sm"
      acoes={
        <>
          <Botao variante="fantasma" disabled={ocupado} onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="perigo" carregando={ocupado} disabled={!confere} onClick={() => void excluir()}>
            Excluir o servidor
          </Botao>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (confere) void excluir();
        }}
      >
        <Campo rotulo="Digite o nome do servidor" value={digitado} autoFocus erro={erro} placeholder={nome} onChange={(e) => setDigitado(e.target.value)} />
      </form>
    </Dialogo>
  );
}
