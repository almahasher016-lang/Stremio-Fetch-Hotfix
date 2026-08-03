import { decodeHTML } from 'entities';

const PROTECTED = new Map([
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['&', '&amp;'],
]);

function protectEncodedLiterals(value) {
  const protectedValues = [];
  const text = String(value || '').replace(/&(?:lt|gt|amp|#0*(?:38|60|62)|#x0*(?:26|3c|3e));/gi, entity => {
    const decoded = decodeHTML(entity);
    const replacement = PROTECTED.get(decoded);
    if (!replacement) return entity;
    const token = `\uE000${protectedValues.length}\uE001`;
    protectedValues.push(replacement);
    return token;
  });
  return { text, protectedValues };
}

export function cleanSubtitleMarkup(value) {
  const protectedInput = protectEncodedLiterals(value);
  let text = protectedInput.text
    .replace(/\{\\[^}]+}/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:i|b|u|s|font|c|ruby|rt|v|lang|span)(?:\s[^>]*)?>/gi, '')
    .replace(/<\/?[A-Za-z][^>\r\n]*>/g, '')
    .replace(/<\d{1,2}:\d{2}:\d{2}[.,]\d+>/g, '');
  text = decodeHTML(text);
  protectedInput.protectedValues.forEach((replacement, index) => {
    text = text.replaceAll(`\uE000${index}\uE001`, replacement);
  });
  return text.replace(/\u00A0/g, ' ').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/gm, '');
}
