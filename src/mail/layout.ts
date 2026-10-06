import { escapeHtml } from '../common/html.js';

/** Marco común de los correos: cabecera navy, contenido blanco y pie con datos de la empresa. */
export function mailLayout(opts: {
  title: string;
  body: string;
  footer: string;
}): string {
  return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px;background:#f3f5fc;font-family:Arial,Helvetica,sans-serif;color:#1a1f3d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
    <tr><td style="background:#041c7b;color:#ffffff;padding:20px 28px;font-size:20px;font-weight:bold">${escapeHtml(opts.title)}</td></tr>
    <tr><td style="padding:24px 28px;font-size:15px;line-height:1.55">${opts.body}</td></tr>
    <tr><td style="padding:16px 28px;background:#e9eefb;color:#4f5780;font-size:12px;line-height:1.5">${opts.footer}</td></tr>
  </table>
</body>
</html>`;
}

/** Tabla de pares etiqueta/valor; los valores se escapan. */
export function mailTable(
  rows: [string, string | number | null | undefined][],
): string {
  const cells = rows
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== '',
    )
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#4f5780;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:6px 0;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">${cells}</table>`;
}
