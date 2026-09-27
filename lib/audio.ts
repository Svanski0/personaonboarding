export function encodePcm16(samples: Float32Array, inputRate: number): string {
  const ratio = inputRate / 16000;
  const output = new Int16Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let sample = start; sample < end; sample += 1) sum += samples[sample];
    const value = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    output[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  const bytes = new Uint8Array(output.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decodePcm16(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const samples = new DataView(bytes.buffer);
  const output = new Float32Array(bytes.length / 2);
  for (let i = 0; i < output.length; i += 1) output[i] = samples.getInt16(i * 2, true) / 32768;
  return output;
}
