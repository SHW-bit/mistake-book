/**
 * 把 dsh-mistake-book 装进 DSH desktop profile。
 *
 * 装法：**真实文件拷贝**，不是 link: / 软链 / junction。
 * 起因：这个插件最早是拿目录联接（junction）挂进 node_modules 的，结果 DSH
 * 桌面端的插件管理读不到 junction 形态的包——表现就是「装上了但界面里看不见」。
 * 同目录下 dsh-search-enhance 的 install.mjs 踩过同一个坑，这里照它的做法。
 *
 * 干这些事：
 *   1. profile/node_modules/dsh-mistake-book ← 本目录的 lib/、skills/、package.json、
 *      cordis.patch.yml、icon.png、README.md、LICENSE（真副本，不是链接）
 *   2. 把拷贝过去的 cordis.patch.yml 里的 <REPO>/dsh-plugin 换成安装后的真实路径
 *      （预设里的 customSkillDirs 必须是绝对路径，DSH 会话工作目录是任意的）
 *   3. profile/package.json 的 dependencies 记来源、dsh.profile.bundles 末尾加插件名
 *
 * 会先备份 package.json 成 package.json.bak-<时间戳>。重复跑是幂等的。
 *
 *   node install.mjs             装
 *   node install.mjs --uninstall 卸
 *   node install.mjs --check     只看会改什么，不写盘
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PKG_NAME = 'dsh-mistake-book';
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const COPY_DIRS = ['lib', 'skills'];
const COPY_FILES = ['package.json', 'cordis.patch.yml', 'icon.png', 'README.md', 'LICENSE'];

const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const checkOnly = args.includes('--check');

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function findProfile() {
  const override = process.env.DSH_PROFILE_DIR;
  if (override) return override;
  const profiles = path.join(dshHome(), 'profiles');
  const candidates = fs.existsSync(profiles)
    ? fs.readdirSync(profiles).filter((d) => fs.existsSync(path.join(profiles, d, 'package.json')))
    : [];
  if (candidates.includes('desktop')) return path.join(profiles, 'desktop');
  if (candidates.length === 1) return path.join(profiles, candidates[0]);
  throw new Error('找不到 profile 目录。找到的是：' + (candidates.join(', ') || '（空）') + '。设 DSH_PROFILE_DIR 指定。');
}

// 递归拷贝，容忍 DSH 开着时个别文件被占用（EPIPE/EBUSY/EPERM 只记下来，不中断）
function copyTree(from, to, locked, prefix) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) { copyTree(src, dst, locked, prefix + name + "/"); continue; }
    try {
      fs.copyFileSync(src, dst);
      continue;
    } catch (e) {
      if (e.code === "EPIPE" || e.code === "EBUSY" || e.code === "EPERM") { locked.push(prefix + name); return; }
      throw e;
    }
  }
}

const profileDir = findProfile();
const pkgFile = path.join(profileDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const localPkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));

pkg.dependencies ??= {};
pkg.dsh ??= {};
pkg.dsh.profile ??= {};
pkg.dsh.profile.bundles ??= [];

const before = JSON.stringify(pkg, null, 2);
const spec = "file:" + HERE.replace(/\\/g, "/");

if (uninstall) {
  delete pkg.dependencies[PKG_NAME];
  pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== PKG_NAME);
} else {
  pkg.dependencies[PKG_NAME] = spec;
  if (!pkg.dsh.profile.bundles.includes(PKG_NAME)) pkg.dsh.profile.bundles.push(PKG_NAME);
}

const after = JSON.stringify(pkg, null, 2);
const dest = path.join(profileDir, 'node_modules', PKG_NAME);

if (checkOnly) {
  console.log("profile ：" + profileDir);
  console.log("package.json " + (before === after ? "无需改动" : "会改写") + "：");
  console.log(JSON.stringify({ dependencies: uninstall ? "(删除)" : spec, bundles: pkg.dsh.profile.bundles }, null, 2));
  console.log("node_modules 目标：" + dest);
  const lst = fs.lstatSync(dest, { throwIfNoEntry: false });
  console.log("  当前存在=" + Boolean(lst) + "，形态=" + (!lst ? "—" : lst.isSymbolicLink() ? "软链/junction（界面看不见，需重装）" : "真实目录"));
  process.exit(0);
}

const backup = pkgFile + ".bak-" + Date.now();
fs.copyFileSync(pkgFile, backup);
fs.writeFileSync(pkgFile, after + '\n', 'utf8');

if (uninstall) {
  if (fs.existsSync(dest)) {
    const lst = fs.lstatSync(dest);
    if (lst.isSymbolicLink()) fs.rmSync(dest, { recursive: false, force: true });
    else fs.rmSync(dest, { recursive: true, force: true });
    console.log("已移除 " + dest);
  }
} else {
  // 先清掉 junction / 软链，再放真副本
  if (fs.existsSync(dest)) {
    const lst = fs.lstatSync(dest);
    if (lst.isSymbolicLink()) {
      fs.rmSync(dest, { recursive: false, force: true });
      console.log("先移除了一个软链/junction");
    }
  }
  fs.mkdirSync(dest, { recursive: true });
  const locked = [];
  for (const dir of COPY_DIRS) {
    const from = path.join(HERE, dir);
    if (!fs.existsSync(from)) continue;
    copyTree(from, path.join(dest, dir), locked, dir + "/");
  }
  for (const file of COPY_FILES) {
    const src = path.join(HERE, file);
    if (!fs.existsSync(src)) continue;
    try {
      if (file === "cordis.patch.yml") {
        // 把占位符换成安装后的真实路径：预设的 customSkillDirs 必须是绝对路径
        const raw = fs.readFileSync(src, "utf8");
        const resolved = raw.split("<REPO>/dsh-plugin").join(dest.replace(/\\/g, "/"));
        fs.writeFileSync(path.join(dest, file), resolved, "utf8");
      } else {
        fs.copyFileSync(src, path.join(dest, file));
      }
    } catch (e) {
      if (e.code === "EPIPE" || e.code === "EBUSY" || e.code === "EPERM") locked.push(file);
      else throw e;
    }
  }
  console.log("已放入真副本：" + dest);
  if (locked.length > 0) {
    console.log("");
    console.log("⚠ 有 " + locked.length + " 个文件被占用没拷上：" + locked.join("、"));
    console.log("  原因是 DSH 还开着。关掉 DSH 再跑一次 node install.mjs 即可。");
  }
}

console.log((uninstall ? "卸载" : "安装") + "完成：" + PKG_NAME + " v" + localPkg.version);
console.log("  profile ：" + profileDir);
console.log("  备份    ：" + path.basename(backup));
console.log("");
console.log("**重启 DSH 才生效。**");
if (!uninstall) {
  console.log("");
  console.log("重启后：侧栏出现「错题本」面板，工具列表多出 13 个 mb_* 工具，预设里多出「错题复习 / 错题答疑」。");
  console.log("注意：面板和工具都连 http://127.0.0.1:8000，先把错题本服务跑起来：");
  console.log("  python app.py --port 8000");
}
