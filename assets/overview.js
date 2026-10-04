"use strict";

window.CivicaOverview = (() => {
  let deps = null;

  function renderHealth(health) {
    const root = document.getElementById("overviewHealthStrip");
    if (!root) return;
    if (!health) {
      root.innerHTML = `<div class="overview-health-item neutral">Verificando fontes oficiais…</div>`;
      return;
    }
    const card = (title, data) => {
      const ok = data?.ok;
      return `<div class="overview-health-item ${ok ? "good" : "warn"}"><b>${deps.esc(title)}</b><span>${ok ? "Acessível" : "Indisponível"}${data?.transport ? ` · ${deps.esc(data.transport)}` : ""}${data?.error ? ` · ${deps.esc(data.error)}` : ""}</span></div>`;
    };
    root.innerHTML = card("Candidaturas TSE", health.candidates) + card("Eleitorado / locais TSE", health.electorate);
  }

  function renderMeta(summary, health) {
    const root = document.getElementById("overviewMeta");
    if (!root) return;
    const parts = [];
    if (summary?.generatedAt) parts.push(`Painel gerado em: <b>${deps.esc(deps.formatDate(summary.generatedAt))}</b>`);
    const t = summary?.territory;
    if (t?.queriedAt) parts.push(`Território MA consultado em: <b>${deps.esc(deps.formatDate(t.queriedAt))}</b>`);
    if (t?.sourceUpdatedAt) parts.push(`Arquivo eleitorado atualizado em: <b>${deps.esc(deps.formatDate(t.sourceUpdatedAt))}</b>`);
    if (t?.stale || summary?.offices?.some(o => o.stale)) parts.push(`<span class="stale">⚠ parte dos dados veio de cache/contingência</span>`);
    if (health?.checkedAt) parts.push(`Saúde das fontes: <b>${deps.esc(deps.formatDate(health.checkedAt))}</b>`);
    root.innerHTML = parts.join("") || "";
  }

  function renderMetrics(summary) {
    const t = summary?.territory || {};
    document.getElementById("metricCandidates").textContent = deps.formatMaybe(summary?.totalCandidates);
    document.getElementById("metricMunicipalities").textContent = t.deferred ? "—" : deps.formatMaybe(t.municipalities ?? 217);
    document.getElementById("metricSections").textContent = t.deferred ? (t.error ? "indisponível" : "—") : deps.formatMaybe(t.count);
    document.getElementById("metricZones").textContent = t.deferred ? "—" : deps.formatMaybe(t.zones);
    document.getElementById("metricElectors").textContent = t.deferred ? "—" : deps.formatMaybe(t.eleitores);
  }

  function renderOfficeGrid(summary) {
    const root = document.getElementById("overviewOfficeGrid");
    if (!root) return;
    const offices = summary?.offices || [];
    if (!offices.length) {
      root.innerHTML = `<div class="empty">Não foi possível carregar os cargos.</div>`;
      return;
    }
    root.innerHTML = offices.map(o => {
      const count = Number.isFinite(o.count) ? deps.fmt.format(o.count) : "—";
      const err = o.error ? `<small class="office-error">${deps.esc(o.error)}</small>` : "";
      return `<a class="office-card" href="/candidatos" data-route="/candidatos" data-office-jump="${deps.esc(o.office)}"><span class="office-card-label">${deps.esc(o.label)}</span><strong>${count}</strong><span>candidaturas</span>${err}</a>`;
    }).join("");
    root.querySelectorAll("[data-office-jump]").forEach(el => {
      el.addEventListener("click", () => {
        const office = el.dataset.officeJump;
        if (!office) return;
        deps.state.office = office;
        const candidateOffice = document.getElementById("candidateOffice");
        if (candidateOffice) candidateOffice.value = office;
      });
    });
  }

  function renderTopMunicipalities(summary) {
    const root = document.getElementById("overviewTopMunicipalities");
    if (!root) return;
    const list = summary?.territory?.topMunicipalities || [];
    if (!list.length) {
      root.innerHTML = `<div class="empty">${summary?.territory?.deferred ? "Território ainda não disponível." : "Sem municípios para exibir."}</div>`;
      return;
    }
    deps.renderBarChart(root, list.map(x => ({ label: x.municipio, count: x.eleitores })), "label", "count", 10);
  }

  function renderStatusChart(summary, office) {
    const root = document.getElementById("overviewStatusChart");
    const label = document.getElementById("overviewStatusLabel");
    if (!root) return;
    const block = (summary?.statuses || {})[office] || [];
    if (label) label.textContent = deps.officeLabel(office);
    if (!block.length) {
      root.innerHTML = `<div class="loading">Carregando situações…</div>`;
      return;
    }
    deps.renderBarChart(root, block.map(x => ({ label: x.status, count: x.count })), "label", "count", 8);
  }

  function renderSources() {
    const root = document.getElementById("overviewSources");
    if (!root) return;
    root.innerHTML = `
      <p>O portal é <b>independente</b> do TSE/TRE-MA. Consulta DivulgaCandContas e o ZIP oficial de locais de votação 2026, com cache temporário e contingência via CDN quando necessário.</p>
      <ul class="overview-sources-list">
        <li><a href="https://dadosabertos.tse.jus.br/dataset/candidatos-2026" target="_blank" rel="noopener">Candidatos 2026 (dados abertos) ↗</a></li>
        <li><a href="https://dadosabertos.tse.jus.br/dataset/eleitorado-2026" target="_blank" rel="noopener">Eleitorado por local de votação 2026 ↗</a></li>
        <li>A base privada de pessoas permanece somente no navegador e não é enviada ao TSE.</li>
      </ul>`;
  }

  async function renderCandidatesPreview(office, refresh = false) {
    const root = document.getElementById("overviewCandidates");
    if (!root) return;
    root.innerHTML = `<div class="loading">Carregando candidaturas…</div>`;
    try {
      const data = await deps.getCandidates(office, refresh);
      root.innerHTML = data.candidates.length
        ? data.candidates.slice(0, 6).map(c => deps.candidateCard(c, office)).join("")
        : `<div class="empty">Nenhuma candidatura retornada.</div>`;
      deps.wireImageFallbacks(root);
    } catch (error) {
      root.innerHTML = `<div class="error">${deps.esc(error.message)}</div>`;
    }
  }

  function fillOfficeSelects(summary) {
    const officeIds = Object.keys(deps.offices);
    const html = officeIds.map(k => `<option value="${deps.esc(k)}">${deps.esc(deps.offices[k])}</option>`).join("");
    ["overviewOffice", "overviewStatusOffice"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = html;
      el.value = deps.state.office;
    });
    const statusOffice = document.getElementById("overviewStatusOffice");
    if (statusOffice && !statusOffice.dataset.bound) {
      statusOffice.dataset.bound = "1";
      statusOffice.onchange = e => renderStatusChart(summary, e.target.value);
    }
    const overviewOffice = document.getElementById("overviewOffice");
    if (overviewOffice && !overviewOffice.dataset.bound) {
      overviewOffice.dataset.bound = "1";
      overviewOffice.onchange = async e => {
        deps.state.office = e.target.value;
        await renderCandidatesPreview(deps.state.office);
      };
    }
  }

  async function render(summary, health, refresh = false) {
    renderHealth(health);
    renderMeta(summary, health);
    renderMetrics(summary);
    renderOfficeGrid(summary);
    renderTopMunicipalities(summary);
    renderSources();
    fillOfficeSelects(summary);
    renderStatusChart(summary, document.getElementById("overviewStatusOffice")?.value || deps.state.office);
    await renderCandidatesPreview(document.getElementById("overviewOffice")?.value || deps.state.office, refresh);
  }

  function bind(depsIn) {
    deps = depsIn;
  }

  return { bind, render };
})();
