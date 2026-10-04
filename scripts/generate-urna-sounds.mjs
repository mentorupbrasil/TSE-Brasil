/**
 * Gera réplica opcional do pilili (fim de ciclo).
 * Confirmação por cargo: use o arquivo oficial assets/sounds/confirma-urna.mp3
 */
import fs from "node:fs";
import path from "node:path";

const SR = 44100;
const OUT = path.join(process.cwd(), "assets", "sounds");

function writeWav(name, pcmFloat) {
  for (let i = 0; i < pcmFloat.length; i++) pcmFloat[i] = Math.tanh(pcmFloat[i] * 1.05);
  const int16 = Buffer.alloc(pcmFloat.length * 2);
  for (let i = 0; i < pcmFloat.length; i++) {
    const v = Math.max(-1, Math.min(1, pcmFloat[i]));
    int16.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const dataSize = int16.length;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  int16.copy(buf, 44);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log("wrote", name, buf.length, "bytes");
}

/** Sequência "pilili" ao encerrar o ciclo completo de votação. */
function synthPilili() {
  const seq = [
    { f: 523.25, d: 0.072, gap: 0.038 },
    { f: 659.25, d: 0.072, gap: 0.038 },
    { f: 783.99, d: 0.072, gap: 0.038 },
    { f: 987.77, d: 0.095, gap: 0 }
  ];
  const total = seq.reduce((s, x) => s + x.d + x.gap, 0);
  const pcm = new Float32Array(Math.ceil(total * SR));
  let offset = 0;
  for (const note of seq) {
    const n = Math.floor(note.d * SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const attack = Math.min(1, i / (SR * 0.002));
      const decay = Math.exp(-t * 22);
      const env = attack * decay;
      const s =
        Math.sin(2 * Math.PI * note.f * t) * 0.75 +
        Math.sin(2 * Math.PI * note.f * 2 * t) * 0.07;
      pcm[offset + i] += s * env * 0.48;
    }
    offset += n + Math.floor(note.gap * SR);
  }
  return pcm;
}

writeWav("urna-pilili.wav", synthPilili());
