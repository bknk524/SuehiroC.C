import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNews, LATEST_COUNT, renderNews, replaceRegion, validateNews } from "./build-news.mjs";

const item = (id, date = "2026-10-03") => ({ id, date, title: `記事 ${id}`, body: ["本文"] });
const articleCount = html => (html.match(/<article /g) || []).length;

test("最新2件と年別一覧を日付順に生成し、同日は記載順を維持する", () => {
  const data = [item("old", "2025-12-31"), item("first"), item("second"), item("draft", "2027-01-01")];
  data[3].draft = true;
  const { latest, archive } = renderNews(data);
  assert.equal(articleCount(latest), LATEST_COUNT);
  assert.ok(latest.indexOf("news-first") < latest.indexOf("news-second"));
  assert.ok(!latest.includes("news-old"));
  assert.equal(articleCount(archive), 3);
  assert.equal((archive.match(/<details class="news-year" open>/g) || []).length, 1);
  assert.ok(archive.indexOf("2026年") < archive.indexOf("2025年"));
  assert.ok(!archive.includes("news-draft"));
  assert.equal(data[0].id, "old");
});

test("記事を500件追加してもトップの件数は一定で、一覧にはすべて残る", () => {
  const { latest, archive } = renderNews(Array.from({ length: 500 }, (_, index) => item(`entry-${index}`)));
  assert.equal(articleCount(latest), 2);
  assert.equal(articleCount(archive), 500);
});

test("0件・1件・下書きのみを扱える", () => {
  assert.match(renderNews([]).latest, /現在、お知らせはありません/);
  assert.match(renderNews([{ ...item("draft"), draft: true }]).archive, /現在、お知らせはありません/);
  assert.equal(articleCount(renderNews([item("one")]).latest), 1);
});

test("見出し・本文・属性のHTMLをエスケープする", () => {
  const data = [{
    ...item("escaped"),
    title: '<script>alert("x")</script>',
    body: ["<img src=x onerror=alert(1)>", "2 < 3 & 4 > 1"],
    category: '<b>"重要"</b>',
    links: [{ text: "<strong>画像</strong>", href: "assets/test.jpg", imageTitle: '\" onmouseover=\"alert(1)' }]
  }];
  const { latest } = renderNews(data);
  assert.ok(!latest.includes("<script>") && !latest.includes("<img"));
  assert.match(latest, /&lt;script&gt;/);
  assert.match(latest, /2 &lt; 3 &amp; 4 &gt; 1/);
  assert.match(latest, /data-image-title="&quot; onmouseover=&quot;alert\(1\)"/);
});

test("電話・重要表示・添付画像・外部リンクを生成する", () => {
  const { archive } = renderNews([{
    ...item("contact"), important: true,
    phone: { number: "070-2615-9280", hours: "受付 8:00–17:00" },
    links: [
      { text: "画像", href: "assets/test.webp", imageTitle: "案内" },
      { text: "PDF", href: "assets/test.pdf" },
      { text: "外部", href: "https://example.com/?a=1&b=2" }
    ]
  }]);
  assert.match(archive, /news-important/);
  assert.match(archive, /<span class="tag">重要<\/span>/);
  assert.match(archive, /href="tel:07026159280"/);
  assert.match(archive, /data-image-title="案内"/);
  assert.match(archive, /target="_blank" rel="noopener noreferrer"/);
  assert.match(archive, /a=1&amp;b=2/);
});

test("入力ミス・重複ID・存在しない日付を拒否する", () => {
  const invalid = [null, {}, [item("same"), item("same")], [item("Bad ID")], [item("bad", "2026-02-30")],
    [item("bad", "2026/10/03")], [{ ...item("bad"), title: "" }], [{ ...item("bad"), body: "本文" }],
    [{ ...item("bad"), important: "true" }], [{ ...item("bad"), draft: "false" }],
    [{ ...item("bad"), draftt: true }], [{ ...item("bad"), phone: { number: "javascript:alert(1)", hours: "受付" } }]];
  for (const data of invalid) assert.throws(() => validateNews(data));
  assert.doesNotThrow(() => validateNews([item("leap", "2028-02-29")]));
});

test("危険なURL・パス逸脱・非画像の拡大指定を拒否する", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,test", "//example.com/test", "http://example.com", "https://user:pass@example.com", "assets/../test.jpg", "assets/%2e%2e/test.jpg", "assets/test.svg", "https:\\example.com"]) {
    assert.throws(() => validateNews([{ ...item("bad"), links: [{ text: "案内", href }] }]));
  }
  for (const href of ["assets/test.pdf", "https://example.com/test.jpg"]) {
    assert.throws(() => validateNews([{ ...item("bad"), links: [{ text: "案内", href, imageTitle: "画像" }] }]));
  }
});

test("生成範囲外と改行コードを維持し、重複・欠損マーカーを拒否する", () => {
  const html = '前\r\n  <!-- NEWS:LATEST:START -->\r\n  古い本文\r\n  <!-- NEWS:LATEST:END -->\r\n後';
  const result = replaceRegion(html, "LATEST", "一行目\n二行目");
  assert.equal(result, html.replace("  古い本文", "  一行目\r\n  二行目"));
  assert.throws(() => replaceRegion("マーカーなし", "LATEST", "本文"));
  assert.throws(() => replaceRegion(html + html, "LATEST", "本文"));
});

async function fixture(t, data) {
  const directory = await mkdtemp(join(tmpdir(), "suehiro-news-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "news.json"), JSON.stringify(data));
  await writeFile(join(directory, "index.html"), "前<!-- NEWS:LATEST:START --><!-- NEWS:LATEST:END -->後");
  await writeFile(join(directory, "news.html"), "前<!-- NEWS:ARCHIVE:START --><!-- NEWS:ARCHIVE:END -->後");
  return directory;
}

test("生成・更新漏れチェック・再生成の冪等性", async t => {
  const directory = await fixture(t, [item("one")]);
  const before = await readFile(join(directory, "index.html"), "utf8");
  await assert.rejects(buildNews(directory, true), /未反映/);
  assert.equal(await readFile(join(directory, "index.html"), "utf8"), before);
  assert.equal(await buildNews(directory), 2);
  assert.equal(await buildNews(directory), 0);
  assert.equal(await buildNews(directory, true), 0);
});

test("添付漏れ・別ページのマーカー欠損がある場合、両HTMLを書き換えない", async t => {
  const directory = await fixture(t, [{ ...item("one"), links: [{ text: "画像", href: "assets/test.jpg" }] }]);
  const before = await readFile(join(directory, "index.html"), "utf8");
  await assert.rejects(buildNews(directory), /ENOENT/);
  assert.equal(await readFile(join(directory, "index.html"), "utf8"), before);
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "assets/test.jpg"), "fixture");
  await writeFile(join(directory, "news.html"), "マーカーなし");
  await assert.rejects(buildNews(directory), /生成範囲/);
  assert.equal(await readFile(join(directory, "index.html"), "utf8"), before);
});
