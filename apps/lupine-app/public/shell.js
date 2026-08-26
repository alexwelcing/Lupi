// Operator shell: sidebar + topbar injected into campaign pages.
// Usage: <body class="has-shell"><div id="shell-root"></div> + import { mountShell } from "/shell.js"
import { onUser } from "/app.js";

export function mountShell(active) {
  const root = document.getElementById("shell-root");
  const content = root.innerHTML;
  root.outerHTML = `
    <div class="shell">
      <aside>
        <a class="brand" href="/">Lupine Science</a>
        <div class="nav-section">Operate</div>
        <a class="nav-item ${active === "campaigns" ? "on" : ""}" href="/campaigns">Campaigns</a>
        <a class="nav-item ${active === "new" ? "on" : ""}" href="/campaigns/new">New campaign</a>
        <div class="nav-section">Account</div>
        <a class="nav-item" href="/account">Subscription</a>
        <a class="nav-item" href="https://lupine.science" target="_blank" rel="noopener">Research site ↗</a>
        <a class="nav-item" href="https://lupi.live" target="_blank" rel="noopener">Lupi viewer ↗</a>
      </aside>
      <div class="content">
        <div class="topbar">
          <span id="who" class="muted"></span>
          <span class="spacer"></span>
          <span id="ent-pill"></span>
          <a href="/sign-in" id="auth-link">Sign in</a>
        </div>
        ${content}
      </div>
    </div>`;
  onUser(async (u) => {
    const link = document.getElementById("auth-link");
    const who = document.getElementById("who");
    if (u) {
      link.textContent = "Sign out";
      link.href = "#";
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        const { signOut } = await import("/app.js");
        await signOut();
        location.href = "/";
      });
      who.textContent = u.email || u.uid;
      try {
        const { loadEntitlement } = await import("/app.js");
        const { entitlement } = await loadEntitlement();
        const pill = document.getElementById("ent-pill");
        const label = document.createElement("span");
        if (entitlement && ["active", "trialing"].includes(entitlement.status)) {
          label.className = "pill ok";
          label.textContent = entitlement.status;
        } else {
          label.className = "pill neutral";
          label.textContent = "no subscription";
        }
        pill.replaceChildren(label);
      } catch { /* billing not configured yet */ }
    }
  });
}
