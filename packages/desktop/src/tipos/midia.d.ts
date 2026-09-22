/**
 * Ajustes de midia que o navegador ja tem, mas a biblioteca de tipos ainda nao.
 *
 * `voiceIsolation` existe no Chromium e foi MEDIDO funcionando nesta versao do
 * Electron — pedir liga, e `getSettings()` confirma. So a definicao de tipos
 * do TypeScript ainda nao acompanhou, e sem isto o compilador recusa tanto
 * pedir quanto ler o resultado.
 *
 * Fica aqui, e nao como `as any` espalhado pelas chamadas, porque o problema e
 * de DEFINICAO e nao de logica: um `any` na hora de pedir tambem engoliria um
 * nome escrito errado, e um nome errado num ajuste de midia falha calado — o
 * navegador ignora o que nao conhece, sem erro nenhum.
 *
 * Pode sair quando a lib do TypeScript incluir o campo.
 */

interface MediaTrackConstraintSet {
  /**
   * Isolamento de voz: separa a voz de quem fala do resto do som.
   *
   * Nao confundir com `noiseSuppression`. Aquele estima um piso de ruido e o
   * subtrai — funciona para som constante, como ventilador, e falha em som que
   * aparece e some, como teclado. Este reconhece VOZ e descarta o que nao for.
   */
  voiceIsolation?: ConstrainBoolean;
}

interface MediaTrackSettings {
  /** O que o navegador REALMENTE ligou; pode ser diferente do que foi pedido. */
  voiceIsolation?: boolean;
}

interface MediaTrackSupportedConstraints {
  voiceIsolation?: boolean;
}

interface MediaTrackCapabilities {
  voiceIsolation?: boolean[];
}
