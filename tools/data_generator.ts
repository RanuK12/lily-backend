import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Types ───────────────────────────────────────────────────────────────────

const AuditAction = z.enum(["create", "update", "delete", "query"]);
type AuditAction = z.infer<typeof AuditAction>;

const Severity = z.enum(["info", "warn", "error", "critical"]);
type Severity = z.infer<typeof Severity>;

export interface AuditEntry {
  id: string;
  agentId: string;
  action: AuditAction;
  timestamp: string;
  metadata: Record<string, unknown>;
  severity: Severity;
}

// ── Arg parsing (lightweight, no deps) ──────────────────────────────────────

const FormatEnum = z.enum(["json", "csv", "both"]);
type FormatEnum = z.infer<typeof FormatEnum>;

const ArgsSchema = z.object({
  format: FormatEnum.default("both"),
  count: z.coerce
    .number()
    .int("count must be an integer")
    .positive("count must be a positive integer (got {input})"),
  seed: z.coerce.number().int().optional(),
  output: z.string().min(1).default("."),
});

type Args = z.infer<typeof ArgsSchema>;

function parseArgs(argv: string[]): Args {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        raw[key] = next;
        i++;
      } else {
        raw[key] = "true";
      }
    }
  }

  const result = ArgsSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join("\n");
    console.error(`Argument validation failed:\n${messages}`);
    process.exit(1);
  }
  return result.data;
}

// ── Data generation ─────────────────────────────────────────────────────────

const ACTIONS: AuditAction[] = ["create", "update", "delete", "query"];
const SEVERITIES: Severity[] = ["info", "warn", "error", "critical"];

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function randomHex(rng: () => number, bytes: number): string {
  let result = "";
  for (let i = 0; i < bytes; i++) {
    result += Math.floor(rng() * 256)
      .toString(16)
      .padStart(2, "0");
  }
  return result;
}

export function generateAuditData(
  count: number,
  seed?: number,
): AuditEntry[] {
  const rng = seed !== undefined ? mulberry32(seed) : Math.random;

  const entries: AuditEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      id: randomUUID(),
      agentId: `agent_${randomHex(rng, 4)}`,
      action: pick(ACTIONS, rng),
      timestamp: new Date(
        Date.now() - Math.floor(rng() * 30 * 24 * 60 * 60 * 1000),
      ).toISOString(),
      metadata: {
        source: pick(["api", "cli", "webhook", "scheduler"], rng),
        durationMs: Math.floor(rng() * 5000),
        success: rng() > 0.2,
      },
      severity: pick(SEVERITIES, rng),
    });
  }
  return entries;
}

// ── Writers ─────────────────────────────────────────────────────────────────

function writeJson(filePath: string, data: AuditEntry[]): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function writeCsv(filePath: string, data: AuditEntry[]): void {
  const headers = [
    "id",
    "agentId",
    "action",
    "timestamp",
    "metadata",
    "severity",
  ];
  const rows = data.map((entry) =>
    [
      entry.id,
      entry.agentId,
      entry.action,
      entry.timestamp,
      JSON.stringify(entry.metadata),
      entry.severity,
    ]
      .map((val) => `"${String(val).replace(/"/g, '""')}"`)
      .join(","),
  );
  writeFileSync(
    filePath,
    [headers.join(","), ...rows].join("\n"),
    "utf-8",
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

export function main(argv: string[] = process.argv.slice(2)): void {
  const args = parseArgs(argv);
  const data = generateAuditData(args.count, args.seed);

  mkdirSync(args.output, { recursive: true });

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 15);
  const prefix = `audit_${timestamp}`;

  const formats: FormatEnum[] =
    args.format === "both" ? ["json", "csv"] : [args.format];

  for (const fmt of formats) {
    const filePath = join(args.output, `${prefix}.${fmt}`);
    if (fmt === "json") {
      writeJson(filePath, data);
    } else {
      writeCsv(filePath, data);
    }
    console.log(`Wrote ${data.length} entries to ${filePath}`);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}
