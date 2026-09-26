// As chamadas agora, vistas do SFU: quem publica o que (codec, camadas e
// tetos de cada transmissao) e quem assiste quem (pelo atributo `assistindo`
// que o app publica). SO LEITURA: listRooms e listParticipants.
//
// Roda dentro do container da API. Pessoas viram P1, P2... na ordem de entrada:
// nada de nome ou id na saida.
//
//   ssh <host> 'docker exec -i -w /app kiroshi-api node --input-type=module -' < deploy/scripts/transmissoes.mjs
//
// Para a banda que cada um manda de verdade, ver 08-producao.md (tcpdump na
// porta 7881, por remetente, sem enderecos).
import { RoomServiceClient } from 'livekit-server-sdk';

const base = process.env.LIVEKIT_API_URL || process.env.LIVEKIT_URL?.replace(/^ws/, 'http');
const sfu = new RoomServiceClient(base, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);

const FONTE = { 0: '?', 1: 'camera', 2: 'microfone', 3: 'tela', 4: 'som da tela' };
const fonte = (s) => FONTE[s] ?? String(s).toLowerCase();
const QUALIDADE = { 0: 'baixa', 1: 'media', 2: 'alta' };
const agora = Date.now();

const salas = await sfu.listRooms();
if (salas.length === 0) console.log('nenhuma sala aberta');
for (const [n, sala] of salas.entries()) {
  const ps = [...(await sfu.listParticipants(sala.name))].sort((a, b) => Number(a.joinedAt) - Number(b.joinedAt));
  const rotulo = new Map(ps.map((p, i) => [p.identity, `P${i + 1}`]));
  const assiste = new Map(ps.map((p) => [p.identity, (p.attributes?.assistindo ?? '').split(',').filter(Boolean)]));
  const minutos = (s) => Math.round((agora / 1000 - Number(s)) / 60);
  console.log(`\nSALA ${n + 1}: ${ps.length} pessoa(s), aberta ha ${minutos(sala.creationTime)} min`);
  for (const p of ps) {
    const eu = rotulo.get(p.identity);
    const faixas = p.tracks.map((t) => {
      const partes = [fonte(t.source)];
      if (t.muted) partes.push('MUDO');
      if (t.type === 1 || t.type === 'VIDEO') {
        const camadas = (t.layers ?? [])
          .map((l) => `${QUALIDADE[l.quality] ?? l.quality} ${l.width}x${l.height}${l.bitrate ? ` ${Math.round(l.bitrate / 1000)}k` : ''}`)
          .join(' | ');
        partes.push(`${t.mimeType || '?'} ${t.width}x${t.height}${t.simulcast ? ' simulcast' : ''}${camadas ? ` [${camadas}]` : ''}`);
      } else {
        const recursos = (t.audioFeatures ?? []).map((f) => ({ 0: 'estereo', 1: 'sem-dtx' })[f] ?? f);
        partes.push(`${t.mimeType || '?'}${recursos.length ? ` (${recursos.join(', ')})` : ''}`);
      }
      return partes.join(' ');
    });
    const vendo = assiste.get(p.identity).map((id) => rotulo.get(id) ?? 'alguem de fora').join(', ');
    console.log(`  ${eu}: ha ${minutos(p.joinedAt)} min, estado ${p.state}${p.isPublisher ? ', publica' : ''}`);
    for (const f of faixas) console.log(`      - ${f}`);
    if (vendo) console.log(`      assiste: ${vendo}`);
  }
  for (const p of ps) {
    if (!p.tracks.some((t) => String(t.source) === '3' || t.source === 'SCREEN_SHARE')) continue;
    const quem = [...assiste.entries()].filter(([, lista]) => lista.includes(p.identity)).map(([id]) => rotulo.get(id));
    console.log(`  TRANSMISSAO de ${rotulo.get(p.identity)}: ${quem.length} assistindo (${quem.join(', ') || 'ninguem'})`);
  }
}
