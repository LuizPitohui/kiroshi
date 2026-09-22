import { useEffect } from 'react';
import { voice } from '../voice/controller.js';

/**
 * Push-to-talk.
 *
 * Duas camadas, porque nenhuma sozinha cobre o caso de uso:
 *
 *  - Com a janela do Kiroshi em foco, ouvimos keydown e keyup e abrimos o
 *    microfone enquanto a tecla estiver pressionada. E o comportamento certo.
 *
 *  - Com outro programa em foco, que e o caso de quem esta jogando, o sistema
 *    nao entrega keyup para um atalho global. Entao o atalho registrado no
 *    processo principal alterna o microfone a cada toque. Nao e igual, mas
 *    funciona sem depender de modulo nativo de captura de teclado.
 */
export function usePushToTalk(): void {
  useEffect(() => {
    const settings = voice.getSettings();

    const accelerator = localStorage.getItem('kiroshi.ptt.accelerator') ?? '';
    if (accelerator) void window.kiroshi.pushToTalk.register(accelerator);

    const key = localStorage.getItem('kiroshi.ptt.key') ?? 'F8';

    const isTyping = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (voice.getSettings().inputMode !== 'push-to-talk') return;
      if (event.repeat) return;
      // Nao rouba a tecla de quem esta escrevendo uma mensagem.
      if (isTyping(event.target)) return;
      if (event.code !== key && event.key !== key) return;

      event.preventDefault();
      void voice.setPushToTalkActive(true);
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (voice.getSettings().inputMode !== 'push-to-talk') return;
      if (event.code !== key && event.key !== key) return;

      event.preventDefault();
      void voice.setPushToTalkActive(false);
    };

    // Perder o foco com a tecla pressionada deixaria o microfone aberto.
    const onBlur = (): void => {
      void voice.setPushToTalkActive(false);
    };

    const offToggle = window.kiroshi.pushToTalk.onToggle(() => {
      const state = voice.getState();
      void voice.setMuted(!state.selfMuted);
    });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    void settings;

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      offToggle();
    };
  }, []);
}
