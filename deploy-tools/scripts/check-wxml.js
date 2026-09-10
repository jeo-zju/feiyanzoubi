// 简易 WXML 标签配对检查：校验四个 v2 样板页的标签开闭是否平衡
const fs = require("fs");
const files = [
  "miniprogram/pages/home/index.wxml",
  "miniprogram/pages/plan-detail/index.wxml",
  "miniprogram/pages/calendar-publish/index.wxml",
  "miniprogram/pages/me/index.wxml"
];
// 允许自闭合/无闭合体的标签
const VOID = new Set(["input", "icon", "import", "include"]);
let fail = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  // 去掉注释
  const clean = src.replace(/<!--[\s\S]*?-->/g, "");
  const stack = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
  let m;
  let ok = true;
  while ((m = re.exec(clean))) {
    const full = m[0];
    const tag = m[1];
    const selfClose = m[3] === "/";
    const isClose = full[1] === "/";
    if (isClose) {
      const top = stack.pop();
      if (top !== tag) {
        console.log(`MISMATCH ${f}: </${tag}> but open <${top}> at pos ${m.index}`);
        ok = false;
        break;
      }
    } else if (!selfClose && !VOID.has(tag)) {
      stack.push(tag);
    }
  }
  if (ok && stack.length) {
    console.log(`UNCLOSED ${f}: ${stack.join(", ")}`);
    ok = false;
  }
  if (ok) console.log("WXML OK:", f);
  else fail++;
}
process.exit(fail ? 1 : 0);
