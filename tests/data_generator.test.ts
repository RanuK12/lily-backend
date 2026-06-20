import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateAuditData, main } from "../tools/data_generator";
import { readFileSync, readdirSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TEST_OUTPUT_DIR = join(__dirname, "__data_gen_output__");

beforeEach(() => {
  // Clean test output dir
  mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  for (const f of readdirSync(TEST_OUTPUT_DIR)) {
    unlinkSync(join(TEST_OUTPUT_DIR, f));
  }
});

describe("generateAuditData", () => {
  it("returns the requested number of entries", () => {
    const data = generateAuditData(5, 42);
    expect(data).toHaveLength(5);
  });

  it("each entry has the required schema fields", () => {
    const data = generateAuditData(3, 1);
    for (const entry of data) {
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("agentId");
      expect(entry).toHaveProperty("action");
      expect(entry).toHaveProperty("timestamp");
      expect(entry).toHaveProperty("metadata");
      expect(entry).toHaveProperty("severity");
      expect(["create", "update", "delete", "query"]).toContain(entry.action);
      expect(["info", "warn", "error", "critical"]).toContain(entry.severity);
      expect(new Date(entry.timestamp).getTime()).not.toBeNaN();
      expect(entry.agentId).toMatch(/^agent_[0-9a-f]{8}$/);
    }
  });

  it("same seed produces deterministic output (excluding UUIDs)", () => {
    const a = generateAuditData(10, 123);
    const b = generateAuditData(10, 123);
    // randomUUID is not seeded, so we compare everything except id
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.agentId).toBe(b[i]!.agentId);
      expect(a[i]!.action).toBe(b[i]!.action);
      expect(a[i]!.timestamp).toBe(b[i]!.timestamp);
      expect(a[i]!.metadata).toEqual(b[i]!.metadata);
      expect(a[i]!.severity).toBe(b[i]!.severity);
    }
  });

  it("different seeds produce different output", () => {
    const a = generateAuditData(10, 1);
    const b = generateAuditData(10, 2);
    // At least one field should differ (extremely unlikely to be identical)
    const identical = a.every((entry, i) => entry.id === b[i]!.id);
    expect(identical).toBe(false);
  });
});

describe("CLI argument validation", () => {
  // Helper: mock process.exit to throw so execution stops immediately
  function mockExitAndError() {
    const mockError = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockExit = vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
    return { mockExit, mockError };
  }

  it("rejects negative count with clear error", () => {
    const { mockExit, mockError } = mockExitAndError();

    expect(() => main(["--count", "-5"])).toThrow("process.exit(1)");
    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining("count"),
    );

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it("rejects zero count", () => {
    const { mockExit, mockError } = mockExitAndError();

    expect(() => main(["--count", "0"])).toThrow("process.exit(1)");

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it("rejects non-integer count", () => {
    const { mockExit, mockError } = mockExitAndError();

    expect(() => main(["--count", "3.5"])).toThrow("process.exit(1)");

    mockExit.mockRestore();
    mockError.mockRestore();
  });

  it("rejects invalid format", () => {
    const { mockExit, mockError } = mockExitAndError();

    expect(() => main(["--count", "5", "--format", "xml"])).toThrow("process.exit(1)");

    mockExit.mockRestore();
    mockError.mockRestore();
  });
});

describe("format output", () => {
  it("format json creates only .json file", () => {
    main(["--count", "3", "--seed", "42", "--format", "json", "--output", TEST_OUTPUT_DIR]);

    const files = readdirSync(TEST_OUTPUT_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const csvFiles = files.filter((f) => f.endsWith(".csv"));

    expect(jsonFiles).toHaveLength(1);
    expect(csvFiles).toHaveLength(0);

    const content = JSON.parse(readFileSync(join(TEST_OUTPUT_DIR, jsonFiles[0]!), "utf-8"));
    expect(content).toHaveLength(3);
  });

  it("format csv creates only .csv file", () => {
    main(["--count", "3", "--seed", "42", "--format", "csv", "--output", TEST_OUTPUT_DIR]);

    const files = readdirSync(TEST_OUTPUT_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const csvFiles = files.filter((f) => f.endsWith(".csv"));

    expect(csvFiles).toHaveLength(1);
    expect(jsonFiles).toHaveLength(0);

    const content = readFileSync(join(TEST_OUTPUT_DIR, csvFiles[0]!), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(4); // header + 3 rows
  });

  it("format both creates BOTH .json and .csv files (main bug fix)", () => {
    main(["--count", "5", "--seed", "42", "--format", "both", "--output", TEST_OUTPUT_DIR]);

    const files = readdirSync(TEST_OUTPUT_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const csvFiles = files.filter((f) => f.endsWith(".csv"));

    expect(jsonFiles).toHaveLength(1);
    expect(csvFiles).toHaveLength(1);

    // Verify JSON content
    const jsonData = JSON.parse(readFileSync(join(TEST_OUTPUT_DIR, jsonFiles[0]!), "utf-8"));
    expect(jsonData).toHaveLength(5);

    // Verify CSV content has correct row count
    const csvContent = readFileSync(join(TEST_OUTPUT_DIR, csvFiles[0]!), "utf-8");
    const csvLines = csvContent.trim().split("\n");
    expect(csvLines).toHaveLength(6); // header + 5 rows
  });

  it("default format is both when not specified", () => {
    main(["--count", "2", "--seed", "1", "--output", TEST_OUTPUT_DIR]);

    const files = readdirSync(TEST_OUTPUT_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const csvFiles = files.filter((f) => f.endsWith(".csv"));

    expect(jsonFiles).toHaveLength(1);
    expect(csvFiles).toHaveLength(1);
  });
});
