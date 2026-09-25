import { useEffect, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { api } from '../../api/client.js';
import { useStore } from '../../store/index.js';
import { navegar, useRota } from '../../app/rotas.js';
import { Botao, BotaoIcone } from '../../design/primitivos/index.js';

const chave = (userId: string) => `kiroshi.avisoDeSenha.${userId}`;

/**
 * "Defina uma senha para entrar tambem com email" (10-front-end-novo.md 4.1):
 * fixo, no alto da area principal, para quem criou a conta pelo Google e
 * ainda nao tem senha; dispensavel ("Agora nao"), e some sozinho quando a
 * senha e definida — o servidor manda USER_UPDATE, o usuario do store muda,
 * e a seguranca da conta e relida.
 *
 * Sem senha, perder o acesso ao Google e perder a conta: por isso o aviso nao
 * some por tempo, so por escolha.
 */
export function AvisoDeSenha(): React.JSX.Element | null {
  const eu = useStore((s) => s.user);
  const rota = useRota();
  const [semSenha, setSemSenha] = useState(false);
  const [dispensado, setDispensado] = useState(true);

  useEffect(() => {
    if (!eu) return;
    try {
      setDispensado(localStorage.getItem(chave(eu.id)) === '1');
    } catch {
      setDispensado(false);
    }
    let vivo = true;
    api
      .get<{ hasPassword: boolean }>('/users/@me/security')
      .then((s) => vivo && setSemSenha(!s.hasPassword))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
    // `eu` inteiro de proposito: o USER_UPDATE depois de definir a senha troca o objeto.
  }, [eu]);

  // Na propria pagina da conta o aviso sobra: e ali que se define a senha.
  if (!eu || !semSenha || dispensado || (rota.tela === 'ajustes' && rota.pagina === 'conta')) return null;

  function dispensar() {
    setDispensado(true);
    try {
      localStorage.setItem(chave(eu!.id), '1');
    } catch {
      // sem armazenamento: some so ate reabrir o app
    }
  }

  return (
    <div role="status" className="flex items-center gap-3 border-b border-borda border-l-2 border-l-aviso bg-terminal px-4 py-2 text-13">
      <KeyRound aria-hidden className="size-4 shrink-0 text-aviso" strokeWidth={1.5} />
      <p className="min-w-0 flex-1 text-texto-2">
        <strong className="font-medium text-texto">Sua conta entra só pelo Google.</strong> Defina uma senha para entrar também com email — e não
        depender só do Google.
      </p>
      <Botao tamanho="sm" onClick={() => navegar({ tela: 'ajustes', pagina: 'conta' })}>
        Definir senha
      </Botao>
      <BotaoIcone rotulo="Agora não" tamanho="sm" icone={<X className="size-4" strokeWidth={1.5} />} onClick={dispensar} />
    </div>
  );
}
