import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { LIMITS } from '@kiroshi/shared';
import { selectors, useStore } from '../../store/index.js';
import { AreaDeTexto, Botao, Campo, avisar } from '../../design/primitivos/index.js';
import { lerImagem } from '../../lib/arquivos.js';
import { Bloco, Linha } from '../ajustes/partes.js';
import { iniciaisDe } from '../casca/organizar.js';
import { salvarServidor } from './acoes.js';

const data = (iso: string | undefined) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

/**
 * Icone, nome e descricao. O canal de sistema e a notificacao padrao do
 * desenho ficaram de fora de proposito: o servidor ainda nao faz nada com
 * nenhum dos dois (nao ha mensagem de sistema de entrada), e a interface nova
 * nao mostra controle que nao muda nada.
 */
export function PaginaVisaoGeral({ guildId }: { guildId: string }) {
  const guild = useStore((s) => s.guilds.get(guildId));
  const dono = useStore((s) => (guild ? selectors.displayNameOf(s, guild.ownerId, guildId) : ''));
  const [nome, setNome] = useState(guild?.name ?? '');
  const [descricao, setDescricao] = useState(guild?.description ?? '');
  const [salvando, setSalvando] = useState(false);
  const [trocandoIcone, setTrocandoIcone] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  // Alguem mudou em outro lugar e eu nao tinha editado nada: acompanha.
  const editado = nome !== (guild?.name ?? '') || descricao !== (guild?.description ?? '');
  const ultimo = useRef({ nome: guild?.name ?? '', descricao: guild?.description ?? '' });
  useEffect(() => {
    if (!guild) return;
    if (nome === ultimo.current.nome) setNome(guild.name);
    if (descricao === ultimo.current.descricao) setDescricao(guild.description ?? '');
    ultimo.current = { nome: guild.name, descricao: guild.description ?? '' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guild?.name, guild?.description]);

  if (!guild) return null;
  const nomeValido = nome.trim().length >= LIMITS.guildName.min;

  async function salvar() {
    setSalvando(true);
    const feito = await salvarServidor(guildId, { name: nome.trim(), description: descricao.trim() || null });
    setSalvando(false);
    if (feito) avisar.ok('Servidor salvo');
  }

  async function trocarIcone(iconUrl: string | null) {
    setTrocandoIcone(true);
    await salvarServidor(guildId, { iconUrl });
    setTrocandoIcone(false);
  }

  return (
    <div className="space-y-8">
      <Bloco titulo="Ícone" descricao={`Quadrado fica melhor. Até ${LIMITS.imageBytes / 1024 / 1024} MB; GIF vira animado.`}>
        <div className="flex items-center gap-5">
          <span className="k-chanfro grid size-20 shrink-0 place-items-center overflow-hidden border border-borda bg-terminal font-display text-24 font-bold text-texto-2">
            {guild.iconUrl ? <img src={guild.iconUrl} alt="" className="size-full object-cover" /> : iniciaisDe(guild.name)}
          </span>
          <div className="flex gap-2">
            <Botao carregando={trocandoIcone} icone={<ImagePlus className="size-4" strokeWidth={1.5} />} onClick={() => entrada.current?.click()}>
              Trocar o ícone
            </Botao>
            {guild.iconUrl ? (
              <Botao variante="fantasma" disabled={trocandoIcone} icone={<Trash2 className="size-4" strokeWidth={1.5} />} onClick={() => void trocarIcone(null)}>
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
              lerImagem(arquivo)
                .then((url) => trocarIcone(url))
                .catch((erro: unknown) => avisar.erro('Não deu para usar esta imagem', erro instanceof Error ? erro.message : undefined));
            }}
          />
        </div>
      </Bloco>

      <Bloco titulo="Nome e descrição">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (editado && nomeValido) void salvar();
          }}
        >
          <Campo
            rotulo="Nome do servidor"
            value={nome}
            maxLength={LIMITS.guildName.max}
            contador
            erro={nomeValido ? null : `Pelo menos ${LIMITS.guildName.min} caracteres.`}
            onChange={(e) => setNome(e.target.value)}
          />
          <AreaDeTexto
            rotulo="Descrição"
            value={descricao}
            maxLength={LIMITS.guildDescription.max}
            contador
            rows={3}
            dica="Aparece na página do convite, para quem ainda não entrou."
            onChange={(e) => setDescricao(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            {editado ? (
              <Botao
                variante="fantasma"
                disabled={salvando}
                onClick={() => {
                  setNome(guild.name);
                  setDescricao(guild.description ?? '');
                }}
              >
                Desfazer
              </Botao>
            ) : null}
            <Botao type="submit" variante="primario" carregando={salvando} disabled={!editado || !nomeValido}>
              Salvar
            </Botao>
          </div>
        </form>
      </Bloco>

      <Bloco titulo="Sobre">
        <Linha titulo="Dono">
          <span className="text-14 text-texto-2">{dono}</span>
        </Linha>
        <Linha titulo="Criado em">
          <span className="text-14 text-texto-2">{data(guild.createdAt)}</span>
        </Linha>
        <Linha titulo="Membros">
          <span className="font-mono text-13 text-texto-2">{guild.memberCount}</span>
        </Linha>
      </Bloco>
    </div>
  );
}
