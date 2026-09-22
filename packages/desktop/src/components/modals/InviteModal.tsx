import { useEffect, useState } from 'react';
import type { Invite } from '@kiroshi/shared';
import { api, ApiRequestError } from '../../api/client.js';
import { Dialog } from '../ui/Dialog.js';
import { InlineAlert } from '../ui/InlineAlert.js';

interface Props {
  guildId: string;
  onClose: () => void;
}

const DURATIONS = [
  { label: '30 minutos', secs: 1800 },
  { label: '6 horas', secs: 21600 },
  { label: '1 dia', secs: 86400 },
  { label: '7 dias', secs: 604800 },
  { label: 'Nunca expira', secs: 0 },
];

/*
  Um uso por padrao, nao "sem limite".

  Neste servidor o cadastro e fechado, entao o convite nao serve so para entrar
  no servidor: e o que permite criar conta. Um codigo sem limite que vaza em
  print, historico de conversa ou celular emprestado abre cadastro para
  qualquer pessoa ate expirar.

  Quem quiser chamar varias pessoas de uma vez escolhe na lista; a diferenca e
  que passa a ser uma decisao, e nao o que acontece quando ninguem olha.
*/
const USES = [
  { label: '1 uso', value: 1 },
  { label: '5 usos', value: 5 },
  { label: '10 usos', value: 10 },
  { label: '25 usos', value: 25 },
  { label: 'Sem limite', value: 0 },
];

export function InviteModal({ guildId, onClose }: Props) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [maxAgeSecs, setMaxAgeSecs] = useState(604800);
  const [maxUses, setMaxUses] = useState(1);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    setCopied(false);

    try {
      const created = await api.post<Invite>(`/guilds/${guildId}/invites`, { maxAgeSecs, maxUses });
      setInvite(created);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Nao consegui criar o convite.');
    } finally {
      setBusy(false);
    }
  }

  // Gera um convite assim que a janela abre: e o que a pessoa veio fazer.
  useEffect(() => {
    void generate();
    // Regerar a cada mudanca de opcao seria desperdicio; o botao cuida disso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy(): Promise<void> {
    if (!invite) return;
    await navigator.clipboard.writeText(invite.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog
      aberto
      aoFechar={onClose}
      titulo="Convidar para o servidor"
      descricao="Mande este codigo para quem voce quer trazer."
      acoes={
        <>
          <button className="btn" onClick={onClose}>
            Fechar
          </button>
          <button className="btn btn-primary" onClick={() => void generate()} disabled={busy}>
            Gerar com estas opcoes
          </button>
        </>
      }
    >
      <>
        <div className="field">
          <span className="field-label">Codigo do convite</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              readOnly
              value={invite?.code ?? ''}
              placeholder={busy ? 'gerando...' : ''}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 16, letterSpacing: '0.05em' }}
              onFocus={(e) => e.target.select()}
            />
            <button
              className="btn btn-primary"
              onClick={() => void copy()}
              disabled={!invite}
              style={{ flexShrink: 0 }}
            >
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>

        <div className="divider" />

        <div className="row" style={{ borderBottom: 'none' }}>
          <div className="row-text">
            <div className="row-title">Expira em</div>
          </div>
          <select value={maxAgeSecs} onChange={(e) => setMaxAgeSecs(Number(e.target.value))}>
            {DURATIONS.map((option) => (
              <option key={option.secs} value={option.secs}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="row" style={{ borderBottom: 'none' }}>
          <div className="row-text">
            <div className="row-title">Numero de usos</div>
          </div>
          <select value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))}>
            {USES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {error && <InlineAlert tipo="erro">{error}</InlineAlert>}
      </>
    </Dialog>
  );
}
