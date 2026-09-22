import type { PresenceStatus } from '@kiroshi/shared';
import { Avatar } from '../Avatar.js';

/**
 * O cartao de perfil, como as outras pessoas veem voce.
 *
 * Existe porque editar perfil sem ver o resultado e adivinhar. Os campos
 * ficavam em uma coluna de formulario — nome aqui, pronomes ali, biografia
 * mais abaixo — e nada mostrava como aquilo se junta. O caso concreto: uma
 * biografia de 190 caracteres parece razoavel no campo de texto, que tem
 * quatro linhas de altura, e ocupa o cartao inteiro quando alguem clica no
 * seu nome.
 *
 * Por isso a previa recebe os valores sendo DIGITADOS, e nao os salvos: ela
 * responde "como vai ficar", nao "como esta". Sem isso seria preciso salvar
 * para descobrir, e salvar e justamente o que se quer evitar fazer no escuro.
 *
 * O mesmo cartao serve para ver o perfil de outra pessoa. Por isso ele nao
 * sabe nada sobre edicao: recebe valores e desenha.
 */

export interface ProfileCardProps {
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  bio?: string | null;
  pronouns?: string | null;
  /** Cor de destaque da pessoa, usada na faixa do topo quando nao ha imagem. */
  accentColor?: string | null;
  status?: PresenceStatus | null;
  /** Botoes de acao: conversar, adicionar, bloquear. */
  acoes?: React.ReactNode;
}

export function ProfileCard({
  displayName,
  username,
  avatarUrl,
  bannerUrl,
  bio,
  pronouns,
  accentColor,
  status,
  acoes,
}: ProfileCardProps) {
  return (
    <article className="cartao-perfil" aria-label={`Perfil de ${displayName}`}>
      <div
        className="cartao-faixa"
        style={
          bannerUrl
            ? { backgroundImage: `url(${bannerUrl})` }
            : accentColor
              ? { background: accentColor }
              : undefined
        }
      />

      <div className="cartao-corpo">
        {/*
          O avatar monta sobre a faixa. O anel em volta nao e enfeite: sem ele
          um avatar escuro sobre uma faixa escura vira uma mancha, e e
          exatamente o que acontece com a cor padrao do tema.
        */}
        <Avatar
          url={avatarUrl}
          name={displayName}
          size={72}
          status={status}
          className="cartao-avatar"
        />

        <div className="cartao-nomes">
          <h3 className="cartao-exibicao">{displayName}</h3>
          <p className="cartao-usuario">
            @{username}
            {pronouns && <span className="cartao-pronomes"> · {pronouns}</span>}
          </p>
        </div>

        {/*
          A biografia preserva as quebras de linha que a pessoa escreveu. Sem
          isso, tres linhas curtas viram um paragrafo so e a formatacao que ela
          viu no campo some no cartao.
        */}
        {bio && <p className="cartao-bio">{bio}</p>}

        {acoes && <div className="cartao-acoes">{acoes}</div>}
      </div>
    </article>
  );
}
