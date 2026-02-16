import type { Tool, ToolContext, ToolResult } from '../types.js';

// ---------------------------------------------------------------------------
// CAPTCHA Solving Tools — CapSolver.com Integration
//
// Provides agents with the ability to solve CAPTCHAs encountered during
// browser automation. Uses the CapSolver API (capsolver.com) under the hood.
//
// Supported CAPTCHA types:
//   - reCAPTCHA v2 (checkbox / invisible)
//   - reCAPTCHA v3 (score-based)
//   - reCAPTCHA Enterprise v2/v3
//   - hCaptcha
//   - FunCaptcha (Arkose Labs)
//   - Image-to-text (classic image CAPTCHAs)
//   - Turnstile (Cloudflare)
//
// All tools are dashboard-safe (HTTP API calls only, no browser needed).
// The typical flow for an agent:
//   1. Navigate to page with browser_navigate (worker tool)
//   2. Detect CAPTCHA type and parameters from the page
//   3. Call solveCaptcha (dashboard tool, HTTP to CapSolver)
//   4. Inject the solution token via browser_evaluate (worker tool)
// ---------------------------------------------------------------------------

const CAPSOLVER_API = 'https://api.capsolver.com';

// ── CapSolver task type mapping ─────────────────────────────────────────

const CAPTCHA_TYPE_MAP: Record<string, { proxyless: string; proxy: string }> = {
  recaptchav2: {
    proxyless: 'ReCaptchaV2TaskProxyLess',
    proxy: 'ReCaptchaV2Task',
  },
  recaptchav3: {
    proxyless: 'ReCaptchaV3TaskProxyLess',
    proxy: 'ReCaptchaV3Task',
  },
  recaptchav2enterprise: {
    proxyless: 'ReCaptchaV2EnterpriseTaskProxyLess',
    proxy: 'ReCaptchaV2EnterpriseTask',
  },
  recaptchav3enterprise: {
    proxyless: 'ReCaptchaV3TaskProxyLess',
    proxy: 'ReCaptchaV3Task',
  },
  hcaptcha: {
    proxyless: 'HCaptchaTaskProxyLess',
    proxy: 'HCaptchaTask',
  },
  funcaptcha: {
    proxyless: 'FunCaptchaTaskProxyLess',
    proxy: 'FunCaptchaTask',
  },
  turnstile: {
    proxyless: 'AntiTurnstileTaskProxyLess',
    proxy: 'AntiTurnstileTaskProxyLess',
  },
  imagetotext: {
    proxyless: 'ImageToTextTask',
    proxy: 'ImageToTextTask',
  },
};

// ── Internal helpers ────────────────────────────────────────────────────

async function capsolverRequest(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${CAPSOLVER_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`CapSolver API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Create a CapSolver task and poll until the solution is ready.
 * Handles both synchronous (image-to-text) and async (token) tasks.
 */
async function createAndWaitForTask(
  apiKey: string,
  task: Record<string, unknown>,
  maxWaitMs = 120_000,
): Promise<{ solution: Record<string, unknown>; taskId: string }> {
  const createRes = await capsolverRequest('/createTask', {
    clientKey: apiKey,
    task,
  });

  if ((createRes.errorId as number) > 0) {
    throw new Error(
      `CapSolver createTask failed: ${createRes.errorCode} — ${createRes.errorDescription}`,
    );
  }

  // Synchronous tasks return the solution immediately
  if (createRes.status === 'ready' && createRes.solution) {
    return {
      solution: createRes.solution as Record<string, unknown>,
      taskId: createRes.taskId as string,
    };
  }

  const taskId = createRes.taskId as string;
  if (!taskId) {
    throw new Error('CapSolver createTask did not return a taskId');
  }

  // Poll for async task result
  const startTime = Date.now();
  let pollInterval = 3_000;

  while (Date.now() - startTime < maxWaitMs) {
    await sleep(pollInterval);

    const resultRes = await capsolverRequest('/getTaskResult', {
      clientKey: apiKey,
      taskId,
    });

    if ((resultRes.errorId as number) > 0) {
      throw new Error(
        `CapSolver getTaskResult failed: ${resultRes.errorCode} — ${resultRes.errorDescription}`,
      );
    }

    if (resultRes.status === 'ready') {
      return {
        solution: resultRes.solution as Record<string, unknown>,
        taskId,
      };
    }

    // Back off slightly after first few polls
    if (pollInterval < 5_000) pollInterval += 500;
  }

  throw new Error(`CapSolver task ${taskId} timed out after ${maxWaitMs / 1000}s`);
}

// ── Tool factory ────────────────────────────────────────────────────────

/**
 * Create the set of CAPTCHA-solving tools.
 * Returns executable Tool objects ready for registration.
 */
export function createCaptchaTools(apiKey: string): Tool[] {
  return [
    createSolveCaptchaTool(apiKey),
    createSolveImageCaptchaTool(apiKey),
    createGetCaptchaBalanceTool(apiKey),
  ];
}

/**
 * Get the tool manifest entries for discovery (without API key dependency).
 */
export function getCaptchaToolManifest(): Array<{
  name: string;
  description: string;
  category: string;
  inputSchema: Record<string, unknown>;
  executionTarget: 'dashboard';
  source: 'tool';
}> {
  return [
    {
      name: 'solveCaptcha',
      description:
        'Solve a CAPTCHA (reCAPTCHA v2/v3, hCaptcha, Turnstile, FunCaptcha) on a website. ' +
        'Returns a solution token that can be injected into the page via browser_evaluate. ' +
        'Use after navigating to a page and identifying the CAPTCHA type and site key.',
      category: 'captcha',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['recaptchav2', 'recaptchav3', 'hcaptcha', 'funcaptcha', 'turnstile',
                   'recaptchav2enterprise', 'recaptchav3enterprise'],
            description: 'The type of CAPTCHA to solve.',
          },
          websiteURL: { type: 'string', description: 'The full URL of the page with the CAPTCHA.' },
          websiteKey: { type: 'string', description: 'The site key (data-sitekey attribute) for the CAPTCHA.' },
          pageAction: { type: 'string', description: 'For reCAPTCHA v3: the action parameter (e.g. "login", "submit").' },
          minScore: { type: 'number', description: 'For reCAPTCHA v3: minimum score threshold (0.1-0.9, default 0.7).' },
          isInvisible: { type: 'boolean', description: 'For reCAPTCHA v2: whether the CAPTCHA is invisible.' },
          enterprisePayload: { type: 'object', description: 'For Enterprise reCAPTCHA: additional payload parameters.' },
        },
        required: ['type', 'websiteURL', 'websiteKey'],
      },
      executionTarget: 'dashboard' as const,
      source: 'tool' as const,
    },
    {
      name: 'solveImageCaptcha',
      description:
        'Solve an image-based CAPTCHA (text recognition from image). ' +
        'Provide the CAPTCHA image as a base64-encoded string. ' +
        'Returns the recognized text from the image.',
      category: 'captcha',
      inputSchema: {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'Base64-encoded image of the CAPTCHA (PNG, JPG, GIF).' },
          module: {
            type: 'string',
            description: 'Optional recognition module hint (e.g. "common" for standard text CAPTCHAs).',
          },
        },
        required: ['body'],
      },
      executionTarget: 'dashboard' as const,
      source: 'tool' as const,
    },
    {
      name: 'getCaptchaBalance',
      description:
        'Check the remaining CapSolver account balance. ' +
        'Returns the current balance in USD. Useful before attempting to solve CAPTCHAs.',
      category: 'captcha',
      inputSchema: { type: 'object', properties: {} },
      executionTarget: 'dashboard' as const,
      source: 'tool' as const,
    },
  ];
}

// ── Individual tool constructors ────────────────────────────────────────

function createSolveCaptchaTool(apiKey: string): Tool {
  return {
    name: 'solveCaptcha',
    description:
      'Solve a CAPTCHA (reCAPTCHA v2/v3, hCaptcha, Turnstile, FunCaptcha) on a website and return the solution token.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        websiteURL: { type: 'string' },
        websiteKey: { type: 'string' },
        pageAction: { type: 'string' },
        minScore: { type: 'number' },
        isInvisible: { type: 'boolean' },
        enterprisePayload: { type: 'object' },
      },
      required: ['type', 'websiteURL', 'websiteKey'],
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const captchaType = String(input.type).toLowerCase();
        const mapping = CAPTCHA_TYPE_MAP[captchaType];

        if (!mapping) {
          const supported = Object.keys(CAPTCHA_TYPE_MAP).join(', ');
          return {
            success: false,
            output: `Unknown CAPTCHA type "${input.type}". Supported types: ${supported}`,
          };
        }

        // Build the task object
        const task: Record<string, unknown> = {
          type: mapping.proxyless,
          websiteURL: input.websiteURL,
          websiteKey: input.websiteKey,
        };

        // Type-specific parameters
        if (captchaType === 'recaptchav3' || captchaType === 'recaptchav3enterprise') {
          task.pageAction = input.pageAction ?? '';
          task.minScore = input.minScore ?? 0.7;
        }

        if (captchaType === 'recaptchav2' && input.isInvisible) {
          task.isInvisible = true;
        }

        if (input.enterprisePayload && captchaType.includes('enterprise')) {
          task.enterprisePayload = input.enterprisePayload;
        }

        const { solution, taskId } = await createAndWaitForTask(apiKey, task);

        // Format the result based on CAPTCHA type
        const token = solution.gRecaptchaResponse
          ?? solution.token
          ?? solution.text
          ?? JSON.stringify(solution);

        const result: Record<string, unknown> = {
          token,
          taskId,
          type: captchaType,
        };

        // Include extra fields if present
        if (solution.userAgent) result.userAgent = solution.userAgent;
        if (solution.expireTime) result.expireTime = solution.expireTime;

        return {
          success: true,
          output: JSON.stringify(result),
        };
      } catch (err: any) {
        return {
          success: false,
          output: `CAPTCHA solving failed: ${err.message}`,
        };
      }
    },
  };
}

function createSolveImageCaptchaTool(apiKey: string): Tool {
  return {
    name: 'solveImageCaptcha',
    description:
      'Solve an image-based CAPTCHA by recognizing text from a base64-encoded image.',
    inputSchema: {
      type: 'object',
      properties: {
        body: { type: 'string' },
        module: { type: 'string' },
      },
      required: ['body'],
    },
    execute: async (input: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const task: Record<string, unknown> = {
          type: 'ImageToTextTask',
          body: input.body,
        };

        if (input.module) {
          task.module = input.module;
        }

        const { solution, taskId } = await createAndWaitForTask(apiKey, task);

        return {
          success: true,
          output: JSON.stringify({
            text: solution.text ?? '',
            taskId,
          }),
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Image CAPTCHA solving failed: ${err.message}`,
        };
      }
    },
  };
}

function createGetCaptchaBalanceTool(apiKey: string): Tool {
  return {
    name: 'getCaptchaBalance',
    description: 'Check the remaining CapSolver account balance in USD.',
    inputSchema: { type: 'object', properties: {} },
    execute: async (): Promise<ToolResult> => {
      try {
        const res = await capsolverRequest('/getBalance', {
          clientKey: apiKey,
        });

        if ((res.errorId as number) > 0) {
          return {
            success: false,
            output: `Failed to get balance: ${res.errorCode} — ${res.errorDescription}`,
          };
        }

        return {
          success: true,
          output: JSON.stringify({
            balance: res.balance,
            packages: res.packages ?? [],
          }),
        };
      } catch (err: any) {
        return {
          success: false,
          output: `Failed to get CAPTCHA balance: ${err.message}`,
        };
      }
    },
  };
}
