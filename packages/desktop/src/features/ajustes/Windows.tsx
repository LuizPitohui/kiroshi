import { useEffect, useState } from 'react';
import type { PreferenciasDoApp } from '../../../electron/preload.js';
import { LinhaDeInterruptor } from '../../design/primitivos/index.js';
import { usePreferenciasDoApp } from '../../app/preferenciasDoApp.js';
import { Bloco } from './partes.js';

/**
 * Windows: iniciar junto, abrir escondido e o que o X faz.
 *
 * Iniciar com o Windows estava quebrado na 1.x: gravado com um argumento e
 * lido sem ele, o interruptor voltava desligado a cada reabertura, e a janela
 * aparecia mesmo pedindo para abrir escondida (electron/main.ts).
 */
export function PaginaWindows() {
  const [inicia, setInicia] = useState<boolean | null>(null);
  const preferencias = usePreferenciasDoApp((s) => s.preferencias);
  const gravarPreferencias = usePreferenciasDoApp((s) => s.gravar);

  useEffect(() => {
    void window.kiroshi?.autostart.get().then(setInicia);
    void usePreferenciasDoApp.getState().carregar();
  }, []);

  const gravar = (patch: Partial<PreferenciasDoApp>) => gravarPreferencias(patch);

  return (
    <div className="space-y-8">
      <Bloco titulo="Ao entrar no Windows">
        <LinhaDeInterruptor
          titulo="Iniciar com o Windows"
          descricao="O Kiroshi abre sozinho quando você entra no computador, pronto para receber mensagens e chamadas."
          ligado={inicia ?? false}
          desativado={inicia === null}
          aoMudar={(ligado) => void window.kiroshi?.autostart.set(ligado).then(setInicia)}
        />
        <LinhaDeInterruptor
          titulo="Abrir escondido na bandeja"
          descricao="Iniciando com o Windows, fica perto do relógio sem abrir a janela."
          ligado={preferencias?.iniciarEscondido ?? true}
          desativado={!preferencias || !inicia}
          aoMudar={(ligado) => void gravar({ iniciarEscondido: ligado })}
        />
      </Bloco>
      <Bloco titulo="Ao fechar a janela">
        <LinhaDeInterruptor
          titulo="Fechar para a bandeja"
          descricao="O X esconde a janela e o Kiroshi segue rodando — chamadas e notificações continuam. Desligado, o X fecha o app de vez."
          ligado={preferencias?.fecharParaBandeja ?? true}
          desativado={!preferencias}
          aoMudar={(ligado) => void gravar({ fecharParaBandeja: ligado })}
        />
      </Bloco>
    </div>
  );
}
