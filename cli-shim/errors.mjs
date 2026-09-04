/**
 * One vocabulary for failure.
 *
 * Four CLIs fail in four dialects. Claude exits 0 and mentions the failure in a
 * JSON line; codex exits non-zero; devin reports over ACP; antigravity writes to
 * stderr and stops. The shim turned all of that into one string — `agent.id +
 * " exited 1: " + stderr` — and handed it back as an HTTP 502 message.
 *
 * A string is not a decision. The engine wanting to know "should I retry this?"
 * had to match substrings against prose that changes with every CLI release,
 * which is why `isRetryableLLMError` over in the engine is a list of needles.
 * The needles are the symptom; no code was ever sent.
 *
 * So every failure leaving this shim now carries a `code` from the list below,
 * and the engine keys its retry policy off the code. The prose stays — a human
 * still has to read it — but nothing branches on it any more.
 *
 * The list is deliberately short. A code earns its place by changing what the
 * caller does; anything the caller would treat identically is `cli-exit`.
 */

/**
 * @typedef {"cancelled"|"timeout"|"rate-limit"|"upstream"|"auth"
 *   |"model-unavailable"|"cli-missing"|"cli-exit"} ErrorCode
 */

/** Every code, with what it means and whether running the same call again could help. */
export const CODES = {
  /** The caller hung up, or the run was deleted. Not a failure of the model. */
  cancelled: { retry: false, http: 499 },
  /** No output inside the budget. The CLI may be wedged; a fresh spawn often works. */
  timeout: { retry: true, http: 504 },
  /** 429, quota, "please try again". Backing off is the whole fix. */
  "rate-limit": { retry: true, http: 429 },
  /** 5xx, connection reset, gateway. Someone else's outage, usually brief. */
  upstream: { retry: true, http: 502 },
  /** 401/403, expired login, no session. Retrying just fails faster. */
  auth: { retry: false, http: 401 },
  /** The model name is not on this CLI. Retrying is futile; the pin is wrong. */
  "model-unavailable": { retry: false, http: 400 },
  /** The binary is gone. Detection said it was there, so this is worth its own code. */
  "cli-missing": { retry: false, http: 503 },
  /** It failed and did not say why. The honest default. */
  "cli-exit": { retry: false, http: 502 },
};

/** Whether the same call is worth making again. Unknown codes are not retried. */
export function retryable(code) {
  return CODES[code]?.retry === true;
}

/** The HTTP status a code answers with. Unknown codes are a plain 502. */
export function statusOf(code) {
  return CODES[code]?.http ?? 502;
}

/**
 * What went wrong, from what the CLI left behind.
 *
 * Order matters: the caller's own abort outranks everything (a killed child
 * also exits non-zero, and reporting that as a model failure would send someone
 * hunting an outage that was their own cancel button). Then the timeout the
 * shim itself imposed. Only then is the CLI's output evidence of anything.
 */
export function classify({ exitCode = 0, cliError = false, stderr = "", stdout = "",
  aborted = false, timedOut = false, spawnError = null } = {}) {
  if (aborted) return "cancelled";
  if (timedOut) return "timeout";
  if (spawnError?.code === "ENOENT") return "cli-missing";

  const text = `${stderr}\n${stdout}`.toLowerCase();

  // A spawn failure does not always arrive as an object with a `code`: the ACP
  // transport turns it into a rejected promise whose message is the only
  // evidence left. Read before the network patterns, or "ENOENT" is taken for
  // a DNS failure and reported as somebody else's outage.
  if (/\benoent\b|is not recognized as an internal or external command|command not found/.test(text)) {
    return "cli-missing";
  }

  // Auth before rate-limit: a 403 for an expired login often also mentions
  // quota, and telling someone to wait when they need to log in wastes an hour.
  if (/\b(401|403)\b/.test(text)
    || /(invalid api key|unauthorized|not logged in|please (log ?in|authenticate)|session expired|no credentials)/.test(text)) {
    return "auth";
  }
  // Quota is worded differently by everyone who runs out of it: OpenAI says
  // "quota exceeded", devin says "your weekly usage quota has been exhausted"
  // and tags it `resource_exhausted`. Matching one phrasing sent a run that
  // only needed to wait down the non-retryable path.
  if (/\b429\b/.test(text)
    || /(rate.?limit|too many requests|usage limit|overloaded|try again later)/.test(text)
    || /(quota|credits?|balance).{0,24}(exceeded|exhausted|depleted|run out|used up)/.test(text)
    || /resource[_ ]exhausted/.test(text)) {
    return "rate-limit";
  }
  if (/(model .* (not found|not available|does not exist)|unknown model|unsupported model|model_not_available)/.test(text)) {
    return "model-unavailable";
  }
  if (/\b(500|502|503|504)\b/.test(text)
    || /(econnrefused|econnreset|etimedout|enotfound|socket hang up|fetch failed|bad gateway|service unavailable|connection error|unable to connect)/.test(text)) {
    return "upstream";
  }
  if (exitCode !== 0 || cliError) return "cli-exit";
  return "cli-exit";
}

/**
 * The body every failed model request answers with.
 *
 * `error.message` keeps the OpenAI shape so existing clients still read
 * something sensible; `code` and `retryable` are what the engine actually
 * branches on. `detail` is the CLI's own words, capped — a stack trace of
 * someone else's program is not worth a megabyte of response.
 */
export function errorBody(code, agentId, detail = "") {
  const trimmed = String(detail).trim().slice(0, 1000);
  return {
    error: {
      code,
      retryable: retryable(code),
      agent: agentId,
      message: `${agentId}: ${code}${trimmed ? ` — ${trimmed}` : ""}`,
      detail: trimmed,
    },
  };
}

/* ------------------------------------------------------------- self-check */

function demo() {
  const eq = (a, b, why) => {
    if (a !== b) throw new Error(`${why}\n  got:      ${a}\n  expected: ${b}`);
  };

  // A cancel is not a model failure, however the child died.
  eq(classify({ aborted: true, exitCode: 137, stderr: "killed" }), "cancelled",
    "the caller's own abort outranks the exit code");
  eq(classify({ timedOut: true, exitCode: 1 }), "timeout", "the shim's own deadline is named");

  // The CLI's words, read for cause.
  eq(classify({ exitCode: 1, stderr: "Error 401: invalid api key" }), "auth", "401 is auth");
  eq(classify({ exitCode: 1, stderr: "you are not logged in" }), "auth", "a login prompt is auth");
  eq(classify({ exitCode: 1, stderr: "429 rate limit exceeded" }), "rate-limit", "429 is rate-limit");
  // Devin's real wording, which the first version of this file read as cli-exit
  // and therefore refused to retry — for a state that clears by itself.
  eq(classify({ exitCode: 1, stderr:
    '{"code":-32011,"message":"Your weekly usage quota has been exhausted.",'
    + '"data":{"cognition.ai/errorKind":"resource_exhausted"}}' }), "rate-limit",
    "an exhausted quota is a rate limit however it is worded");
  eq(classify({ exitCode: 1, stderr: "insufficient credits exhausted" }), "rate-limit",
    "so is running out of credit");
  eq(classify({ exitCode: 1, stderr: "model gpt-9 does not exist" }), "model-unavailable",
    "a bad model name is not worth retrying");
  eq(classify({ exitCode: 1, stderr: "API Error: Unable to connect to API" }), "upstream",
    "claude's own connection message is an upstream fault");
  eq(classify({ exitCode: 1, stderr: "ECONNRESET" }), "upstream", "a reset socket is upstream");
  eq(classify({ exitCode: 0, cliError: true, stdout: "something went wrong" }), "cli-exit",
    "claude exits 0 and still fails; is_error is enough");
  eq(classify({ spawnError: { code: "ENOENT" } }), "cli-missing", "a missing binary says so");
  // The ACP transport loses the error object and keeps only the message; before
  // this was read, "ENOENT" fell through to the socket patterns and a missing
  // binary was reported as an upstream outage the user could only wait out.
  eq(classify({ exitCode: 1, stderr: "spawn C:\\bin\\devin ENOENT" }), "cli-missing",
    "a spawn failure is still a missing binary when only its text survives");
  eq(classify({ exitCode: 1, stderr: "'devin' is not recognized as an internal or external command" }),
    "cli-missing", "and when Windows words it its own way");

  // Auth wins over a quota mention in the same message.
  eq(classify({ exitCode: 1, stderr: "403 forbidden: quota exceeded for this key" }), "auth",
    "an expired key that also mentions quota is still auth");

  // Retry policy is the point of the whole file.
  eq(retryable("rate-limit"), true, "waiting helps a rate limit");
  eq(retryable("upstream"), true, "an outage is usually brief");
  eq(retryable("timeout"), true, "a wedged CLI is worth one fresh spawn");
  eq(retryable("auth"), false, "retrying a bad key just fails faster");
  eq(retryable("model-unavailable"), false, "the pin is wrong, not the weather");
  eq(retryable("cancelled"), false, "the caller asked for this");
  eq(retryable("nonsense"), false, "an unknown code is never retried");

  // The body carries the decision, not just the prose.
  const body = errorBody("rate-limit", "claude", "  429 slow down  ");
  eq(body.error.code, "rate-limit", "the code survives");
  eq(body.error.retryable, true, "so does the policy");
  eq(body.error.detail, "429 slow down", "the CLI's words are trimmed, not lost");
  eq(statusOf("rate-limit"), 429, "the status matches the cause");
  eq(statusOf("whatever"), 502, "an unknown code answers 502");

  console.log("errors: all checks passed");
}

if (process.argv[1] && process.argv[1].endsWith("errors.mjs")) demo();
