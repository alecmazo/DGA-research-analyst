/**
 * Wedding storefront — Option A
 * Loads public config (packages, Stripe, Calendly, media) and posts leads to Sliw CRM.
 */
(function () {
  const API =
    window.SLIW_PUBLIC_API ||
    (location.hostname === "weddings.edytasliwinska.com" ||
    location.hostname === "www.weddings.edytasliwinska.com"
      ? "/api/sliw"
      : location.pathname.indexOf("/weddings-site") === 0
        ? "/api/sliw"
        : "/api/sliw");

  const params = new URLSearchParams(location.search);
  ["utm_source", "utm_medium", "utm_campaign"].forEach((k) => {
    const el = document.getElementById(k);
    if (el) el.value = params.get(k) || params.get(k.replace("utm_", "")) || "";
  });
  // Convenience: ?src=instagram
  if (!document.getElementById("utm_source")?.value && params.get("src")) {
    const el = document.getElementById("utm_source");
    if (el) el.value = params.get("src");
  }

  // Post-payment return from Stripe Payment Links
  (function showPaidBanner() {
    const paid = (params.get("paid") || "").toLowerCase();
    if (!paid) return;
    const banner = document.getElementById("pay-banner");
    if (!banner) return;
    const label =
      paid === "package10" || paid === "package_10"
        ? "You’re booked for the 10-lesson package."
        : paid === "single" || paid === "single_lesson"
          ? "You’re booked for a private trial lesson."
          : "Payment received — thank you.";
    banner.hidden = false;
    banner.innerHTML =
      label +
      " Submit the form below (same email) so Edyta has your wedding date & song ideas · or <a href=\"#book\">scroll to book</a>.";
    // Soft-scroll book section after a beat
    setTimeout(() => {
      const el = document.getElementById("book");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 400);
  })();

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function mediaSrc(src) {
    if (!src) return "";
    if (/^https?:\/\//i.test(src) || src.startsWith("//") || src.startsWith("/")) {
      return src;
    }
    // Relative to storefront root (works on both host root and /weddings-site/)
    const base =
      location.pathname.indexOf("/weddings-site") === 0 ? "/weddings-site/" : "/";
    return base + String(src).replace(/^\//, "");
  }

  function renderPackages(pkgs) {
    const host = document.getElementById("pkg-grid");
    if (!host) return;
    const list = Array.isArray(pkgs) && pkgs.length
      ? pkgs
      : [
          {
            id: "single_lesson",
            name: "Private wedding lesson ×1",
            price_label: "$150",
            one_liner: "One focused private session to start with confidence.",
            includes: ["Customized to your level", "Style exploration", "DWTS pro coaching"],
            best_for: ["Testing the waters"],
          },
          {
            id: "package_10",
            name: "Wedding lesson package ×10",
            price_label: "$1,250",
            one_liner: "Full prep arc for a polished first dance.",
            includes: ["10 private sessions", "Flexible scheduling", "Detailed feedback"],
            best_for: ["Show-stopping first dance"],
          },
          {
            id: "dream",
            name: "Dream Wedding Dance",
            price_label: "Custom",
            one_liner: "Choreography, venue coordination, day-of support.",
            includes: ["Personalized choreography", "Rehearsal space", "Performance day support"],
            best_for: ["Full production"],
          },
        ];

    host.innerHTML = list
      .map((p, i) => {
        const featured = p.id === "package_10" || i === 1;
        const includes = (p.includes || []).map((x) => `<li>${esc(x)}</li>`).join("");
        const cta =
          p.id === "single_lesson"
            ? `<a class="btn primary" data-stripe="single_lesson" href="#book">Book trial</a>`
            : p.id === "package_10"
              ? `<a class="btn primary" data-stripe="package_10" href="#book">Choose package</a>`
              : `<a class="btn ghost" href="#book">Request proposal</a>`;
        return `<article class="pkg ${featured ? "featured" : ""}">
          <h3>${esc(p.name)}</h3>
          <div class="pkg-price">${esc(p.price_label)}</div>
          <p class="muted">${esc(p.one_liner)}</p>
          <ul>${includes}</ul>
          ${cta}
        </article>`;
      })
      .join("");
  }

  function wireStripe(stripe) {
    const s = stripe || {};
    const map = {
      single_lesson: s.single_lesson,
      package_10: s.package_10,
    };
    document.querySelectorAll("[data-stripe]").forEach((a) => {
      const key = a.getAttribute("data-stripe");
      const url = map[key];
      if (url) {
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
      }
    });
    const single = document.getElementById("stripe-single");
    const ten = document.getElementById("stripe-10");
    if (single && s.single_lesson) {
      single.href = s.single_lesson;
      single.target = "_blank";
      single.rel = "noopener";
    }
    if (ten && s.package_10) {
      ten.href = s.package_10;
      ten.target = "_blank";
      ten.rel = "noopener";
    }
    const copy = document.getElementById("stripe-copy");
    if (copy) {
      if (s.mode === "live" && (s.single_lesson || s.package_10)) {
        copy.textContent =
          "Secure checkout · live Stripe. After payment we’ll reach out to schedule.";
      } else if (s.single_lesson || s.package_10) {
        copy.textContent = "Secure Stripe checkout (test mode).";
      } else {
        copy.textContent = "Payment links connecting — use the form or email for now.";
      }
    }
  }

  function wireCalendly(url) {
    const link = document.getElementById("calendly-link");
    const copy = document.getElementById("calendly-copy");
    const embed = document.getElementById("calendly-embed");
    if (!url) {
      if (copy) {
        copy.textContent =
          "Scheduling link not connected yet — submit the form and we’ll reach out, or email admin@edytasliwinska.com.";
      }
      return;
    }
    if (copy) {
      copy.textContent =
        "Pick a 15-minute discovery slot. After booking, still submit the form so your details land in Edyta’s Sliw desk.";
    }
    if (link) {
      link.hidden = false;
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open calendar →";
    }
    if (embed) {
      embed.innerHTML =
        '<div class="calendly-inline-widget" data-url="' +
        esc(url) +
        '" style="min-width:280px;height:620px;"></div>';
      if (!document.getElementById("calendly-widget-script")) {
        const s = document.createElement("script");
        s.id = "calendly-widget-script";
        s.src = "https://assets.calendly.com/assets/external/widget.js";
        s.async = true;
        document.body.appendChild(s);
      } else if (window.Calendly && typeof window.Calendly.initInlineWidget === "function") {
        try {
          window.Calendly.initInlineWidget({
            url: url,
            parentElement: embed.querySelector(".calendly-inline-widget"),
          });
        } catch (_) {}
      }
    }
  }

  function renderHeroMedia(hero, stripe) {
    if (!hero || !hero.src) return;
    const host = document.getElementById("hero-visual");
    if (!host) return;
    const src = mediaSrc(hero.src);
    const alt = esc(hero.alt || "Edyta wedding dance studio");
    const type = (hero.type || "image").toLowerCase();
    let mediaHtml = "";
    if (type === "video") {
      const poster = hero.poster ? ` poster="${esc(mediaSrc(hero.poster))}"` : "";
      mediaHtml =
        `<video src="${esc(src)}"${poster} autoplay muted loop playsinline controls></video>`;
    } else if (type === "embed") {
      mediaHtml =
        `<iframe src="${esc(src)}" title="${alt}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
    } else {
      mediaHtml = `<img src="${esc(src)}" alt="${alt}" loading="eager" />`;
    }
    const singleUrl = (stripe && stripe.single_lesson) || "#book";
    const pkgUrl = (stripe && stripe.package_10) || "#book";
    host.innerHTML = `
      <div class="hero-media">
        ${mediaHtml}
        <div class="hero-media-overlay">
          <strong>First dances, zero fear</strong>
          <span>San Rafael · private · DWTS pro</span>
          <div class="hero-media-ctas">
            <a class="btn primary" data-stripe="package_10" href="${esc(pkgUrl)}" ${pkgUrl.startsWith("http") ? 'target="_blank" rel="noopener"' : ""}>$1,250 package</a>
            <a class="btn ghost" data-stripe="single_lesson" href="${esc(singleUrl)}" ${singleUrl.startsWith("http") ? 'target="_blank" rel="noopener"' : ""}>$150 trial</a>
          </div>
        </div>
      </div>`;
  }

  function renderClips(clips) {
    const section = document.getElementById("studio");
    const rail = document.getElementById("clip-rail");
    if (!section || !rail) return;
    const list = Array.isArray(clips) ? clips.filter((c) => c && c.src) : [];
    if (!list.length) {
      section.hidden = true;
      rail.innerHTML = "";
      return;
    }
    section.hidden = false;
    rail.innerHTML = list
      .map((c) => {
        const type = (c.type || "image").toLowerCase();
        const src = mediaSrc(c.src);
        const cap = c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : "";
        let body = "";
        if (type === "video") {
          const poster = c.poster ? ` poster="${esc(mediaSrc(c.poster))}"` : "";
          body = `<video src="${esc(src)}"${poster} controls playsinline preload="metadata"></video>`;
        } else if (type === "embed") {
          body = `<iframe src="${esc(src)}" title="${esc(c.caption || "Clip")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
        } else {
          body = `<img src="${esc(src)}" alt="${esc(c.caption || "Studio")}" loading="lazy" />`;
        }
        return `<figure class="clip-card"><div class="clip-frame">${body}</div>${cap}</figure>`;
      })
      .join("");
  }

  async function loadConfig() {
    try {
      const r = await fetch(API + "/public/wedding-config", { credentials: "omit" });
      if (!r.ok) throw new Error("config " + r.status);
      const cfg = await r.json();
      renderPackages(cfg.packages);
      wireStripe(cfg.stripe);
      wireCalendly(cfg.calendly_url);
      const media = cfg.media || {};
      renderHeroMedia(media.hero, cfg.stripe);
      renderClips(media.clips);
      // Re-wire stripe on any newly injected CTAs
      wireStripe(cfg.stripe);
      return cfg;
    } catch (e) {
      console.warn("[weddings] config fallback", e);
      renderPackages(null);
      return null;
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const status = document.getElementById("form-status");
    const btn = document.getElementById("form-submit");
    const fd = new FormData(form);
    const body = Object.fromEntries(fd.entries());
    // If returning from Stripe, tag message so desk sees paid context
    const paid = (params.get("paid") || "").toLowerCase();
    if (paid && body.message !== undefined) {
      const tag = paid.includes("package") ? "package_10" : "single_lesson";
      body.message = `[Paid Stripe: ${tag}] ${(body.message || "").trim()}`.trim();
      if (!body.package_interest || body.package_interest === "unsure") {
        body.package_interest = tag;
      }
    }
    status.className = "form-status";
    status.textContent = "Sending…";
    btn.disabled = true;
    try {
      const r = await fetch(API + "/public/wedding-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j.detail || j.error || "Could not send — try email admin@edytasliwinska.com");
      }
      status.className = "form-status ok";
      status.textContent = j.deduped
        ? "You’re already on Edyta’s list — we’ll follow up soon."
        : "You’re in. Check your email — Edyta’s desk will follow up shortly.";
      form.reset();
    } catch (err) {
      status.className = "form-status err";
      status.textContent = err.message || String(err);
    } finally {
      btn.disabled = false;
    }
  }

  document.getElementById("lead-form")?.addEventListener("submit", onSubmit);
  loadConfig();
})();
