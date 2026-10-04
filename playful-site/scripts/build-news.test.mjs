import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildNews, renderNews, replaceRegion, validateNews } from "./build-news.mjs";

const item = (id, date = "2026-10-03") => ({ id, date, title: `記事 ${id}`, body: ["本文"] });
const articleCount = html => (html.match(/<article /g) || []).length;

test("最新2件と年別一覧を日付順に生成し、同日は記載順を維持する", () => {
  const data = [item("old", "2025-09-30"), item("first"), item("second"), item("draft", "2027-01-01")];
  data[3].draft = true;
  const { latest, archive } = renderNews(data);
  assert.equal(articleCount(latest), 2);
  assert.ok(latest.indexOf("news-first") < latest.indexOf("news-second"));
  assert.ok(!latest.includes("news-old"));
  assert.equal(articleCount(archive), 3);
  assert.equal((archive.match(/<details class="news-year" open>/g) || []).length, 1);
  assert.ok(archive.indexOf("2026年") < archive.indexOf("2025年"));
  assert.ok(!archive.includes("news-draft"));
  assert.equal(data[0].id, "old");
});

test("通常記事が500件あってもトップは最新2件とし、一覧にはすべて残す", () => {
  const { latest, archive } = renderNews(Array.from({ length: 500 }, (_, index) => item(`entry-${index}`)));
  assert.equal(articleCount(latest), 2);
  assert.equal(articleCount(archive), 500);
  assert.ok(!latest.includes("news-feed-scroll"));
});

test("古い重要記事を重複なく先頭に残し、増えた一覧だけをスクロール対象にする", () => {
  const data = [
    item("newest", "2026-10-05"),
    { ...item("recent-important", "2026-10-04"), important: true },
    { ...item("old-important", "2025-01-01"), important: true },
    item("old", "2024-01-01"),
    { ...item("draft-important", "2027-01-01"), important: true, draft: true }
  ];
  const { latest, archive } = renderNews(data);
  const ids = [...latest.matchAll(/<article[^>]* id="news-([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(ids, ["recent-important", "old-important", "newest"]);
  assert.ok(!latest.includes("news-feed-count"));
  assert.match(latest, /class="news-feed news-feed-scroll" tabindex="0" role="region" aria-label="[^"]+"/);
  assert.ok(!archive.includes("news-feed-scroll"));
  assert.ok(archive.indexOf('id="news-newest"') < archive.indexOf('id="news-recent-important"'));
  assert.equal(articleCount(archive), 4);
  assert.ok(!archive.includes("news-draft-important"));
});

test("多数の重要記事を省略せず、最新2件の通常記事も残す", () => {
  const important = Array.from({ length: 500 }, (_, index) => ({ ...item(`important-${index}`, "2025-01-01"), important: true }));
  const { latest } = renderNews([item("first"), item("second"), ...important]);
  assert.equal(articleCount(latest), 502);
  assert.ok(!latest.includes("news-feed-count"));
  assert.ok(latest.indexOf('id="news-important-0"') < latest.indexOf('id="news-important-499"'));
  assert.ok(latest.indexOf('id="news-important-499"') < latest.indexOf('id="news-first"'));
  assert.match(latest, /news-feed-scroll/);
});

test("重要指定の解除後は最新2件で判定し、古い記事は一覧に残る", () => {
  const data = [item("first"), item("second"), { ...item("ended", "2025-01-01"), important: false, category: "重要" }];
  const { latest, archive } = renderNews(data);
  assert.equal(articleCount(latest), 2);
  assert.ok(!latest.includes("news-ended"));
  assert.ok(!latest.includes("news-feed-scroll"));
  assert.match(archive, /id="news-ended"/);
  assert.ok(!latest.includes("news-feed-count"));
});

test("重要記事を含めて2件以下ならスクロール枠を作らない", () => {
  const { latest } = renderNews([item("newest"), { ...item("important", "2026-10-02"), important: true }]);
  assert.equal(articleCount(latest), 2);
  assert.ok(!latest.includes("news-feed-scroll"));
  assert.ok(latest.indexOf('id="news-important"') < latest.indexOf('id="news-newest"'));
  assert.equal(articleCount(renderNews([{ ...item("only"), important: true }]).latest), 1);
});

test("最新2件が両方重要なら通常記事を補充せず、重要記事すべてを一度ずつ表示する", () => {
  const data = [
    { ...item("first", "2026-10-05"), important: true },
    { ...item("second", "2026-10-04"), important: true },
    item("normal"),
    { ...item("old", "2024-01-01"), important: true }
  ];
  const { latest, archive } = renderNews(data);
  assert.equal(articleCount(latest), 3);
  assert.ok(!latest.includes('id="news-normal"'));
  for (const id of ["first", "second", "old"]) {
    assert.equal(latest.split(`id="news-${id}"`).length - 1, 1);
  }
  assert.equal(articleCount(archive), 4);
});

test("古い記事でも最新2件は表示し、経過日数による制限を設けない", () => {
  const { latest, archive } = renderNews([item("first", "2020-01-01"), item("second", "2019-01-01"), item("old", "2018-01-01")]);
  assert.equal(articleCount(latest), 2);
  assert.match(latest, /id="news-first"/);
  assert.match(latest, /id="news-second"/);
  assert.ok(!latest.includes('id="news-old"'));
  assert.equal(articleCount(archive), 3);
});

test("未来の日付だけでは予約公開にならず、下書き指定で公開を制御する", () => {
  const { latest, archive } = renderNews([item("future", "2099-01-01"), item("current"), { ...item("draft", "2099-02-01"), draft: true }]);
  assert.equal(articleCount(latest), 2);
  assert.match(latest, /id="news-future"/);
  assert.ok(!archive.includes('id="news-draft"'));
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
    links: [{ text: "<strong>画像</strong>", href: "assets/test.jpg", imageTitle: '\" onmouseover=\"alert(1)', width: 1200, height: 800 }]
  }];
  const { latest } = renderNews(data);
  assert.ok(!latest.includes("<script>") && !latest.includes("<img src=x"));
  assert.equal((latest.match(/<img /g) || []).length, 1);
  assert.match(latest, /&lt;script&gt;/);
  assert.match(latest, /2 &lt; 3 &amp; 4 &gt; 1/);
  assert.match(latest, /data-image-title="&quot; onmouseover=&quot;alert\(1\)"/);
  assert.match(latest, /alt="&quot; onmouseover=&quot;alert\(1\)"/);
});

test("電話・重要表示・添付画像・外部リンクを生成する", () => {
  const { archive } = renderNews([{
    ...item("contact"), important: true,
    phone: { number: "070-2615-9280", hours: "受付 8:00–17:00" },
    links: [
      { text: "画像", href: "assets/test.webp", imageTitle: "案内", width: 1200, height: 800 },
      { text: "PDF", href: "assets/test.pdf" },
      { text: "外部", href: "https://example.com/?a=1&b=2" }
    ]
  }]);
  assert.match(archive, /news-important/);
  assert.match(archive, /<span class="tag">重要<\/span>/);
  assert.match(archive, /href="tel:07026159280"/);
  assert.match(archive, /data-image-title="案内"/);
  assert.match(archive, /<img src="assets\/test.webp" width="1200" height="800" alt="案内" loading="lazy" decoding="async" fetchpriority="low">/);
  assert.match(archive, /class="text-link" href="assets\/test.pdf"/);
  assert.match(archive, /target="_blank" rel="noopener noreferrer"/);
  assert.match(archive, /a=1&amp;b=2/);
});

test("今後の画像も形式を判定して本文に表示し、説明省略時はリンク文言を使う", () => {
  for (const extension of ["jpg", "jpeg", "png", "webp", "gif"]) {
    const { latest, archive } = renderNews([{ ...item("photo"), links: [{ text: "営業のご案内", href: `assets/guide.${extension}`, width: 900, height: 600 }] }]);
    for (const html of [latest, archive]) {
      assert.match(html, /class="news-image"/);
      assert.match(html, /data-image-title="営業のご案内"/);
      assert.match(html, /aria-label="営業のご案内を拡大"/);
      assert.match(html, /width="900" height="600" alt="営業のご案内"/);
      assert.match(html, /<span class="zoom-icon" aria-hidden="true"><\/span>/);
      assert.doesNotMatch(html, /↗/);
    }
  }
});

test("画像サイズの不足・不正値と、非画像へのサイズ指定を拒否する", () => {
  const link = { text: "画像", href: "assets/test.jpg", width: 1200, height: 800 };
  for (const key of ["width", "height"]) {
    for (const value of [undefined, null, 0, -1, 1.5, "800", Infinity, Number.MAX_SAFE_INTEGER + 1, '\" onerror=\"alert(1)']) {
      assert.throws(() => validateNews([{ ...item("bad-size"), links: [{ ...link, [key]: value }] }]), /width/);
    }
  }
  for (const href of ["assets/test.pdf", "https://example.com/test.jpg"]) {
    assert.throws(() => validateNews([{ ...item("bad-size"), links: [{ ...link, href }] }]), /width/);
  }
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

test("記事追加後も重要記事を残し、生成漏れを検出する", async t => {
  const data = [{ ...item("important", "2025-01-01"), important: true }, item("previous")];
  const directory = await fixture(t, data);
  await buildNews(directory);
  data.push(item("newest", "2026-10-05"), item("second", "2026-10-04"));
  await writeFile(join(directory, "news.json"), JSON.stringify(data));
  await assert.rejects(buildNews(directory, true), /未反映/);
  assert.equal(await buildNews(directory), 2);
  const latest = await readFile(join(directory, "index.html"), "utf8");
  assert.equal(articleCount(latest), 3);
  assert.match(latest, /id="news-important"/);
  assert.ok(!latest.includes('id="news-previous"'));
  assert.equal(articleCount(await readFile(join(directory, "news.html"), "utf8")), 4);
});

test("添付漏れ・別ページのマーカー欠損がある場合、両HTMLを書き換えない", async t => {
  const directory = await fixture(t, [{ ...item("one"), links: [{ text: "画像", href: "assets/test.jpg", width: 1200, height: 800 }] }]);
  const before = await readFile(join(directory, "index.html"), "utf8");
  await assert.rejects(buildNews(directory), /ENOENT/);
  assert.equal(await readFile(join(directory, "index.html"), "utf8"), before);
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "assets/test.jpg"), "fixture");
  await writeFile(join(directory, "news.html"), "マーカーなし");
  await assert.rejects(buildNews(directory), /生成範囲/);
  assert.equal(await readFile(join(directory, "index.html"), "utf8"), before);
});
