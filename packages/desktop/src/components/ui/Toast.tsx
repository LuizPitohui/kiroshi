import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Close, ErroCirculo, Info, Warning } from '../Icons.js';
import type { TipoDeAviso } from './InlineAlert.js';

/**
 * Confirmacao breve, no canto, que some sozinha.
 *
 * A divisao de trabalho com `InlineAlert` e a regra que importa aqui, e a
 * especificacao e explicita: toast serve para CONFIRMACAO BREVE; problema
 * persistente fica visivel perto da area afetada.
 *
 *   "Convite copiado", "Mensagem fixada", "Perfil salvo"  -> toast
 *   "Nao consegui enviar", "A chamada caiu", "Campo invalido" -> InlineAlert
 *
 * O motivo nao e estetico: um toast some. Se a informacao precisa continuar
 * disponivel — porque exige acao, ou porque a pessoa pode ter olhado para
 * outro lado — ela nao pode estar num componente que se apaga sozinho.
 *
 * Por isso um toast de erro aqui e possivel mas dura mais, e nunca deve ser a
 * unica sinalizacao de uma falha que exige decisao.
 */

export interface Toast {
  id: number;
  tipo: TipoDeAviso;
  texto: string;
}

interface ContextoDeToast {
  mostrar: (texto: string, tipo?: TipoDeAviso) => void;
}

const Contexto = createContext<ContextoDeToast | null>(null);

/** Quanto tempo cada tipo fica na tela. */
const DURACAO: Record<TipoDeAviso, number> = {
  sucesso: 2600,
  info: 3200,
  aviso: 4500,
  // Erro fica mais: ainda que a acao esteja em outro lugar, a pessoa precisa
  // de tempo para ler o que aconteceu.
  erro: 6000,
};

const ICONE = { info: Info, sucesso: Check, aviso: Warning, erro: ErroCirculo } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [fila, setFila] = useState<Toast[]>([]);

  const remover = useCallback((id: number) => {
    setFila((atual) => atual.filter((t) => t.id !== id));
  }, []);

  const mostrar = useCallback((texto: string, tipo: TipoDeAviso = 'sucesso') => {
    // `Date.now()` colide quando dois toasts saem no mesmo milissegundo, o que
    // acontece em acao em lote. O contador garante chave unica.
    const id = proximoId++;
    setFila((atual) => [...atual, { id, tipo, texto }]);
  }, []);

  return (
    <Contexto.Provider value={{ mostrar }}>
      {children}
      {fila.length > 0 &&
        createPortal(
          <div className="toasts" role="region" aria-label="Notificacoes">
            {fila.map((t) => (
              <LinhaDeToast key={t.id} toast={t} aoSair={() => remover(t.id)} />
            ))}
          </div>,
          document.body,
        )}
    </Contexto.Provider>
  );
}

let proximoId = 1;

function LinhaDeToast({ toast, aoSair }: { toast: Toast; aoSair: () => void }) {
  const Icone = ICONE[toast.tipo];

  useEffect(() => {
    const t = setTimeout(aoSair, DURACAO[toast.tipo]);
    return () => clearTimeout(t);
  }, [toast.tipo, aoSair]);

  return (
    <div className={`toast toast-${toast.tipo}`} role={toast.tipo === 'erro' ? 'alert' : 'status'}>
      <Icone size={15} />
      <span className="toast-texto">{toast.texto}</span>
      <button className="toast-fechar" onClick={aoSair} aria-label="Fechar">
        <Close size={12} />
      </button>
    </div>
  );
}

/**
 * Mostra um toast.
 *
 * Fora do provedor vira nada — nao lanca. Um aviso de confirmacao nunca pode
 * ser o motivo de uma tela quebrar.
 */
export function useToast(): ContextoDeToast {
  return useContext(Contexto) ?? { mostrar: () => undefined };
}
