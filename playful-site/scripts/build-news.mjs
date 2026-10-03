import { readFile, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LATEST_COUNT = 2;
const siteDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const isText = value => typeof value === "string" && value.trim().length > 0;
const isAsset = value => /^assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp|gif|pdf)$/.test(value);

function checkObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: オブジェクトで指定してください。`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${label}: 未対応の項目「${key}」があります。`);
  }
}

function isHttps(value) {
  if (!isText(value) || /[\s\\]/.test(value) || !value.startsWith("https://")) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

export function validateNews(data) {
  if (!Array.isArray(data)) throw new Error("news.json: お知らせを配列で指定してください。");
  const ids = new Set();
  for (const [index, item] of data.entries()) {
    const label = `news.json ${index + 1}件目`;
    checkObject(item, ["id", "date", "category", "important", "title", "body", "phone", "links", "draft"], label);
    if (!isText(item.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || ids.has(item.id)) {
      throw new Error(`${label}: idは重複しない半角英小文字・数字・ハイフンで指定してください。`);
    }
    ids.add(item.id);
    const date = typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? new Date(`${item.date}T00:00:00Z`) : null;
    if (!date || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== item.date) {
      throw new Error(`${label}: dateは実在する日付をYYYY-MM-DDで指定してください。`);
    }
    if (!isText(item.title) || !Array.isArray(item.body) || !item.body.every(isText)) {
      throw new Error(`${label}: titleと、段落ごとの文字列を入れたbody配列が必要です。`);
    }
    if (item.category !== undefined && !isText(item.category)) throw new Error(`${label}: categoryは文字列で指定してください。`);
    for (const key of ["important", "draft"]) {
      if (item[key] !== undefined && typeof item[key] !== "boolean") throw new Error(`${label}: ${key}はtrueまたはfalseで指定してください。`);
    }
    if (item.phone !== undefined) {
      checkObject(item.phone, ["number", "hours"], label);
      if (!isText(item.phone.number) || !/^0\d{1,4}-\d{1,4}-\d{3,4}$/.test(item.phone.number) || !isText(item.phone.hours)) {
        throw new Error(`${label}: phoneにはハイフン付きの電話番号numberと受付時間hoursを指定してください。`);
      }
    }
    if (item.links !== undefined) {
      if (!Array.isArray(item.links)) throw new Error(`${label}: linksは配列で指定してください。`);
      for (const link of item.links) {
        checkObject(link, ["text", "href", "imageTitle"], label);
        if (!isText(link.text) || !isText(link.href) || (!isAsset(link.href) && !isHttps(link.href))) {
          throw new Error(`${label}: リンクはassets内の画像・PDF、またはhttps URLを指定してください。`);
        }
        if (link.imageTitle !== undefined && (!isText(link.imageTitle) || !isAsset(link.href) || link.href.endsWith(".pdf"))) {
          throw new Error(`${label}: imageTitleはassets内の画像リンクにのみ指定できます。`);
        }
      }
    }
  }
  return data;
}

function renderItem(item, archive) {
  const id = `news-${item.id}`;
  const heading = archive ? "h2" : "h3";
  const category = item.category || (item.important ? "重要" : "");
  const title = archive ? escapeHtml(item.title) : `<a href="news.html#${id}">${escapeHtml(item.title)}</a>`;
  const links = (item.links || []).map(link => {
    const image = link.imageTitle ? ` data-image-title="${escapeHtml(link.imageTitle)}"` : "";
    const external = isHttps(link.href);
    return `<a class="text-link" href="${escapeHtml(link.href)}"${image}${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(link.text)} <span aria-hidden="true">↗</span>${external ? '<span class="sr-only">（新しいタブ）</span>' : ""}</a>`;
  });
  return [
    `<article class="news-item${item.important ? " news-important" : ""}" id="${id}" aria-labelledby="${id}-title">`,
    `  <div class="news-meta"><time datetime="${item.date}">${item.date.replaceAll("-", ".")}</time>${category ? `<span${item.important ? ' class="tag"' : ""}>${escapeHtml(category)}</span>` : ""}</div>`,
    `  <${heading} id="${id}-title">${title}</${heading}>`,
    ...item.body.map(paragraph => `  <p>${escapeHtml(paragraph)}</p>`),
    ...(item.phone ? [`  <a class="phone-link" href="tel:${item.phone.number.replaceAll("-", "")}">${escapeHtml(item.phone.number)} <span>${escapeHtml(item.phone.hours)}</span></a>`] : []),
    ...links.map(link => `  ${link}`),
    "</article>"
  ].join("\n");
}

export function renderNews(data) {
  // 同日の記事はデータの記載順を維持し、下書きはHTMLに含めない。
  const published = validateNews(data).filter(item => !item.draft).toSorted((a, b) => b.date.localeCompare(a.date));
  const empty = '<p class="news-empty">現在、お知らせはありません。</p>';
  const latest = published.slice(0, LATEST_COUNT).map(item => renderItem(item, false)).join("\n") || empty;
  const years = [...new Set(published.map(item => item.date.slice(0, 4)))];
  const archive = years.map((year, index) => {
    const items = published.filter(item => item.date.startsWith(year));
    return [
      `<details class="news-year"${index === 0 ? " open" : ""}>`,
      `  <summary><span>${year}年 <small>${items.length}件</small></span><span aria-hidden="true">＋</span></summary>`,
      '  <div class="news-year-items">',
      items.map(item => renderItem(item, true).split("\n").map(line => `    ${line}`).join("\n")).join("\n"),
      "  </div>",
      "</details>"
    ].join("\n");
  }).join("\n") || empty;
  return { latest, archive };
}

export function replaceRegion(html, region, content) {
  const start = `<!-- NEWS:${region}:START -->`;
  const end = `<!-- NEWS:${region}:END -->`;
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end);
  if (startIndex < 0 || endIndex < startIndex || html.indexOf(start, startIndex + start.length) !== -1 || html.indexOf(end, endIndex + end.length) !== -1) {
    throw new Error(`生成範囲 NEWS:${region} が見つからないか重複しています。HTMLを確認してください。`);
  }
  const newline = html.includes("\r\n") ? "\r\n" : "\n";
  const linePrefix = html.slice(html.lastIndexOf("\n", startIndex) + 1, startIndex);
  const indentation = /^[\t ]*$/.test(linePrefix) ? linePrefix : "";
  const body = content.split("\n").map(line => indentation + line).join(newline);
  return html.slice(0, startIndex + start.length) + newline + body + newline + indentation + html.slice(endIndex);
}

export async function buildNews(directory = siteDirectory, check = false) {
  const data = JSON.parse(await readFile(resolve(directory, "news.json"), "utf8"));
  const { latest, archive } = renderNews(data);
  // 公開記事の添付漏れと両ページの生成範囲を確認してから書き込む。
  for (const item of data.filter(item => !item.draft)) {
    for (const link of item.links || []) {
      if (isAsset(link.href)) await access(resolve(directory, link.href));
    }
  }
  const updates = [];
  for (const [file, region, content] of [["index.html", "LATEST", latest], ["news.html", "ARCHIVE", archive]]) {
    const path = resolve(directory, file);
    const before = await readFile(path, "utf8");
    const after = replaceRegion(before, region, content);
    if (before !== after) updates.push({ path, after });
  }
  if (check && updates.length) throw new Error("お知らせの生成結果が未反映です。node playful-site/scripts/build-news.mjs を実行してください。");
  for (const { path, after } of updates) await writeFile(path, after, "utf8");
  return updates.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(arg => arg !== "--check")) throw new Error("指定できるオプションは --check のみです。");
    const count = await buildNews(siteDirectory, process.argv.includes("--check"));
    console.log(process.argv.includes("--check") ? "お知らせデータとHTMLは一致しています。" : `お知らせを生成しました（${count}ファイル更新）。`);
  } catch (error) {
    console.error(`お知らせの生成を中止しました: ${error.message}`);
    process.exitCode = 1;
  }
}
