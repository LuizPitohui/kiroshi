import { useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { Botao, BotaoIcone } from '../../design/primitivos/index.js';
import { deveReiniciarAgora, ouvirAtualizacao, prontaParaReiniciar, useAtualizacao } from '../../app/atualizacao.js';
import { useVoz } from './useVoz.js';

/**
 * "Versao nova pronta — Reiniciar agora", no alto da area principal (pedido do
 * dono em 2026-09-26: o botao so existia em Configuracoes > Sobre).
 *
 * Nada aparece enquanto baixa: o download e sozinho e nao impede nada. Pronta,
 * o aviso fica ate a pessoa decidir; "Depois" tira o aviso de cima e deixa o
 * selo na barra de titulo, que o traz de volta (e a versao entra de qualquer
 * jeito quando o Kiroshi fechar de vez).
 *
 * Numa chamada, reiniciar agora derruba a pessoa dela — entao o aviso diz, e
 * oferece reiniciar sozinho quando ela sair.
 */
export function AvisoDeVersaoNova(): React.JSX.Element | null {
  const atualizacao = useAtualizacao((s) => s.atualizacao);
  const dispensada = useAtualizacao((s) => s.dispensada);
  const aoSairDaChamada = useAtualizacao((s) => s.aoSairDaChamada);
  const emChamada = useVoz((v) => v.connected || v.connecting);
  const pronta = prontaParaReiniciar(atualizacao);

  useEffect(() => ouvirAtualizacao(), []);

  // "Quando eu sair da chamada": saiu, reinicia.
  useEffect(() => {
    if (deveReiniciarAgora(pronta, aoSairDaChamada, emChamada)) window.kiroshi.atualizacao.instalarEReiniciar();
  }, [pronta, aoSairDaChamada, emChamada]);

  if (!pronta || dispensada) return null;

  const { dispensar, reiniciarAoSairDaChamada } = useAtualizacao.getState();
  const versao = atualizacao?.versao ? `A versão ${atualizacao.versao} do Kiroshi está pronta.` : 'Uma versão nova do Kiroshi está pronta.';
  const explicacao = aoSairDaChamada
    ? 'O Kiroshi reinicia sozinho quando você sair da chamada.'
    : emChamada
      ? 'Reiniciar agora tira você da chamada.'
      : 'Reiniciar leva alguns segundos.';

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-borda border-l-2 border-l-acento bg-terminal px-4 py-2 text-13">
      <Download aria-hidden className="size-4 shrink-0 text-acento" strokeWidth={1.5} />
      <p className="min-w-0 flex-1 text-texto-2">
        <strong className="font-medium text-texto">{versao}</strong> {explicacao}
      </p>
      <div className="flex items-center gap-2">
        {emChamada && !aoSairDaChamada ? (
          <Botao tamanho="sm" onClick={() => reiniciarAoSairDaChamada(true)}>
            Quando eu sair da chamada
          </Botao>
        ) : null}
        {aoSairDaChamada ? (
          <Botao tamanho="sm" variante="fantasma" onClick={() => reiniciarAoSairDaChamada(false)}>
            Não reiniciar sozinho
          </Botao>
        ) : null}
        <Botao variante="primario" tamanho="sm" onClick={() => window.kiroshi.atualizacao.instalarEReiniciar()}>
          Reiniciar agora
        </Botao>
        <BotaoIcone
          rotulo="Depois (a versão nova entra quando o Kiroshi fechar de vez)"
          tamanho="sm"
          icone={<X className="size-4" strokeWidth={1.5} />}
          onClick={dispensar}
        />
      </div>
    </div>
  );
}
