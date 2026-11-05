/* ========== 像素豆 PixelBean · 共享交互 ========== */
(function () {
  "use strict";

  /* 按钮点击弹跳反馈 */
  function bindPop() {
    document.querySelectorAll(".btn, .site-cta, .pbtn").forEach(function (b) {
      b.addEventListener("click", function () {
        b.classList.remove("pop");
        void b.offsetWidth;
        b.classList.add("pop");
      });
    });
  }

  /* Toast 提示 */
  var toastTimer;
  window.showToast = function (msg) {
    var t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2400);
  };

  /* data-go 统一派发：scroll: / register / toast: / copy: */
  function bindGo() {
    document.querySelectorAll("[data-go]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        var go = el.getAttribute("data-go");
        var i = go.indexOf(":");
        var type = i < 0 ? go : go.slice(0, i);
        var val = i < 0 ? "" : go.slice(i + 1);
        if (type === "scroll") {
          e.preventDefault();
          var t = document.getElementById(val);
          if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (type === "register") {
          window.location.href = "register.html";
        } else if (type === "toast") {
          e.preventDefault();
          window.showToast(val);
        } else if (type === "copy") {
          e.preventDefault();
          copyText(val);
        }
      });
    });
  }

  /* 复制到剪贴板（用于色板） */
  window.copyText = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { window.showToast("已复制 " + text); },
        function () { window.showToast("复制失败，请手动复制：" + text); }
      );
    } else {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); window.showToast("已复制 " + text); }
      catch (err) { window.showToast("复制失败，请手动复制：" + text); }
      document.body.removeChild(ta);
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    bindPop();
    bindGo();
    initAuthUI();
  });

  /* ============ 登录态 UI ============ */
  /* 已登录时，把「免费生成」按钮替换为 头像(手机号后4位) + 退出 */
  window.pbAuth = {
    isLoggedIn: function () { return !!localStorage.getItem("pb_token"); },
    phone: function () { return localStorage.getItem("pb_phone") || ""; },
    logout: function () {
      localStorage.removeItem("pb_token");
      localStorage.removeItem("pb_phone");
      location.reload();
    }
  };

  function initAuthUI() {
    var btns = document.querySelectorAll(".header-cta, .site-cta");
    if (!window.pbAuth.isLoggedIn() || !btns.length) return;
    var phone = window.pbAuth.phone();
    var last4 = phone.length >= 4 ? phone.slice(-4) : "****";
    btns.forEach(function (btn) {
      if (btn.dataset.authDone) return;
      btn.dataset.authDone = "1";
      btn.style.display = "none";
      var box = document.createElement("div");
      box.className = "user-box";
      box.innerHTML =
        '<span class="user-avatar">' + last4 + '</span>' +
        '<button type="button" class="user-out">退出</button>';
      if (btn.nextSibling) btn.parentNode.insertBefore(box, btn.nextSibling);
      else btn.parentNode.appendChild(box);
      box.querySelector(".user-out").addEventListener("click", function () {
        window.pbAuth.logout();
      });
    });
  }
})();
