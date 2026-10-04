"use strict";

(() => {
  const root = document.documentElement;
  root.classList.add("has-js");

  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reduceMotion = () => motionPreference.matches;
  const syncMotion = () => {
    root.dataset.reducedMotion = String(reduceMotion());
    if (reduceMotion()) document.getAnimations().forEach(animation => animation.cancel());
  };
  syncMotion();
  motionPreference.addEventListener("change", syncMotion);

  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.querySelector(".navigation");
  const headerInner = document.querySelector(".header-inner");
  let navigationCollapsed;
  let focusedMenuElement = null;
  const setMenu = open => {
    navigation.classList.toggle("is-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "メニューを閉じる" : "メニューを開く");
  };
  const syncMenu = () => {
    // CSSのコンテナクエリを読み取り、境界値をJS側に重複させない。
    const collapsed = getComputedStyle(headerInner).getPropertyValue("--navigation-collapsed").trim() === "1";
    // CSSで先に非表示になった場合、ブラウザーが外したフォーカスも引き継ぐ。
    const focused = document.activeElement === document.body ? focusedMenuElement : document.activeElement;
    const focusedLink = navigation.contains(focused);
    const focusedButton = focused === menuButton;
    if (collapsed === navigationCollapsed) {
      if (focusedLink && !focused.getClientRects().length) menuButton.focus();
      return;
    }
    navigationCollapsed = collapsed;
    setMenu(false);
    menuButton.hidden = !collapsed;
    if (collapsed && focusedLink) menuButton.focus();
    if (!collapsed && focusedButton) navigation.querySelector("a").focus();
  };
  syncMenu();
  if ("ResizeObserver" in window) new ResizeObserver(syncMenu).observe(headerInner);
  else window.addEventListener("resize", syncMenu);
  menuButton.addEventListener("click", () => setMenu(menuButton.getAttribute("aria-expanded") !== "true"));
  navigation.addEventListener("click", event => {
    if (event.target.closest("a")) {
      focusedMenuElement = null;
      setMenu(false);
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      setMenu(false);
      menuButton.focus();
    }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".site-header")) {
      focusedMenuElement = null;
      setMenu(false);
    }
  });
  document.addEventListener("focusin", event => {
    focusedMenuElement = event.target === menuButton || navigation.contains(event.target) ? event.target : null;
    if (!event.target.closest(".site-header")) setMenu(false);
  });

  // 本文を隠さず、画面に入ったときだけ短い動きを添える。
  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (!reduceMotion()) {
          entry.target.animate([{ transform: "translateY(14px)" }, { transform: "translateY(0)" }], {
            duration: 420,
            easing: "cubic-bezier(.2,.8,.2,1)"
          });
        }
        revealObserver.unobserve(entry.target);
      }
    }, { threshold: 0.12 });
    document.querySelectorAll("[data-reveal]").forEach(element => revealObserver.observe(element));
  }

  function initStudentTable() {
    const tableWrapper = document.querySelector(".table-scroll");
    if (!tableWrapper) return;
    const swipeHint = document.querySelector(".scroll-hint");
    const syncTable = () => {
      const scrollable = tableWrapper.scrollWidth > tableWrapper.clientWidth + 1;
      swipeHint.hidden = !scrollable;
      tableWrapper.tabIndex = scrollable ? 0 : -1;
    };
    syncTable();
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(syncTable);
      observer.observe(tableWrapper);
      observer.observe(tableWrapper.querySelector("table"));
    } else {
      window.addEventListener("resize", syncTable);
    }

  }

  function initFriends() {
    const track = document.querySelector(".friends-track");
    if (!track) return;
    const cards = [...track.querySelectorAll(".friend-card")];
    const friendControls = document.querySelector(".carousel-controls");
    const previousFriend = document.querySelector('[data-friend-step="-1"]');
    const nextFriend = document.querySelector('[data-friend-step="1"]');
    const friendPosition = document.getElementById("friend-position");
    friendControls.hidden = false;
    let currentFriend = 0;
    let pendingFrame = 0;
    const cardOffset = card => card.offsetLeft - cards[0].offsetLeft;
    const syncFriends = () => {
      const maxScroll = track.scrollWidth - track.clientWidth;
      const position = track.scrollLeft;
      currentFriend = cards.reduce((nearest, card, index) =>
        Math.abs(cardOffset(card) - position) < Math.abs(cardOffset(cards[nearest]) - position) ? index : nearest, 0);
      const endReached = position >= maxScroll - 3;
      const lastVisible = cards.reduce((last, card, index) =>
        cardOffset(card) + card.offsetWidth <= position + track.clientWidth + 3 ? index : last, currentFriend);
      const range = currentFriend === lastVisible ? `${currentFriend + 1}` : `${currentFriend + 1}–${lastVisible + 1}`;
      friendPosition.textContent = `${range} / ${cards.length}`;
      previousFriend.disabled = position <= 3;
      nextFriend.disabled = maxScroll <= 3;
      nextFriend.setAttribute("aria-label", endReached ? "先頭のキャラクターへ" : "次のキャラクターへ");
    };
    friendControls.addEventListener("click", event => {
      const button = event.target.closest("[data-friend-step]");
      if (!button) return;
      const step = Number(button.dataset.friendStep);
      const returnToStart = step > 0 && track.scrollLeft >= track.scrollWidth - track.clientWidth - 3;
      const targetIndex = returnToStart ? 0 : Math.max(0, Math.min(cards.length - 1, currentFriend + step));
      track.scrollTo({ left: cardOffset(cards[targetIndex]), behavior: reduceMotion() ? "instant" : "smooth" });
    });
    track.addEventListener("scroll", () => {
      if (pendingFrame) return;
      pendingFrame = requestAnimationFrame(() => {
        syncFriends();
        pendingFrame = 0;
      });
    }, { passive: true });
    if ("ResizeObserver" in window) new ResizeObserver(syncFriends).observe(track);
    else window.addEventListener("resize", syncFriends);
    syncFriends();

  }

  initStudentTable();
  initFriends();

  function initCouponPrint() {
    const button = document.querySelector(".coupon-print");
    if (!button || typeof window.print !== "function") return;
    const image = document.querySelector(".coupon-sheet img");
    const status = document.getElementById("coupon-print-status");
    document.querySelector(".coupon-print-actions").hidden = false;
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      status.textContent = "クーポン画像を準備しています…";
      let timeout;
      try {
        // 遅延読み込み中や再試行時も、画像の描画が完了するまで印刷を始めない。
        image.loading = "eager";
        image.fetchPriority = "high";
        if (image.complete && !image.naturalWidth) {
          const source = image.src;
          image.removeAttribute("src");
          image.src = source;
        }
        await Promise.race([
          image.decode(),
          new Promise((_, reject) => { timeout = window.setTimeout(() => reject(new Error("Image load timeout")), 20000); })
        ]);
        window.clearTimeout(timeout);
        status.textContent = "印刷画面で用紙や部数をご確認ください。";
        window.print();
      } catch {
        status.textContent = "印刷の準備ができませんでした。通信状態をご確認のうえ、もう一度お試しください。";
      } finally {
        window.clearTimeout(timeout);
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    });
  }
  initCouponPrint();

  function revealNewsTarget() {
    let id;
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    const article = document.getElementById(id);
    const year = article?.closest(".news-year");
    if (!year) return;
    // 過去年の記事への直接リンクでも、折りたたみの内側を表示する。
    year.open = true;
    requestAnimationFrame(() => article.scrollIntoView({ block: "start", behavior: "instant" }));
  }
  revealNewsTarget();
  window.addEventListener("hashchange", revealNewsTarget);

  const dialog = document.querySelector(".image-dialog");
  const dialogImage = dialog.querySelector(".dialog-image");
  const imageTitle = document.getElementById("image-title");
  const caption = dialog.querySelector(".dialog-caption");
  const stage = dialog.querySelector(".dialog-stage");
  const zoomButton = dialog.querySelector(".zoom-button");
  const imageLoading = dialog.querySelector(".image-loading");
  const imageError = dialog.querySelector(".image-error");
  const retryButton = dialog.querySelector(".image-retry");
  let opener = null;
  let previousOverflow = "";
  let imageRequest = 0;
  let imageUrl = "";
  const resetZoom = () => {
    dialog.classList.remove("is-zoomed");
    zoomButton.setAttribute("aria-pressed", "false");
    zoomButton.textContent = "拡大する";
    stage.scrollTop = 0;
    stage.scrollLeft = 0;
  };
  const loadDialogImage = url => {
    const request = ++imageRequest;
    resetZoom();
    imageLoading.hidden = false;
    imageError.hidden = true;
    dialogImage.hidden = true;
    zoomButton.disabled = true;
    dialogImage.setAttribute("aria-busy", "true");
    const finish = async () => {
      try { await dialogImage.decode(); } catch { fail(); return; }
      // 閉じた後や別の画像へ切り替えた後の応答を反映しない。
      if (request !== imageRequest || !dialog.open) return;
      imageLoading.hidden = true;
      dialogImage.hidden = false;
      dialogImage.removeAttribute("aria-busy");
      zoomButton.disabled = false;
    };
    const fail = () => {
      if (request !== imageRequest || !dialog.open) return;
      imageLoading.hidden = true;
      imageError.hidden = false;
      dialogImage.hidden = true;
      dialogImage.removeAttribute("aria-busy");
      zoomButton.disabled = true;
    };
    dialogImage.onload = finish;
    dialogImage.onerror = fail;
    dialogImage.src = url;
    if (dialogImage.complete) {
      if (dialogImage.naturalWidth) finish();
      else fail();
    }
  };
  document.addEventListener("click", event => {
    const link = event.target.closest("a[data-image-title]");
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (typeof dialog.showModal !== "function") return;
    event.preventDefault();
    opener = link;
    imageUrl = link.href;
    imageTitle.textContent = link.dataset.imageTitle;
    dialogImage.alt = link.dataset.imageTitle;
    dialog.querySelector(".original-image").href = link.href;
    caption.textContent = link.dataset.imageCaption || "";
    caption.hidden = !caption.textContent;
    // ダイアログの表示に成功した後にだけ背景スクロールを止める。
    dialog.showModal();
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    loadDialogImage(imageUrl);
  });
  retryButton.addEventListener("click", () => {
    // 失敗した同一URLも再取得し、操作位置は閉じるボタンに保つ。
    dialogImage.removeAttribute("src");
    loadDialogImage(imageUrl);
    dialog.querySelector(".dialog-close").focus();
  });
  zoomButton.addEventListener("click", () => {
    const zoomed = dialog.classList.toggle("is-zoomed");
    zoomButton.setAttribute("aria-pressed", String(zoomed));
    zoomButton.textContent = zoomed ? "全体を表示" : "拡大する";
    if (!zoomed) resetZoom();
  });
  dialog.querySelector(".dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => {
    imageRequest++;
    dialogImage.onload = null;
    dialogImage.onerror = null;
    if (imageLoading.hidden === false) dialogImage.removeAttribute("src");
    imageLoading.hidden = true;
    dialogImage.removeAttribute("aria-busy");
    document.body.style.overflow = previousOverflow;
    resetZoom();
    opener?.focus({ preventScroll: true });
  });
  document.getElementById("year").textContent = new Date().getFullYear();
})();
