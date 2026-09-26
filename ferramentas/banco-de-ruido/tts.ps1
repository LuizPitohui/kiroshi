# Fala limpa para a bancada do F3: voz sintetica do proprio Windows (sem download).
# Maria (pt-BR) le frases de chamada de jogo; Zira (en-US) vira a "conversa ao fundo".
param([string]$Pasta = $PSScriptRoot)
Add-Type -AssemblyName System.Speech
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

function Falar([string]$voz, [string]$ssml, [string]$arquivo) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice($voz)
  $s.SetOutputToWaveFile((Join-Path $Pasta $arquivo), $fmt)
  $s.SpeakSsml($ssml)
  $s.Dispose()
}

$frases = @(
  'Pessoal, tem um cara no telhado do lado esquerdo.',
  'Espera, espera, deixa eu recarregar antes de entrar.',
  'Alguem tem kit medico sobrando? Estou com pouca vida.',
  'Vou pela ponte, me cobre daqui a pouco.',
  'Boa! Pegamos o objetivo, agora segura a posicao.',
  'Nao sei se voces estao me ouvindo direito, testa ai.',
  'Amanha a gente joga de novo, umas nove da noite.',
  'Cuidado com a granada, ela caiu bem do seu lado.'
)
$corpo = ($frases | ForEach-Object { "<s>$_</s><break time='900ms'/>" }) -join ''
$ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='pt-BR'><break time='800ms'/>$corpo</speak>"
Falar 'Microsoft Maria Desktop' $ssml 'fala-maria.wav'

$ingles = @(
  'So anyway, I told him the meeting was moved to Thursday, but he never checked his email.',
  'Did you see the game last night? The second half was completely different.',
  'We should order something, I am starving and there is nothing in the fridge.',
  'Honestly the new season is better than I expected, the ending surprised me.',
  'Can you pass me the charger? My phone is almost dead again.'
)
$corpo2 = ($ingles | ForEach-Object { "<s>$_</s><break time='250ms'/>" }) -join ''
$ssml2 = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>$corpo2</speak>"
Falar 'Microsoft Zira Desktop' $ssml2 'conversa-zira.wav'
'ok'
