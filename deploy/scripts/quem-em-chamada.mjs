// Quem esta em chamada agora, perguntando direto ao SFU.
//
// Existe para uma pergunta so, feita antes de qualquer deploy: tem gente em
// voz? Reiniciar o LiveKit derruba todo mundo que estiver em chamada, e
// reiniciar a API apaga os estados de voz do banco com as salas do SFU ainda
// vivas — as pessoas continuam se ouvindo, mas somem da lista do canal.
//
// Roda DENTRO do container da API, que ja tem o SDK e as credenciais no
// ambiente. Nada e gravado nem alterado: so listRooms e listParticipants.
//
//   ssh <host> 'docker exec -i -w /app kiroshi-api node --input-type=module -' < deploy/scripts/quem-em-chamada.mjs
//
// Imprime so contagens, nunca quem e quem.

import { RoomServiceClient } from 'livekit-server-sdk';

const url = process.env.LIVEKIT_URL?.replace(/^ws/, 'http');
if (!url || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
  console.error('LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET precisam estar no ambiente.');
  process.exit(2);
}

const sfu = new RoomServiceClient(url, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const salas = await sfu.listRooms();

let pessoas = 0;
let transmitindo = 0;
for (const sala of salas) {
  const participantes = await sfu.listParticipants(sala.name);
  // TrackSource.SCREEN_SHARE e 3 no protocolo; o SDK pode devolver o numero ou o nome.
  const comTela = participantes.filter((p) =>
    p.tracks.some((t) => String(t.source) === '3' || t.source === 'SCREEN_SHARE'),
  ).length;
  pessoas += participantes.length;
  transmitindo += comTela;
  console.log(`${sala.name}: ${participantes.length} pessoa(s), ${comTela} transmitindo`);
}

console.log(`TOTAL: ${salas.length} sala(s), ${pessoas} pessoa(s), ${transmitindo} transmitindo`);
// Codigo de saida util para script: 0 = vazio, 1 = tem gente.
process.exit(pessoas > 0 ? 1 : 0);
