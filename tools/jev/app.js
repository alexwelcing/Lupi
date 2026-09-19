const form = document.querySelector('#command'), input = document.querySelector('#text');
const status = document.querySelector('#status'), receipt = document.querySelector('#receipt');
const viewer = document.querySelector('#viewer'), run = document.querySelector('#run');
const targetOrigin = 'https://lupi.live';
let busy = false;

function bridge(command) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('Viewer did not respond. Wait until it is ready.')); }, 10000);
    function listener(event) {
      if (event.origin !== targetOrigin || event.source !== viewer.contentWindow
          || event.data?.requestId !== requestId || event.data?.type !== 'lupi:mcp:response') return;
      clearTimeout(timer); window.removeEventListener('message', listener);
      const result = event.data.responses?.[0];
      if (!result?.ok) reject(new Error(result?.error?.message || 'Viewer rejected the command'));
      else resolve(result);
    }
    window.addEventListener('message', listener);
    viewer.contentWindow.postMessage({ type: 'lupi:mcp:execute', requestId, request: { id: requestId, ...command } }, targetOrigin);
  });
}

document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => { if (busy) return; input.value = button.dataset.example; input.focus(); }));
document.querySelector('#load').addEventListener('click', async () => {
  if (busy) return;
  busy = true; run.disabled = true;
  try { const result = await bridge({ tool: 'lupi.generate_molecule', arguments: { inputType: 'template', input: 'Caffeine' } }); status.textContent = 'Caffeine loaded. Try a camera or bond command.'; receipt.textContent = JSON.stringify(result, null, 2); }
  catch (error) { status.textContent = error.message; }
  finally { busy = false; run.disabled = false; input.disabled = false; }
});

form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  busy = true; run.disabled = true; input.disabled = true; status.textContent = 'Interpreting…';
  const started = performance.now();
  try {
    const response = await fetch('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: input.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Request failed');
    const decisionMs = Math.round(performance.now() - started);
    const record = { source: result.source, decisionMs, serverMs: result.elapsedMs, action: result.action, reason: result.reason, confidence: result.confidence, command: result.command };
    receipt.textContent = JSON.stringify(record, null, 2);
    if (!result.command) { status.textContent = `No action applied (${result.reason || 'uncertain'}). Try one specific viewer command.`; return; }
    const applied = await bridge(result.command);
    record.viewer = { ok: applied.ok, tool: applied.tool, result: applied.result };
    record.totalMs = Math.round(performance.now() - started);
    receipt.textContent = JSON.stringify(record, null, 2);
    status.textContent = `Applied ${result.action} · ${decisionMs} ms decision · ${result.source}`;
  } catch (error) { status.textContent = error.message; }
  finally { busy = false; run.disabled = false; input.disabled = false; }
});
