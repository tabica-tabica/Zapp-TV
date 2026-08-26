// SRT usa vírgula nos milissegundos e não tem cabeçalho; VTT é quase o mesmo
// formato por baixo — a conversão é textual, não um parser de verdade, e é o
// suficiente pro que o <track> do navegador precisa pra desenhar os cues.
// Tags de estilo (<i>, <b>) passam intactas: VTT aceita as mesmas.

export function srtToVtt(srt: string): string {
    const body = srt
        .replace(/\r+/g, '')
        .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return `WEBVTT\n\n${body.trim()}\n`;
}
