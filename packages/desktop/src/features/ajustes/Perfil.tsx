import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { LIMITS, type PresenceStatus, type SelfUser } from '@kiroshi/shared';
import { api } from '../../api/client.js';
import { useStore } from '../../store/index.js';
import { AreaDeTexto, Avatar, Botao, Campo, Escolha, avisar } from '../../design/primitivos/index.js';
import { motivo } from '../conversa/acoes.js';
import { lerImagem } from '../../lib/arquivos.js';
import { Bloco } from './partes.js';

const MB = 1024 * 1024;


function SecaoFoto({ eu }: { eu: SelfUser }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function trocar(avatarUrl: string | null) {
    setEnviando(true);
    try {
      // A resposta chega tambem pelo gateway (USER_UPDATE), que atualiza a tela toda.
      await api.patch('/users/@me', { avatarUrl });
    } catch (falha) {
      avisar.erro('Não consegui trocar a foto', motivo(falha, 'Tente de novo.'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Bloco titulo="Foto">
      <div className="flex items-center gap-5">
        <Avatar nome={eu.displayName || eu.username} id={eu.id} url={eu.avatarUrl} tamanho={72} />
        <div className="flex gap-2">
          <Botao carregando={enviando} icone={<ImagePlus className="size-4" strokeWidth={1.5} />} onClick={() => entrada.current?.click()}>
            Trocar a foto
          </Botao>
          {eu.avatarUrl ? (
            <Botao variante="fantasma" icone={<Trash2 className="size-4" strokeWidth={1.5} />} disabled={enviando} onClick={() => void trocar(null)}>
              Tirar
            </Botao>
          ) : null}
        </div>
        <input
          ref={entrada}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = '';
            if (!arquivo) return;
            lerImagem(arquivo).then(
              (dados) => void trocar(dados),
              (falha: Error) => avisar.erro('Essa imagem não serve', falha.message),
            );
          }}
        />
      </div>
      <p className="text-12 text-texto-3">Quadrada fica melhor: ela é cortada em círculo, com até {LIMITS.imageBytes / MB} MB.</p>
    </Bloco>
  );
}

function SecaoPerfil({ eu }: { eu: SelfUser }) {
  const [nome, setNome] = useState(eu.displayName);
  const [pronomes, setPronomes] = useState(eu.pronouns ?? '');
  const [bio, setBio] = useState(eu.bio ?? '');
  const [salvando, setSalvando] = useState(false);

  // Outro aparelho mudou o perfil: a tela acompanha, se nada estiver sendo editado aqui.
  useEffect(() => setNome(eu.displayName), [eu.displayName]);
  useEffect(() => setPronomes(eu.pronouns ?? ''), [eu.pronouns]);
  useEffect(() => setBio(eu.bio ?? ''), [eu.bio]);

  const mudou = nome.trim() !== eu.displayName || pronomes.trim() !== (eu.pronouns ?? '') || bio.trim() !== (eu.bio ?? '');

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      await api.patch('/users/@me', { displayName: nome.trim(), pronouns: pronomes.trim() || null, bio: bio.trim() || null });
      avisar.ok('Perfil salvo');
    } catch (falha) {
      avisar.erro('Não consegui salvar o perfil', motivo(falha, 'Tente de novo.'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Bloco titulo="Como os outros te veem">
      <form onSubmit={(e) => void salvar(e)} className="max-w-[480px] space-y-3">
        <Campo rotulo="Nome de exibição" value={nome} maxLength={LIMITS.displayName.max} contador onChange={(e) => setNome(e.target.value)} dica="O nome em cima das suas mensagens. O @usuário não muda." />
        <Campo rotulo="Pronomes" value={pronomes} maxLength={LIMITS.pronouns.max} onChange={(e) => setPronomes(e.target.value)} placeholder="ela/dela, ele/dele…" />
        <AreaDeTexto rotulo="Sobre você" value={bio} maxLength={LIMITS.bio.max} contador rows={3} onChange={(e) => setBio(e.target.value)} />
        <Botao type="submit" variante="primario" carregando={salvando} disabled={!mudou || !nome.trim()}>
          Salvar
        </Botao>
      </form>
    </Bloco>
  );
}

function SecaoStatus({ eu }: { eu: SelfUser }) {
  const [texto, setTexto] = useState(eu.customStatus ?? '');
  useEffect(() => setTexto(eu.customStatus ?? ''), [eu.customStatus]);

  async function mudar(status: PresenceStatus, customStatus: string | null) {
    try {
      await api.patch('/users/@me/presence', { status, customStatus });
      // O proprio status volta pelo gateway (PRESENCE_UPDATE); o do usuario na hora.
      useStore.getState().setUser({ ...eu, status, customStatus });
    } catch (falha) {
      avisar.erro('Não consegui mudar o status', motivo(falha, 'Tente de novo.'));
    }
  }

  return (
    <Bloco titulo="Status">
      <Escolha<PresenceStatus>
        rotulo="Como você aparece"
        valor={eu.status}
        aoMudar={(status) => void mudar(status, eu.customStatus)}
        opcoes={[
          { valor: 'ONLINE', rotulo: 'Online', descricao: 'Disponível.' },
          { valor: 'IDLE', rotulo: 'Ausente', descricao: 'Longe do computador.' },
          { valor: 'DND', rotulo: 'Não perturbe', descricao: 'Nenhuma notificação aparece.' },
          { valor: 'OFFLINE', rotulo: 'Invisível', descricao: 'Aparece offline, mas usa tudo normalmente.' },
        ]}
      />
      <form
        className="flex max-w-[480px] items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void mudar(eu.status, texto.trim() || null);
        }}
      >
        <Campo rotulo="Frase de status" value={texto} maxLength={LIMITS.customStatus.max} onChange={(e) => setTexto(e.target.value)} placeholder="Jogando até tarde…" className="flex-1" />
        <Botao type="submit" disabled={texto.trim() === (eu.customStatus ?? '')}>
          Salvar
        </Botao>
      </form>
    </Bloco>
  );
}

/** Meu perfil: foto, nome, pronomes, bio e status. */
export function PaginaPerfil() {
  const eu = useStore((s) => s.user);
  if (!eu) return <p className="text-13 text-texto-3">Carregando…</p>;
  return (
    <div className="space-y-8">
      <SecaoFoto eu={eu} />
      <SecaoPerfil eu={eu} />
      <SecaoStatus eu={eu} />
    </div>
  );
}
