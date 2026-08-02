import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerStyledSubtitleRoutes } from '../api/routes/subtitles.js';
import { stabilizeArabicStyledSubtitle } from '../utils/styledArabicBidi.js';

const RLM = '\u200F';
const RLI = '\u2067';
const PDI = '\u2069';

const STYLED_FIXTURE = `[Script Info]
Title: عنوان عربي!

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Arabic,Tahoma,54,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,40,40,55,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
Dialogue: 0,0:00:01.00,0:00:03.00,Arabic,,0,0,0,,{\\an8\\c&H00FF00&}شاهدت (الحلقة) أمس\\Nمرحبا بالعالم.
Comment: 0,0:00:01.00,0:00:03.00,Arabic,,0,0,0,,شاهدت (الحلقة) أمس
Dialogue: 0,0:00:04.00,0:00:06.00,Arabic,,0,0,0,,{\\k20}مر{\\k20}حبا!
Dialogue: 0,0:00:07.00,0:00:09.00,Arabic,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}{\\an8}انتبه!
`;

test('styled BiDi stabilization edits Dialogue.Text only and preserves ASS syntax', () => {
  const result = stabilizeArabicStyledSubtitle(STYLED_FIXTURE);

  assert.match(result, /^Title: عنوان عربي!$/mu);
  assert.match(result, /^Style: Arabic,Tahoma,54,/mu);
  assert.ok(result.includes('{\\an8\\c&H00FF00&}' + RLI + 'شاهدت (الحلقة) أمس' + PDI + '\\Nمرحبا بالعالم.' + RLM));
  assert.match(result, /^Comment: .*شاهدت \(الحلقة\) أمس$/mu);
  assert.ok(result.includes('{\\k20}مر{\\k20}حبا!' + RLM));
  assert.ok(result.includes('{\\p1}m 0 0 l 10 10{\\p0}{\\an8}انتبه!' + RLM));
  assert.doesNotMatch(result, new RegExp(`${RLM}m 0 0 l 10 10`, 'u'));
  assert.equal(stabilizeArabicStyledSubtitle(result), result);
});

test('styled BiDi stabilization honors SSA event field order and visual line breaks', () => {
  const source = `[Script Info]
ScriptType: v4.00

[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: Marked=0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\an7}(مرحبا)\\nهل أنت بخير؟
`;
  const result = stabilizeArabicStyledSubtitle(source);
  assert.ok(result.includes('{\\an7}' + RLI + '(مرحبا)' + PDI + '\\nهل أنت بخير؟' + RLM));
  assert.match(result, /^Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text$/mu);
});

test('styled BiDi stabilization leaves dialogue untouched when an explicit format has no Text field', () => {
  const source = '[Events]\nFormat: Layer, Start, End, Style\nDialogue: 0,0:00:01.00,0:00:03.00,مرحبا!\n';
  assert.equal(stabilizeArabicStyledSubtitle(source), source);
});

test('actual ASS and SSA styled proxy routes return direction-stabilized Dialogue text', async t => {
  const app = express();
  registerStyledSubtitleRoutes(app, {
    resolver: async token => ({
      text: STYLED_FIXTURE,
      encoding: 'utf-8',
      format: token,
      archive: 'zip',
      archiveEntry: `subtitle.${token}`,
      cache: 'miss',
    }),
  });
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));

  const server = app.listen(0);
  t.after(() => new Promise(resolve => {
    server.close(resolve);
  }));
  await new Promise(resolve => {
    server.once('listening', resolve);
  });
  const { port } = server.address();

  for (const format of ['ass', 'ssa']) {
    const response = await fetch(`http://127.0.0.1:${port}/proxy/styled/${format}.${format}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-source-format'), format);
    assert.equal(response.headers.get('x-source-archive-entry'), `subtitle.${format}`);
    assert.match(response.headers.get('content-disposition') || '', new RegExp(`subtitle\\.${format}`));
    assert.equal(await response.text(), stabilizeArabicStyledSubtitle(STYLED_FIXTURE));
  }
});
