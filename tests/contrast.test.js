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
test('暗色テーマの文字と主要操作・削除操作が4.5:1以上', () => {
  const pairs = [
    ['#f2f6f8', '#141e25'], ['#bfccd3', '#141e25'],
    ['#bfccd3', '#0b1014'], ['#082429', '#25d1da'],
    ['#ffb8ae', '#1b2932'], ['#a9b9c3', '#172127'],
  ];
  for (const [text, background] of pairs) {
    assert.ok(css.includes(text) && css.includes(background), 'Checked palette must exist in stylesheet');
    assert.ok(contrast(text, background) >= 4.5, `${text} on ${background}`);
  }
});
test('フォーカス枠・操作境界が隣接背景に対して3:1以上', () => {
  for (const [color, background] of [['#6be6ed', '#141e25'], ['#788c97', '#1b2932'], ['#596d78', '#141e25']]) {
    assert.ok(css.includes(color) && css.includes(background));
    assert.ok(contrast(color, background) >= 3, `${color} on ${background}`);
  }
});
