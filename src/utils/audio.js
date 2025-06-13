const ffmpegPath = require('ffmpeg-static');
const ffmpeg     = require('fluent-ffmpeg');
const { file: tmpFile } = require('tmp-promise');
const fs = require('fs/promises');

ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Convierte un archivo de audio (webm/ogg/mpga/lo que sea) a MP3.
 * Devuelve la **ruta** del nuevo .mp3.  Borra el archivo de entrada si se pide.
 */
async function toMp3(inputPath, autoClean = true) {
  const { path: mp3Path } = await tmpFile({ postfix: '.mp3' });

  await new Promise((ok, err) => {
    ffmpeg(inputPath)
      .audioCodec('libmp3lame')
      .format('mp3')
      .on('end', ok)
      .on('error', err)
      .save(mp3Path);
  });

  if (autoClean) {
    try { await fs.unlink(inputPath); } catch {/* nada */}
  }
  return mp3Path;
}

module.exports = { toMp3 };
