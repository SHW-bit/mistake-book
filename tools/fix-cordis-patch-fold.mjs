#!/usr/bin/env node
// 修 cordis.patch.yml 里的「折行 plain 标量」。
//
// 背景：某些 YAML 序列化器会把长字符串按 ~80 列折成多行 plain 标量：
//     descriptionEn: DeepSeek flagship model, supporting 1M context window, native
//       multimodal model
// 这在 YAML 1.2 里合法（折行等价于一个空格），宿主解析没问题；但 @yunmiao/studymate
// 启动时用自带的严格解析器读整份 profile 补丁，遇到多行 plain 标量直接抛错，
// 于是「StudyMate：已跳过原生加载」——学习模式/答疑模式两条预设一起消失。
//
// 修法：把续行拼回上一行（语义完全等价）。块标量（`: >-` / `: |`）的内容不动。
//
// 用法：node tools/fix-cordis-patch-fold.mjs [patchPath]
// 默认 patchPath = ~/.dsh/profiles/desktop/cordis.patch.yml
// 幂等：没有可拼的行就什么都不写。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const target = process.argv[2]
  || path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');

/** 这一行看起来是「key: value」而不是续行。 */
function isKeyLine(text) {
  if (!text.trim()) return false;
  if (/^\s*#/.test(text)) return false;
  if (/^\s*-\s/.test(text)) return false;
  if (/^\s*[\[\]{}|>]/.test(text)) return false;
  return /^\s*(?:"[^"]*"|'[^']*'|[^:#\s][^:]*):(\s|$)/.test(text);
}

function indentOf(text) {
  return text.match(/^ */)[0].length;
}

/** 开启块标量的行：`key: >` / `key: |-` / `- key: >` 等。 */
function opensBlockScalar(text) {
  return /:\s*[|>][-+]?\s*(#.*)?$/.test(text);
}

const original = fs.readFileSync(target, 'utf8');
const lines = original.split('\n');
const out = [];
const joined = [];
// 块标量体：缩进必须大于开块那一行的缩进，遇到更浅或等深的行即结束。
let blockIndent = -1;

for (let i = 0; i < lines.length; i += 1) {
  const text = lines[i];
  const lineNo = i + 1;

  if (blockIndent >= 0) {
    if (text.trim() === '' || indentOf(text) > blockIndent) {
      out.push(text);
      continue;
    }
    blockIndent = -1;
  }

  if (opensBlockScalar(text)) {
    out.push(text);
    blockIndent = indentOf(text);
    continue;
  }

  const continuation = text.trim() !== ''
    && !/^\s*#/.test(text)
    && !/^\s*-\s/.test(text)
    && !/^\s*[\[\]{}|>]/.test(text)
    && !isKeyLine(text)
    && out.length > 0
    && out[out.length - 1].trim() !== '';

  if (continuation) {
    out[out.length - 1] = out[out.length - 1].replace(/\s+$/, '') + ' ' + text.trim();
    joined.push(lineNo);
    continue;
  }

  out.push(text);
}

if (!joined.length) {
  console.log('无需修改：' + target);
  process.exit(0);
}

fs.writeFileSync(target, out.join('\n'));
console.log('已拼回 ' + joined.length + ' 行续行：' + joined.join(', '));
console.log('行数 ' + lines.length + ' -> ' + out.length);
