let electron = require("electron");
let node_fs_promises = require("node:fs/promises");
let node_fs = require("node:fs");
let node_path = require("node:path");
let node_url = require("node:url");
//#region functions/_lib/supabaseServer.js
const DEFAULT_URL = "https://kiejevuedddhtgyqrntp.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_FcZ5iv2W-IVzAQnmMjxlnA_w72Y5t_a";
const supabaseUrl = (env = {}) => String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || DEFAULT_URL).replace(/\/$/, "");
const supabasePublishableKey = (env = {}) => env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY;
const supabaseServiceKey = (env = {}) => env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseHeaders = (env, { service = false, token } = {}) => {
	const key = service ? supabaseServiceKey(env) : supabasePublishableKey(env);
	return {
		apikey: key,
		authorization: `Bearer ${token || key}`,
		"content-type": "application/json"
	};
};
//#endregion
//#region functions/_lib/usageTracking.js
const todayUtc = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
async function recordApiUsage(env, { uid, kind, tokens }) {
	if (!uid || !["builder", "deployed"].includes(kind)) return;
	if (env?.SELF_HOSTED_MODE !== "false") return;
	const date = todayUtc();
	try {
		if (!supabaseServiceKey(env)) return;
		const response = await fetch(`${supabaseUrl(env)}/rest/v1/rpc/increment_usage`, {
			method: "POST",
			headers: supabaseHeaders(env, { service: true }),
			body: JSON.stringify({
				target_user_id: uid,
				usage_date: date,
				usage_kind: kind,
				token_count: tokens || 0
			})
		});
		if (!response.ok) {
			const detail = await response.text().catch(() => "");
			console.error("[usage-tracking] update failed:", response.status, detail.slice(0, 200));
		}
	} catch (err) {
		console.error("[usage-tracking]", err?.message || err);
	}
}
function trackApiUsage(env, args, waitUntil) {
	const promise = recordApiUsage(env, args);
	if (typeof waitUntil === "function") waitUntil(promise);
}
//#endregion
//#region functions/_lib/trackTokens.js
const DROPPED_HEADERS = [
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
	"keep-alive"
];
const relayHeaders = (headers) => {
	const out = new Headers(headers);
	for (const name of DROPPED_HEADERS) out.delete(name);
	return out;
};
function wrapWithTokenTracking(env, upstreamResponse, bodyObj, { uid, kind }, waitUntil) {
	if (!upstreamResponse.ok) return new Response(upstreamResponse.body, {
		status: upstreamResponse.status,
		headers: relayHeaders(upstreamResponse.headers)
	});
	if (bodyObj.stream) {
		let tokens = 0;
		const { readable, writable } = new TransformStream({
			start() {
				this.buffer = "";
			},
			transform(chunk, controller) {
				controller.enqueue(chunk);
				const text = new TextDecoder().decode(chunk, { stream: true });
				this.buffer += text;
				const lines = this.buffer.split("\n");
				this.buffer = lines.pop() || "";
				for (const line of lines) if (line.startsWith("data: ") && line !== "data: [DONE]") try {
					const data = JSON.parse(line.slice(6).trim());
					if (data.usage && data.usage.total_tokens) tokens = data.usage.total_tokens;
				} catch {}
			},
			flush() {
				trackApiUsage(env, {
					uid,
					kind,
					tokens: tokens || void 0
				}, waitUntil);
			}
		});
		const pipePromise = upstreamResponse.body.pipeTo(writable).catch(() => {});
		if (typeof waitUntil === "function") waitUntil(pipePromise);
		return new Response(readable, {
			status: upstreamResponse.status,
			headers: relayHeaders(upstreamResponse.headers)
		});
	} else {
		const processNonStreamed = async () => {
			const text = await upstreamResponse.text();
			let tokens = 0;
			try {
				const data = JSON.parse(text);
				if (data.usage && data.usage.total_tokens) tokens = data.usage.total_tokens;
			} catch {}
			trackApiUsage(env, {
				uid,
				kind,
				tokens: tokens || void 0
			}, waitUntil);
			return new Response(text, {
				status: upstreamResponse.status,
				headers: relayHeaders(upstreamResponse.headers)
			});
		};
		return processNonStreamed();
	}
}
//#endregion
//#region functions/_lib/providers.js
const REASONING_PARAMS = /* @__PURE__ */ new Set([
	"reasoning_effort",
	"reasoning",
	"thinking",
	"omit"
]);
const PROVIDERS = {
	"openai-compatible": {
		label: "Any OpenAI-compatible API (set the base URL)",
		baseUrl: "",
		reasoningParam: "reasoning_effort"
	},
	openai: {
		label: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		reasoningParam: "reasoning_effort"
	},
	openrouter: {
		label: "OpenRouter",
		baseUrl: "https://openrouter.ai/api/v1",
		reasoningParam: "reasoning"
	},
	deepseek: {
		label: "DeepSeek",
		baseUrl: "https://api.deepseek.com",
		reasoningParam: "reasoning_effort"
	},
	zai: {
		label: "Z.ai",
		baseUrl: "https://api.z.ai/api/paas/v4",
		reasoningParam: "thinking",
		forcedToolChoice: false,
		streamUsage: false
	},
	"zai-coding": {
		label: "Z.ai Coding Plan",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		reasoningParam: "thinking",
		forcedToolChoice: false,
		streamUsage: false
	}
};
const PRESET_DEFAULTS = {
	forcedToolChoice: true,
	streamUsage: true
};
const DEFAULT_PROVIDER = "openai-compatible";
const PROVIDER_IDS$1 = [...Object.keys(PROVIDERS).filter((id) => id !== DEFAULT_PROVIDER), DEFAULT_PROVIDER];
const OFF_EFFORTS = /* @__PURE__ */ new Set([
	false,
	"none",
	"off",
	"disabled",
	""
]);
const read = (env, name) => String(env?.[name] ?? "").trim();
const warned = /* @__PURE__ */ new Set();
const providerVarScope = (id, prefix = "APPBLIPS_LLM") => `${prefix.replace(/_LLM$/, "")}_${id.toUpperCase().replace(/-/g, "_")}`;
const varNames = (id, prefix) => {
	const generic = {
		apiKey: `${prefix}_API_KEY`,
		model: `${prefix}_MODEL`,
		baseUrl: `${prefix}_BASE_URL`
	};
	if (id === "openai-compatible") return {
		own: generic,
		fallback: generic
	};
	const scope = providerVarScope(id, prefix);
	return {
		own: {
			apiKey: `${scope}_API_KEY`,
			model: `${scope}_MODEL`,
			baseUrl: `${scope}_BASE_URL`
		},
		fallback: generic
	};
};
const resolveProvider = (env, prefix, { quiet = false } = {}) => {
	const requested = read(env, `${prefix}_PROVIDER`).toLowerCase();
	let id = requested;
	let alsoConfigured = [];
	if (requested && !PROVIDERS[requested]) return { error: `Unknown ${prefix}_PROVIDER "${requested}". Use one of: ${PROVIDER_IDS$1.join(", ")}.` };
	if (!id) {
		const configured = PROVIDER_IDS$1.filter((candidate) => read(env, varNames(candidate, prefix).own.apiKey));
		if (!configured.length) return {
			unconfigured: true,
			error: `No AI provider is configured. In your .env, fill in the API key for ONE provider (for example ${varNames("openrouter", prefix).own.apiKey}) and set ${prefix}_MODEL, then restart.`
		};
		id = configured[0];
		alsoConfigured = configured.slice(1);
		if (alsoConfigured.length && !warned.has(prefix)) {
			warned.add(prefix);
			if (!quiet) console.warn(`[llm] Several providers have an API key set (${configured.join(", ")}); using ${id}. Set ${prefix}_PROVIDER to choose.`);
		}
	}
	const names = varNames(id, prefix);
	const pick = (field) => read(env, names.own[field]) || read(env, names.fallback[field]);
	const preset = PROVIDERS[id];
	const override = read(env, `${prefix}_REASONING_PARAM`).toLowerCase();
	const provider = {
		id,
		...PRESET_DEFAULTS,
		...preset,
		apiKey: pick("apiKey"),
		model: pick("model"),
		baseUrl: pick("baseUrl") || preset.baseUrl,
		reasoningParam: REASONING_PARAMS.has(override) ? override : preset.reasoningParam,
		alsoConfigured,
		vars: {
			apiKey: names.own.apiKey,
			model: names.fallback.model,
			baseUrl: names.fallback.baseUrl
		}
	};
	provider.missing = missingVars(provider);
	return provider;
};
const USER_PROVIDER_IDS = PROVIDER_IDS$1.filter((id) => id !== DEFAULT_PROVIDER);
const USER_PROVIDER_OPTIONS = USER_PROVIDER_IDS.map((id) => ({
	id,
	label: PROVIDERS[id].label
}));
const providerLabel = (id) => PROVIDERS[id]?.label || id;
const MAX_USER_KEY_LENGTH = 512;
const MAX_USER_MODEL_LENGTH = 200;
const resolveUserProvider = (input) => {
	if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Invalid provider settings." };
	const id = typeof input.id === "string" ? input.id.trim().toLowerCase() : "";
	const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
	const model = typeof input.model === "string" ? input.model.trim() : "";
	if (!USER_PROVIDER_IDS.includes(id)) return { error: `Choose one of: ${USER_PROVIDER_OPTIONS.map((p) => p.label).join(", ")}.` };
	if (!apiKey) return { error: "The API key is empty." };
	if (apiKey.length > MAX_USER_KEY_LENGTH || /[\s\x00-\x1f\x7f]/.test(apiKey)) return { error: "The API key is not valid." };
	if (!model) return { error: "The model is empty." };
	if (model.length > MAX_USER_MODEL_LENGTH || /[\x00-\x1f\x7f]/.test(model)) return { error: "The model name is not valid." };
	const preset = PROVIDERS[id];
	return {
		id,
		...PRESET_DEFAULTS,
		...preset,
		apiKey,
		model,
		baseUrl: preset.baseUrl,
		reasoningParam: preset.reasoningParam,
		alsoConfigured: [],
		missing: [],
		userSupplied: true
	};
};
const missingVars = (provider) => [
	!provider.apiKey && provider.vars.apiKey,
	!provider.model && provider.vars.model,
	!provider.baseUrl && provider.vars.baseUrl
].filter(Boolean);
const IGNORED_APP_PROVIDER_VARS = [
	"APPBLIPS_APP_LLM_PROVIDER",
	"APPBLIPS_APP_LLM_API_KEY",
	"APPBLIPS_APP_LLM_MODEL",
	"APPBLIPS_APP_LLM_BASE_URL",
	"APPBLIPS_APP_LLM_REASONING_PARAM",
	...PROVIDER_IDS$1.filter((id) => id !== DEFAULT_PROVIDER).flatMap((id) => {
		const own = varNames(id, "APPBLIPS_APP_LLM").own;
		return [
			own.apiKey,
			own.model,
			own.baseUrl
		];
	})
];
const ignoredAppProviderVars = (env) => IGNORED_APP_PROVIDER_VARS.filter((name) => read(env, name));
const APP_AI_LIMITS = [
	"MAX_TOKENS",
	"TEMPERATURE",
	"REASONING_EFFORT"
];
const appAiLimit = (env, name) => read(env, `APPBLIPS_APP_AI_${name}`) || read(env, `APPBLIPS_APP_LLM_${name}`);
const renamedAppAiLimits = (env) => APP_AI_LIMITS.filter((name) => read(env, `APPBLIPS_APP_LLM_${name}`)).map((name) => ({
	from: `APPBLIPS_APP_LLM_${name}`,
	to: `APPBLIPS_APP_AI_${name}`
}));
const resolveAppProvider = (env, options) => resolveProvider(env, "APPBLIPS_LLM", options);
const applyProviderSettings = (bodyObj, provider, { effort } = {}) => {
	const raw = effort ?? "none";
	const off = OFF_EFFORTS.has(raw);
	switch (provider.reasoningParam) {
		case "omit": break;
		case "reasoning":
			bodyObj.reasoning = { effort: off ? "none" : raw };
			break;
		case "thinking":
			bodyObj.thinking = { type: off ? "disabled" : "enabled" };
			if (!off) bodyObj.reasoning_effort = raw;
			break;
		default: bodyObj.reasoning_effort = off ? "none" : raw;
	}
	const reasoningEnabled = !off && provider.reasoningParam !== "omit";
	if (!provider.streamUsage) delete bodyObj.stream_options;
	const choice = bodyObj.tool_choice;
	if ((choice === "required" || choice?.type === "function") && (!provider.forcedToolChoice || reasoningEnabled)) bodyObj.tool_choice = "auto";
	return { reasoningEnabled };
};
//#endregion
//#region functions/_lib/chatProxy.js
const toChatCompletionsUrl = (baseUrl) => {
	const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
	if (!trimmed) return "";
	return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
};
const authorize = async (request, env) => {
	if (env.SELF_HOSTED_MODE !== "false") return { id: "local-user" };
	const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
	if (!token) return null;
	try {
		const res = await fetch(`${supabaseUrl(env)}/auth/v1/user`, { headers: supabaseHeaders(env, { token }) });
		if (!res.ok) return null;
		const data = await res.json();
		return data?.id ? { id: data.id } : null;
	} catch {
		return null;
	}
};
const rateLimitMap = /* @__PURE__ */ new Map();
const checkRateLimit = async (userId, env) => {
	const max = parseInt(env.APPBLIPS_CHAT_RATE_LIMIT_MAX, 10) || 60;
	const windowSeconds = parseInt(env.APPBLIPS_CHAT_RATE_LIMIT_WINDOW_SECONDS, 10) || 300;
	const now = Date.now();
	const windowMs = windowSeconds * 1e3;
	let record = rateLimitMap.get(userId);
	if (!record || now - record.startTime > windowMs) {
		record = {
			startTime: now,
			count: 1
		};
		rateLimitMap.set(userId, record);
		if (rateLimitMap.size > 1e3) {
			for (const [key, val] of rateLimitMap.entries()) if (now - val.startTime > windowMs) rateLimitMap.delete(key);
		}
		return {
			allowed: true,
			windowSeconds
		};
	}
	record.count += 1;
	if (record.count > max) return {
		allowed: false,
		windowSeconds: Math.max(1, Math.ceil((record.startTime + windowMs - now) / 1e3))
	};
	return {
		allowed: true,
		windowSeconds
	};
};
const ALLOWED_TOOL_NAMES = /* @__PURE__ */ new Set([
	"apply_surgical_edits",
	"ask_clarifying_questions",
	"view_code",
	"list_sections",
	"create_page",
	"delete_page",
	"list_pages"
]);
const ALLOWED_ROLES = /* @__PURE__ */ new Set([
	"system",
	"user",
	"assistant",
	"tool"
]);
const ALLOWED_EFFORTS = /* @__PURE__ */ new Set([
	"none",
	"off",
	"disabled",
	"minimal",
	"low",
	"medium",
	"high"
]);
const DEFAULT_MAX_BODY_BYTES = 2097152;
const DEFAULT_MAX_MESSAGES = 100;
const DEFAULT_HOSTED_MAX_TOKENS = 32768;
const DEFAULT_ASK_MAX_TOKENS = 8192;
const isHostedMode = (env) => env.SELF_HOSTED_MODE === "false";
const positiveInt = (value, fallback) => {
	const n = parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
};
const badRequest = (error, status = 400) => new Response(JSON.stringify({ error }), {
	status,
	headers: { "content-type": "application/json" }
});
const validateHostedPayload = (payload, env) => {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "Invalid request body.";
	const { messages, tools, tool_choice, reasoning_effort } = payload;
	const maxMessages = positiveInt(env.APPBLIPS_CHAT_MAX_MESSAGES, DEFAULT_MAX_MESSAGES);
	if (!Array.isArray(messages) || messages.length === 0) return "messages must be a non-empty array.";
	if (messages.length > maxMessages) return "Too many messages in request.";
	for (const m of messages) {
		if (!m || typeof m !== "object" || !ALLOWED_ROLES.has(m.role)) return "Invalid message role.";
		if (m.content != null && typeof m.content !== "string") {
			if (!Array.isArray(m.content)) return "Invalid message content.";
			for (const part of m.content) if (!part || part.type !== "text" && part.type !== "image_url") return "Invalid message content part.";
		}
	}
	if (tools != null) {
		if (!Array.isArray(tools) || tools.length > ALLOWED_TOOL_NAMES.size) return "Invalid tools.";
		for (const t of tools) if (t?.type !== "function" || !ALLOWED_TOOL_NAMES.has(t?.function?.name)) return "Unsupported tool.";
	}
	if (tool_choice != null && typeof tool_choice === "object") {
		if (tool_choice.type !== "function" || !ALLOWED_TOOL_NAMES.has(tool_choice.function?.name)) return "Unsupported tool_choice.";
	} else if (tool_choice != null && ![
		"auto",
		"required",
		"none"
	].includes(tool_choice)) return "Unsupported tool_choice.";
	if (reasoning_effort != null && reasoning_effort !== false && !ALLOWED_EFFORTS.has(reasoning_effort)) return "Unsupported reasoning_effort.";
	const up = payload.user_provider;
	if (up != null) {
		if (typeof up !== "object" || Array.isArray(up)) return "Invalid user_provider.";
		for (const field of [
			"id",
			"apiKey",
			"model"
		]) if (typeof up[field] !== "string") return "Invalid user_provider.";
	}
	return null;
};
const readJsonWithLimit = async (request, maxBytes) => {
	const declared = parseInt(request.headers.get("content-length") || "", 10);
	if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };
	const text = await request.text();
	if (new TextEncoder().encode(text).length > maxBytes) return { tooLarge: true };
	try {
		return { payload: JSON.parse(text) };
	} catch {
		return { invalid: true };
	}
};
const configError = (env, detail) => {
	const hosted = isHostedMode(env);
	if (hosted) console.error(`[chat] ${detail}`);
	return new Response(JSON.stringify({ error: hosted ? "The AI service is temporarily unavailable. Please try again later." : `AppBlips isn't set up yet. ${detail} Or set your own provider in Settings → AI.` }), {
		status: 500,
		headers: { "content-type": "application/json" }
	});
};
const pickProvider = (env, payload) => {
	if (payload?.user_provider != null) {
		const provider = resolveUserProvider(payload.user_provider);
		if (provider.error) return { response: badRequest(`Your AI provider settings are incomplete: ${provider.error}`) };
		return { provider };
	}
	const provider = resolveProvider(env, "APPBLIPS_LLM");
	if (provider.error) return { response: configError(env, provider.error) };
	if (provider.missing.length) return { response: configError(env, `Missing configuration: ${provider.missing.join(", ")}. Add ${provider.missing.length > 1 ? "them" : "it"} to your .env (or your host's environment variables) and restart.`) };
	return { provider };
};
const isForeignOrigin = (request, env) => {
	const origin = request.headers.get("origin");
	if (origin === null) return false;
	let own = "";
	try {
		const url = new URL(request.url);
		own = `${url.protocol}//${url.host}`;
	} catch {}
	if (own && origin === own) return false;
	return !String(env.APPBLIPS_CHAT_ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean).includes(origin);
};
const upstreamErrorMessage = async (upstream) => {
	let text = "";
	try {
		text = await upstream.text();
	} catch {
		return "";
	}
	let message = text;
	try {
		const body = JSON.parse(text);
		const err = body?.error ?? body;
		message = typeof err === "string" ? err : err?.message || body?.message || text;
	} catch {}
	return String(message).replace(/\s+/g, " ").trim().slice(0, 300);
};
const rejectedUserKey = (provider) => badRequest(`${providerLabel(provider.id)} rejected the API key in Settings → AI.`);
async function handleChatProxy(request, env, waitUntil) {
	if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
	if (!isHostedMode(env) && isForeignOrigin(request, env)) return new Response(JSON.stringify({ error: "Requests from other sites are not allowed." }), {
		status: 403,
		headers: { "content-type": "application/json" }
	});
	if (isHostedMode(env) && !supabasePublishableKey(env)) return configError(env, "Missing configuration: SUPABASE_PUBLISHABLE_KEY.");
	const user = await authorize(request, env);
	if (!user) return new Response(JSON.stringify({ error: "Sign in required." }), {
		status: 401,
		statusText: "ProxyAuthFailed",
		headers: { "content-type": "application/json" }
	});
	const hosted = isHostedMode(env);
	if (hosted) {
		const { allowed, windowSeconds } = await checkRateLimit(user.id, env);
		if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded. Please slow down and try again shortly." }), {
			status: 429,
			headers: {
				"content-type": "application/json",
				"Retry-After": String(windowSeconds)
			}
		});
	}
	let payload;
	if (hosted) {
		const maxBytes = positiveInt(env.APPBLIPS_CHAT_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
		const parsed = await readJsonWithLimit(request, maxBytes);
		if (parsed.tooLarge) return badRequest("Request body too large.", 413);
		if (parsed.invalid) return badRequest("Invalid JSON body.");
		payload = parsed.payload;
		const invalid = validateHostedPayload(payload, env);
		if (invalid) return badRequest(invalid);
	} else try {
		payload = await request.json();
	} catch {
		return badRequest("Invalid JSON body.");
	}
	const picked = pickProvider(env, payload);
	if (picked.response) return picked.response;
	const { provider } = picked;
	const url = toChatCompletionsUrl(provider.baseUrl);
	const apiKey = provider.apiKey;
	const model = provider.model;
	const { messages, tools, tool_choice, stream, reasoning_effort, auto_fix, ask } = payload;
	let temperature = .2;
	if (auto_fix === true) temperature = 0;
	else if (env.APPBLIPS_LLM_TEMPERATURE !== void 0 && env.APPBLIPS_LLM_TEMPERATURE !== "") {
		const parsedTemperature = parseFloat(env.APPBLIPS_LLM_TEMPERATURE);
		if (!isNaN(parsedTemperature)) temperature = parsedTemperature;
	}
	const bodyObj = {
		model,
		stream: !!stream,
		messages,
		temperature
	};
	if (bodyObj.stream) bodyObj.stream_options = { include_usage: true };
	if (ask === true) {
		const parsedAskMax = parseInt(env.APPBLIPS_LLM_ASK_MAX_TOKENS, 10);
		bodyObj.max_tokens = parsedAskMax > 0 ? parsedAskMax : DEFAULT_ASK_MAX_TOKENS;
	} else {
		if (env.APPBLIPS_LLM_MAX_TOKENS) {
			const parsedMax = parseInt(env.APPBLIPS_LLM_MAX_TOKENS, 10);
			if (!isNaN(parsedMax)) bodyObj.max_tokens = parsedMax;
		}
		if (hosted && !bodyObj.max_tokens) bodyObj.max_tokens = DEFAULT_HOSTED_MAX_TOKENS;
	}
	if (tools) bodyObj.tools = tools;
	if (tool_choice) bodyObj.tool_choice = tool_choice;
	applyProviderSettings(bodyObj, provider, { effort: reasoning_effort ?? "none" });
	let upstream;
	try {
		upstream = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify(bodyObj)
		});
	} catch (err) {
		return new Response(JSON.stringify({ error: `Failed to reach LLM endpoint: ${err.message}` }), {
			status: 502,
			headers: { "content-type": "application/json" }
		});
	}
	if (provider.userSupplied && (upstream.status === 401 || upstream.status === 403)) {
		upstream.body?.cancel().catch(() => {});
		return rejectedUserKey(provider);
	}
	if (upstream.status === 429) {
		const detail = await upstreamErrorMessage(upstream);
		const retryAfter = upstream.headers.get("retry-after");
		if (isHostedMode(env)) console.error(`[chat] provider 429: ${detail}`);
		return new Response(JSON.stringify({
			error: isHostedMode(env) ? "The AI service is busy. Please try again shortly." : `${providerLabel(provider.id)} turned the request down${detail ? `: ${detail}` : "."}`,
			source: "provider"
		}), {
			status: 429,
			headers: {
				"content-type": "application/json",
				...retryAfter ? { "Retry-After": retryAfter } : {}
			}
		});
	}
	return wrapWithTokenTracking(env, upstream, bodyObj, {
		uid: user.id,
		kind: "builder"
	}, waitUntil);
}
//#endregion
//#region functions/_lib/selfHostedAiRelay.js
const MAX_BODY_BYTES$1 = 262144;
const MAX_MESSAGES = 64;
const json$1 = (body, status, headers = {}) => new Response(JSON.stringify(body), {
	status,
	headers: {
		"content-type": "application/json",
		...headers
	}
});
const failure = (code, status, message, headers) => json$1({ error: {
	code,
	message
} }, status, headers);
const chatUrl = (base) => {
	const clean = String(base || "").trim().replace(/\/+$/, "");
	return /\/chat\/completions$/i.test(clean) ? clean : `${clean}/chat/completions`;
};
const originHeaders = (request, env) => {
	const origin = request.headers.get("origin");
	if (!origin) return {
		allowed: true,
		headers: {}
	};
	let ownOrigin = "";
	try {
		ownOrigin = new URL(request.url).origin;
	} catch {}
	const allowlist = String(env.APPBLIPS_APP_AI_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
	if (origin !== ownOrigin && !allowlist.includes(origin)) return {
		allowed: false,
		headers: {}
	};
	return {
		allowed: true,
		headers: origin === ownOrigin ? {} : {
			"Access-Control-Allow-Origin": origin,
			"Access-Control-Allow-Headers": "content-type",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			Vary: "Origin"
		}
	};
};
async function handleSelfHostedAiChat(request, env) {
	if (env.SELF_HOSTED_MODE === "false" || String(env.APPBLIPS_GENERATED_AI_MODE || "relay").toLowerCase() === "byok") return failure("unauthorized", 403, "Self-hosted app AI relay is disabled.");
	const cors = originHeaders(request, env);
	if (!cors.allowed) return failure("unauthorized", 403, "Request origin is not allowed.");
	if (request.method === "OPTIONS") return new Response(null, {
		status: 204,
		headers: cors.headers
	});
	if (request.method !== "POST") return new Response("Method not allowed", {
		status: 405,
		headers: cors.headers
	});
	let raw;
	try {
		raw = await request.text();
	} catch {
		return failure("payload_too_large", 413, "Request payload is too large.", cors.headers);
	}
	if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES$1) return failure("payload_too_large", 413, "Request payload is too large.", cors.headers);
	let payload;
	try {
		payload = JSON.parse(raw);
	} catch {
		return failure("invalid_request", 400, "Invalid JSON body.", cors.headers);
	}
	const { messages, temperature, max_tokens, stream } = payload || {};
	if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) return failure("invalid_request", 400, "A valid messages array is required.", cors.headers);
	const provider = resolveAppProvider(env);
	if (provider.error) console.error("[app-ai] misconfigured:", provider.error);
	if (provider.error || provider.missing.length) return failure("upstream_error", 502, "App AI service is unavailable.", cors.headers);
	const cap = Math.max(1, parseInt(appAiLimit(env, "MAX_TOKENS"), 10) || 4096);
	const requestedMax = Number.isFinite(Number(max_tokens)) ? Math.max(1, Math.floor(Number(max_tokens))) : cap;
	const requestedTemperature = Number.parseFloat(temperature);
	const configuredTemperature = Number.parseFloat(appAiLimit(env, "TEMPERATURE"));
	const safeMessages = messages.map((message) => ({
		role: [
			"system",
			"user",
			"assistant"
		].includes(message?.role) ? message.role : "user",
		content: typeof message?.content === "string" ? message.content : String(message?.content ?? "")
	}));
	const bodyObj = {
		model: provider.model,
		messages: safeMessages,
		temperature: Number.isFinite(requestedTemperature) ? Math.min(2, Math.max(0, requestedTemperature)) : Number.isFinite(configuredTemperature) ? configuredTemperature : .2,
		max_tokens: Math.min(cap, requestedMax),
		stream: Boolean(stream)
	};
	applyProviderSettings(bodyObj, provider, { effort: appAiLimit(env, "REASONING_EFFORT") || "none" });
	let upstream;
	try {
		upstream = await fetch(chatUrl(provider.baseUrl), {
			method: "POST",
			headers: {
				authorization: `Bearer ${provider.apiKey}`,
				"content-type": "application/json"
			},
			body: JSON.stringify(bodyObj)
		});
	} catch {
		return failure("upstream_error", 502, "App AI request failed.", cors.headers);
	}
	if (!upstream.ok) return failure("upstream_error", 502, "App AI request failed.", cors.headers);
	return new Response(upstream.body, {
		status: 200,
		headers: {
			...cors.headers,
			"content-type": upstream.headers.get("content-type") || (stream ? "text/event-stream" : "application/json")
		}
	});
}
//#endregion
//#region functions/_lib/rateLimit.js
const buckets = /* @__PURE__ */ new Map();
const consumeToken = (key, { max = 20, windowSeconds = 60 } = {}) => {
	const capacity = Math.max(1, Number(max) || 20);
	const windowMs = Math.max(1, Number(windowSeconds) || 60) * 1e3;
	const now = Date.now();
	const refillPerMs = capacity / windowMs;
	const previous = buckets.get(key) || {
		tokens: capacity,
		updatedAt: now
	};
	const tokens = Math.min(capacity, previous.tokens + (now - previous.updatedAt) * refillPerMs);
	if (tokens < 1) {
		buckets.set(key, {
			tokens,
			updatedAt: now
		});
		return {
			allowed: false,
			retryAfter: Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1e3))
		};
	}
	buckets.set(key, {
		tokens: tokens - 1,
		updatedAt: now
	});
	if (buckets.size > 2e3) {
		for (const [bucketKey, bucket] of buckets) if (now - bucket.updatedAt > windowMs * 2) buckets.delete(bucketKey);
	}
	return {
		allowed: true,
		retryAfter: 0
	};
};
//#endregion
//#region functions/_lib/debugUnlock.js
const MAX_BODY_BYTES = 1024;
const encoder = new TextEncoder();
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
	status,
	headers: {
		"content-type": "application/json",
		"cache-control": "no-store",
		...headers
	}
});
const clientIp = (request) => request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
const digest = async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const digestsEqual = (a, b) => {
	let diff = a.length ^ b.length;
	for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ (b[i] ?? 0);
	return diff === 0;
};
const handleDebugUnlock = async (request, env) => {
	const pin = env.APPBLIPS_DEBUG_PIN;
	if (!pin) return json({ ok: false }, 404);
	if (request.method !== "POST") return json({ ok: false }, 405, { allow: "POST" });
	const rate = consumeToken(`debug-unlock:${clientIp(request)}`, {
		max: parseInt(env.APPBLIPS_DEBUG_PIN_RATE_LIMIT_MAX, 10) || 5,
		windowSeconds: parseInt(env.APPBLIPS_DEBUG_PIN_RATE_LIMIT_WINDOW_SECONDS, 10) || 300
	});
	if (!rate.allowed) return json({
		ok: false,
		error: "rate_limited"
	}, 429, { "retry-after": String(rate.retryAfter) });
	const raw = await request.text();
	if (encoder.encode(raw).length > MAX_BODY_BYTES) return json({ ok: false }, 413);
	let submitted = "";
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed?.pin === "string") submitted = parsed.pin;
	} catch {
		return json({ ok: false }, 400);
	}
	const ok = digestsEqual(await digest(submitted), await digest(String(pin)));
	return json({ ok });
};
//#endregion
//#region functions/_lib/configSummary.js
const describeProvider = (provider) => `${provider.label} · ${provider.model} · ${provider.baseUrl}`;
const describeConfig = (env) => {
	const lines = [];
	const hosted = env?.SELF_HOSTED_MODE === "false";
	lines.push({
		level: "info",
		label: "Mode",
		text: hosted ? "hosted (Supabase sign-in, deploys)" : "self-hosted (single local user)"
	});
	const builder = resolveProvider(env, "APPBLIPS_LLM", { quiet: true });
	if (builder.unconfigured && !hosted) lines.push({
		level: "warn",
		label: "Builder AI",
		text: "No provider in .env. Set one there, or pick one in the app under Settings → AI."
	});
	else if (builder.error) lines.push({
		level: "error",
		label: "Builder AI",
		text: builder.error
	});
	else if (builder.missing.length) lines.push({
		level: "error",
		label: "Builder AI",
		text: `${builder.label} is selected but ${builder.missing.join(", ")} ${builder.missing.length > 1 ? "are" : "is"} empty. Add ${builder.missing.length > 1 ? "them" : "it"} to your .env.`
	});
	else lines.push({
		level: "info",
		label: "Builder AI",
		text: describeProvider(builder)
	});
	if (!builder.error && builder.alsoConfigured?.length) lines.push({
		level: "warn",
		text: `Several provider keys are set (${[builder.id, ...builder.alsoConfigured].join(", ")}); using ${builder.id}. Set APPBLIPS_LLM_PROVIDER to choose.`
	});
	const configuredMode = String(env?.APPBLIPS_GENERATED_AI_MODE || "relay").trim().toLowerCase();
	if (!hosted && configuredMode === "byok") lines.push({
		level: "info",
		label: "App AI",
		text: "BYOK, as configured (people using a finished app enter their own key)"
	});
	else if (!builder.error && !builder.missing.length) {
		const where = hosted ? "deployed apps" : "relay";
		lines.push({
			level: "info",
			label: "App AI",
			text: `${where}, sharing the builder's provider · ${builder.model}`
		});
	}
	const renamed = renamedAppAiLimits(env);
	if (renamed.length) lines.push({
		level: "warn",
		text: `Renamed (old names still work for now): ${renamed.map(({ from, to }) => `${from} -> ${to}`).join(", ")}.`
	});
	const ignored = ignoredAppProviderVars(env);
	if (ignored.length) lines.push({
		level: "warn",
		text: `${ignored.join(", ")} ${ignored.length > 1 ? "are" : "is"} no longer used: AI in generated apps always shares the builder's provider and key. Remove ${ignored.length > 1 ? "them" : "it"}.`
	});
	return lines;
};
const formatConfigSummary = (lines) => {
	const mark = {
		info: " ",
		warn: "!",
		error: "x"
	};
	return ["AppBlips configuration", ...lines.map(({ level, label, text }) => {
		const head = label ? `${label} ${".".repeat(Math.max(2, 12 - label.length))} ` : "";
		return `  ${mark[level]} ${head}${text}`;
	})].join("\n");
};
//#endregion
//#region src/lib/pages.js
const LANDING_PAGE = "index.html";
const PAGE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}\.html$/;
function validatePageName(name) {
	return typeof name === "string" && PAGE_NAME_RE.test(name);
}
function makeFiles(landingHtml) {
	return landingHtml ? { [LANDING_PAGE]: landingHtml } : {};
}
function versionFiles(version) {
	if (!version) return {};
	if (version.files && typeof version.files === "object") return version.files;
	return makeFiles(version.code);
}
//#endregion
//#region electron/projectStore.js
const PROJECT_FILE = "project.json";
const APP_DATA_FILE = "app-data.json";
const SITE_DIR = "site";
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_NAME_LENGTH = 200;
const MAX_FOLDER_NAME_LENGTH = 80;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const isValidProjectId = (id) => typeof id === "string" && ID_RE.test(id);
function folderNameFor(name) {
	let clean = String(name ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_FOLDER_NAME_LENGTH).replace(/[. ]+$/, "");
	if (!clean || /^\.+$/.test(clean)) clean = "Untitled app";
	if (WINDOWS_RESERVED.test(clean)) clean = `${clean}_`;
	return clean;
}
const sameFolder = (a, b) => a.toLowerCase() === b.toLowerCase();
function validateRow(row) {
	if (!row || typeof row !== "object" || Array.isArray(row)) return "Project must be an object.";
	if (!isValidProjectId(row.id)) return "Invalid project id.";
	if (typeof row.name !== "string" || row.name.length > MAX_NAME_LENGTH) return "Invalid project name.";
	if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) return "Invalid project data.";
	if (row.updatedAt != null && typeof row.updatedAt !== "string") return "Invalid updatedAt.";
	return null;
}
const sanitizeAppData = (map) => {
	const clean = {};
	if (!map || typeof map !== "object" || Array.isArray(map)) return clean;
	for (const [key, value] of Object.entries(map)) {
		if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
		clean[key] = String(value ?? "");
	}
	return clean;
};
const readJson = async (file) => JSON.parse(await (0, node_fs_promises.readFile)(file, "utf8"));
async function writeFileAtomic(file, contents) {
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	await (0, node_fs_promises.writeFile)(tmp, contents, "utf8");
	for (let attempt = 0;; attempt += 1) try {
		await (0, node_fs_promises.rename)(tmp, file);
		return;
	} catch (err) {
		if (attempt >= 4 || ![
			"EPERM",
			"EACCES",
			"EBUSY"
		].includes(err.code)) {
			await (0, node_fs_promises.rm)(tmp, { force: true });
			throw err;
		}
		await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
	}
}
async function moveDir(from, to) {
	try {
		await (0, node_fs_promises.rename)(from, to);
	} catch (err) {
		if (err.code !== "EXDEV") throw err;
		await (0, node_fs_promises.cp)(from, to, {
			recursive: true,
			errorOnExist: true
		});
		await (0, node_fs_promises.rm)(from, {
			recursive: true,
			force: true
		});
	}
}
function createProjectStore({ root, orphanDir, trash } = {}) {
	let projectsRoot = (0, node_path.resolve)(root);
	const orphanRoot = (0, node_path.resolve)(orphanDir);
	const folders = /* @__PURE__ */ new Map();
	const queues = /* @__PURE__ */ new Map();
	let scanned = false;
	const enqueue = (id, task) => {
		const run = (queues.get(id) || Promise.resolve()).catch(() => {}).then(task);
		const tail = run.catch(() => {});
		queues.set(id, tail);
		tail.then(() => {
			if (queues.get(id) === tail) queues.delete(id);
		});
		return run;
	};
	const folderPath = (folder) => {
		const full = (0, node_path.resolve)(projectsRoot, folder);
		if (!full.startsWith(projectsRoot + node_path.sep)) throw new Error("Project folder escapes the projects root.");
		return full;
	};
	const orphanPath = (id) => (0, node_path.join)(orphanRoot, `${id}.json`);
	const uniqueFolder = (name, ownFolder) => {
		const base = folderNameFor(name);
		for (let n = 1;; n += 1) {
			const candidate = n === 1 ? base : `${base} (${n})`;
			if (ownFolder && sameFolder(candidate, ownFolder)) return candidate;
			if (![...folders.values()].some((f) => sameFolder(f, candidate)) && !(0, node_fs.existsSync)((0, node_path.join)(projectsRoot, candidate))) return candidate;
		}
	};
	async function scan() {
		folders.clear();
		await (0, node_fs_promises.mkdir)(projectsRoot, { recursive: true });
		const seen = /* @__PURE__ */ new Map();
		const entries = await (0, node_fs_promises.readdir)(projectsRoot, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			let row;
			try {
				row = await readJson((0, node_path.join)(projectsRoot, entry.name, PROJECT_FILE));
			} catch {
				continue;
			}
			if (validateRow(row)) continue;
			const prev = seen.get(row.id);
			if (prev !== void 0 && String(prev) >= String(row.updatedAt || "")) continue;
			seen.set(row.id, row.updatedAt || "");
			folders.set(row.id, entry.name);
		}
		scanned = true;
	}
	const ensureScanned = async () => {
		if (!scanned) await scan();
	};
	const flush = async () => {
		while (queues.size) await Promise.all([...queues.values()]);
	};
	async function readAppData(id) {
		const folder = folders.get(id);
		const file = folder ? (0, node_path.join)(folderPath(folder), APP_DATA_FILE) : orphanPath(id);
		try {
			return sanitizeAppData(await readJson(file));
		} catch {
			return null;
		}
	}
	async function writeSiteMirror(dir, row) {
		const versions = Array.isArray(row.data.versions) ? row.data.versions : [];
		const version = versions[Number.isInteger(row.data.currentVersionIndex) ? row.data.currentVersionIndex : versions.length - 1] || versions[versions.length - 1];
		if (!version) return;
		const files = versionFiles(version);
		const names = Object.keys(files).filter((name) => validatePageName(name) && typeof files[name] === "string").slice(0, 12);
		if (!names.length) return;
		const siteDir = (0, node_path.join)(dir, SITE_DIR);
		await (0, node_fs_promises.mkdir)(siteDir, { recursive: true });
		for (const existing of await (0, node_fs_promises.readdir)(siteDir)) if (existing.endsWith(".html") && !names.includes(existing)) await (0, node_fs_promises.rm)((0, node_path.join)(siteDir, existing), { force: true });
		for (const name of names) await writeFileAtomic((0, node_path.join)(siteDir, name), files[name]);
	}
	return {
		get root() {
			return projectsRoot;
		},
		async list() {
			await flush();
			await scan();
			const projects = [];
			for (const [id, folder] of folders) try {
				const row = await readJson((0, node_path.join)(folderPath(folder), PROJECT_FILE));
				projects.push({
					row,
					appData: await readAppData(id)
				});
			} catch (err) {
				console.warn("[projectStore] skipping unreadable project", folder, err.message);
			}
			return projects;
		},
		async orphanAppData() {
			const out = {};
			let names = [];
			try {
				names = await (0, node_fs_promises.readdir)(orphanRoot);
			} catch {
				return out;
			}
			for (const name of names) {
				const id = name.replace(/\.json$/, "");
				if (!name.endsWith(".json") || !isValidProjectId(id) || folders.has(id)) continue;
				try {
					out[id] = sanitizeAppData(await readJson((0, node_path.join)(orphanRoot, name)));
				} catch {}
			}
			return out;
		},
		save(row) {
			const problem = validateRow(row);
			if (problem) return Promise.reject(new Error(problem));
			return enqueue(row.id, async () => {
				await ensureScanned();
				const current = folders.get(row.id);
				const wanted = uniqueFolder(row.name, current);
				if (current && current !== wanted) await moveDir(folderPath(current), folderPath(wanted));
				folders.set(row.id, wanted);
				const dir = folderPath(wanted);
				await (0, node_fs_promises.mkdir)(dir, { recursive: true });
				await writeFileAtomic((0, node_path.join)(dir, PROJECT_FILE), JSON.stringify(row, null, 2));
				if (!current && (0, node_fs.existsSync)(orphanPath(row.id))) await (0, node_fs_promises.rename)(orphanPath(row.id), (0, node_path.join)(dir, APP_DATA_FILE)).catch(() => {});
				await writeSiteMirror(dir, row);
			});
		},
		remove(id) {
			if (!isValidProjectId(id)) return Promise.reject(/* @__PURE__ */ new Error("Invalid project id."));
			return enqueue(id, async () => {
				await ensureScanned();
				await (0, node_fs_promises.rm)(orphanPath(id), { force: true });
				const folder = folders.get(id);
				if (!folder) return;
				const dir = folderPath(folder);
				folders.delete(id);
				if (trash) try {
					await trash(dir);
					return;
				} catch {}
				await (0, node_fs_promises.rm)(dir, {
					recursive: true,
					force: true
				});
			});
		},
		saveAppData(id, map) {
			if (!isValidProjectId(id)) return Promise.reject(/* @__PURE__ */ new Error("Invalid project id."));
			return enqueue(id, async () => {
				await ensureScanned();
				const folder = folders.get(id);
				const file = folder ? (0, node_path.join)(folderPath(folder), APP_DATA_FILE) : orphanPath(id);
				if (map === null) {
					await (0, node_fs_promises.rm)(file, { force: true });
					return;
				}
				await (0, node_fs_promises.mkdir)(folder ? folderPath(folder) : orphanRoot, { recursive: true });
				await writeFileAtomic(file, JSON.stringify(sanitizeAppData(map)));
			});
		},
		folderOf(id) {
			const folder = folders.get(id);
			return folder ? folderPath(folder) : null;
		},
		flush,
		async changeRoot(newRoot, { move = false } = {}) {
			await flush();
			const target = (0, node_path.resolve)(newRoot);
			await (0, node_fs_promises.mkdir)(target, { recursive: true });
			let moved = 0;
			if (move && target !== projectsRoot) {
				await ensureScanned();
				const taken = new Set((await (0, node_fs_promises.readdir)(target)).map((n) => n.toLowerCase()));
				for (const folder of folders.values()) {
					let name = folder;
					for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${folder} (${n})`;
					await moveDir(folderPath(folder), (0, node_path.join)(target, name));
					taken.add(name.toLowerCase());
					moved += 1;
				}
			}
			projectsRoot = target;
			scanned = false;
			await scan();
			return moved;
		},
		async count() {
			await ensureScanned();
			return folders.size;
		}
	};
}
//#endregion
//#region electron/providerStore.js
const PROVIDER_IDS = new Set(USER_PROVIDER_OPTIONS.map((p) => p.id));
const MAX_FIELD = 512;
const clean = (value) => String(value ?? "").trim().slice(0, MAX_FIELD);
function createProviderStore({ file, crypto }) {
	let state = {
		enabled: false,
		id: "",
		model: "",
		key: null
	};
	try {
		const saved = JSON.parse((0, node_fs.readFileSync)(file, "utf8"));
		state = {
			enabled: saved.enabled === true,
			id: PROVIDER_IDS.has(saved.id) ? saved.id : "",
			model: typeof saved.model === "string" ? saved.model : "",
			key: saved.key && typeof saved.key === "object" ? saved.key : null
		};
	} catch {}
	const encrypted = () => crypto.isEncryptionAvailable();
	const weakEncryption = () => !encrypted() || crypto.getSelectedStorageBackend?.() === "basic_text";
	const decryptKey = () => {
		if (!state.key) return "";
		try {
			if (typeof state.key.cipher === "string") return crypto.decryptString(Buffer.from(state.key.cipher, "base64"));
			if (typeof state.key.plain === "string") return state.key.plain;
		} catch (err) {
			console.warn("[providerStore] could not decrypt the saved API key:", err.message);
		}
		return "";
	};
	const encryptKey = (apiKey) => encrypted() ? { cipher: crypto.encryptString(apiKey).toString("base64") } : { plain: apiKey };
	const persist = () => writeFileAtomic(file, JSON.stringify(state, null, 2));
	return {
		describe() {
			return {
				enabled: state.enabled,
				id: state.id,
				model: state.model,
				hasKey: Boolean(state.key),
				weakEncryption: weakEncryption()
			};
		},
		async set({ enabled, id, model, apiKey } = {}) {
			const next = { ...state };
			if (enabled !== void 0) next.enabled = enabled === true;
			if (id !== void 0) {
				if (!PROVIDER_IDS.has(id)) throw new Error("Unknown provider.");
				if (id !== state.id) next.key = null;
				next.id = id;
			}
			if (model !== void 0) next.model = clean(model);
			const key = clean(apiKey);
			if (key) next.key = encryptKey(key);
			state = next;
			await persist();
			return this.describe();
		},
		async clear() {
			state = {
				enabled: false,
				id: "",
				model: "",
				key: null
			};
			await persist();
			return this.describe();
		},
		active() {
			if (!state.enabled || !state.id || !state.model) return null;
			const apiKey = decryptKey();
			return apiKey ? {
				id: state.id,
				model: state.model,
				apiKey
			} : null;
		},
		keyFor(id) {
			return id && id === state.id ? decryptKey() : "";
		}
	};
}
function providerEnv(baseEnv, active) {
	if (!active) return baseEnv;
	const scope = providerVarScope(active.id);
	const env = { ...baseEnv };
	for (const name of [
		"APPBLIPS_LLM_BASE_URL",
		"APPBLIPS_LLM_REASONING_PARAM",
		`${scope}_MODEL`,
		`${scope}_BASE_URL`
	]) delete env[name];
	env.APPBLIPS_LLM_PROVIDER = active.id;
	env[`${scope}_API_KEY`] = active.apiKey;
	env.APPBLIPS_LLM_MODEL = active.model;
	return env;
}
//#endregion
//#region electron/main.js
const SCHEME = "appblips";
const APP_ORIGIN = `${SCHEME}://app`;
const APP_DIR = (0, node_url.fileURLToPath)(new URL("..", require("url").pathToFileURL(__filename).href));
const DIST_DIR = (0, node_path.join)(APP_DIR, "dist");
const DOCS_URL = "https://docs.appblips.com";
const SECURITY_HEADERS = {
	"Content-Security-Policy": "frame-ancestors 'none'",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer"
};
const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".webm": "video/webm",
	".webmanifest": "application/manifest+json",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8"
};
electron.protocol.registerSchemesAsPrivileged([{
	scheme: SCHEME,
	privileges: {
		standard: true,
		secure: true,
		supportFetchAPI: true,
		stream: true,
		corsEnabled: true
	}
}]);
if (!electron.app.requestSingleInstanceLock()) {
	electron.app.quit();
	process.exit(0);
}
let mainWindow = null;
let projectStore;
let providerStore;
const settingsFile = () => (0, node_path.join)(electron.app.getPath("userData"), "settings.json");
const defaultProjectsRoot = () => (0, node_path.join)(electron.app.getPath("documents"), "AppBlips", "Projects");
function readSettings() {
	try {
		return JSON.parse((0, node_fs.readFileSync)(settingsFile(), "utf8")) || {};
	} catch {
		return {};
	}
}
async function writeSettings(patch) {
	await writeFileAtomic(settingsFile(), JSON.stringify({
		...readSettings(),
		...patch
	}, null, 2));
}
function handlerEnv() {
	return providerEnv({
		...process.env,
		SELF_HOSTED_MODE: "true",
		APPBLIPS_GENERATED_AI_MODE: "relay",
		APPBLIPS_APP_AI_ALLOWED_ORIGINS: [process.env.APPBLIPS_APP_AI_ALLOWED_ORIGINS, APP_ORIGIN].filter(Boolean).join(",")
	}, providerStore.active());
}
async function withSavedProvider(request) {
	if (request.method !== "POST") return request;
	const text = await request.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = null;
	}
	if (body && typeof body === "object" && !Array.isArray(body)) {
		const sent = body.user_provider;
		if (sent && typeof sent === "object" && !sent.apiKey) body.user_provider = {
			...sent,
			apiKey: providerStore.keyFor(sent.id)
		};
		else if (sent == null) {
			const active = providerStore.active();
			if (active) body.user_provider = active;
		}
	}
	const origin = request.headers.get("origin");
	return new Request(request.url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...origin ? { origin } : {}
		},
		body: body ? JSON.stringify(body) : text
	});
}
const withSecurityHeaders = (response) => {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};
async function serveStatic(pathname) {
	const requested = decodeURIComponent(pathname);
	const safePath = (0, node_path.normalize)((0, node_path.join)(DIST_DIR, requested));
	if (!safePath.startsWith(DIST_DIR + node_path.sep) && safePath !== DIST_DIR) return new Response("Bad request", {
		status: 400,
		headers: SECURITY_HEADERS
	});
	const indexFile = (0, node_path.join)(DIST_DIR, "index.html");
	let filePath = requested === "/" ? indexFile : safePath;
	try {
		if ((await (0, node_fs_promises.stat)(filePath)).isDirectory()) filePath = (0, node_path.join)(filePath, "index.html");
		await (0, node_fs_promises.stat)(filePath);
	} catch {
		filePath = indexFile;
	}
	try {
		const body = await (0, node_fs_promises.readFile)(filePath);
		return new Response(body, {
			status: 200,
			headers: {
				...SECURITY_HEADERS,
				"Content-Type": MIME_TYPES[(0, node_path.extname)(filePath)] || "application/octet-stream",
				"Cache-Control": filePath === indexFile ? "no-cache" : "public, max-age=3600"
			}
		});
	} catch {
		return new Response("Not found — run `npm run build` first.", {
			status: 404,
			headers: SECURITY_HEADERS
		});
	}
}
async function handleAppRequest(request) {
	const url = new URL(request.url);
	if (url.host !== "app") return new Response("Not found", { status: 404 });
	try {
		switch (url.pathname) {
			case "/api/chat":
				if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
				return withSecurityHeaders(await handleChatProxy(await withSavedProvider(request), handlerEnv()));
			case "/api/app-ai/chat": return withSecurityHeaders(await handleSelfHostedAiChat(request, handlerEnv()));
			case "/api/debug-unlock": return withSecurityHeaders(await handleDebugUnlock(request, handlerEnv()));
			default:
				if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", {
					status: 405,
					headers: SECURITY_HEADERS
				});
				return await serveStatic(url.pathname);
		}
	} catch (err) {
		console.error("[desktop] request failed:", url.pathname, err);
		return new Response(JSON.stringify({ error: "Internal error." }), {
			status: 500,
			headers: {
				...SECURITY_HEADERS,
				"Content-Type": "application/json"
			}
		});
	}
}
const fromApp = (event) => {
	const frame = event.senderFrame;
	return Boolean(frame && frame.parent === null && frame.url.startsWith(`${APP_ORIGIN}/`));
};
function handle(channel, fn) {
	electron.ipcMain.handle(channel, async (event, ...args) => {
		if (!fromApp(event)) throw new Error("Not allowed.");
		return fn(...args);
	});
}
const envProviderConfigured = () => !resolveProvider(process.env, "APPBLIPS_LLM", { quiet: true }).error;
function registerIpc() {
	handle("desktop:projects:list", async () => ({
		projects: await projectStore.list(),
		orphanAppData: await projectStore.orphanAppData()
	}));
	handle("desktop:projects:save", (row) => projectStore.save(row));
	handle("desktop:projects:delete", (id) => projectStore.remove(id));
	handle("desktop:appData:save", (id, map) => projectStore.saveAppData(id, map));
	handle("desktop:provider:get", () => ({
		...providerStore.describe(),
		envConfigured: envProviderConfigured()
	}));
	handle("desktop:provider:set", (patch) => providerStore.set(patch));
	handle("desktop:provider:clear", () => providerStore.clear());
	handle("desktop:folder:get", () => projectStore.root);
	handle("desktop:folder:open", async (id) => {
		const target = id && isValidProjectId(id) ? projectStore.folderOf(id) : null;
		const error = await electron.shell.openPath(target || projectStore.root);
		if (error) throw new Error(error);
	});
	handle("desktop:folder:choose", async () => {
		const picked = await electron.dialog.showOpenDialog(mainWindow, {
			title: "Choose a folder for your AppBlips projects",
			defaultPath: projectStore.root,
			properties: ["openDirectory", "createDirectory"]
		});
		const target = picked.filePaths?.[0];
		if (picked.canceled || !target || (0, node_path.normalize)(target) === projectStore.root) return {
			changed: false,
			root: projectStore.root,
			moved: 0
		};
		if ((0, node_path.normalize)(target).startsWith(projectStore.root + node_path.sep)) throw new Error("Choose a folder outside the current projects folder");
		let move = false;
		const count = await projectStore.count();
		if (count > 0) {
			const { response } = await electron.dialog.showMessageBox(mainWindow, {
				type: "question",
				buttons: [
					"Move projects",
					"Leave them where they are",
					"Cancel"
				],
				defaultId: 0,
				cancelId: 2,
				message: `Move your ${count} ${count === 1 ? "project" : "projects"} to the new folder?`,
				detail: "Projects left in the old folder will no longer appear in AppBlips until you switch back."
			});
			if (response === 2) return {
				changed: false,
				root: projectStore.root,
				moved: 0
			};
			move = response === 0;
		}
		const moved = await projectStore.changeRoot(target, { move });
		await writeSettings({ projectsRoot: projectStore.root });
		return {
			changed: true,
			root: projectStore.root,
			moved
		};
	});
}
const isAppUrl = (url) => url === APP_ORIGIN || url.startsWith(`${APP_ORIGIN}/`);
function lockDown(contents) {
	contents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith(`blob:${APP_ORIGIN}/`)) return {
			action: "allow",
			overrideBrowserWindowOptions: {
				autoHideMenuBar: true,
				backgroundColor: "#ffffff",
				webPreferences: {
					sandbox: true,
					contextIsolation: true,
					nodeIntegration: false
				}
			}
		};
		if (/^https?:\/\//i.test(url)) electron.shell.openExternal(url);
		return { action: "deny" };
	});
	contents.on("will-navigate", (event, url) => {
		if (isAppUrl(url) && isAppUrl(contents.getURL())) return;
		event.preventDefault();
		if (/^https?:\/\//i.test(url)) electron.shell.openExternal(url);
	});
	contents.on("will-attach-webview", (event) => event.preventDefault());
}
const ALLOWED_PERMISSIONS = /* @__PURE__ */ new Set([
	"clipboard-sanitized-write",
	"fullscreen",
	"pointerLock"
]);
function createWindow() {
	mainWindow = new electron.BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 960,
		minHeight: 600,
		show: false,
		backgroundColor: "#080808",
		title: "AppBlips",
		icon: (0, node_path.join)(APP_DIR, "build", "icon.png"),
		autoHideMenuBar: true,
		webPreferences: {
			preload: (0, node_path.join)(APP_DIR, "electron", "preload.cjs"),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			spellcheck: true
		}
	});
	mainWindow.once("ready-to-show", () => mainWindow.show());
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
	mainWindow.loadURL(`${APP_ORIGIN}/`);
}
function buildMenu() {
	const template = [
		{
			label: "File",
			submenu: [
				{
					label: "Open Projects Folder",
					click: () => electron.shell.openPath(projectStore.root)
				},
				{ type: "separator" },
				{ role: "quit" }
			]
		},
		{ role: "editMenu" },
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" }
			]
		},
		{
			label: "Help",
			submenu: [{
				label: "Documentation",
				click: () => electron.shell.openExternal(DOCS_URL)
			}, {
				label: `Version ${electron.app.getVersion()}`,
				enabled: false
			}]
		}
	];
	electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
}
electron.app.on("second-instance", () => {
	if (!mainWindow) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.focus();
});
electron.app.on("web-contents-created", (_event, contents) => lockDown(contents));
electron.app.whenReady().then(() => {
	projectStore = createProjectStore({
		root: readSettings().projectsRoot || defaultProjectsRoot(),
		orphanDir: (0, node_path.join)(electron.app.getPath("userData"), "app-data"),
		trash: (dir) => electron.shell.trashItem(dir)
	});
	providerStore = createProviderStore({
		file: (0, node_path.join)(electron.app.getPath("userData"), "provider.json"),
		crypto: electron.safeStorage
	});
	electron.protocol.handle(SCHEME, handleAppRequest);
	registerIpc();
	buildMenu();
	const allowed = (permission) => ALLOWED_PERMISSIONS.has(permission);
	electron.session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed(permission)));
	electron.session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed(permission));
	console.log(`AppBlips desktop ${electron.app.getVersion()} — projects in ${projectStore.root}`);
	console.log(`\n${formatConfigSummary(describeConfig(handlerEnv()))}\n`);
	createWindow();
});
electron.app.on("window-all-closed", () => electron.app.quit());
let flushed = false;
electron.app.on("before-quit", (event) => {
	if (flushed || !projectStore) return;
	event.preventDefault();
	projectStore.flush().finally(() => {
		flushed = true;
		electron.app.quit();
	});
});
//#endregion
