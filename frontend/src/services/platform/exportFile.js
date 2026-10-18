// Export text files (GPX / CSV) so they work both in the browser and inside the
// Capacitor iOS/Android WebView.
//
// Why this exists:
//   - In a Capacitor WKWebView an <a download> with a blob URL does nothing, so
//     on native we write the file and open the share sheet (Filesystem + Share).
//   - WebKit's Blob constructor can throw "Provided data is inadequate" for some
//     strings, so we always hand it UTF-8 bytes from TextEncoder (which replaces
//     any lone surrogate instead of failing).

import { isNativePlatform } from '../bluetooth/index.js';

/** Strip characters that are illegal in file names. */
export function sanitizeFilename(name, fallback = 'inlap') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

export function textBytes(text) {
  return new TextEncoder().encode(String(text ?? ''));
}

/** Is a Capacitor plugin actually present in this build? */
export function pluginAvailable(name) {
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  try {
    if (cap && typeof cap.isPluginAvailable === 'function') return !!cap.isPluginAvailable(name);
    if (cap && cap.Plugins) return !!cap.Plugins[name];
  } catch (_) {
    return false;
  }
  return false;
}

function webDownload(filename, bytes, mime) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new Error('La descarga de archivos no está disponible en este entorno.');
  }
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch (_) {
      /* ignore */
    }
  }, 10000);
}

/**
 * Export a text file. On native it writes to the app cache and opens the share
 * sheet; on the web it triggers a download. Never throws without a useful
 * message: the error text is propagated to the UI.
 * @returns {Promise<{ via: 'share'|'download'|'download-fallback', filename: string, uri?: string, warning?: string }>}
 */
export async function exportTextFile(filename, text, mime) {
  const safeName = sanitizeFilename(filename);
  const bytes = textBytes(text);

  if (!isNativePlatform()) {
    webDownload(safeName, bytes, mime);
    return { via: 'download', filename: safeName };
  }

  // Native: Filesystem + Share. Report clearly if the plugins are missing.
  let nativeError = null;
  try {
    const missing = ['Filesystem', 'Share'].filter((p) => !pluginAvailable(p));
    if (missing.length) {
      throw new Error(
        `Esta build de la app no incluye ${missing.join(' y ')}. Reinstala el .ipa nuevo.`,
      );
    }
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const written = await Filesystem.writeFile({
      path: safeName,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    try {
      await Share.share({
        title: safeName,
        text: 'Exportado desde InLap',
        url: written.uri,
        dialogTitle: 'Guardar o compartir',
      });
    } catch (_) {
      // The user may dismiss the share sheet; the file is already written.
    }
    return { via: 'share', filename: safeName, uri: written.uri };
  } catch (err) {
    nativeError = err;
  }

  // Fallback: try the browser download (works on some Android WebViews).
  try {
    webDownload(safeName, bytes, mime);
    return {
      via: 'download-fallback',
      filename: safeName,
      warning: String((nativeError && nativeError.message) || nativeError),
    };
  } catch (_) {
    throw new Error(
      `No se pudo exportar: ${String((nativeError && nativeError.message) || nativeError)}`,
    );
  }
}
