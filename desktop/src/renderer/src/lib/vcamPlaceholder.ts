/**
 * Draws the "camera is not streaming" card that the Windows virtual camera
 * shows while Facecam is idle. Without it the bundled DirectShow filter paints
 * its own green "no sender" pattern, which looks like a broken camera.
 */
const PLACEHOLDER_WIDTH = 1280;
const PLACEHOLDER_HEIGHT = 720;

let installed = false;

export function installVcamPlaceholder(): void {
  if (installed) return;
  installed = true;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = PLACEHOLDER_WIDTH;
    canvas.height = PLACEHOLDER_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = PLACEHOLDER_WIDTH;
    const height = PLACEHOLDER_HEIGHT;
    const middle = width / 2;

    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#0a1020');
    background.addColorStop(0.55, '#101a30');
    background.addColorStop(1, '#0b1424');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    // Soft glow behind the glyph.
    const glow = ctx.createRadialGradient(middle, height / 2 - 120, 20, middle, height / 2 - 120, 320);
    glow.addColorStop(0, 'rgba(86,132,255,0.28)');
    glow.addColorStop(1, 'rgba(86,132,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // Camera glyph.
    ctx.strokeStyle = 'rgba(150,182,255,0.92)';
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.roundRect(middle - 84, height / 2 - 214, 140, 104, 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(middle + 56, height / 2 - 186);
    ctx.lineTo(middle + 112, height / 2 - 214);
    ctx.lineTo(middle + 112, height / 2 - 110);
    ctx.lineTo(middle + 56, height / 2 - 138);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#eaf1ff';
    ctx.font = '600 62px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Connectivity Camera', middle, height / 2 + 18);
    ctx.fillStyle = '#a8bce0';
    ctx.font = '400 38px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Start Facecam in the Connectivity app', middle, height / 2 + 84);
    ctx.fillStyle = '#7188ad';
    ctx.font = '400 30px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('to stream your tablet camera here', middle, height / 2 + 132);

    const pixels = ctx.getImageData(0, 0, width, height).data;
    void window.sc
      .vcamPlaceholder(pixels.buffer as ArrayBuffer, width, height)
      .catch(() => undefined);
  } catch {
    // The virtual camera falls back to a plain dark frame in the main process.
  }
}
