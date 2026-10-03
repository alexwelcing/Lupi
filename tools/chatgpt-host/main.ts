/** This host deliberately uses the published MCP SDKs. No JSON-RPC bridge
 * methods are fabricated, and no molecule payload enters from a gallery. */
import { Client, StreamableHTTPClientTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { AppBridge, PostMessageTransport, getToolUiResourceUri, RESOURCE_MIME_TYPE, type McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-bridge';

type EventRecord = { at: string; card?: number; direction: string; message: unknown };
type Card = { id: number; result: CallToolResult; args: Record<string, unknown>; iframe: HTMLIFrameElement; wrapper: HTMLElement; bridge: AppBridge; hostContext: McpUiHostContext; context?: unknown; initialized: boolean };
const form = document.querySelector<HTMLFormElement>('#molecule-form')!;
const queryInput = document.querySelector<HTMLInputElement>('#molecule-query')!;
const fresh = document.querySelector<HTMLInputElement>('#fresh-lookup')!;
const status = document.querySelector<HTMLElement>('#host-status')!;
const cardList = document.querySelector<HTMLElement>('#cards')!;
const highlightButton = document.querySelector<HTMLButtonElement>('#highlight-button')!;
const co2Button = document.querySelector<HTMLButtonElement>('#co2-button')!;
const omolButton = document.querySelector<HTMLButtonElement>('#omol-button')!;
const reopenButton = document.querySelector<HTMLButtonElement>('#reopen-button')!;
const showButton = document.querySelector<HTMLButtonElement>('#show-button')!;
const contextPanel = document.querySelector<HTMLElement>('#model-context')!;
const candidates = document.querySelector<HTMLElement>('#candidates')!;
const cards: Card[] = [];
const events: EventRecord[] = [];
let activeCard: Card | undefined;
let resourceUri = '';
let connected = false;
let busy = false;
let nextId = 0;
const client = new Client({ name: 'Lupi Development MCP host', version: '0.1.0' }, { capabilities: {} });

function record(direction: string, message: unknown, card?: number) {
  events.push({ at: new Date().toISOString(), direction, message, ...(card ? { card } : {}) });
}
function setStatus(message: string, error = false) { status.textContent = message; status.dataset.error = String(error); }
function updateButtons() {
  showButton.disabled = busy || !connected;
  co2Button.disabled = busy || !connected;
  omolButton.disabled = busy || !connected;
  highlightButton.disabled = busy || !activeCard;
  reopenButton.disabled = busy || !activeCard;
}
function selectCard(card: Card) {
  activeCard = card;
  for (const other of cards) other.wrapper.dataset.active = String(other === card);
  contextPanel.textContent = JSON.stringify(card.context ?? card.result.structuredContent, null, 2);
  updateButtons();
}
function updateHostContext(card: Card, change: Partial<McpUiHostContext>) {
  // SDK 2.x replaces its stored context, even though its notification includes
  // only changed fields. Always supply the complete merged state.
  card.hostContext = { ...card.hostContext, ...change };
  card.bridge.setHostContext(card.hostContext);
}
function summary(result: CallToolResult) { return result.structuredContent as Record<string, unknown> | undefined; }
function resultMessage(result: CallToolResult): string {
  return result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
}
async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  record('host-to-server', { method: 'tools/call', params: { name, arguments: args } });
  const result = await client.callTool({ name, arguments: args }) as CallToolResult;
  record('server-to-host', result);
  return result;
}

async function mountCard(result: CallToolResult, args: Record<string, unknown>, replay = false): Promise<Card> {
  if (result.isError || summary(result)?.status !== 'shown') throw new Error(resultMessage(result) || 'The server returned no structure.');
  const resource = await client.readResource({ uri: resourceUri });
  const item = resource.contents.find((content) => content.mimeType === RESOURCE_MIME_TYPE && 'text' in content);
  if (!item || !('text' in item)) throw new Error('The server did not return its MCP App HTML resource.');
  const id = ++nextId;
  const wrapper = document.createElement('article');
  wrapper.className = 'card-wrap';
  wrapper.dataset.cardId = String(id);
  const label = document.createElement('div');
  label.className = 'card-label';
  const labelText = document.createElement('span');
  const identity = summary(result);
  labelText.textContent = `${replay ? 'Reopened result' : 'MCP tool result'} ${id} · ${identity?.source === 'OMol25' ? `OMol25 ${identity.collection} row ${identity.rowIndex}` : `PubChem CID ${identity?.cid}`}`;
  const select = document.createElement('button');
  select.type = 'button';
  select.textContent = 'Select for follow-up';
  label.append(labelText, select);
  const iframe = document.createElement('iframe');
  iframe.className = 'widget';
  iframe.title = `Lupi molecule card ${id}`;
  // An opaque origin keeps the app separate from this test host. The widget
  // is self-contained, and receives its record only through the SDK bridge.
  iframe.setAttribute('sandbox', 'allow-scripts');
  wrapper.append(label, iframe);
  if (!cards.length) cardList.replaceChildren();
  cardList.append(wrapper);
  const hostContext: McpUiHostContext = {
    theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'],
    platform: window.innerWidth < 600 ? 'mobile' : 'web', locale: 'en-US',
    containerDimensions: { width: wrapper.clientWidth, maxHeight: 1400 },
  };
  const bridge = new AppBridge(client, { name: 'Development MCP host (not ChatGPT)', version: '0.1.0' }, {
    openLinks: {}, serverTools: {}, serverResources: {}, logging: {}, updateModelContext: { text: {} },
    sandbox: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } },
  }, { hostContext });
  const card: Card = { id, result, args, iframe, wrapper, bridge, hostContext, initialized: false };
  select.onclick = () => selectCard(card);
  bridge.onsizechange = ({ height }) => { if (height && Number.isFinite(height)) iframe.style.height = `${Math.min(1400, Math.max(320, height))}px`; };
  bridge.onupdatemodelcontext = async (context) => {
    card.context = context;
    record('widget-model-context', context, id);
    selectCard(card);
    return {};
  };
  bridge.onopenlink = async ({ url }) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['pubchem.ncbi.nlm.nih.gov', 'huggingface.co', 'lupi.live'].includes(parsed.hostname)) return { isError: true };
    window.open(url, '_blank', 'noopener,noreferrer');
    return {};
  };
  bridge.onrequestdisplaymode = async ({ mode }) => {
    wrapper.classList.toggle('expanded', mode === 'fullscreen');
    updateHostContext(card, { displayMode: mode });
    return { mode };
  };
  bridge.onloggingmessage = (message) => record('widget-log', message, id);
  bridge.oninitialized = () => {
    card.initialized = true;
    void bridge.sendToolInput({ arguments: args }).then(() => bridge.sendToolResult(result));
  };
  class RecordingTransport extends PostMessageTransport {
    override async send(message: Parameters<PostMessageTransport['send']>[0]) {
      record('host-to-widget', message, id);
      return super.send(message);
    }
  }
  await bridge.connect(new RecordingTransport(iframe.contentWindow!, iframe.contentWindow!));
  // Apply the requested empty remote-domain CSP. The app needs inline JS and
  // CSS because the MCP resource is one self-contained document. This local
  // host policy is recorded separately from actual ChatGPT enforcement.
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src \'none\'; worker-src blob:; frame-src \'none\'; base-uri \'none\'; form-action \'none\'">';
  iframe.srcdoc = String(item.text).replace(/<head>/i, `<head>${csp}`);
  cards.push(card);
  selectCard(card);
  wrapper.scrollIntoView({ block: 'start', behavior: 'auto' });
  return card;
}

async function resolveAndShow(query: string, refresh = true) {
  const resolved = await callTool('resolve_molecule', { query, cacheMode: refresh ? 'refresh' : 'prefer-cache' });
  const data = summary(resolved);
  if (data?.status === 'ambiguous') {
    setStatus('PubChem returned more than one identity. Choose a source CID before rendering.');
    for (const candidate of data.candidates as Array<{ cid: number }>) {
      const button = document.createElement('button');
      button.className = 'candidate';
      button.textContent = `PubChem CID ${candidate.cid}`;
      button.onclick = () => void run(() => resolveAndShow(`cid:${candidate.cid}`, refresh));
      candidates.append(button);
    }
    return resolved;
  }
  if (resolved.isError || data?.status !== 'resolved') throw new Error(resultMessage(resolved) || 'The source identity could not be resolved.');
  const args = { structureRef: data.structureRef };
  const shown = await callTool('show_molecule', args);
  await mountCard(shown, args);
  setStatus(`${data.name} · CID ${data.cid} · ${data.dimension === '3d' ? '3D source record' : '2D depiction'} · ${data.cacheHit ? 'validated cache' : 'fresh PubChem retrieval'}`);
  return shown;
}

async function browseOmolAndShow() {
  const collections = await callTool('list_omol25_collections', {});
  if (collections.isError) throw new Error(resultMessage(collections));
  const page = await callTool('search_omol25', { collection: 'neutral-train', offset: 0, limit: 1 });
  const row = (summary(page)?.rows as Array<{ rowIndex: number }> | undefined)?.[0];
  if (page.isError || !Number.isInteger(row?.rowIndex)) throw new Error(resultMessage(page) || 'No OMol25 row was returned.');
  const args = { collection: 'neutral-train', rowIndex: row.rowIndex };
  const opened = await callTool('open_omol25', args);
  await mountCard(opened, args);
  setStatus(`OMol25 neutral-train row ${row.rowIndex} · source 3D atoms · no source bond topology.`);
}

async function highlight() {
  if (!activeCard) return;
  const args = { structureRef: summary(activeCard.result)?.structureRef, view: { highlightElements: ['N'] } };
  const result = await callTool('show_molecule', args);
  await mountCard(result, args);
  setStatus(`Nitrogen follow-up opened a new card for CID ${summary(result)?.cid}. Earlier cards retain their own view.`);
}

async function run(action: () => Promise<unknown>) {
  if (busy) return;
  busy = true; updateButtons(); candidates.replaceChildren(); setStatus('Retrieving the source record…');
  try { await action(); } catch (cause) { setStatus(cause instanceof Error ? cause.message : String(cause), true); }
  finally { busy = false; updateButtons(); }
}
form.onsubmit = (event) => { event.preventDefault(); void run(() => resolveAndShow(queryInput.value.trim(), fresh.checked)); };
highlightButton.onclick = () => void run(highlight);
co2Button.onclick = () => void run(() => resolveAndShow('carbon dioxide', fresh.checked));
omolButton.onclick = () => void run(browseOmolAndShow);
reopenButton.onclick = () => void run(async () => {
  if (activeCard) { await mountCard(activeCard.result, activeCard.args, true); setStatus('Reopened the complete selected tool result in a new local iframe.'); }
});
window.addEventListener('message', (event) => {
  const card = cards.find((candidate) => candidate.iframe.contentWindow === event.source);
  if (card && event.data?.jsonrpc === '2.0') record('widget-to-host', event.data, card.id);
});
window.addEventListener('resize', () => {
  for (const card of cards) updateHostContext(card, { containerDimensions: { width: card.wrapper.clientWidth, maxHeight: 1400 } });
});
Object.defineProperty(window, '__lupiDevHost', { value: {
  state: () => ({ host: 'Development MCP host', actualChatGpt: false, connected, busy, activeCardId: activeCard?.id,
    cards: cards.map((card) => ({ id: card.id, initialized: card.initialized, args: card.args, summary: card.result.structuredContent, context: card.context })), events }),
}, configurable: true });

try {
  await client.connect(new StreamableHTTPClientTransport(new URL('/chatgpt/mcp', window.location.href)));
  const { tools } = await client.listTools();
  const show = tools.find((tool) => tool.name === 'show_molecule');
  resourceUri = show ? getToolUiResourceUri(show) ?? '' : '';
  if (!resourceUri) throw new Error('show_molecule does not advertise its UI resource.');
  connected = true; updateButtons(); setStatus('Connected to the local Worker MCP endpoint. Ready to explore OMol25 or look up PubChem.');
} catch (cause) { setStatus(cause instanceof Error ? cause.message : String(cause), true); }
