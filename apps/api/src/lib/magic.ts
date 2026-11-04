/**
 * Content sniffing for uploads.
 *
 * The browser's `mimetype` is a client-supplied string: trusting it would let anyone
 * store an `.html`/`.svg` payload labeled as `image/png`. This checks the file's leading
 * bytes instead, so what the database records — and what the download route later sends
 * in `Content-Type` — matches what is actually stored.
 *
 * Only the types the product accepts are sniffed; everything else returns null and is
 * rejected by the upload route.
 */

export interface SniffedFile {
    mimeType: string;
    extension: string;
}

const SIGNATURES: { bytes: number[]; offset?: number; mime: string; ext: string }[] = [
    { bytes: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png', ext: 'png' },
    { bytes: [0xff, 0xd8, 0xff], mime: 'image/jpeg', ext: 'jpg' },
    { bytes: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif', ext: 'gif' },
    { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], mime: 'application/pdf', ext: 'pdf' },
    // ZIP container: covers .docx/.xlsx, which are zipped XML with distinct content.
    { bytes: [0x50, 0x4b, 0x03, 0x04], mime: 'application/zip', ext: 'zip' },
];

/** RIFF....WEBP */
function isWebp(head: Buffer): boolean {
    return head.length >= 12 && head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
}

/** Office Open XML parts carry this marker inside the first kilobyte. */
function isOoxml(buffer: Buffer): boolean {
    return buffer.subarray(0, 2048).includes('[Content_Types].xml');
}

function looksLikeText(buffer: Buffer): boolean {
    const head = buffer.subarray(0, 512);
    if (head.length === 0) return false;
    // Markup is text too, and exactly the kind we must not label as a document: a `.html`
    // or `.svg` payload that sniffs as acceptable is a stored-XSS candidate on download.
    if (head.subarray(0, 64).toString('ascii').trimStart().startsWith('<')) return false;
    // No NUL bytes and mostly printable/whitespace: a text document, not a binary blob.
    return !head.includes(0x00) && [...head].every((b) => b >= 0x20 || b === 0x09 || b === 0x0a || b === 0x0d);
}

/**
 * Identify a buffer, or return null when it is not one of the supported uploads.
 * `declared` (the client's MIME type) only breaks ties between two text formats.
 */
export function sniffFile(buffer: Buffer, declared?: string): SniffedFile | null {
    const head = buffer.subarray(0, 64);

    for (const sig of SIGNATURES) {
        const offset = sig.offset ?? 0;
        if (buffer.length < offset + sig.bytes.length) continue;
        if (!sig.bytes.every((byte, i) => buffer[offset + i] === byte)) continue;
        if (sig.mime === 'application/zip') {
            return isOoxml(buffer)
                ? { mimeType: ooxmlMime(declared), extension: ooxmlExtension(declared) }
                : { mimeType: 'application/zip', extension: 'zip' };
        }
        return { mimeType: sig.mime, extension: sig.ext };
    }

    if (isWebp(head)) return { mimeType: 'image/webp', extension: 'webp' };

    if (looksLikeText(buffer)) {
        if (declared === 'application/json') return { mimeType: 'application/json', extension: 'json' };
        if (declared === 'text/csv') return { mimeType: 'text/csv', extension: 'csv' };
        return { mimeType: 'text/plain', extension: 'txt' };
    }

    // Unrecognized: the upload route turns this into "Unsupported file type", and the
    // sniffed result (never `declared`) is what ends up in the database.
    return null;
}

/** A zipped OOXML file is still a Word or an Excel document to the user; keep that label. */
function ooxmlMime(declared?: string): string {
    return declared === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        declared === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ? declared
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function ooxmlExtension(declared?: string): string {
    return declared === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ? 'xlsx' : 'docx';
}

/** Safe `Content-Disposition` filename: no quotes, no path, no control characters. */
export function safeFilename(filename: string, extension: string): string {
    // A raw \n or \r reaching a Content-Disposition would break the response line, so the
    // control range is exactly what gets stripped here.
    const cleaned = filename
        // eslint-disable-next-line no-control-regex
        .replace(/[\\/"\u0000-\u001f]/g, ' ')
        .replace(/\.[^.]*$/, '')
        .trim()
        .slice(0, 120);
    return `${cleaned || 'file'}.${extension}`;
}
