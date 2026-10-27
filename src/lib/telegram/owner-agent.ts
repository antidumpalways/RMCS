/** Structured, AI-first interpretation for owner conversations. This module never accesses RMCS or writes data. */
import { parseOwnerRupiah } from './owner-intent';
export type OwnerAgentAction =
  | { kind: 'search_products'; query: string }
  | { kind: 'get_product_details'; query: string }
  | { kind: 'get_low_stock' }
  | { kind: 'get_inventory'; query: string | null }
  | { kind: 'propose_stock_in'; query: string; quantity: number | null; unitCost: string | null; sellPrice: string | null; margin: string | null; supplier: string | null }
  | { kind: 'propose_stock_adjustment'; query: string; targetStock: number | null; reason: string | null }
  | { kind: 'propose_price_update'; query: string; field: 'sellPrice' | 'costPrice' | 'margin' | null; amount: string | null }
  | { kind: 'propose_location_change'; query: string; location: string | null }
  | { kind: 'get_business_report'; date: string | null; shift: string | null }
  | { kind: 'request_clarification'; question: string };

export type OwnerAgentTurn = { reply: string; actions: OwnerAgentAction[]; clarification: string | null };
export type OwnerChatMessage = { role: 'user' | 'assistant'; content: string };

export class OwnerAgentTurnValidationError extends Error {
  constructor(readonly reason: string, readonly field?: string, readonly actionIndex?: number) {
    super('OWNER_AGENT_INVALID'); this.name = 'OwnerAgentTurnValidationError';
  }
}

function invalidTurn(reason: string, field?: string, actionIndex?: number): never {
  throw new OwnerAgentTurnValidationError(reason, field, actionIndex);
}

const safeText = (value: unknown, limit = 180): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : null;
const safeQty = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;

function safeDate(value: unknown): string | null {
  const date = safeText(value, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? date : null;
}

export function validateOwnerAgentTurn(value: unknown): OwnerAgentTurn {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidTurn('root_must_be_object');
  const raw = value as Record<string, unknown>;
  const reply = safeText(raw.reply, 900);
  if (!reply) invalidTurn('reply_missing_or_invalid', 'reply');
  if (!Array.isArray(raw.actions)) invalidTurn('actions_must_be_array', 'actions');
  if (raw.actions.length > 8) invalidTurn('too_many_actions', 'actions');
  const actions: OwnerAgentAction[] = [];
  for (const [actionIndex, entry] of raw.actions.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalidTurn('action_must_be_object', undefined, actionIndex);
    const action = entry as Record<string, unknown>;
    const query = safeText(action.query);
    switch (action.kind) {
      case 'search_products':
      case 'get_product_details':
        if (!query) invalidTurn('query_missing_or_invalid', 'query', actionIndex);
        actions.push({ kind: action.kind, query });
        break;
      case 'get_inventory':
        actions.push({ kind: 'get_inventory', query: safeText(action.query) });
        break;
      case 'get_low_stock': actions.push({ kind: 'get_low_stock' }); break;
      case 'propose_stock_in':
        if (!query) invalidTurn('query_missing_or_invalid', 'query', actionIndex);
        actions.push({ kind: 'propose_stock_in', query, quantity: safeQty(action.quantity),
          unitCost: safeText(action.unitCost, 40), sellPrice: safeText(action.sellPrice, 40),
          margin: safeText(action.margin, 40), supplier: safeText(action.supplier, 100) });
        break;
      case 'propose_stock_adjustment':
        if (!query) invalidTurn('query_missing_or_invalid', 'query', actionIndex);
        actions.push({ kind: 'propose_stock_adjustment', query, targetStock: safeQty(action.targetStock), reason: safeText(action.reason, 300) });
        break;
      case 'propose_price_update':
        if (!query) invalidTurn('query_missing_or_invalid', 'query', actionIndex);
        actions.push({ kind: 'propose_price_update', query,
          field: action.field === 'sellPrice' || action.field === 'costPrice' || action.field === 'margin' ? action.field : null,
          amount: safeText(action.amount, 40) });
        break;
      case 'propose_location_change':
        if (!query) invalidTurn('query_missing_or_invalid', 'query', actionIndex);
        actions.push({ kind: 'propose_location_change', query, location: safeText(action.location, 100) });
        break;
      case 'get_business_report':
        if (action.date !== null && action.date !== undefined && !safeDate(action.date)) invalidTurn('date_invalid', 'date', actionIndex);
        actions.push({ kind: 'get_business_report', date: safeDate(action.date), shift: safeText(action.shift, 30) });
        break;
      case 'request_clarification': {
        const question = safeText(action.question, 500);
        if (!question) invalidTurn('question_missing_or_invalid', 'question', actionIndex);
        actions.push({ kind: 'request_clarification', question });
        break;
      }
      default: invalidTurn('action_kind_unsupported', 'kind', actionIndex);
    }
  }
  return { reply, actions, clarification: safeText(raw.clarification, 500) };
}

export function deriveUnitCost(sellPrice: bigint, margin: bigint): bigint | null {
  const cost = sellPrice - margin;
  return cost > 0n && cost <= 1_000_000_000_000n ? cost : null;
}

export function planStockInPricing(action: Extract<OwnerAgentAction, { kind: 'propose_stock_in' }>) {
  const sellPrice = parseOwnerRupiah(action.sellPrice), margin = parseOwnerRupiah(action.margin);
  const explicitCost = parseOwnerRupiah(action.unitCost);
  const derivedCost = sellPrice !== null && margin !== null ? deriveUnitCost(sellPrice, margin) : null;
  if (sellPrice !== null && margin !== null && (derivedCost === null || (explicitCost !== null && explicitCost !== derivedCost))) {
    return { unitCost: null, sellPrice, derived: false, clarification: 'Modal per unit tidak cocok dengan harga jual dan margin.' };
  }
  return { unitCost: explicitCost ?? derivedCost, sellPrice, derived: derivedCost !== null && explicitCost === null, clarification: null };
}

export class OwnerAgentUnavailable extends Error {
  readonly diagnostics: { stage: string; category: string; status?: number; durationMs: number;
    model: string; finishReason?: string | null; validationReason?: string; validationField?: string; actionIndex?: number;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };
  constructor(diagnostics: OwnerAgentUnavailable['diagnostics']) {
    super('OWNER_AGENT_UNAVAILABLE'); this.name = 'OwnerAgentUnavailable'; this.diagnostics = diagnostics;
  }
}

const instructions = `You are R-CELL's Indonesian conversational store assistant. Understand intent from informal Indonesian, slang, abbreviations, typos and natural follow-ups. Do not make the owner use command syntax. Return JSON only: {"reply":"short natural Indonesian reply","clarification":null|string,"actions":[...]}. Extract up to 8 actions in the order requested. For each intent use one of: search_products {query}; get_product_details {query}; get_low_stock; get_inventory {query|null}; propose_stock_in {query,quantity,unitCost,sellPrice,margin,supplier}; propose_stock_adjustment {query,targetStock,reason}; propose_price_update {query,field,amount}; propose_location_change {query,location}; get_business_report {date,shift}; request_clarification {question}. Prices must be strings as written (e.g. 50rb); quantities integers. Only extract facts the owner actually stated. Never invent a product, ID, stock, price, expense, profit, or transaction. For stock corrections, require a reason the owner explicitly gave and copy that reason verbatim; otherwise set reason=null and ask. In a stock-in request, an unqualified “harga 50rb, margin 20rb” means sellPrice=50rb and margin=20rb; derive unitCost as sellPrice minus margin. Map to unitCost only when the owner says modal/harga modal/harga beli. If both sellPrice and margin are stated for stock-in, preserve both; the application will derive unit cost deterministically and disclose it. If a follow-up changes sellPrice and the prior proposal stated a margin, preserve that margin and recalculate the derived cost; if the owner may mean to change the margin too, ask. Corrections update the existing proposal instead of adding a duplicate action. Treat the current proposal list as the complete prior draft and return the complete updated action list. If the owner answers a prior clarification, resolve it and remove the answered clarification action. Do not reactivate cancelled or rejected proposals from message history unless the owner explicitly asks to make that change again. If context is unclear or required values are missing, ask a concise question and do not invent values. A casual acknowledgement such as “oke” never authorizes a database write; writes always require the owner's Telegram confirmation button. If user cancels, return an empty actions array and explain cancellation.`;

export async function interpretOwnerTurn(input: {
  text: string; history: OwnerChatMessage[]; currentActions: OwnerAgentAction[];
  apiKey?: string; model?: string; fetcher?: typeof fetch; timeoutMs?: number;
}): Promise<OwnerAgentTurn> {
  const startedAt = Date.now();
  const model = input.model || 'deepseek-flash';
  const diagnose = (category: string, stage: string, extra: Partial<OwnerAgentUnavailable['diagnostics']> = {}): OwnerAgentUnavailable => {
    const diagnostics = { stage, category, durationMs: Date.now() - startedAt, model, ...extra };
    console.error(JSON.stringify({ event: 'owner_agent_failure', ...diagnostics }));
    return new OwnerAgentUnavailable(diagnostics);
  };
  if (!input.apiKey) throw diagnose('missing_configuration', 'configuration');
  let stage = 'request';
  const timeoutSignal = AbortSignal.timeout(input.timeoutMs ?? 20_000);
  try {
    const response = await (input.fetcher ?? fetch)('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + input.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
        temperature: 0, max_tokens: 2400, stream: false, messages: [
          { role: 'system', content: instructions },
          ...input.history.slice(-12).map(message => ({ role: message.role, content: message.content.slice(0, 1200) })),
          { role: 'user', content: JSON.stringify({ latest_message: input.text.slice(0, 1500), current_proposal: input.currentActions }) },
        ] }), signal: timeoutSignal,
    });
    if (!response.ok) throw diagnose('provider_http_error', 'provider_response', { status: response.status });
    stage = 'provider_response';
    let data: { choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }; model?: string };
    try { data = await response.json() as typeof data; }
    catch { throw diagnose('invalid_provider_response', 'provider_response', { status: response.status }); }
    const choice = data.choices?.[0], finishReason = choice?.finish_reason ?? null;
    const usage = data.usage ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens } : undefined;
    const extra = { status: response.status, finishReason, usage, model: data.model || model };
    if (finishReason === 'length') throw diagnose('truncated_completion', 'completion', extra);
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw diagnose('empty_completion', 'completion', extra);
    stage = 'json_parse';
    let parsed: unknown;
    try { parsed = JSON.parse(content); }
    catch { throw diagnose('invalid_json', 'json_parse', extra); }
    stage = 'schema_validation';
    try {
      const turn = validateOwnerAgentTurn(parsed);
      console.info(JSON.stringify({ event: 'owner_agent_success', stage: 'complete', model: data.model || model,
        durationMs: Date.now() - startedAt, status: response.status, finishReason, usage }));
      return turn;
    } catch (error) {
      const validation = error instanceof OwnerAgentTurnValidationError ? {
        validationReason: error.reason,
        ...(error.field ? { validationField: error.field } : {}),
        ...(error.actionIndex !== undefined ? { actionIndex: error.actionIndex } : {}),
      } : { validationReason: 'unexpected_validator_error' };
      throw diagnose('schema_validation', stage, { ...extra, ...validation });
    }
  } catch (error) {
    if (error instanceof OwnerAgentUnavailable) throw error;
    const aborted = timeoutSignal.aborted || (error instanceof Error && error.name === 'TimeoutError');
    throw diagnose(aborted ? 'timeout' : 'network_error', stage);
  }
}
