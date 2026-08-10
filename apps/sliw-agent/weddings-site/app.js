/**
 * Wedding storefront — Option A
 * Loads public config (packages, Stripe links, Calendly) and posts leads to Sliw CRM.
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

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
    const tenHero = document.getElementById("btn-stripe-10");
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
    if (tenHero && s.package_10) {
      // hero CTA still goes to form first — payment is secondary
    }
  }

  function wireCalendly(url) {
    const link = document.getElementById("calendly-link");
    const copy = document.getElementById("calendly-copy");
    if (!url) return;
    if (copy) {
      copy.textContent = "Pick a 15-minute discovery slot. After booking, still submit the form so Edyta has your details in Sliw.";
    }
    if (link) {
      link.hidden = false;
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Open Calendly";
    }
    // Optional inline embed if Calendly script allowed later
    const embed = document.getElementById("calendly-embed");
    if (embed && url) {
      embed.innerHTML =
        `<a class="btn primary full" href="${esc(url)}" target="_blank" rel="noopener" style="margin-top:8px">Schedule discovery call</a>`;
    }
  }

  async function loadConfig() {
    try {
      const r = await fetch(API + "/public/wedding-config", { credentials: "omit" });
      if (!r.ok) throw new Error("config " + r.status);
      const cfg = await r.json();
      renderPackages(cfg.packages);
      wireStripe(cfg.stripe);
      wireCalendly(cfg.calendly_url);
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
