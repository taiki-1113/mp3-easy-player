import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../docs/style.css', import.meta.url), 'utf8');
function luminance(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
const palettes = [...css.matchAll(/:root\s*\{([^}]+)\}/g)].map(match =>
  Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)].map(value => [value[1], value[2]])));
assert.equal(palettes.length, 2, 'Both light and dark palette must be checked');
for (const [index, palette] of palettes.entries()) {
  const theme = index === 0 ? '明色' : '暗色';
  test(`${theme}の文字・補足・主要操作・削除操作が7:1以上`, () => {
    const pairs = [
      ...['panel', 'page', 'control', 'hover', 'player', 'selected', 'result'].flatMap(background => [['text', background], ['muted', background]]),
      ['accent-text', 'accent'], ['accent-text', 'accent-hover'],
      ['danger', 'control'], ['danger', 'danger-hover'],
      ['disabled-text', 'disabled-bg'],
    ];
    for (const [text, background] of pairs) {
      assert.ok(contrast(palette[text], palette[background]) >= 7, `${theme}: ${text} on ${background}`);
    }
  });
  test(`${theme}のフォーカス枠・操作境界が3:1以上`, () => {
    const pairs = ['panel', 'page', 'player'].flatMap(background => [['focus', background], ['border', background], ['line', background]]);
    pairs.push(['border', 'control'], ['accent', 'selected']);
    for (const [color, background] of pairs) assert.ok(contrast(palette[color], palette[background]) >= 3, `${theme}: ${color} on ${background}`);
  });
}
