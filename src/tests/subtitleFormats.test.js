import test from 'node:test';
import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { processSubtitleBuffer } from '../utils/subtitleProcessor.js';
import { decodeSubtitleBuffer } from '../utils/subtitleEncoding.js';

function process(text, options = {}) {
  return processSubtitleBuffer(Buffer.from(text), options);
}

test('TTML and DFXP convert text, inherited markup, frames, ticks, and entities', () => {
  const input = `<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="25" ttp:tickRate="100">
  <body><div>
    <p begin="00:00:01.500" end="00:00:03.250">مرحبا <span>بك</span><br/>اليوم &amp; غدًا</p>
    <p begin="100t" dur="50f">سطر ثان</p>
  </div></body>
</tt>`;
  const result = process(input);
  assert.equal(result.format, 'ttml');
  assert.match(result.text, /00:00:01,500 --> 00:00:03,250/);
  assert.match(result.text, /مرحبا بك\nاليوم & غدًا/);
  assert.match(result.text, /00:00:01,000 --> 00:00:03,000/);
});

test('unsafe XML declarations are rejected instead of expanded', () => {
  const input = '<!DOCTYPE tt [<!ENTITY x "مرحبا">]><tt><body><p begin="1s" end="2s">&x;</p></body></tt>';
  assert.equal(process(input).text.trim(), '');
});

test('SAMI selects the Arabic language alternative and uses adjacent Sync boundaries', () => {
  const input = `<SAMI><BODY>
<SYNC Start=1000><P Class=ENCC>Hello</P><P Class=ARCC>مرحبا بك</P>
<SYNC Start=3500><P Class=ENCC>Goodbye</P><P Class=ARCC>إلى اللقاء</P>
</BODY></SAMI>`;
  const result = process(input);
  assert.equal(result.format, 'sami');
  assert.match(result.text, /00:00:01,000 --> 00:00:03,500\nمرحبا بك/);
  assert.doesNotMatch(result.text, /Hello|Goodbye/);
});

test('MicroDVD requires a trustworthy FPS and supports its embedded FPS header', () => {
  const embedded = process('{1}{1}25.000\n{25}{50}مرحبا|بك');
  assert.equal(embedded.format, 'microdvd');
  assert.match(embedded.text, /00:00:01,000 --> 00:00:02,000\nمرحبا\nبك/);

  const contextual = process('{24}{48}سطر عربي', { frameRate: 24 });
  assert.match(contextual.text, /00:00:01,000 --> 00:00:02,000/);
  assert.equal(process('{24}{48}سطر عربي').text.trim(), '');
});

test('MPL2, SubViewer/SBV, LRC, and RealText convert into normalized SRT', () => {
  const samples = [
    ['[10][25]/مرحبا|بك', 'mpl2', '00:00:01,000 --> 00:00:02,500'],
    ['00:00:01.20,00:00:02.75\nمرحبا بك', 'subviewer', '00:00:01,200 --> 00:00:02,750'],
    ['[00:01.20]مرحبا\n[00:03.40]أهلا', 'lrc', '00:00:01,200 --> 00:00:03,400'],
    ['<window><time begin="00:01.20" end="00:02.75">مرحبا<br>بك</window>', 'realtext', '00:00:01,200 --> 00:00:02,750'],
  ];
  for (const [input, format, timing] of samples) {
    const result = process(input);
    assert.equal(result.format, format);
    assert.match(result.text, new RegExp(timing.replaceAll('.', '\\.')));
    assert.match(result.text, /مرحبا/);
  }
});

test('YouTube transcript XML converts numeric timing and decoded text', () => {
  const result = process('<transcript><text start="1.25" dur="2.5">مرحبا &amp; أهلا</text></transcript>');
  assert.equal(result.format, 'youtube-xml');
  assert.match(result.text, /00:00:01,250 --> 00:00:03,750/);
  assert.match(result.text, /مرحبا & أهلا/);
});

test('legacy Arabic encodings are decoded without treating them as Windows-1256 aliases', () => {
  const source = '1\n00:00:01,000 --> 00:00:02,000\nمرحبا بك\n';
  for (const encoding of ['windows-1256', 'iso-8859-6', 'cp720']) {
    const decoded = decodeSubtitleBuffer(iconv.encode(source, encoding));
    assert.equal(decoded.encoding, encoding);
    assert.match(decoded.text, /مرحبا بك/);
  }

  const prefix = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n');
  const cp864 = decodeSubtitleBuffer(Buffer.concat([prefix, Buffer.from([0xe5, 0xd1, 0xcd, 0xc8, 0xa8])]));
  assert.equal(cp864.encoding, 'cp864');
  assert.match(cp864.text, /مرحبا/);

  const macArabic = decodeSubtitleBuffer(Buffer.from([0xf3, 0x20, 0xf8]), { encodingHint: 'mac-arabic' });
  assert.equal(macArabic.encoding, 'mac-arabic');
  assert.equal(macArabic.text, 'پ گ');
});

test('UTF-32 subtitles with and without byte-order marks do not fall through to UTF-16', () => {
  const source = '1\n00:00:01,000 --> 00:00:02,000\nمرحبا\n';
  const encode = littleEndian => {
    const bytes = Buffer.alloc([...source].length * 4);
    [...source].forEach((character, index) => {
      const code = character.codePointAt(0);
      if (littleEndian) bytes.writeUInt32LE(code, index * 4);
      else bytes.writeUInt32BE(code, index * 4);
    });
    return bytes;
  };
  for (const littleEndian of [true, false]) {
    const raw = encode(littleEndian);
    const bom = littleEndian ? Buffer.from([0xff, 0xfe, 0x00, 0x00]) : Buffer.from([0x00, 0x00, 0xfe, 0xff]);
    const expected = littleEndian ? 'utf-32le' : 'utf-32be';
    assert.equal(decodeSubtitleBuffer(raw).encoding, expected);
    assert.equal(decodeSubtitleBuffer(Buffer.concat([bom, raw])).encoding, expected);
    assert.match(processSubtitleBuffer(raw).text, /مرحبا/);
  }
});

test('HTML entities are decoded safely and encoded literal tags stay literal', () => {
  const input = `1
00:00:01.5 --> 00:00:02.123456
<i>مرحبا&nbsp;بك</i> &rlm; &lt;i&gt;نص&lt;/i&gt; &#60;b&#62;حرفي&#60;/b&#62; &#x1F44B; ①
`;
  const result = process(input);
  assert.match(result.text, /00:00:01,500 --> 00:00:02,123/);
  assert.match(result.text, /مرحبا بك &lt;i&gt;نص&lt;\/i&gt; &lt;b&gt;حرفي&lt;\/b&gt; 👋 ①/);
  assert.doesNotMatch(result.text, /[\u200E\u200F\u202A-\u202E\u2066-\u2069]{2,}/u);
  assert.doesNotMatch(result.text, /<i>مرحبا/);
});
